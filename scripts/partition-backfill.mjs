#!/usr/bin/env node
// LORAMER_PARTITION_METRICS_DAILY_V1 — THE HISTORICAL BACKFILL RUNNER.
//
// Moves metrics_daily → metrics_daily_p, month by month, batch by batch. Design:
// docs/LORAMER_PARTITION_METRICS_DAILY_DESIGN_V1.md
//
// ⛔ IT DOES NOT SWAP. It never renames, never drops, never touches metrics_daily's rows. The source is
// READ-ONLY to this script. The swap is a separate, human-gated step.
//
// ⛔ THE PROPERTY THAT MATTERS MOST: IT CANNOT REPORT SUCCESS ON PARTIAL WORK.
//   · the ledger commits OUTSIDE the moving transaction, so progress survives a rollback
//   · every batch is its own transaction — a kill loses at most one batch, never the month
//   · a month may only read 'verified' after BOTH a row count AND a metric checksum match the source
//   · ANY mismatch → state='failed', numbers recorded, THE WHOLE RUN STOPS. It does not skip ahead.
//   · "complete" means EVERY month reads 'verified'. It never means "the loop ended".
//
// ⛔ THE DISK FLOOR IS ABSOLUTE TONIGHT. The disk-modification window is exhausted for ~4 hours, so
// autoscale CANNOT rescue a full disk. Below the floor the run STOPS CLEANLY and exits non-zero.
// There is no "one more batch" — a full disk on Postgres is not a slow query, it is an outage that
// also blocks the vacuum that would recover it.
//
//   node scripts/partition-backfill.mjs --run          move everything not yet verified
//   node scripts/partition-backfill.mjs --status       print the ledger and exit (safe any time)
//   node scripts/partition-backfill.mjs --run --limit-months 1   move one month (a smoke test)
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// ── DISK, AND WHY THIS IS PROGRAMMATIC RATHER THAN A DASHBOARD READ ────────────────────────────────
// PROVISIONED is a CONSTANT TONIGHT and that is the only reason this is safe unattended: the disk
// modification window is exhausted, so the number cannot change under us. USED is read live every
// batch from pg_database_size across all databases plus pg_ls_waldir(). Free = provisioned − used.
// ⛔ If either read fails, the run STOPS — it does not assume headroom it cannot see.
// ⛔ 280 GB, RAISED BY RUSS 2026-08-04 (was 200 GB). src/lib/backfill/universe-window-log.ts carries the
// SAME number and tests/guards/universe-window-log.guard.mjs asserts the two agree — one disk, one
// provisioned figure, one floor. Resize again and BOTH move in the same commit.
const PROVISIONED_BYTES = 280 * 1024 ** 3
const FLOOR_BYTES = Math.max(15 * 1024 ** 3, Math.floor(PROVISIONED_BYTES * 0.20))  // max(15 GB, 20%) = 56 GB
const BATCH_ROWS = 50_000
const MAINTENANCE_WORK_MEM = '2GB'                    // session-scoped; see setSession()

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i === -1 || i + 1 >= argv.length ? d : argv[i + 1] }
const LIMIT_MONTHS = Number(flag('--limit-months', 0)) || Infinity

const { default: pg } = await import('pg')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()

// ⛔ SESSION-SCOPED ONLY. `SET` (not ALTER SYSTEM / ALTER DATABASE) lives and dies with this connection,
// so nothing is left changed for the rest of the fleet when the run ends or is killed.
async function setSession() {
  await client.query(`SET maintenance_work_mem = '${MAINTENANCE_WORK_MEM}'`)
  await client.query(`SET statement_timeout = '0'`)          // batches are bounded by size, not by clock
  await client.query(`SET idle_in_transaction_session_timeout = '0'`)
  const { rows } = await client.query(`select current_setting('maintenance_work_mem') as mwm, current_setting('statement_timeout') as st`)
  return rows[0]
}

async function freeBytes() {
  const { rows } = await client.query(`
    select (select sum(pg_database_size(datname))::bigint from pg_database) as db,
           (select coalesce(sum(size),0)::bigint from pg_ls_waldir()) as wal`)
  const used = Number(rows[0].db) + Number(rows[0].wal)
  if (!Number.isFinite(used) || used <= 0) throw new Error('could not read disk usage — refusing to run blind')
  return { free: PROVISIONED_BYTES - used, used }
}
const gb = (b) => (b / 1024 ** 3).toFixed(2) + ' GB'

