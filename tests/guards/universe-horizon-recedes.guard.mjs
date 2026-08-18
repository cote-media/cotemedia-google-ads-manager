#!/usr/bin/env node
// LORAMER_WALK_HORIZON_RECEDES_V1 + LORAMER_RESUMER_SCAN_ROTATES_V1 — the two defects that made the scheduled
// walk a second forward-capture loop, and the invariant that keeps its bound EXACT.
//
// ⛔ BOTH DEFECTS WERE MEASURED BEFORE THEY WERE FIXED, and the measurements are the reason this guard exists
// in this shape rather than as a code review:
//   · HORIZON — the route read `const windowEnd = yesterday` for every window, every fire, every surface.
//     Live attempt log 2026-08-13: **244 vendor requests since 2026-08-10 23:52Z, ZERO ROWS WRITTEN, EVER.**
//     Oldest window_start ever attempted 2026-07-12, against a discovered floor of 2022-03-04 — 1,622 days
//     of depth the walk could not reach because nothing ever moved an anchor backward.
//   · SCAN CAP — the route scanned the catalog IN ORDER and broke at MAX_ENTRIES_SCANNED_PER_RUN. Live:
//     **61 distinct surfaces ever touched of 346 selectable.** 286 had never been asked once. The cap was
//     doing its job; the ORDER silently made it a filter.
//
// ⛔ DRIVEN, NOT GREPPED. Both decisions were moved OUT of the route and into pure functions precisely so
// this guard can execute them — `universe-window-log.ts:93-97` records the third time in one day that a
// text-search guard went GREEN against a break that replaced an expression with `false` because the NAME
// survived. A decision that must be guarded has to be callable.
import { readFileSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const DECIDER = 'src/lib/backfill/universe-resumer.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const ADAPTER = 'src/lib/backfill/capture-adapters/google-ads.adapter.ts'
const stripped = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

// ── COMPILE THE PURE DECIDER AND DRIVE IT ────────────────────────────────────────────────────────────
let R = null
{
  const out = mkdtempSync(join(tmpdir(), 'loramer-horizon-'))
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, DECIDER), '--target', 'es2020', '--module', 'commonjs', '--outDir', out, '--skipLibCheck'], { encoding: 'utf8' })
  if (r.error || (r.status !== 0 && !/error TS/.test(String(r.stdout || '')))) {
    findings.push(`could not compile ${DECIDER} — ${r.error ? r.error.message : String(r.stdout || r.stderr).slice(0, 300)}. A guard that cannot run its subject FAILS rather than passing.`)
  } else {
    try { R = createRequire(import.meta.url)(join(out, 'universe-resumer.js')) }
    catch (e) { findings.push(`could not load the compiled ${DECIDER} — ${e.message}. A BROKEN INSTRUMENT, not a pass.`) }
  }
}

// ⛔ THE DECISIONS MUST EXIST BEFORE THEY CAN BE DRIVEN — AND THEIR ABSENCE IS A FINDING, NOT A CRASH.
// Driven against the pre-change tree this guard threw `R.deriveAnchorEnd is not a function`, which
// `run-guards.mjs` correctly buckets as CRASHED — a broken instrument, which is NOT evidence that the code
// is wrong. The absence of the decision IS the defect (the horizon anchored at yesterday because nothing
// derived an anchor at all), so it is reported as one and the driven legs below are skipped cleanly.
if (R) {
  for (const fn of ['deriveAnchorEnd', 'deriveWindow', 'orderForRotation', 'boundedSelection']) {
    if (typeof R[fn] !== 'function') {
      findings.push(`${DECIDER} exports no \`${fn}\`. THE DECISION DOES NOT EXIST AS A DRIVABLE FUNCTION — which is how the ` +
        `horizon came to be \`const windowEnd = yesterday\` inline in the route, unguardable and unmoved for the walk's entire scheduled life ` +
        `(measured: 244 requests, 0 rows, oldest window_start 2026-07-12 against a 2022-03-04 floor).`)
      R = null
      break
    }
  }
}

