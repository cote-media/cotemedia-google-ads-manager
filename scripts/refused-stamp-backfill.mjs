#!/usr/bin/env node
// LORAMER_REFUSED_STAMP_BACKFILL_V1 — stamp the PRE-FIX rows and null the ratios built on refused metrics.
//
// ⛔ WHAT IS WRONG WITH THOSE ROWS. 1,841,461 landed google rows hold a metric the vendor REFUSED as a plain
// `0`, with `roas`/`cpa`/`cpc`/`ctr`/`cpm` computed on it, and nothing marking any of it. Lora reads them
// today as true zeros. The writer stopped producing them on 2026-08-04; NO FUTURE WRITE REPAIRS THE EXISTING
// ONES, which is why this exists.
//
// ⛔ ZERO VENDOR QUOTA, AND THAT IS THE WHOLE DESIGN. Which metrics are refused is a property of the
// (breakdown_type, entity_level) GRAIN and was measured by the probe into the capture artifact. Every value
// written here is derived from data we already hold — there is no re-fetch and no Google request.
//
// ⛔ THE METRIC COLUMNS CANNOT BE FIXED AND THIS SCRIPT DOES NOT PRETEND OTHERWISE. spend/clicks/impressions/
// conversions/conversion_value are NOT NULL DEFAULT 0, so a refused metric MUST remain 0 in its column. What
// changes is that the row now SAYS SO (extra.refusedMetrics + the vendor's reason) and that every ratio built
// on the refusal becomes null instead of a confident 0. The read path (LORAMER_REFUSED_RATIO_IS_NULL_V1)
// turns the column into null on the way out.
//
//   node scripts/refused-stamp-backfill.mjs --status
//   node scripts/refused-stamp-backfill.mjs            (run; resumable, batched, disk-floored)
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// ⛔ SAME DISK CONSTANTS AS EVERY OTHER WRITER ON THIS VOLUME. An UPDATE is not free: it writes a new heap
// tuple per row and leaves the old one dead, so 1.84M updates cost real disk before autovacuum reclaims it.
const PROVISIONED_BYTES = 280 * 1024 ** 3
const FLOOR_BYTES = Math.max(15 * 1024 ** 3, Math.floor(PROVISIONED_BYTES * 0.2))
const BATCH = 20_000
const gb = (b) => (b / 1024 ** 3).toFixed(2) + ' GB'

const KEYS = {
  'metrics.cost_micros': 'spend', 'metrics.impressions': 'impressions', 'metrics.clicks': 'clicks',
  'metrics.conversions': 'conversions', 'metrics.conversions_value': 'conversion_value',
}
const RATIO_INPUTS = {
  ctr: ['clicks', 'impressions'], cpc: ['spend', 'clicks'], cpm: ['spend', 'impressions'],
  roas: ['conversion_value', 'spend'], cpa: ['spend', 'conversions'], convRate: ['conversions', 'clicks'],
}

const doc = JSON.parse(readFileSync(resolve(ROOT, 'docs/google-ads-capture-universe.json'), 'utf8'))
const GRAINS = []
for (const e of doc.entries) {
  if (!e.refusesMetrics || e.refusesMetrics.length === 0) continue
  const bt = e.segment ? e.segment.replace(/^segments\./, '').replace(/\./g, '_') : e.resource
  const refused = [...new Set(e.refusesMetrics.map((x) => KEYS[x] || x))].sort()
  GRAINS.push({
    bt, level: e.resource, refused,
    reason: e.metricSetReason || 'refused, no reason recorded',
    code: (/"query_error":(\d+)/.exec(e.metricSetReason || '') || [])[1] || null,
    serves: [...new Set((e.servesMetrics || []).map((x) => KEYS[x] || x))].sort(),
    // Ratios poisoned by this grain's refusals — EITHER side counts.
    nullRatios: Object.entries(RATIO_INPUTS)
      .filter(([, [n, d]]) => refused.includes(n) || refused.includes(d)).map(([k]) => k),
  })
}

const { default: pg } = await import('pg')
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()
await c.query(`SET statement_timeout = '0'`)

