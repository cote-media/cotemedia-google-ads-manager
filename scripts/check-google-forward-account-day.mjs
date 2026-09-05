#!/usr/bin/env node
// LORAMER_GOOGLE_ACCOUNT_ZERO_DAY_V1 — A STAMPED FORWARD DAY HOLDS AN ACCOUNT ROW, DORMANT OR NOT.
//
// ⛔ THE DEFECT THIS PINS, MEASURED LIVE 2026-08-26: the first fire on the 02e79b7 account producer left
// NINE of eighteen google connections with NO account row for 2026-08-25 while their forward cursors read
// captured. Cause, proven from both query shapes on the live vendor: GAQL with a segment in the SELECT
// omits zero-metric rows ALWAYS (single-day and ranged alike), so `FROM customer ... segments.date` returns
// nothing for a dormant day — and the retired producer's zero rows had come from the UNSEGMENTED
// (entity-report) campaign query, not from the vendor serving dated zeros. Nothing serves dated zeros.
// The producer therefore has to WRITE the zero day itself, and this check asserts the BEHAVIOR — the rows —
// never the code: a green here means every stamped capture day genuinely holds its account anchor, which is
// also the row google-campaign-backfill's posture:'block' reconciler anchors on (a missing anchor reads as
// $0.00 through `fin(acctRow?.spend)` and silently disarms the gate — the seam that made this invisible).
//
// THE INVARIANT: for every live google connection whose sync_state forward cursor has reached the latest
// COMPLETED google forward fire's target_date, an entity_level='account' row exists for that date.
// Cursor-stamped-but-rowless is exactly "the writer ran and wrote nothing" — the silent-gap class
// BACKFILL_DONE_DONE condition 2 bans (every interior day FILLED or ATTESTED-EMPTY, no silent gap).
//
// DB-READING BY DESIGN → lives in `npm run check:data` (scripts/run-checkdata.mjs), NEVER in `npm run
// guard`/build — Vercel has no DB and the build path is deliberately hermetic (same posture as every other
// leg in the roster). Exit 1 on violation; the roster survives non-green legs and reports them.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
// .env.local exactly the way run-checkdata's other legs get their keys — no new env plumbing.
if (existsSync(resolve(ROOT, '.env.local'))) {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('✗ google-forward-account-day: no Supabase credentials (needs .env.local)'); process.exit(1) }

