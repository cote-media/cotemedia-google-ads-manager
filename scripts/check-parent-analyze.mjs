#!/usr/bin/env node
// LORAMER_PARENT_ANALYZE_SCHEDULED_V1 — THE FIX-WITH-GUARD HALF.
//
// ⛔ WHAT THIS PROTECTS, and why prose could not: PostgreSQL never autoanalyzes a partitioned parent.
// Every latency number this project holds — 2,624 ms cold, 2-of-145 pruning, zero filter discard —
// rests on statistics that nothing maintained until 2026-08-04. A scheduled job now maintains them.
// ⛔ A SCHEDULE THAT SILENTLY STOPS IS INDISTINGUISHABLE FROM ONE THAT NEVER EXISTED. That is the
// exact class this repo keeps discovering by accident, so the schedule is checked, not assumed.
//
//   (a) THE PARENT'S STATISTICS ARE NOT STALE beyond a stated age.
//   (b) THE MECHANISM IS STILL THERE AND STILL ENABLED — job present, active, correct command.
//   (c) THE LEDGER TELLS THE TRUTH — it has run, the last run succeeded, and finished_at is a real
//       wall-clock moment rather than a copy of started_at.
//
// ⛔ NEEDS THE DATABASE — this is a DB-state check, so it belongs in `npm run check:data` alongside
// the reachability and account-row gates, NOT in `npm run guard` (which must stay hermetic and run
// on Vercel). Same posture as breakdown-reachability-check.
//
//   node scripts/check-parent-analyze.mjs          report
//   node scripts/check-parent-analyze.mjs --gate   exit 1 on any finding
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const GATE = process.argv.includes('--gate')
// ⛔ 48 HOURS, NOT 24, AND THE SLACK IS DELIBERATE: the job runs daily at 03:30 UTC, so a 24-hour
// threshold would fire on any single missed night — including a Supabase maintenance restart — and a
// guard that cries wolf gets ignored. 48h means TWO consecutive misses, which is a real signal.
const MAX_AGE_HOURS = 48
const JOB = 'loramer-analyze-metrics-daily'
const findings = []

const { default: pg } = await import('pg')
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL })
await c.connect()
await c.query("SET statement_timeout='115s'")

// ── (a) THE PARENT'S STATISTICS ARE FRESH ─────────────────────────────────────────────────────────
const { rows: st } = await c.query(`
  select greatest(coalesce(last_analyze,'epoch'), coalesce(last_autoanalyze,'epoch')) as last_any,
         round(extract(epoch from (now() - greatest(coalesce(last_analyze,'epoch'), coalesce(last_autoanalyze,'epoch'))))/3600, 1) as age_hours
  from pg_stat_user_tables where relname = 'metrics_daily'`)
if (!st.length) findings.push('(a) metrics_daily is not in pg_stat_user_tables — the table this guard exists for is missing.')
else if (Number(st[0].age_hours) > MAX_AGE_HOURS) {
  findings.push(`(a) the PARENT's statistics are ${st[0].age_hours}h old (limit ${MAX_AGE_HOURS}h). PostgreSQL will NEVER autoanalyze a partitioned parent, so this does not fix itself — every query plan against metrics_daily is drifting.`)
}

// ── (b) THE MECHANISM IS STILL THERE, STILL ON ────────────────────────────────────────────────────
const { rows: job } = await c.query(`select jobname, schedule, command, active from cron.job where jobname = $1`, [JOB])
if (!job.length) findings.push(`(b) cron job '${JOB}' DOES NOT EXIST. The statistics have no maintainer — removing the schedule is exactly as bad as never having had one, and far harder to notice.`)
else {
  if (job[0].active !== true) findings.push(`(b) cron job '${JOB}' exists but is DISABLED (active=false). A present-but-off schedule is the worst state: it looks configured and does nothing.`)
  if (!/analyze_metrics_daily/.test(job[0].command)) findings.push(`(b) cron job '${JOB}' no longer calls analyze_metrics_daily — command is "${job[0].command}".`)
}
const { rows: fn } = await c.query(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                    where n.nspname='public' and p.proname='analyze_metrics_daily'`)
if (!fn.length) findings.push('(b) public.analyze_metrics_daily() no longer exists — the schedule would fire into nothing.')

// ── (c) THE LEDGER TELLS THE TRUTH ────────────────────────────────────────────────────────────────
const { rows: log } = await c.query(`
  select outcome, duration_ms, partitions, started_at, finished_at,
         extract(epoch from (finished_at - started_at)) as wall_secs
  from public.maintenance_analyze_log where target='metrics_daily' order by id desc limit 1`)
if (!log.length) findings.push('(c) maintenance_analyze_log is EMPTY — the job has never run. A schedule that has never fired is not a working schedule.')
else {
  const l = log[0]
  if (l.outcome === 'failed') findings.push(`(c) the most recent ANALYZE FAILED: ${l.error ?? 'no error recorded'}`)
  if (l.outcome === 'running') findings.push('(c) the most recent row is still `running` — it never reached an outcome, which means the job died mid-flight. That is the failure, not a pending state.')
  // ⛔ THE STAMP-HONESTY CHECK. On 2026-08-04 the first version wrote finished_at = now(), which in
  // PL/pgSQL is TRANSACTION START — so a 158-second job logged finished_at identical to started_at.
  // duration_ms was right and finished_at was a lie. Same family as ★DRAIN-CRON-RUNS-ORPHANED: a
  // column that does not mean what its name says. This leg exists so it cannot come back.
  if (l.outcome === 'ok' && Number(l.duration_ms) > 5000 && Number(l.wall_secs) < 1) {
    findings.push(`(c) finished_at - started_at is ${l.wall_secs}s while duration_ms says ${l.duration_ms}ms. The timestamps are being written with now() (transaction start) instead of clock_timestamp() — finished_at does not mean finished.`)
  }
}

await c.end()

const label = 'LORAMER_PARENT_ANALYZE_SCHEDULED_V1'
if (log.length) console.log(`${label}\n  last run: ${log[0].outcome} · ${log[0].duration_ms}ms · ${log[0].partitions} partitions · ${log[0].started_at?.toISOString?.() ?? log[0].started_at}`)
if (st.length) console.log(`  parent statistics age: ${st[0].age_hours}h (limit ${MAX_AGE_HOURS}h)`)
if (job.length) console.log(`  schedule: '${job[0].schedule}' active=${job[0].active}`)

if (findings.length) {
  console.error(`\n✗ PARENT-ANALYZE GATE FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(GATE ? 1 : 0)
}
console.log('\n✓ PARENT-ANALYZE GATE PASSED — statistics fresh, schedule present and active, ledger honest.')