async function freeBytes() {
  const { rows } = await c.query(`
    select (select sum(pg_database_size(datname))::bigint from pg_database) db,
           (select coalesce(sum(size),0)::bigint from pg_ls_waldir()) wal`)
  const used = Number(rows[0].db) + Number(rows[0].wal)
  if (!Number.isFinite(used) || used <= 0) throw new Error('could not read disk usage — refusing to run blind')
  return { free: PROVISIONED_BYTES - used, used }
}
async function assertFloor(where) {
  const { free, used } = await freeBytes()
  if (free < FLOOR_BYTES) {
    throw Object.assign(new Error(
      `DISK FLOOR BREACHED at ${where}: ${gb(free)} free, floor ${gb(FLOOR_BYTES)} (used ${gb(used)} of ${gb(PROVISIONED_BYTES)}). ` +
      `STOPPING CLEANLY — an UPDATE backfill generates dead tuples faster than autovacuum reclaims them.`), { floorBreach: true })
  }
  return free
}

if (process.argv.includes('--status')) {
  const { rows } = await c.query(`select state, count(*) grains, sum(rows_stamped) stamped, sum(rows_remaining) remaining
                                  from public.refused_stamp_backfill_ledger group by state order by state`)
  console.table(rows)
  const { rows: f } = await c.query(`select breakdown_type, entity_level, rows_remaining, left(last_error,160) last_error
                                     from public.refused_stamp_backfill_ledger where state in ('failed','running') order by 1,2`)
  if (f.length) { console.error('\n⛔ NOT DONE:'); console.table(f) }
  const { free, used } = await freeBytes()
  console.log(`\ndisk: ${gb(free)} free of ${gb(PROVISIONED_BYTES)} (used ${gb(used)}) · floor ${gb(FLOOR_BYTES)}`)
  await c.end(); process.exit(0)
}

// Seed the ledger. Idempotent — an existing row keeps its state, so a re-run resumes.
for (const g of GRAINS) {
  await c.query(`insert into public.refused_stamp_backfill_ledger (breakdown_type, entity_level, refused_metrics)
                 values ($1,$2,$3) on conflict (breakdown_type, entity_level) do nothing`, [g.bt, g.level, g.refused])
}

console.log(`LORAMER_REFUSED_STAMP_BACKFILL_V1 — ${GRAINS.length} grains · batch ${BATCH.toLocaleString()} · floor ${gb(FLOOR_BYTES)}`)
console.log(`⛔ ZERO vendor requests: every value is derived from the capture artifact.\n`)

