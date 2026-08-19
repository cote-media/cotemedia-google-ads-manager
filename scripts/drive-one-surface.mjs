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

// ⛔ THE SURFACE IS AN ARGUMENT — LORAMER_DRIVE_TAKES_ITS_SURFACE_V1. It was three hard-coded literals, and
// hard-coded constants in THIS FILE caused both of 2026-08-18's instrument defects: a deleted `FLOOR` whose
// readers survived, and a `PASS_TIMEOUT_MS` sized on the wrong quantity. A frozen (client, resource,
// segment) is the same class with a worse failure mode — it does not crash, it silently walks the WRONG
// SURFACE and reports a clean run about something nobody asked for.
// ⛔ THERE IS NO DEFAULT, DELIBERATELY. A default here is indistinguishable from an argument the operator
// thought they passed. Missing → LOUD REFUSAL, exit 2, before any network call.
// VENDOR is NOT a parameter and that is not an oversight: `/api/backfill/universe-drive` constructs the
// google adapter itself, so a second vendor would be a lie the route cannot honour. Stated, not defaulted.
const VENDOR = 'google'

/** Pure so the self-test can drive it. Returns {ok:true, …} or {ok:false, missing:[…]}. */
export const resolveSurface = (argv, env) => {
  const flag = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3).trim() : ''
  }
  const clientId = flag('client') || (env.DRIVE_CLIENT_ID ?? '').trim()
  const resource = flag('resource') || (env.DRIVE_RESOURCE ?? '').trim()
  const segment = argv.some((a) => a.startsWith('--segment=')) ? flag('segment')
    : (env.DRIVE_SEGMENT ?? '').trim()
  // ⛔ SEGMENT MAY LEGITIMATELY BE EMPTY (an unsegmented surface writes segment=''), so its ABSENCE cannot be
  // detected by emptiness — the operator must pass `--segment=` explicitly to mean "none". Anything else and
  // an unsegmented run and a forgotten argument look identical, which is the whole defect class.
  const segmentGiven = argv.some((a) => a.startsWith('--segment=')) || env.DRIVE_SEGMENT !== undefined
  const missing = []
  if (!clientId) missing.push('--client=<uuid> (or DRIVE_CLIENT_ID)')
  if (!resource) missing.push('--resource=<catalogue resource> (or DRIVE_RESOURCE)')
  if (!segmentGiven) missing.push('--segment=<segment or empty for none> (or DRIVE_SEGMENT)')
  if (missing.length) return { ok: false, missing }
  return { ok: true, clientId, resource, segment }
}
// ⛔ NO FLOOR CONSTANT — LORAMER_COMPLETION_SIGNAL_V1. It read `'2022-03-04'`: Foam OH's DISCOVERED inception,
// frozen into an instrument, which is exactly the class `LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1` killed in the
// engine and this script then reintroduced. The route resolves the stop per (account, surface) at execute
// time and RETURNS it — `floorReached` and `stopBasis` — so the drive reads the engine's answer instead of
// asserting one. Bath Fitter's google history begins 2020-01-27; the constant was wrong for it by 4 years.

const PASS_CAP = Number(process.env.DRIVE_PASS_CAP ?? 1600)
const REQUEST_CAP = Number(process.env.DRIVE_REQUEST_CAP ?? 3200)

// ⛔ THE CEILING IS READ FROM THE CONSUMER'S DECLARED CONTRACT — LORAMER_COMPLETION_SIGNAL_V1.
// `PASS_TIMEOUT_MS = 180_000` used to sit here and it mirrored `WALK_BUDGET_MS`, the consumer's budget for
// TAKING a new range — the wrong quantity. What bounds "could the consumer still be alive" is
// `CONSUMER_MAX_DURATION_S`, because Vercel's guarantee is "if a function runs for longer than its set
// maximum duration, Vercel will terminate it". Pro permits 800s and 1800s extended, so the number is OURS
// and must be read, never written: `drive-ceiling-pin.guard.mjs` pins this read, the contract and the
// route's export to one value.
export const readConsumerMaxDurationS = (src) => {
  const m = src.match(/export const CONSUMER_MAX_DURATION_S\s*=\s*(\d+)/)
  if (!m) throw new Error('CONSUMER_MAX_DURATION_S not found in universe-v2-contract.ts — the ceiling has no contract to derive from, and a guessed one is the defect this replaced')
  return Number(m[1])
}
// ⛔ THE MARGIN IS DERIVED, NOT CHOSEN. After the platform kill no further row can appear, so the observer
// needs exactly one more poll to see the absence — nothing else is being waited for.
const POLL_MS = 2000
const RUN_ID = process.env.DRIVE_RUN_ID || `drive-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`

