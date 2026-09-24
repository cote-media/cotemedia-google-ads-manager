#!/usr/bin/env node
// LORAMER_IDLE_SEED_RETRACTION_V1 (2026-09-24, round 45) — ONE-TIME: retract the idle attestations that a CAPPED seed produced.
//
// WHAT IT DOES. Between 2026-09-23 10:52Z (360-day windows) and the fix's deploy, the idle memo REUSED __account_activity rows
// whose stored day list was capped at 92 dates (worker `slice(0, 92)`), so every fully-covered month after the 92nd named day
// read idle. For every surface-window retired 'zero' with the reuse marker on a window longer than 92 days whose month seeds
// include an ok row naming MORE than 92 days (the round-44 provenance: poisoned ⇔ provably false, 20 windows, 390 rows), append
// ONE attempt_finished row with outcome 'retracted' (migration 104) — the row the view universe_attesting_terminals honours.
// The surfaces seeded only by zero rows or by uncapped ok rows (32 windows) are TRUE idles (two re-asked at Google, rows=0) and
// are left alone. APPEND-ONLY: nothing is updated. IDEMPOTENT: a range that already carries a 'retracted' row is skipped.
// USAGE: node scripts/retract-capped-idle.mjs --dry | --apply
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const APPLY = process.argv.includes('--apply'), DRY = process.argv.includes('--dry')
if (APPLY === DRY) { console.error('usage: --dry | --apply'); process.exit(2) }
const SINCE = '2026-09-23 10:52:00+00' // LORAMER_DESCEND_WINDOW_360_V1 deployed (4eaebee) — the first fire that could seed a capped list
const CAP = 92
const today = new Date().toISOString().slice(0, 10)
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
await db.query(`set statement_timeout = '600s'`)
// (1) the poisoned account windows: reused idle rows on >CAP-day windows since SINCE, whose month seeds include a capped ok row
const { rows: windows } = await db.query(`
  with sus as (
    select l.client_id, l.window_start, l.window_end
      from universe_attempt_log l
     where l.phase = 'attempt_finished' and l.outcome = 'zero'
       and l.error like 'IDLE_ATTESTED_BY_ACCOUNT%[reused:%'
       and l.recorded_at >= $1::timestamptz and (l.window_end - l.window_start + 1) > $2
     group by 1, 2, 3),
  months as (
    select s.*, m::date as ms, (m + interval '1 month' - interval '1 day')::date as me
      from sus s cross join lateral generate_series(date_trunc('month', s.window_start), date_trunc('month', s.window_end), interval '1 month') m),
  seeds as (
    select client_id, window_start, window_end, outcome, recorded_at, attempt_no,
           substring(error from 'ACCOUNT_ACTIVITY — (\\d+) active')::int as named
      from universe_attempt_log where resource = '__account_activity' and phase = 'attempt_finished' and outcome in ('ok', 'zero')),
  mp as (
    select mo.client_id, mo.window_start, mo.window_end, mo.ms,
           (select json_build_object('ws', s.window_start, 'we', s.window_end, 'outcome', s.outcome, 'named', s.named, 'attempt', s.attempt_no)
              from seeds s where s.client_id = mo.client_id and s.window_start <= mo.ms and s.window_end >= mo.me
             order by s.recorded_at desc limit 1) as seed
      from months mo where mo.ms >= mo.window_start and mo.me <= mo.window_end)
  select client_id, window_start::text as ws, window_end::text as we,
         json_agg(seed) filter (where (seed->>'outcome') = 'ok' and (seed->>'named')::int > $2) as capped_seeds
    from mp group by 1, 2, 3
  having bool_or((seed->>'outcome') = 'ok' and (seed->>'named')::int > $2)
   order by 1, 2`, [SINCE, CAP])
console.log(`[retract] poisoned account windows: ${windows.length}`)
// (2) every surface-row retired on those windows, with the range's current max attempt and whether it is already retracted
let toWrite = 0, skipped = 0, written = 0
const plan = []
for (const w of windows) {
  const seedTxt = [...new Map((w.capped_seeds ?? []).map((s) => [`${s.ws}..${s.we}#${s.attempt}`, s])).values()]
    .map((s) => `${s.ws}..${s.we} attempt ${s.attempt} named ${s.named} stored ${CAP}`).join('; ')
  const { rows } = await db.query(`
    select l.resource, l.segment, l.lane, l.attempt_no,
           (select max(a.attempt_no) from universe_attempt_log a where a.client_id = l.client_id and a.vendor = l.vendor and a.resource = l.resource and a.segment = l.segment and a.window_start = l.window_start and a.window_end = l.window_end) as max_no,
           exists (select 1 from universe_attempt_log r where r.client_id = l.client_id and r.vendor = l.vendor and r.resource = l.resource and r.segment = l.segment and r.window_start = l.window_start and r.window_end = l.window_end and r.phase = 'attempt_finished' and r.outcome = 'retracted' and r.attempt_no > l.attempt_no) as already
      from universe_attempt_log l
     where l.client_id = $1 and l.vendor = 'google' and l.window_start = $2::date and l.window_end = $3::date
       and l.phase = 'attempt_finished' and l.outcome = 'zero' and l.error like 'IDLE_ATTESTED_BY_ACCOUNT%[reused:%'
       and l.recorded_at >= $4::timestamptz`, [w.client_id, w.ws, w.we, SINCE])
  for (const r of rows) {
    if (r.already) { skipped++; continue }
    toWrite++
    plan.push({ client: w.client_id, resource: r.resource, seg: r.segment, ws: w.ws, we: w.we, lane: r.lane, attemptNo: Number(r.max_no) + 1,
      error: `RETRACTED — LORAMER_IDLE_SEED_RETRACTION_V1: the 'zero' at attempt ${r.attempt_no} was reused from a CAPPED account answer (seed ${seedTxt}); every month after the 92nd named day read idle while the walk's own rows inside ${w.ws}..${w.we} carry impressions (round 44 provenance, 2026-09-24). This range attests nothing until a lane asks it again.` })
  }
}
const byClient = plan.reduce((m, p) => m.set(p.client, (m.get(p.client) ?? 0) + 1), new Map())
console.log(`[retract] ${DRY ? 'DRY' : 'APPLY'}: ${toWrite} retraction row(s) to append on ${windows.length} window(s) · ${skipped} skipped (already retracted) · by client ${[...byClient].map(([c, n]) => `${c.slice(0, 8)} ${n}`).join(' · ')}`)
if (APPLY) {
  for (const p of plan) {
    await db.query(
      `insert into universe_attempt_log (client_id, vendor, resource, segment, window_start, window_end, attempt_no, phase, outcome, message_key, invocation_id, lane, rows_written, requests_spent, error)
       values ($1, 'google', $2, $3, $4, $5, $6, 'attempt_finished', 'retracted', null, $7, $8, 0, 0, $9)`,
      [p.client, p.resource, p.seg, p.ws, p.we, p.attemptNo, `retract:LORAMER_IDLE_SEED_RETRACTION_V1:${today}`, p.lane, p.error])
    written++
    if (written % 100 === 0) console.log(`[retract] ${written}/${plan.length}`)
  }
  console.log(`[retract] APPLIED — ${written} retracted row(s) appended`)
}
await db.end()