let totalStamped = 0
for (const g of GRAINS) {
  const { rows: st } = await c.query(
    `select state from public.refused_stamp_backfill_ledger where breakdown_type=$1 and entity_level=$2`, [g.bt, g.level])
  if (st[0]?.state === 'done') continue

  await assertFloor(`${g.bt}/${g.level}`)
  await c.query(`update public.refused_stamp_backfill_ledger set state='running', started_at=clock_timestamp(), last_error=null
                 where breakdown_type=$1 and entity_level=$2`, [g.bt, g.level])

  // The stamp, byte-for-byte the shape refusalStamp() writes, so backfilled rows are indistinguishable
  // from post-fix rows to every reader.
  const stamp = {
    refusedMetrics: g.refused, refusedReason: g.reason,
    refusedCode: g.code ? `query_error ${g.code}` : null,
    metricsReported: g.serves,
    refusedMeaning: 'THESE COLUMNS ARE NOT ZERO — the vendor refuses to report them at this grain. Never sum them, never present them as 0, and never use one as a ratio denominator (ROAS/CPA/CPC).',
    stampedBy: 'LORAMER_REFUSED_STAMP_BACKFILL_V1',
  }
  const nullPatch = Object.fromEntries(g.nullRatios.map((k) => [k, null]))

  // ⛔ TWO DEFECTS, NOT ONE, AND THE FIRST VERSION OF THIS PREDICATE ONLY CAUGHT ONE OF THEM.
  //   (1) rows with NO stamp at all (pre-2026-08-04 writer), and
  //   (2) rows that ARE stamped but still carry a NUMERIC ratio built on the refusal — every row the
  //       post-stamp/pre-ratio-fix writer produced, i.e. everything written on 2026-08-04.
  // `not (extra ? 'refusedMetrics')` matches only (1) and SKIPS (2) precisely because those rows already
  // look correct. The row proving this was quoted in the flight report: stamped, with roas/cpa/cpc all 0.
  // `jsonb_typeof(...) = 'number'` is the test that separates a real 0 from a JSON null.
  const needsWork = g.nullRatios.length
    ? `(not (coalesce(m2.extra,'{}'::jsonb) ? 'refusedMetrics') or ${g.nullRatios
        .map((k) => `jsonb_typeof(m2.extra->'${k}') = 'number'`).join(' or ')})`
    : `not (coalesce(m2.extra,'{}'::jsonb) ? 'refusedMetrics')`

  let stamped = 0
  try {
    for (;;) {
      await assertFloor(`${g.bt}/${g.level} batch`)
      // ⛔ ctid-bounded batch: no ORDER BY over the table, and each batch commits on its own so a kill
      // loses at most one batch rather than the grain.
      const { rowCount } = await c.query(
        `update public.metrics_daily m
            set extra = coalesce(m.extra,'{}'::jsonb) || $3::jsonb || $4::jsonb
          where m.ctid = any (array(
                select m2.ctid from public.metrics_daily m2
                 where m2.platform='google' and m2.breakdown_type=$1 and m2.entity_level=$2
                   and ${needsWork}
                 limit ${BATCH}))`,
        [g.bt, g.level, JSON.stringify(stamp), JSON.stringify(nullPatch)])
      if (!rowCount) break
      stamped += rowCount
      await c.query(`update public.refused_stamp_backfill_ledger set rows_stamped=$3 where breakdown_type=$1 and entity_level=$2`,
        [g.bt, g.level, stamped])
      process.stdout.write(`\r  ${g.bt}/${g.level}: ${stamped.toLocaleString()} stamped`)
    }
    // ⛔ VERIFY, THEN CLAIM. 'done' requires a COUNT of zero unstamped rows left in this grain — not the loop
    // ending. A loop that exits early and a grain that is finished look identical from inside the loop.
    const verifyPred = g.nullRatios.length
      ? `(not (coalesce(extra,'{}'::jsonb) ? 'refusedMetrics') or ${g.nullRatios
          .map((k) => `jsonb_typeof(extra->'${k}') = 'number'`).join(' or ')})`
      : `not (coalesce(extra,'{}'::jsonb) ? 'refusedMetrics')`
    const { rows: v } = await c.query(
      `select count(*)::bigint remaining from public.metrics_daily
        where platform='google' and breakdown_type=$1 and entity_level=$2
          and ${verifyPred}`, [g.bt, g.level])
    const remaining = Number(v[0].remaining)
    await c.query(
      `update public.refused_stamp_backfill_ledger
          set state=$3, rows_stamped=$4, rows_remaining=$5, finished_at=clock_timestamp()
        where breakdown_type=$1 and entity_level=$2`,
      [g.bt, g.level, remaining === 0 ? 'done' : 'failed', stamped, remaining])
    if (remaining !== 0) console.error(`\n  ⛔ ${g.bt}/${g.level}: ${remaining} rows STILL unstamped — grain marked failed, not done.`)
    else if (stamped) console.log(`\r  ${g.bt}/${g.level}: ${stamped.toLocaleString()} stamped · verified 0 remaining ✓`)
    totalStamped += stamped
  } catch (e) {
    await c.query(`update public.refused_stamp_backfill_ledger set state='failed', last_error=$3, finished_at=clock_timestamp()
                   where breakdown_type=$1 and entity_level=$2`, [g.bt, g.level, String(e.message).slice(0, 500)])
    console.error(`\n⛔ ${g.bt}/${g.level} FAILED: ${e.message}`)
    if (e.floorBreach) { await c.end(); process.exit(3) }
  }
}

const { rows: fin } = await c.query(`select state, count(*) n from public.refused_stamp_backfill_ledger group by state order by state`)
console.log(`\n\nTOTAL STAMPED THIS RUN: ${totalStamped.toLocaleString()}`)
console.table(fin)
const notDone = fin.filter((r) => r.state !== 'done').reduce((a, r) => a + Number(r.n), 0)
await c.end()
if (notDone) { console.error(`⛔ ${notDone} grain(s) NOT done — this run is INCOMPLETE. Re-run to resume.`); process.exit(2) }
console.log('✓ every grain verified done.')