// ── THE TWO PREDICATES, PURE, SO THEY CAN BE DRIVEN WITH RECORDED DATA ──────────────────────────────────
/** v2's quiesce, KEPT ONLY AS A FIXTURE SUBJECT. Silence is not completion — Temporal, SQS and Airbyte all
 *  say so, and pass 3 of 2026-08-18 proved it locally: open 22:31:53.470, finish 22:32:09.300, 8,649 rows,
 *  against a 10s quiet window. `quiesceWouldHaveFired` exists so a guard can drive that recorded trace and go
 *  RED on any constant that would blind the instrument again. */
export const quiesceWouldHaveFired = (a) => a.quietMs < a.openToFinishMs

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
  // ── ⛔ CONSTANT FIXTURES — LORAMER_COMPLETION_SIGNAL_V1. EVERY SIZED CONSTANT GETS A FIXTURE DRAWN FROM
  // REAL RECORDED DATA THAT SITS ON THE WRONG SIDE OF IT. This is the leg that was missing: the self-test
  // above proved the PREDICATES and nothing ever proved the CONSTANTS, so `QUIET_MS = 10_000` — sized on a
  // measured 1-4s inter-range gap — shipped and blinded the instrument on the first dense day it met.
  const fixtures = []
  // (1) THE RECORDED TRACE THAT BROKE IT. Pass 3, 2026-08-18: attempt_started 22:31:53.470,
  //     attempt_finished 22:32:09.300 — 15,830 ms open→finish on an 8,649-row day.
  fixtures.push({
    name: 'QUIET_MS vs the 2026-08-18 pass-3 trace (15,830 ms open→finish, 8,649 rows)',
    ok: quiesceWouldHaveFired({ quietMs: 10_000, openToFinishMs: 15_830 }) === true,
    why: 'a 10s quiet window MUST be shown firing early on this trace; if it does not, the fixture has stopped measuring what it was written for',
  })
  // (2) THE CEILING MUST COME FROM THE CONTRACT, and the contract must still be readable.
  let maxDurS = null
  try { maxDurS = readConsumerMaxDurationS(readFileSync(path.resolve(ROOT, 'src/lib/backfill/universe-v2-contract.ts'), 'utf8')) } catch { maxDurS = null }
  fixtures.push({
    name: 'ceiling derives from CONSUMER_MAX_DURATION_S (an invocation alive at maxDuration)',
    ok: Number.isInteger(maxDurS) && maxDurS > 0 && (maxDurS * 1000 + POLL_MS) > maxDurS * 1000,
    why: `read ${maxDurS}s from the contract; a ceiling at or below maxDuration cannot tell "still running" from "dead", which is the whole point of deriving it`,
  })
  // (3) THE FLOOR IS THE ENGINE'S ANSWER, NOT A CONSTANT. Bath Fitter's google history begins 2020-01-27 —
  //     an inception this script's old hard-coded '2022-03-04' is simply wrong about.
  fixtures.push({
    name: "FLOOR is not hard-coded (an account whose inception is 2020-01-27, not 2022-03-04)",
    ok: !/const FLOOR\s*=\s*'\d{4}-\d{2}-\d{2}'/.test(readFileSync(path.resolve(ROOT, 'scripts/drive-one-surface.mjs'), 'utf8')),
    why: 'a per-account discovered inception frozen as a script constant is exactly the class LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 killed in the engine; the route returns stopBasis and floorReached',
  })
  // (4) ⛔ THE SURFACE IS AN ARGUMENT AND ITS ABSENCE MUST REFUSE — LORAMER_DRIVE_TAKES_ITS_SURFACE_V1.
  //     The fixture on the WRONG side of it is the real run #1 invocation: had `--segment=` been forgotten,
  //     a defaulting resolver would have walked segments.device again and reported a clean run about a
  //     surface nobody asked for. Emptiness cannot detect a missing segment — an unsegmented surface writes
  //     segment='' — so the fixture drives the OMITTED case, not the empty one.
  const noArgs = resolveSurface([], {})
  const omittedSegment = resolveSurface(['--client=957d484e-d0c4-4dd0-b382-d8499d556252', '--resource=campaign_search_term_view'], {})
  const emptySegment = resolveSurface(['--client=957d484e-d0c4-4dd0-b382-d8499d556252', '--resource=campaign_search_term_view', '--segment='], {})
  const full = resolveSurface(['--client=957d484e-d0c4-4dd0-b382-d8499d556252', '--resource=campaign_search_term_view', '--segment=segments.device'], {})
  fixtures.push({
    name: 'CLIENT_ID/RESOURCE/SEGMENT come from argv and REFUSE when absent (run #1\'s own surface as the fixture)',
    ok: noArgs.ok === false && noArgs.missing.length === 3
      && omittedSegment.ok === false && omittedSegment.missing.length === 1
      && emptySegment.ok === true && emptySegment.segment === ''
      && full.ok === true && full.clientId === '957d484e-d0c4-4dd0-b382-d8499d556252'
      && full.resource === 'campaign_search_term_view' && full.segment === 'segments.device',
    why: 'no args must refuse with 3 missing; an OMITTED segment must refuse with 1; an EXPLICITLY EMPTY segment must be accepted as "no segment"; a full triple must resolve verbatim',
  })
  for (const f of fixtures) console.log(`[selftest] fixture ${f.ok ? 'PASS' : '⛔ FAIL'} — ${f.name}${f.ok ? '' : ` :: ${f.why}`}`)
  const fixturesOk = fixtures.every((f) => f.ok)
  const ok = !oldSaysProgress && newSaysProgress && !progressByOwedSet(genuine) && fixturesOk
  console.log(`[selftest] ${ok ? 'PASS — v1 false-stalls on real data, v2 reads it as progress, v2 still halts on a genuine stall, and every sized constant has a real-data fixture on the wrong side of it.' : 'FAIL'}`)
  process.exitCode = ok ? 0 : 1
} else {

try {
  for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
  }
} catch {}
// ⛔ IDENTITY FIRST, AND IT REFUSES RATHER THAN GUESSES.
const picked = resolveSurface(process.argv.slice(2), process.env)
if (!picked.ok) {
  console.error('[drive] REFUSING — the surface is an ARGUMENT and nothing was passed. There is no default: a')
  console.error('        default is indistinguishable from an argument you thought you gave, and this script')
  console.error('        spends real vendor quota. Missing:')
  for (const m of picked.missing) console.error(`          ${m}`)
  console.error('        e.g. node scripts/drive-one-surface.mjs --client=<uuid> --resource=campaign_search_term_view --segment=segments.device')
  process.exit(2)
}
const { clientId: CLIENT_ID, resource: RESOURCE, segment: SEGMENT } = picked

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
    // ⛔ BOUNDED BY THE SAME DERIVED CEILING, NEVER BY A SECOND OPINION. This read referenced
    // PASS_TIMEOUT_MS — deleted in this very commit — so it threw ReferenceError inside the pass-1
    // try/catch and printed "publish failed", blaming the route for a defect in the instrument.
    { headers: { Authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(CEILING_MS) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`route HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`)
  return body
}