async function assertHeadroom(where) {
  const { free, used } = await freeBytes()
  if (free < FLOOR_BYTES) {
    throw Object.assign(new Error(
      `DISK FLOOR BREACHED at ${where}: ${gb(free)} free, floor is ${gb(FLOOR_BYTES)} (used ${gb(used)} of ${gb(PROVISIONED_BYTES)}). ` +
      `STOPPING CLEANLY. Autoscale cannot rescue this tonight — the disk-modification window is exhausted.`), { floorBreach: true, free })
  }
  return free
}

// The checksum is deliberately over the MONEY AND VOLUME columns plus the row count: a copy that moved
// every row but mangled a numeric would pass a count check and fail this one.
const CHECKSUM_SQL = (tbl, where) => `
  select count(*)::text || '|' || coalesce(sum(spend),0)::text || '|' || coalesce(sum(impressions),0)::text
      || '|' || coalesce(sum(clicks),0)::text || '|' || coalesce(sum(conversions),0)::text
      || '|' || coalesce(sum(conversion_value),0)::text || '|' || coalesce(sum(revenue),0)::text as ck
  from public.${tbl} where ${where}`

async function status() {
  const { rows } = await client.query(`
    select state, count(*) as months, sum(src_rows) as src_rows, sum(moved_rows) as moved_rows
    from public.partition_backfill_ledger group by state order by state`)
  console.table(rows)
  const { rows: f } = await client.query(`select month, src_rows, moved_rows, last_error from public.partition_backfill_ledger where state='failed' order by month`)
  if (f.length) { console.error('\n⛔ FAILED MONTHS:'); console.table(f) }
  const { free, used } = await freeBytes()
  console.log(`\ndisk: ${gb(free)} free of ${gb(PROVISIONED_BYTES)} (used ${gb(used)}) · floor ${gb(FLOOR_BYTES)}`)
}