// ── (a) THE HORIZON RECEDES — AND ONLY OVER ANSWERED GROUND ──────────────────────────────────────────
if (R) {
  const NEWEST = '2026-08-12'
  // 1. Never attempted → the newest ground. Newest-first is still the design.
  const first = R.deriveAnchorEnd({ newestGround: NEWEST, lastWindowStart: null, lastWindowEnd: null, lastWindowFullyAnswered: true })
  if (first.anchorEnd !== NEWEST || first.receded) {
    findings.push(`(a) a NEVER-ATTEMPTED surface did not anchor at the newest ground: ${JSON.stringify(first)}. Newest-first is the design — the user has the most recent months within hours.`)
  }
  // 2. ⛔ THE WHOLE POINT: an answered window must RECEDE, to the day BELOW it.
  // ⛔ `lastWindowKnown: true` ADDED 2026-08-18 — LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1. The recession legs of
  // this guard assert what happens to a window the engine can VOUCH FOR, so they must say so. A row without a
  // parent stamp is UNKNOWN and deliberately does NOT recede, and that separate contract is asserted by
  // `anchor-recedes-by-window.guard.mjs` leg (B) rather than duplicated here.
  const receded = R.deriveAnchorEnd({ newestGround: NEWEST, lastWindowStart: '2026-07-14', lastWindowEnd: '2026-08-12', lastWindowFullyAnswered: true, lastWindowKnown: true })
  if (!receded.receded || receded.anchorEnd !== '2026-07-13') {
    findings.push(`(a) AN ANSWERED WINDOW DID NOT RECEDE: ${JSON.stringify(receded)} — expected anchorEnd 2026-07-13, the day below 2026-07-14. ` +
      `THIS IS THE DEFECT: anchored at yesterday forever, the scheduled walk spent 244 requests for ZERO rows and never reached below 2026-07-12 against a 2022-03-04 floor.`)
  }
  // 3. ⛔ AND IT MUST NOT RECEDE PAST UNANSWERED GROUND — receding there would skip days nothing else walks.
  const held = R.deriveAnchorEnd({ newestGround: NEWEST, lastWindowStart: '2026-07-14', lastWindowEnd: '2026-08-12', lastWindowFullyAnswered: false, lastWindowKnown: true })
  if (held.receded || held.anchorEnd !== '2026-08-12') {
    findings.push(`(a) THE ANCHOR RECEDED PAST A WINDOW THAT STILL OWED DAYS: ${JSON.stringify(held)}. A day skipped here is walked by NOTHING — ` +
      `that is the false-all-clear class this rebuild exists to end, arriving through a scheduler instead of a coverage read.`)
  }
  // 4. Monotone: successive receding anchors strictly descend, so the walk cannot stall in place.
  let cursor = { start: '2026-07-14', end: '2026-08-12' }
  let prev = '9999-12-31'
  for (let i = 0; i < 5; i++) {
    const a = R.deriveAnchorEnd({ newestGround: NEWEST, lastWindowStart: cursor.start, lastWindowEnd: cursor.end, lastWindowFullyAnswered: true, lastWindowKnown: true })
    if (!(a.anchorEnd < prev)) { findings.push(`(a) the anchor did not STRICTLY descend on lap ${i}: ${a.anchorEnd} vs previous ${prev}. A walk that stops descending re-buys ground forever.`); break }
    prev = a.anchorEnd
    const w = R.deriveWindow({ anchorEnd: a.anchorEnd, sizingDays: 30, stopDate: '2022-03-04' })
    if (!w) { findings.push(`(a) deriveWindow returned COMPLETE at ${a.anchorEnd}, far above the stop 2022-03-04.`); break }
    cursor = { start: w.windowStart, end: w.windowEnd }
  }
}

// ── (b) THE WINDOW CLAMPS TO THE RESOLVED STOP — AND `null` IS UNKNOWN, NOT A FLOOR ──────────────────
if (R) {
  const clamped = R.deriveWindow({ anchorEnd: '2022-03-20', sizingDays: 30, stopDate: '2022-03-04' })
  if (!clamped || clamped.windowStart !== '2022-03-04') {
    findings.push(`(b) a window straddling the stop was not clamped to it: ${JSON.stringify(clamped)} — expected windowStart 2022-03-04. ` +
      `Asking below a DISCOVERED stop spends quota to learn what is already known.`)
  }
  const done = R.deriveWindow({ anchorEnd: '2022-03-03', sizingDays: 30, stopDate: '2022-03-04' })
  if (done !== null) {
    findings.push(`(b) an anchor BELOW the stop did not report COMPLETE: ${JSON.stringify(done)}. A surface walked to its floor must be distinguishable from one that is merely quiet.`)
  }
  const unknown = R.deriveWindow({ anchorEnd: '2015-01-30', sizingDays: 30, stopDate: null })
  if (!unknown || unknown.windowStart !== '2015-01-01') {
    findings.push(`(b) a NULL stop did not leave the window unclamped: ${JSON.stringify(unknown)}. \`null\` is UNKNOWN — no wall observed, no inception discovered — ` +
      `and inventing a floor from silence is LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1, which sealed 214 cursors once already.`)
  }
}