async function rest(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`PostgREST ${r.status} on ${path.split('?')[0]}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

// 1. The day under test = the newest google forward fire's target_date, finished or not, and the fires judged are
//    EVERY forward fire that targeted that day. LORAMER_FORWARD_LANE_HYGIENE_V1: this used to take "the newest
//    COMPLETED fire" — on 2026-09-05 that was a 10:58Z no-op that ran 110 minutes after the last row was written,
//    while seven fires had written the day and three of them were killed at maxDuration and never finished. The
//    goalpost is the DAY; a single fire's finish is an adjacent number.
const newest = await rest(`cron_runs?select=target_date&mode=eq.forward&platform=eq.google&order=id.desc&limit=1`)
if (!newest.length || !newest[0].target_date) { console.log('✓ google-forward-account-day OK — no google forward fire in cron_runs to judge (nothing stamped, nothing owed).'); process.exit(0) }
const day = newest[0].target_date
const fires = await rest(`cron_runs?select=started_at,finished_at&mode=eq.forward&platform=eq.google&target_date=eq.${day}&order=started_at.asc`)

// 2. The denominator: live google connections on non-deleted clients whose forward cursor REACHED that day.
//    (Cursor short of the day = the fire has not processed that client yet — not a violation, just pending.)
const conns = await rest(`platform_connections?select=client_id,account_id,clients!inner(id,name,deleted_at)&platform=eq.google`)
const live = conns.filter((c) => !c.clients?.deleted_at)
const cursors = await rest(`sync_state?select=client_id,last_forward_sync_date&platform=eq.google`)
const cursorByClient = new Map(cursors.map((c) => [c.client_id, c.last_forward_sync_date]))
const owed = live.filter((c) => (cursorByClient.get(c.client_id) || '') >= day)

// 3. The rows: one account row per owed connection for that date. Chunk the IN list defensively.
const ids = [...new Set(owed.map((c) => c.client_id))]
const held = new Set()
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50)
  const rows = await rest(`metrics_daily?select=client_id&platform=eq.google&entity_level=eq.account&breakdown_type=eq.&breakdown_value=eq.&date=eq.${day}&client_id=in.(${chunk.join(',')})`)
  for (const r of rows) held.add(r.client_id)
}
const missing = owed.filter((c) => !held.has(c.client_id))

if (missing.length) {
  console.error(`✗ GOOGLE-ACCOUNT-ZERO-DAY FAILED — ${missing.length} of ${owed.length} cursor-stamped google connection(s) hold NO account row for ${day} (the latest completed forward fire's target_date). A stamped day without its account anchor is a silent gap AND a disarmed campaign reconciler:`)
  for (const c of missing) console.error(`  - ${c.clients?.name || c.client_id} (client ${c.client_id}, account ${c.account_id})`)
  console.error(`  The producer (google-account-row.ts fetchGoogleAccountWindow) must yield a zero day for every date the vendor omits — Google never serves dated zero rows (measured 2026-08-26, both query shapes).`)
  process.exit(1)
}
// 4. LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — "A FIRE FOR THIS DAY WROTE IT", NOT "A ROW IS THERE". Since the stamp deployed,
//    every account row the forward lane writes carries extra.lane='forward' and extra.observedAt (the fetch time). So the
//    target-date row must say lane='forward' and must have been observed at or after the EARLIEST stamped fire that
//    targeted the day — a row that predates every such fire is a row none of them wrote, however present it is.
//    LORAMER_FORWARD_LANE_HYGIENE_V1: the clock is the earliest fire for the day, finished or not, never "the newest
//    completed fire" — killed fires wrote 11 of 18 rows on 2026-09-04 and a no-op fire ran 110 minutes later.
//    ⛔ EXEMPTION BY DATE, STATED: fires that started before the stamp deployed wrote un-stamped rows and are judged by
//    presence only (leg 3 above). PROVENANCE_STAMP_LIVE_FROM is the deploy of LORAMER_ACCOUNT_ROW_PROVENANCE_V1.
const PROVENANCE_STAMP_LIVE_FROM = '2026-09-05T04:30:00Z'
const stampedFires = fires
  .map((f) => ({ startedAt: f.started_at ? new Date(f.started_at).toISOString() : null, finished: f.finished_at != null }))
  .filter((f) => f.startedAt && f.startedAt >= PROVENANCE_STAMP_LIVE_FROM)
const fireStartedAt = stampedFires.length ? stampedFires[0].startedAt : null
if (!fireStartedAt) {
  console.log(`  provenance leg SKIPPED — none of the ${fires.length} forward fire(s) targeting ${day} started after the stamp went live (${PROVENANCE_STAMP_LIVE_FROM}); their rows are pre-stamp and UNKNOWN-provenance by design.`)
} else {
  const unfinished = stampedFires.filter((f) => !f.finished).length
  console.log(`  provenance leg JUDGED — ${stampedFires.length} stamped fire(s) targeted ${day} (earliest ${fireStartedAt}; ${unfinished} never recorded finished_at — killed or still running); every row must carry observedAt ≥ that earliest start.`)
  const bad = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const rows = await rest(`metrics_daily?select=client_id,extra&platform=eq.google&entity_level=eq.account&breakdown_type=eq.&breakdown_value=eq.&date=eq.${day}&client_id=in.(${chunk.join(',')})`)
    for (const r of rows) {
      const x = r.extra || {}
      if (x.lane !== 'forward') bad.push(`${r.client_id}: lane=${JSON.stringify(x.lane ?? null)} (expected 'forward')`)
      else if (!x.observedAt || String(x.observedAt) < fireStartedAt) bad.push(`${r.client_id}: observedAt=${JSON.stringify(x.observedAt ?? null)} is before the fire's started_at ${fireStartedAt} — present, but this fire did not write it`)
      else if (x.provenance !== 'VENDOR_REPORTED' && x.provenance !== 'ZERO_FILLED_VENDOR_OMITTED') bad.push(`${r.client_id}: provenance=${JSON.stringify(x.provenance ?? null)} is not one of the two text values`)
    }
  }
  if (bad.length) {
    console.error(`✗ GOOGLE-ACCOUNT-ZERO-DAY FAILED — ${bad.length} of ${owed.length} account row(s) for ${day} do not say the forward fire (started ${fireStartedAt}) wrote them:`)
    for (const b of bad) console.error(`  - ${b}`)
    process.exit(1)
  }
  console.log(`  provenance leg OK — every ${day} account row carries lane='forward', observedAt ≥ ${fireStartedAt}, provenance ∈ {VENDOR_REPORTED, ZERO_FILLED_VENDOR_OMITTED}.`)
}
console.log(`✓ google-forward-account-day OK — ${owed.length}/${owed.length} cursor-stamped google connection(s) hold an account row for ${day} (${live.length - owed.length} not yet stamped to that day, not judged).`)