async function moveMonth(month) {
  const lo = month, hi = `(date '${month}' + interval '1 month')::date`
  const whereSrc = `date >= '${lo}' and date < ${hi}`
  await assertHeadroom(`start of ${month}`)
  const free0 = (await freeBytes()).free

  // 1) COUNT FIRST, from the source, and commit it before any row moves.
  const { rows: c } = await client.query(`select count(*)::bigint as n from public.metrics_daily where ${whereSrc}`)
  const srcRows = Number(c[0].n)
  await client.query(
    `update public.partition_backfill_ledger set state='in_progress', src_rows=$2, started_at=coalesce(started_at, now()),
       free_bytes_at_start=$3, last_error=null, updated_at=now() where month=$1`, [month, srcRows, free0])

  if (srcRows === 0) {
    await client.query(`update public.partition_backfill_ledger set state='verified', moved_rows=0, finished_at=now(), updated_at=now() where month=$1`, [month])
    return { month, srcRows: 0, moved: 0, skipped: true }
  }

  // 2) MOVE IN BATCHES, each its own transaction, keyed by id so resume is exact.
  //    ⛔ ON CONFLICT DO NOTHING is correct here and is not laziness: dual-write may already have
  //    placed a live row, and the live row is the NEWER truth. Overwriting it with the historical
  //    copy would move data BACKWARDS in time.
  let lastId = -1, moved = 0
  const { rows: r } = await client.query(
    `select coalesce(max(id),0)::bigint as n from public.metrics_daily_p where ${whereSrc}`)
  if (Number(r[0].n) > 0) {
    const { rows: rr } = await client.query(`select count(*)::bigint as n from public.metrics_daily_p where ${whereSrc}`)
    moved = Number(rr[0].n)
  }

  for (;;) {
    await assertHeadroom(`batch in ${month}`)
    const { rows: b } = await client.query(`
      with src as (
        select * from public.metrics_daily
         where ${whereSrc} and id > $1
         order by id limit ${BATCH_ROWS}
      ), ins as (
        insert into public.metrics_daily_p select * from src
        on conflict on constraint metrics_daily_p_natural_key do nothing
        returning 1
      )
      select (select count(*) from src)::bigint as read, (select max(id) from src)::bigint as max_id`, [lastId])
    const read = Number(b[0].read)
    if (read === 0) break
    lastId = Number(b[0].max_id)
    moved += read
    await client.query(`update public.partition_backfill_ledger set moved_rows=$2, updated_at=now() where month=$1`, [month, moved])
    process.stdout.write(`\r  ${month}  ${moved.toLocaleString()} / ${srcRows.toLocaleString()}   `)
  }
  process.stdout.write('\n')

  // 3) VERIFY BEFORE CLAIMING. Count AND checksum, both, against the source.
  const { rows: sc } = await client.query(CHECKSUM_SQL('metrics_daily', whereSrc))
  const { rows: dc } = await client.query(CHECKSUM_SQL('metrics_daily_p', whereSrc))
  const src = sc[0].ck, dst = dc[0].ck
  if (src !== dst) {
    await client.query(
      `update public.partition_backfill_ledger set state='failed', src_checksum=$2, dst_checksum=$3,
         last_error=$4, finished_at=now(), updated_at=now() where month=$1`,
      [month, src, dst, `checksum/count mismatch — src ${src} vs dst ${dst}`])
    throw Object.assign(new Error(
      `⛔ VERIFICATION FAILED for ${month}\n     source: ${src}\n     dest:   ${dst}\n` +
      `   THE RUN STOPS HERE. It does not continue to the next month — a migration that skips a bad ` +
      `month and finishes "successfully" is the exact defect this project exists to prevent.`), { verifyFail: true })
  }
  await client.query(
    `update public.partition_backfill_ledger set state='verified', moved_rows=$2, src_checksum=$3, dst_checksum=$4,
       finished_at=now(), last_error=null, updated_at=now() where month=$1`, [month, moved, src, dst])
  return { month, srcRows, moved, checksum: src }
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────
try {
  if (argv.includes('--status')) { await status(); await client.end(); process.exit(0) }
  if (!argv.includes('--run')) {
    console.log('LORAMER_PARTITION_METRICS_DAILY_V1 backfill runner')
    console.log('  --status                     print the ledger (safe any time, changes nothing)')
    console.log('  --run                        move every month not yet verified')
    console.log('  --run --limit-months <n>     move at most n months (smoke test)')
    console.log(`\n  batch ${BATCH_ROWS.toLocaleString()} rows · disk floor ${gb(FLOOR_BYTES)} of ${gb(PROVISIONED_BYTES)} provisioned`)
    await client.end(); process.exit(0)
  }

  const s = await setSession()
  console.log(`[session] maintenance_work_mem=${s.mwm} statement_timeout=${s.st} (SESSION-SCOPED — dies with this connection)`)
  const free = await assertHeadroom('run start')
  console.log(`[disk] ${gb(free)} free of ${gb(PROVISIONED_BYTES)} · floor ${gb(FLOOR_BYTES)}`)

  const { rows: todo } = await client.query(
    `select month::text from public.partition_backfill_ledger where state <> 'verified' order by month`)
  console.log(`[plan] ${todo.length} month(s) not yet verified\n`)

  let done = 0
  const t0 = Date.now()
  for (const { month } of todo) {
    if (done >= LIMIT_MONTHS) { console.log(`\n[stop] --limit-months ${LIMIT_MONTHS} reached.`); break }
    const r = await moveMonth(month)
    done++
    if (!r.skipped) console.log(`  ✓ ${month} verified — ${r.moved.toLocaleString()} rows · ${r.checksum}`)
  }

  // ⛔ COMPLETION IS A QUERY, NOT A COUNTER. "The loop ended" is not success.
  const { rows: left } = await client.query(
    `select count(*)::int as n from public.partition_backfill_ledger where state <> 'verified'`)
  const secs = Math.round((Date.now() - t0) / 1000)
  if (left[0].n === 0) console.log(`\n✅ COMPLETE — every month reads 'verified'. ${done} moved this run, ${secs}s.`)
  else console.log(`\n⏸ NOT COMPLETE — ${left[0].n} month(s) still unverified. ${done} moved this run, ${secs}s. Re-run to continue.`)
  await client.end()
  process.exit(left[0].n === 0 ? 0 : 2)
} catch (e) {
  console.error(`\n${e.message}`)
  try { await client.end() } catch {}
  process.exit(e.floorBreach ? 3 : e.verifyFail ? 4 : 1)
}