// ── (c) THE ROTATION REACHES EVERY SURFACE, AND STARVATION IS IMPOSSIBLE ─────────────────────────────
if (R) {
  const CATALOG = Array.from({ length: 346 }, (_, i) => ({ resource: `r${String(i).padStart(3, '0')}`, segment: null }))
  const keyOf = (e) => `${e.resource}|${e.segment ?? ''}`
  const SCAN = 60
  // Simulate the real loop: scan the first SCAN of the rotated order, stamp them attempted, repeat.
  const seen = new Map()
  const everScanned = new Set()
  let fires = 0
  for (; fires < 12; fires++) {
    const order = R.orderForRotation(CATALOG, keyOf, seen)
    for (const e of order.slice(0, SCAN)) {
      const k = keyOf(e)
      everScanned.add(k)
      seen.set(k, `2026-08-13T${String(fires).padStart(2, '0')}:30:00Z`)
    }
    if (everScanned.size === CATALOG.length) break
  }
  const laps = Math.ceil(CATALOG.length / SCAN)
  if (everScanned.size !== CATALOG.length) {
    findings.push(`(c) ROTATION DOES NOT REACH THE WHOLE CATALOG: ${everScanned.size} of ${CATALOG.length} surfaces scanned in 12 fires. ` +
      `THIS IS THE DEFECT: in catalog order, entries ${SCAN + 1}..${CATALOG.length} were unreachable BY CONSTRUCTION — 61 of 346 ever touched, 286 never asked once.`)
  } else if (fires + 1 > laps) {
    findings.push(`(c) the rotation took ${fires + 1} fires to cover ${CATALOG.length} surfaces at a scan cap of ${SCAN}; ceil() says ${laps}. ` +
      `A rotation that revisits before it completes is not least-recently-attempted ordering.`)
  }
  // Never-attempted MUST outrank everything attempted, or a new surface can be starved by an old busy one.
  const mixed = [{ resource: 'zzz', segment: null }, { resource: 'aaa', segment: null }]
  const withStamp = new Map([['aaa|', '2020-01-01T00:00:00Z']])
  const ordered = R.orderForRotation(mixed, keyOf, withStamp)
  if (keyOf(ordered[0]) !== 'zzz|') {
    findings.push(`(c) an ATTEMPTED surface outranked a NEVER-ATTEMPTED one (${ordered.map(keyOf).join(', ')}). Never-attempted must sort first — otherwise a surface that has never been asked once can wait behind one that has been asked a thousand times.`)
  }
  // Deterministic: same inputs, same order. A guard cannot drive a decision that is not total.
  const a1 = R.orderForRotation(CATALOG, keyOf, seen).map(keyOf).join(',')
  const a2 = R.orderForRotation(CATALOG, keyOf, seen).map(keyOf).join(',')
  if (a1 !== a2) findings.push(`(c) orderForRotation is NOT deterministic on identical inputs — the tie-break is not total, so the scan order is unpredictable and unguardable.`)
}

// ── (d) THE EXACT-BOUND INVARIANT: sizing.maxDays ≤ MAX_REQUESTS_PER_RUN ─────────────────────────────
// ⛔ THIS PINS A RELATIONSHIP, NOT EITHER NUMBER, and that is deliberate. `boundedSelection` admits an
// over-budget candidate ALONE when nothing has been taken (skipping it forever would starve the most
// fragmented entries), so the true worst case per fire is max(bite, largest single candidate's ranges).
// Ranges ≤ owed days ≤ window days ≤ sizing.maxDays. While maxDays ≤ bite the worst case IS the bite; raise
// maxDays past it and the bound silently stops being exact with nothing to announce it.
{
  const dec = read(DECIDER)
  const ad = read(ADAPTER)
  const bite = Number((dec.match(/export const MAX_REQUESTS_PER_RUN\s*=\s*(\d+)/) || [])[1])
  const maxDays = Number((ad.match(/maxDays\s*:\s*(\d+)/) || [])[1])
  if (!Number.isFinite(bite)) findings.push(`(d) MAX_REQUESTS_PER_RUN not found in ${DECIDER} — the bound this invariant is expressed against has moved or vanished.`)
  else if (!Number.isFinite(maxDays)) findings.push(`(d) sizing.maxDays not found in ${ADAPTER} — the window ceiling that bounds a single candidate's ranges cannot be read.`)
  else if (maxDays > bite) {
    findings.push(`(d) EXACT-BOUND INVARIANT BROKEN: sizing.maxDays is ${maxDays} but MAX_REQUESTS_PER_RUN is ${bite}. ` +
      `boundedSelection admits an over-budget candidate ALONE, so one fire can now spend ${maxDays} rather than ${bite} — the bound is no longer exact, ` +
      `and every daily-spend figure derived from it (bite × fires/day) is understated. Raise the bite, lower maxDays, or re-derive the schedule.`)
  }
  // And the invariant must be DRIVEN, not just compared: a single oversized candidate is admitted alone.
  if (R && Number.isFinite(bite)) {
    const alone = R.boundedSelection([{ ranges: bite + 5 }, { ranges: 1 }], bite)
    if (alone.taken.length !== 1 || alone.requests !== bite + 5) {
      findings.push(`(d) boundedSelection's admit-alone behaviour changed: ${JSON.stringify(alone)}. The invariant in (d) is derived from it — if it no longer admits an oversized item alone and stops, the worst-case arithmetic above is describing a function that does not exist.`)
    }
  }
}

