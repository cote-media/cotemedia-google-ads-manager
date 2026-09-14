#!/usr/bin/env node
// LORAMER_PARENT_ANALYZE_SCHEDULED_V1 — THE FIX-WITH-GUARD HALF.
// LORAMER_ANALYZE_MAINTENANCE_REAL_V1 (2026-09-13) — THE LEGS NOW READ DURABLE TRUTH.
//
// ⛔ WHAT THIS PROTECTS, and why prose could not: PostgreSQL never autoanalyzes a partitioned parent.
// Every latency number this project holds — 2,624 ms cold, 2-of-145 pruning, zero filter discard —
// rests on statistics that nothing maintained until 2026-08-04. A scheduled job now maintains them.
// ⛔ A SCHEDULE THAT SILENTLY STOPS IS INDISTINGUISHABLE FROM ONE THAT NEVER EXISTED. That is the
// exact class this repo keeps discovering by accident, so the schedule is checked, not assumed.
//
// ⛔ HOW THE FIRST VERSION LIED FOR 40 DAYS (read 2026-09-13, round 11): cron.job_run_details held 40 of 40
// nightly runs FAILED — "canceling statement due to statement timeout" at `ANALYZE public.metrics_daily`
// (the cluster's 120 s ceiling against a 158 s job) — while this check read GREEN every day, because:
//   · leg (c) read maintenance_analyze_log's newest row with NO recency term, and that row was the 2026-08-04
//     hand run: the function's own 'failed' row is written inside the transaction the timeout aborts and its
//     RAISE rolls it back, so the ledger can only ever hold committed successes;
//   · leg (a) read pg_stat_user_tables.last_analyze, which PostgreSQL stamps NON-transactionally as each
//     relation's analysis completes — a run cancelled after the parent's sample still stamps the parent while
//     its pg_statistic / pg_class writes roll back. A FRESH STAMP IS NOT A FRESH STATISTIC.
// The mechanism half of the fix is migration 093 (the job command raises statement_timeout where the
// statement STARTS — a function-level SET cannot re-arm a statement already running). This file is the
// instrument half. ⛔ analyze_metrics_daily() is deliberately UNCHANGED: its ledger can only hold committed
// successes, and (c'') now asks it exactly that and nothing more.
//
//   (a) CORROBORATION ONLY — the pg_stat stamp. Printed for the record; it is a finding ONLY when it reads
//       fresh while the newest job run failed (the stamp-without-statistic lie, caught as a condition). It
//       can never make the gate green on its own.
//   (b) THE MECHANISM IS STILL THERE AND STILL ENABLED — job present, active, correct command, function present.
//   (c') PRIMARY, DURABLE — cron.job_run_details: the newest run of the job has status 'succeeded' AND ended
//        within RECENCY_H. pg_cron writes this row outside the job's transaction, so a failure cannot erase it.
//   (c'') CORROBORATION, COMMITTED — maintenance_analyze_log's newest row is outcome 'ok' AND started within
//         RECENCY_H, with the stamp-honesty check (finished_at is wall-clock, not transaction start).
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
// The SAME term now bounds (c') and (c'') — moved to durable sources, unchanged in meaning.
const RECENCY_H = 48
const MAX_AGE_HOURS = RECENCY_H
const JOB = 'loramer-analyze-metrics-daily'
const findings = []

const { default: pg } = await import('pg')
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL })
await c.connect()
await c.query("SET statement_timeout='115s'")

