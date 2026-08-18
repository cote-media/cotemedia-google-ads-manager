#!/usr/bin/env node
// LORAMER_SINGLE_SURFACE_DRIVE_V1 — THE OPERATOR'S LOOP. One surface, pass by pass, to its floor.
//
// ⛔ THE DRIVER OWNS THE LOOP (June, BackfillControl.tsx:64-86). Publish ONE window via
// /api/backfill/universe-drive, WAIT for the consumer to go QUIET, re-read the surface's state, then decide.
// The route has no loop; the walk has no idea it is being driven. Nothing here is a shortcut past the real path.
//
// ⛔ TWO INSTRUMENT BUGS COST THE FIRST RUN, BOTH MINE, BOTH FIXED HERE AND BOTH RED-PROVEN BELOW.
//
// (1) QUIESCE-THEN-READ. v1 returned on the FIRST new `attempt_finished`. **ONE CONSUMER INVOCATION WALKS
//     SEVERAL OWED RANGES** — measured 2026-08-17 22:09:18-23Z, one message did 2026-02-05..02-09 ('zero')
//     AND 2026-03-06 ('ok', 1,967 rows) inside five seconds. So the read fired MID-INVOCATION, three seconds
//     before the next range's row existed, and reported a stall over a number still being written.
//     N = 10s of quiet: the measured inter-range gap was 1-4s (22:09:19→19, :19→23, :26→27, :27→30), so ten
//     seconds is >2× the widest observed gap while keeping a pass cheap. It is a MEASURED margin, not a round
//     number — and it is bounded by PASS_TIMEOUT_MS regardless.
//
// (2) THE PREDICATE IS THE OWED SET, NOT THE FRONTIER DATE — LORAMER_NO_PROGRESS_TESTS_THE_OWED_SET_V1,
//     banked this morning and not applied to my own instrument. **THE WALK FILLS HOLES INSIDE A WINDOW; IT
//     DOES NOT MARCH A CONTIGUOUS EDGE.** Pass 1's window owed days at BOTH ends — a five-day empty run at the
//     bottom and a single funded day at the top — so "deepest window_start decreased" is not a progress bar,
//     and a pass that fills a hole in already-asked ground is real progress that moves it not at all.
//     PROGRESS ⟺ the derived window CHANGED, or its owed-day count SHRANK. HALT ⟺ neither.
//
// ⛔ THE OWED COUNT COMES FROM THE ROUTE'S OWN DERIVATION (a free dryRun call — no publish, no vendor
// request), which runs the REAL `rangesStillOwed`. The drive never computes coverage itself; if it did, it
// would be proving its own arithmetic rather than the engine's.
//
// USAGE: DRIVE_URL=… node scripts/drive-one-surface.mjs [--selftest]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CLIENT_ID = '957d484e-d0c4-4dd0-b382-d8499d556252'
const VENDOR = 'google'
const RESOURCE = 'campaign_search_term_view'
const SEGMENT = 'segments.device'
const FLOOR = '2022-03-04'

const PASS_CAP = Number(process.env.DRIVE_PASS_CAP ?? 1600)
const REQUEST_CAP = Number(process.env.DRIVE_REQUEST_CAP ?? 3200)
const PASS_TIMEOUT_MS = 180_000
const QUIET_MS = 10_000
const RUN_ID = process.env.DRIVE_RUN_ID || `drive-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`

// ── THE TWO PREDICATES, PURE, SO THEY CAN BE DRIVEN WITH RECORDED DATA ──────────────────────────────────
/** v1 — WRONG. Kept ONLY so the self-test can show it false-stalling on real recorded numbers. */
export const progressByFrontier = (a) => Boolean(a.frontierBefore && a.frontierAfter && a.frontierAfter < a.frontierBefore)
/** v2 — the owed set. A changed window is progress; a shrunken owed count is progress. Neither is a stall. */
export const progressByOwedSet = (a) =>
  a.windowAfter !== a.windowBefore || (Number.isFinite(a.owedAfter) && Number.isFinite(a.owedBefore) && a.owedAfter < a.owedBefore)