// ── (e) THE RESUMER MAY NOT CLAMP TO A GLOBAL FLOOR ──────────────────────────────────────────────────
// ⛔ THE MEASURED DEFECT: the resumer read `adapter.retention.floorDate ?? VENDOR_FLOOR_DATE` = `null ??
// '2022-03-05'`, clamping every window of every account to ONE CONSTANT. Foam OH's DISCOVERED inception is
// 2022-03-04 — one day BELOW it — so a receding walk would stop one day above the floor it holds provenance
// for, on every surface, forever; on an older account, years early. Same class the adapter's own `retention`
// header records: one account's measured floor applied to every account.
{
  const code = stripped(read(ROUTE))
  if (/\bVENDOR_FLOOR_DATE\b/.test(code)) {
    findings.push(`(e) ${ROUTE} references VENDOR_FLOOR_DATE in code. The resumer clamps to the RESOLVED per-(account,surface) stop; ` +
      `reaching for the global re-introduces exactly the defect this flight removed — and it is one day WRONG on the only account the walk runs on.`)
  }
  if (!/resolveWalkStop\s*\(/.test(code)) {
    findings.push(`(e) ${ROUTE} never calls resolveWalkStop(). The resumer must compose the SAME stop the consumer does, through the one composition site — otherwise it is clamping to something it invented.`)
  }
  // ⛔ SCOPED TO THE MESSAGE LITERAL, not the file. A bare /floorDate\s*,/ over the whole route matched
  // `floorDate: adapter.retention.floorDate,` — the assessCoverage argument, which is CORRECT and must stay
  // (it passes the RAW null so the below-the-floor check stays inert on a null-floor adapter). A guard whose
  // finding names the wrong line is a guard that gets disabled.
  {
    const msgLit = code.match(/const\s+msg\s*:\s*UniverseMessageV2\s*=\s*\{[\s\S]*?\n\s{4}\}/)
    if (!msgLit) {
      findings.push(`(e) ${ROUTE} has no \`const msg: UniverseMessageV2 = {…}\` literal — this guard cannot locate what the resumer publishes and FAILS rather than assuming.`)
    } else if (/\bfloorDate\b/.test(msgLit[0])) {
      findings.push(`(e) ${ROUTE} still puts \`floorDate\` on the published message. The consumer is FORBIDDEN to read it ` +
        `(universe-floor-execute-time leg (a)), so it is a publisher's opinion nothing consumes — and a dead field holding a stale floor is how the stale floor comes back.`)
    }
  }
  if (!/deriveAnchorEnd\s*\(/.test(code) || !/deriveWindow\s*\(/.test(code) || !/orderForRotation\s*\(/.test(code)) {
    findings.push(`(e) ${ROUTE} does not use all three pure decisions (deriveAnchorEnd · deriveWindow · orderForRotation). ` +
      `A decision re-inlined into the route is a decision this guard cannot drive, which is how a text-search guard went green over a break three times in one day.`)
  }
  if (!/scanCompleted/.test(code)) {
    findings.push(`(e) ${ROUTE} emits no \`scanCompleted\` in its fire instrument. A resumer that DIES MID-SCAN publishes a truncated prefix ` +
      `that reads exactly like a complete fire that found little; nothing else distinguishes them.`)
  }
}

if (findings.length) {
  console.error(`[universe-horizon-recedes] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-horizon-recedes] PASS — the anchor recedes over answered ground and HOLDS over unanswered · the window clamps to the RESOLVED stop and treats null as UNKNOWN · the rotation reaches all 346 surfaces in ceil(346/60) fires with never-attempted first and a total tie-break · sizing.maxDays ≤ MAX_REQUESTS_PER_RUN keeps the bound EXACT · and the resumer carries no global floor and no dead floorDate on the message. LIMIT: these are the DECISIONS, driven with no DB and no vendor — that the live coverage read feeding them is right is Gate-B's question, not this guard's.`)