let requests = 0, rowsTotal = 0
// ⛔ THE ENGINE'S FLOOR, LATCHED AS IT IS REPORTED. Never a constant: Foam OH inceptions at 2022-03-04 and
// Bath Fitter at 2020-01-27, and the old hard-coded value was simply wrong for the second.
let stopDate = null
const daysBetween = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000)
let fBefore = await frontier()
const START_FRONTIER = fBefore
const MAX_DUR_S = readConsumerMaxDurationS(readFileSync(path.resolve(ROOT, 'src/lib/backfill/universe-v2-contract.ts'), 'utf8'))
const CEILING_MS = MAX_DUR_S * 1000 + POLL_MS
// ⛔ PRE-FLIGHT: VALIDATE THE SURFACE BEFORE SPENDING, NOT AFTER. One dryRun call — it publishes nothing and
// costs no vendor request — is the ONLY honest validator, because "is this (resource, segment) selectable
// for THIS client" is a question the catalogue and the client's own connection answer together, and the
// route already owns both. A typo'd segment used to surface as a 400 partway through a spending loop.
let preflight
try {
  preflight = await call(true, 'preflight')
} catch (e) {
  console.error(`[drive] REFUSING — the surface did not validate, and NOTHING was spent: ${String(e?.message ?? e)}`)
  console.error(`        Asked for client=${CLIENT_ID} resource=${RESOURCE} segment=${SEGMENT === '' ? '<none>' : SEGMENT}.`)
  console.error(`        A 400 naming the catalog entry means the pair is not selectable for this client — check the resource/segment spelling against the universe catalogue.`)
  process.exit(2)
}
if (preflight.stopDate) stopDate = preflight.stopDate