// ── SELF-TEST — RED-PROVE BOTH BEFORE SPENDING ANYTHING ─────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  // PASS 2 AS IT ACTUALLY HAPPENED, from universe_attempt_log 2026-08-17 22:09:26-30Z:
  //   window 2026-02-04..2026-03-05 · ranges walked 2026-02-04 ('zero', 0 rows) and 2026-03-05 ('ok', 1,815)
  //   frontier read MID-INVOCATION was 2026-02-05 → 2026-02-05 (the 02-04 row did not exist yet)
  const recorded = {
    frontierBefore: '2026-02-05', frontierAfter: '2026-02-05',      // what v1 saw, measured too early
    windowBefore: '2026-02-04..2026-03-05', windowAfter: '2026-01-05..2026-02-03',
    owedBefore: 2, owedAfter: 0,                                     // both ranges walked and answered
  }
  const oldSaysProgress = progressByFrontier(recorded)
  const newSaysProgress = progressByOwedSet(recorded)
  console.log(`[selftest] v1 frontier predicate on pass-2's REAL numbers → ${oldSaysProgress ? 'progress' : 'STALL'}  ${oldSaysProgress ? '' : '⛔ FALSE STALL — this is the bug that cost the first run'}`)
  console.log(`[selftest] v2 owed-set predicate on the SAME numbers    → ${newSaysProgress ? 'progress ✅' : 'STALL'}`)
  // And the case that MUST still halt: quiesced, same window, owed unchanged.
  const genuine = { frontierBefore: '2026-02-04', frontierAfter: '2026-02-04', windowBefore: 'W', windowAfter: 'W', owedBefore: 3, owedAfter: 3 }
  console.log(`[selftest] v2 on a GENUINE stall (same window, owed 3 → 3) → ${progressByOwedSet(genuine) ? 'progress ⛔ WRONG' : 'STALL ✅'}`)
  const ok = !oldSaysProgress && newSaysProgress && !progressByOwedSet(genuine)
  console.log(`[selftest] ${ok ? 'PASS — v1 false-stalls on real data, v2 reads it as progress, v2 still halts on a genuine stall.' : 'FAIL'}`)
  process.exitCode = ok ? 0 : 1
} else {

try {
  for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
  }
} catch {}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRIVE_URL = process.env.DRIVE_URL, SECRET = (process.env.CRON_SECRET ?? '').trim()
if (!SB || !K || !DRIVE_URL || !SECRET) {
  console.error('[drive] CANNOT RUN — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRIVE_URL, CRON_SECRET.')
  process.exit(2)
}
const enc = encodeURIComponent
const SURF = `client_id=eq.${CLIENT_ID}&vendor=eq.${VENDOR}&resource=eq.${RESOURCE}&segment=eq.${enc(SEGMENT)}`
const q = async (p) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
  if (r.status !== 200) throw new Error(`read HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return r.json()
}
const frontier = async () => (await q(`universe_attempt_log?select=window_start&${SURF}&phase=eq.attempt_started&window_start=gt.2000-01-01&order=window_start.asc&limit=1`))[0]?.window_start ?? null
const newestRowAt = async () => (await q(`universe_attempt_log?select=recorded_at&${SURF}&order=recorded_at.desc&limit=1`))[0]?.recorded_at ?? '1970-01-01T00:00:00Z'
const call = async (dry, tag) => {
  const r = await fetch(`${DRIVE_URL}?clientId=${CLIENT_ID}&resource=${RESOURCE}&segment=${enc(SEGMENT)}&runId=${RUN_ID}-${tag}&dryRun=${dry ? 1 : 0}`,
    { headers: { Authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(PASS_TIMEOUT_MS) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`route HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`)
  return body
}

let requests = 0, rowsTotal = 0
const daysBetween = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000)
let fBefore = await frontier()
const START_FRONTIER = fBefore
console.log(`[drive] START ${RESOURCE}/${SEGMENT} · frontier=${fBefore} · floor=${FLOOR} · runId=${RUN_ID}`)
console.log(`[drive] caps ${PASS_CAP} passes / ${REQUEST_CAP} requests · quiesce ${QUIET_MS / 1000}s · HALT when a QUIESCED pass leaves the OWED SET unchanged`)

for (let pass = 1; pass <= PASS_CAP; pass++) {
  if (requests >= REQUEST_CAP) { console.log(`[drive] HALT — request cap ${REQUEST_CAP} reached.`); break }
  if (fBefore && fBefore <= FLOOR) { console.log(`[drive] ✅ PROVEN — frontier ${fBefore} reached the floor ${FLOOR} after ${pass - 1} pass(es), ${requests} request(s).`); break }

  const since = await newestRowAt()
  let pub
  try { pub = await call(false, pass) } catch (e) { console.log(`[drive] HALT — publish failed: ${String(e?.message ?? e)}`); break }
  if (pub.floorReached) { console.log(`[drive] ✅ PROVEN — the route reports the floor: ${pub.reason}`); break }
  if (pub.nothingOwed) { console.log(`[drive] pass ${pass}: window ${pub.window} owes nothing — no publish; the anchor recedes on the next derivation.`); fBefore = await frontier(); continue }
  if (!pub.published) { console.log(`[drive] HALT — route published nothing and gave no reason: ${JSON.stringify(pub).slice(0, 240)}`); break }
  const windowBefore = pub.window, owedBefore = Number(pub.owedDays)

  // ── QUIESCE: wait until this surface has been silent for QUIET_MS, not for the first finished attempt. ──
  const deadline = Date.now() + PASS_TIMEOUT_MS
  let lastSeen = since, lastChange = Date.now(), sawAny = false
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const newest = await newestRowAt()
    if (newest !== lastSeen) { lastSeen = newest; lastChange = Date.now(); sawAny = true }
    else if (sawAny && Date.now() - lastChange >= QUIET_MS) break
  }
  if (!sawAny) { console.log(`[drive] HALT — pass ${pass} (window ${windowBefore}) produced no attempt row within ${PASS_TIMEOUT_MS / 1000}s. A pass that never lands is a halt, not a hang.`); break }

  const walked = await q(`universe_attempt_log?select=window_start,window_end,outcome,rows_written&${SURF}&phase=eq.attempt_finished&recorded_at=gt.${enc(since)}&order=recorded_at.asc`)
  requests += walked.length
  const rows = walked.reduce((s, w) => s + Number(w.rows_written ?? 0), 0)
  rowsTotal += rows
  const fAfter = await frontier()
  let after
  try { after = await call(true, `${pass}-probe`) } catch (e) { console.log(`[drive] HALT — post-pass derivation failed: ${String(e?.message ?? e)}`); break }
  const windowAfter = after.floorReached ? 'FLOOR' : (after.window ?? 'none')
  const owedAfter = after.floorReached ? 0 : Number(after.owedDays ?? (after.nothingOwed ? 0 : NaN))

  console.log(`[drive] pass ${pass}: window ${windowBefore} · ${walked.length} range(s) [${walked.map((w) => `${w.window_start}..${w.window_end}=${w.outcome}/${w.rows_written}`).join(' ')}] · rows=${rows} · owed ${owedBefore} → ${owedAfter} · frontier ${fBefore} → ${fAfter} · requests=${requests}`)

  if (walked.some((w) => String(w.outcome) === 'error')) { console.log(`[drive] ⛔ WALL/ERROR — a range finished 'error'. Halting rather than spending into it.`); break }
  if (after.floorReached) { console.log(`[drive] ✅ PROVEN — ${after.reason}`); break }
  if (!progressByOwedSet({ windowBefore, windowAfter, owedBefore, owedAfter })) {
    console.log(`[drive] ⛔ STALL — a QUIESCED pass over window ${windowBefore} walked ${walked.length} range(s) for ${rows} row(s) and left the owed set UNCHANGED (${owedBefore} → ${owedAfter}, window ${windowAfter}). THIS IS A REAL STALL. Halting for diagnosis.`)
    break
  }
  fBefore = fAfter
  // ⛔ PROGRESS CARRIES THE DISTANCE, NOT ONLY THE POSITION. A frontier date alone cannot tell anyone whether
  // this run will arrive; days-remaining and the pass estimate are what make the rate legible while it runs.
  if (pass % 50 === 0) {
    const remain = fAfter ? daysBetween(fAfter, FLOOR) : null
    const perPass = fAfter ? (daysBetween(START_FRONTIER, fAfter) / pass) : 0
    const est = remain !== null && perPass > 0 ? Math.ceil(remain / perPass) : null
    console.log(`[drive] ══ PROGRESS · frontier ${fAfter} · ${pass} passes · ${requests} requests (${REQUEST_CAP - requests} left) · ${rowsTotal.toLocaleString()} rows · ${remain} day(s) to floor ${FLOOR} · ~${est ?? '?'} passes remaining at ${perPass.toFixed(2)} day/pass`)
  }
}
console.log(`[drive] END — frontier ${await frontier()} · ${requests} vendor request(s) spent.`)
}