// ── (b) THE MECHANISM IS STILL THERE, STILL ON ────────────────────────────────────────────────────
const { rows: job } = await c.query(`select jobid, jobname, schedule, command, active from cron.job where jobname = $1`, [JOB])
if (!job.length) findings.push(`(b) cron job '${JOB}' DOES NOT EXIST. The statistics have no maintainer — removing the schedule is exactly as bad as never having had one, and far harder to notice.`)
else {
  if (job[0].active !== true) findings.push(`(b) cron job '${JOB}' exists but is DISABLED (active=false). A present-but-off schedule is the worst state: it looks configured and does nothing.`)
  if (!/analyze_metrics_daily/.test(job[0].command)) findings.push(`(b) cron job '${JOB}' no longer calls analyze_metrics_daily — command is "${job[0].command}".`)
}
const { rows: fn } = await c.query(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                    where n.nspname='public' and p.proname='analyze_metrics_daily'`)
if (!fn.length) findings.push('(b) public.analyze_metrics_daily() no longer exists — the schedule would fire into nothing.')

// ── (c') PRIMARY — THE JOB'S OWN DURABLE RUN LEDGER ───────────────────────────────────────────────
// cron.job_run_details is written by pg_cron's launcher, NOT inside the job's transaction: a run that fails
// (timeout, error) leaves a 'failed' row with its return_message. This is the row that held the truth for 40
// nights while the app-side ledger held nothing.
const { rows: runs } = await c.query(`
  select d.runid, d.status, d.return_message, d.start_time, d.end_time,
         extract(epoch from (d.end_time - d.start_time)) as took_secs,
         round(extract(epoch from (now() - d.end_time))/3600, 1) as age_hours
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where j.jobname = $1 order by d.start_time desc limit 1`, [JOB])
let cPrimeFailed = false
if (!runs.length) { cPrimeFailed = true; findings.push(`(c') cron.job_run_details holds NO run for '${JOB}' — the schedule has never fired.`) }
else {
  const r = runs[0]
  if (r.status !== 'succeeded') {
    cPrimeFailed = true
    findings.push(`(c') the newest run of '${JOB}' (runid ${r.runid}, ${r.start_time?.toISOString?.() ?? r.start_time}) has status '${r.status}' after ${Math.round(Number(r.took_secs))}s — return_message: ${String(r.return_message ?? '').split('\n')[0].trim() || '(none)'}. The parent's statistics are NOT being maintained; read the message before touching the timeout again.`)
  } else if (Number(r.age_hours) > RECENCY_H) {
    cPrimeFailed = true
    findings.push(`(c') the newest SUCCEEDED run of '${JOB}' ended ${r.age_hours}h ago (limit ${RECENCY_H}h) — two consecutive nights without a completed ANALYZE.`)
  }
}

// ── (c'') CORROBORATION — THE COMMITTED-SUCCESS LEDGER ────────────────────────────────────────────
// analyze_metrics_daily() writes maintenance_analyze_log inside its own transaction and RAISEs on failure, so
// this table can only ever hold committed successes. That is exactly what it is asked here: a fresh 'ok' row.
const { rows: log } = await c.query(`
  select outcome, duration_ms, partitions, started_at, finished_at, error,
         extract(epoch from (finished_at - started_at)) as wall_secs,
         round(extract(epoch from (now() - started_at))/3600, 1) as age_hours
  from public.maintenance_analyze_log where target='metrics_daily' order by id desc limit 1`)
if (!log.length) findings.push('(c\'\') maintenance_analyze_log is EMPTY — no ANALYZE has ever COMMITTED.')
else {
  const l = log[0]
  if (l.outcome !== 'ok') findings.push(`(c'') the newest committed ledger row is '${l.outcome}'${l.error ? `: ${l.error}` : ''} — only a committed success may stand here.`)
  else if (Number(l.age_hours) > RECENCY_H) findings.push(`(c'') the newest COMMITTED ANALYZE is ${l.age_hours}h old (limit ${RECENCY_H}h; started ${l.started_at?.toISOString?.() ?? l.started_at}) — every job run since either failed or never committed.`)
  // ⛔ THE STAMP-HONESTY CHECK. On 2026-08-04 the first version wrote finished_at = now(), which in
  // PL/pgSQL is TRANSACTION START — so a 158-second job logged finished_at identical to started_at.
  // duration_ms was right and finished_at was a lie. Same family as ★DRAIN-CRON-RUNS-ORPHANED: a
  // column that does not mean what its name says. This leg exists so it cannot come back.
  if (l.outcome === 'ok' && Number(l.duration_ms) > 5000 && Number(l.wall_secs) < 1) {
    findings.push(`(c'') finished_at - started_at is ${l.wall_secs}s while duration_ms says ${l.duration_ms}ms. The timestamps are being written with now() (transaction start) instead of clock_timestamp() — finished_at does not mean finished.`)
  }
}

// ── (a) CORROBORATION ONLY — THE pg_stat STAMP ("a fresh stamp is not a fresh statistic") ─────────
const { rows: st } = await c.query(`
  select greatest(coalesce(last_analyze,'epoch'), coalesce(last_autoanalyze,'epoch')) as last_any,
         round(extract(epoch from (now() - greatest(coalesce(last_analyze,'epoch'), coalesce(last_autoanalyze,'epoch'))))/3600, 1) as age_hours
  from pg_stat_user_tables where schemaname = 'public' and relname = 'metrics_daily'`)
if (!st.length) findings.push('(a) public.metrics_daily is not in pg_stat_user_tables — the table this guard exists for is missing.')
else if (Number(st[0].age_hours) <= MAX_AGE_HOURS && cPrimeFailed) {
  findings.push(`(a) STAMP WITHOUT STATISTIC: pg_stat last_analyze reads ${st[0].age_hours}h fresh while the newest job run did not succeed — a cancelled ANALYZE stamps the parent non-transactionally and rolls its statistics back. The stamp is not evidence; (c') is.`)
}

await c.end()

const label = 'LORAMER_ANALYZE_MAINTENANCE_REAL_V1'
if (runs.length) console.log(`${label}\n  newest job run: ${runs[0].status} · ${Math.round(Number(runs[0].took_secs))}s · ended ${runs[0].end_time?.toISOString?.() ?? runs[0].end_time} (${runs[0].age_hours}h ago)`)
if (log.length) console.log(`  newest committed ledger row: ${log[0].outcome} · ${log[0].duration_ms}ms · ${log[0].partitions} partitions · ${log[0].started_at?.toISOString?.() ?? log[0].started_at} (${log[0].age_hours}h ago)`)
if (st.length) console.log(`  pg_stat stamp age (corroboration only): ${st[0].age_hours}h`)
if (job.length) console.log(`  schedule: '${job[0].schedule}' active=${job[0].active} · command: ${job[0].command}`)

if (findings.length) {
  console.error(`\n✗ PARENT-ANALYZE GATE FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(GATE ? 1 : 0)
}
console.log('\n✓ PARENT-ANALYZE GATE PASSED — the newest job run succeeded within 48h (durable), a committed success is on the ledger within 48h, schedule present and active.')