console.log(`[drive] START ${RESOURCE}/${SEGMENT === '' ? '<no segment>' : SEGMENT} · client=${CLIENT_ID} · vendor=${VENDOR}`)
console.log(`[drive] SUBJECT VALIDATED by a dryRun (no publish, no vendor request) · frontier=${fBefore} · ` +
  `stop=${preflight.stopDate ?? 'UNREPORTED'} (${preflight.stopBasis ?? 'basis unreported'}) · ` +
  `first window=${preflight.floorReached ? 'FLOOR ALREADY REACHED' : (preflight.window ?? 'none')} · owed=${preflight.owedDays ?? (preflight.nothingOwed ? 0 : '?')} · runId=${RUN_ID}`)
console.log(`[drive] caps ${PASS_CAP} passes / ${REQUEST_CAP} requests · ceiling ${CEILING_MS / 1000}s DERIVED from CONSUMER_MAX_DURATION_S=${MAX_DUR_S}s + one poll · WAITS FOR THE TERMINAL ROW, never for silence`)

for (let pass = 1; pass <= PASS_CAP; pass++) {
  if (requests >= REQUEST_CAP) { console.log(`[drive] HALT — request cap ${REQUEST_CAP} reached.`); break }
  // ⛔ NO LOCAL FLOOR TEST. `pub.floorReached` below is the ENGINE's answer, resolved per (account, surface).

  const since = await newestRowAt()
  let pub
  try { pub = await call(false, pass) } catch (e) { console.log(`[drive] HALT — publish failed: ${String(e?.message ?? e)}`); break }
  if (pub.floorReached) { console.log(`[drive] ✅ PROVEN — the route reports the floor: ${pub.reason}`); break }
  if (pub.nothingOwed) { console.log(`[drive] pass ${pass}: window ${pub.window} owes nothing — no publish; the anchor recedes on the next derivation.`); fBefore = await frontier(); continue }
  if (!pub.published) { console.log(`[drive] HALT — route published nothing and gave no reason: ${JSON.stringify(pub).slice(0, 240)}`); break }
  const windowBefore = pub.window, owedBefore = Number(pub.owedDays)
  if (pub.stopDate) stopDate = pub.stopDate

  // ── ⛔ WAIT FOR THE TERMINAL ROW, NEVER FOR SILENCE — LORAMER_COMPLETION_SIGNAL_V1. Two versions of this
  // loop inferred completion from write activity and both were wrong, because write activity has gaps in the
  // MIDDLE: v1 returned on the first finished row (a 1-4s inter-range gap fooled it), v2 waited 10s of quiet
  // (a 15.8s open→finish on a dense day fooled it). Airbyte, Temporal and SQS all say the same thing —
  // completion is a POSITIVE record and absence is failure-or-not-yet, never done. The consumer now writes one.
  // ⛔ MATCHED ON THE PRODUCER'S OWN KEY, which the route returns, so a scheduled */15 fire landing on this
  // same surface mid-pass can never be mistaken for the drive's work.
  const msgKey = pub.idempotencyKey
  if (!msgKey) { console.log(`[drive] HALT — the route returned no idempotencyKey, so this pass cannot be attributed. Refusing to measure work I cannot prove is mine.`); break }
  const deadline = Date.now() + CEILING_MS
  let terminal = null
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const t = await q(`universe_attempt_log?select=recorded_at,error&${SURF}&phase=eq.message_finished&message_key=eq.${enc(msgKey)}&limit=1`)
    if (t.length) { terminal = t[0]; break }
  }
  if (!terminal) {
    // ⛔ LOUD INDETERMINATE, AND IT INVALIDATES THE MEASUREMENT RATHER THAN COLOURING IT. Vercel's contract is
    // that an invocation cannot outlive its configured maxDuration, so past the ceiling there is no terminal
    // row coming — the message did not finish, and a pass that cannot be proven complete must not be counted.
    // The old loop fell through here SILENTLY when it had seen any row at all.
    console.log(`[drive] ⛔ INDETERMINATE — pass ${pass} (window ${windowBefore}, key ${msgKey}) produced NO terminal row within ${CEILING_MS / 1000}s, which is CONSUMER_MAX_DURATION_S(${MAX_DUR_S}s) + one poll. Past that ceiling Vercel has terminated the invocation, so no terminal row is coming. THE MEASUREMENT IS VOID — not a stall, not a pass. Halting.`)
    break
  }

  // ⛔ THE COUNTER JOINS ON THE PRODUCER'S KEY, NOT ON A TIME WINDOW, and it sums the column that is CHARGED
  // BEFORE the vendor call. Counting `attempt_finished` rows inside a `recorded_at >` window — the old shape —
  // inherits the same boundary one layer down (it reported 2 where the ledger held 3) and silently drops every
  // attempt that was charged and then died.
  const started = await q(`universe_attempt_log?select=requests_spent&${SURF}&phase=eq.attempt_started&message_key=eq.${enc(msgKey)}`)
  const walked = await q(`universe_attempt_log?select=window_start,window_end,outcome,rows_written&${SURF}&phase=eq.attempt_finished&message_key=eq.${enc(msgKey)}&order=recorded_at.asc`)
  requests += started.reduce((a, r) => a + Number(r.requests_spent ?? 0), 0)
  const rows = walked.reduce((s, w) => s + Number(w.rows_written ?? 0), 0)
  rowsTotal += rows
  const fAfter = await frontier()
  let after
  try { after = await call(true, `${pass}-probe`) } catch (e) { console.log(`[drive] HALT — post-pass derivation failed: ${String(e?.message ?? e)}`); break }
  if (after.stopDate) stopDate = after.stopDate
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
    // ⛔ THE FLOOR IS READ, NEVER WRITTEN. This block referenced a FLOOR constant deleted in the same
    // commit — outside every try, so it would have crashed the run at pass 50 having already spent ~50
    // passes, and printed no END line. `stopDate` is the engine's per-(account,surface) answer, carried
    // back by the route beside `stopBasis`; when it has not been reported yet the distance is simply
    // unknown and says so, which is the honest reading and not an estimate.
    const remain = fAfter && stopDate ? daysBetween(fAfter, stopDate) : null
    const perPass = fAfter ? (daysBetween(START_FRONTIER, fAfter) / pass) : 0
    const est = remain !== null && perPass > 0 ? Math.ceil(remain / perPass) : null
    console.log(`[drive] ══ PROGRESS · frontier ${fAfter} · ${pass} passes · ${requests} requests (${REQUEST_CAP - requests} left) · ${rowsTotal.toLocaleString()} rows · ${remain ?? '?'} day(s) to floor ${stopDate ?? 'UNREPORTED'} · ~${est ?? '?'} passes remaining at ${perPass.toFixed(2)} day/pass`)
  }
}
console.log(`[drive] END — frontier ${await frontier()} · ${requests} vendor request(s) spent.`)
}
