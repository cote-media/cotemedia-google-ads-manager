#!/usr/bin/env node
// LORAMER_UNIVERSE_RESUMER_V1 — THE SCHEDULER'S REFUSALS, MECHANICALLY.
//
// ⛔ WHY THIS GUARD IS DIFFERENT FROM THE OTHERS. Every other component in this rebuild fails in front of a
// human. **THE RESUMER FAILS UNATTENDED**, and a scheduler over a wrong coverage answer publishes wrong work
// forever. Coverage has been proven for ONE entry, ONE month, ONE platform. So the legs here are almost all
// REFUSALS — the things the resumer must decline to do — rather than things it must do.
//
// THE LEGS:
//   (a) it publishes from DERIVED coverage — never a stored list, never a cursor
//   (b) implausible coverage REFUSES AND RECORDS (four arithmetic/declared-fact checks, pure)
//   (c) it cannot exceed its bound, and the bound is in REQUESTS, not messages
//   (d) a BROKEN entry stops being published and becomes reportable
//   (e) it HOLDS when the meter is unreadable
//   (f) ⛔ NO-PROGRESS — an entry whose owed set did not shrink after a SUCCESSFUL attempt is not
//       re-published. This is June's `BackfillControl.tsx:81-83` and the defence v2 lacked; leg (f2) is red
//       against a bound that only fires on failures, which is what v2 shipped with.
//   (g) it never writes a row, a day commit, or to either old bookkeeping table
//   (h) its SCHEDULE and its own header AGREE, in both directions (scheduled 2026-08-11, LORAMER_WALK_SCHEDULED_V1)
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const DECIDER = 'src/lib/backfill/universe-resumer.ts'
const ROUTE = process.env.LORAMER_RESUMER_ROUTE || 'src/app/api/cron/universe-resume/route.ts'

const route = read(ROUTE)
const code = route.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

// ── (a) DERIVED COVERAGE, NEVER A LIST OR A CURSOR ───────────────────────────────────────────────────
if (route) {
  if (!/rangesStillOwed\(/.test(code)) {
    findings.push(`(a) ${ROUTE} never calls rangesStillOwed. THE RESUMER PUBLISHES FROM DERIVED COVERAGE. A stored list is a claim that goes stale — on 2026-08-08 the walk's own owed list was measured WRONG IN BOTH DIRECTIONS on the very range it was consulted about.`)
  }
  for (const [pat, why] of [
    [/universe_run_state/, 'the old per-entry state table — an owed LIST, which is the thing being replaced'],
    [/universe_window_log/, 'the old bookkeeping table, measured wrong in both directions'],
    [/backfill_earliest_date|sync_state/, 'the June cursor — a claim about an action, not a fact about data'],
  ]) {
    if (pat.test(code)) findings.push(`(a) ${ROUTE} reads ${why}. Owed-ness is RECOMPUTED every run from metrics_daily and from nothing else.`)
  }
  if (!/selectableEntries\(|loadUniverse\(/.test(code)) {
    findings.push(`(a) ${ROUTE} does not enumerate the CATALOG. Candidates must come from the DECLARED universe (the denominator), with owed-ness derived per entry — not from a list of pending work.`)
  }
}

// ── (c) THE BOUND IS IN REQUESTS, NOT MESSAGES ───────────────────────────────────────────────────────
if (route) {
  if (!/MAX_REQUESTS_PER_RUN/.test(code)) findings.push(`(c) ${ROUTE} does not apply MAX_REQUESTS_PER_RUN.`)
  if (!/boundedSelection\(/.test(code)) findings.push(`(c) ${ROUTE} does not bound its selection.`)
  if (!/windowsRemaining:\s*WINDOWS_PER_PUBLISHED_MESSAGE/.test(code)) {
    findings.push(`(c) ${ROUTE} does not publish single-window work. WITHOUT \`windowsRemaining: 1\` EVERY PUBLISHED MESSAGE SELF-REPUBLISHES ITS SUCCESSOR AND WALKS TO THE FLOOR — publishing 4 messages would start 4 chains and cost ~148 requests from a bound that reads like 4. The driver owns the loop (June: BackfillControl.tsx:64-86).`)
  }
}

// ── (e) THE METER GATES THE PUBLISH ───────────────────────────────────────────────────────────────────
if (route) {
  const iGate = code.search(/mayFetch(Program)?\(/), iSend = code.indexOf('send(TOPIC')
  if (iGate < 0) findings.push(`(e) ${ROUTE} never calls mayFetch/mayFetchProgram — nothing gates the publish on the adapter's meter.`)
  else if (iSend >= 0 && iGate > iSend) findings.push(`(e) ${ROUTE} publishes at ${iSend} BEFORE gating at ${iGate}.`)
  if (!/if\s*\(!gate\.ok\)/.test(code)) findings.push(`(e) ${ROUTE} does not act on the meter verdict.`)
}

// ── (e2) THE METER IS CHARGED FOR THE WHOLE PROGRAM, NOT ONE FETCH ────────────────────────────────────
// ⛔ LORAMER_V2_METER_CHARGES_THE_PROGRAM_V1, 2026-08-11 — MEASURED TWICE ON LIVE DATA, NOT PREDICTED. The
// resumer publishes up to MAX_REQUESTS_PER_RUN = 20 vendor requests (one per owed range) and gated them with
// `mayFetch(adapter, sel.requests)` — a REQUEST COUNT handed to a parameter that means DAYS. Google's
// `costOf` is flat and discards `days`, so the mislabelling was invisible: both watched wet runs of
// 2026-08-10/11 printed `0 + 1 of 6000` while authorising twenty requests. It failed SAFE only because
// MAX_REQUESTS_PER_RUN is the real bound, which is precisely the problem — the meter was not holding the
// line it appeared to hold, and the next person to raise that bound would have found out the hard way.
// ⛔ THIS LEG IS INVOCATION-SHAPED, NOT NAME-SHAPED (Lesson 68 shape (c)): it refuses the SPECIFIC wrong
// call, so restoring the defect with the import still present goes RED.
if (route) {
  if (/mayFetch\s*\(\s*adapter\s*,\s*sel\.requests\s*\)/.test(code)) {
    findings.push(`(e2) ${ROUTE} charges the meter \`mayFetch(adapter, sel.requests)\` — a REQUEST COUNT passed to a \`days\` parameter. On Google \`costOf\` discards \`days\`, so a 20-request program is charged ONE operation and the gate reads "0 + 1 of 6000" while authorising twenty. Charge the PROGRAM: mayFetchProgram(adapter, sel.taken.flatMap((c) => c.rangeSpans)).`)
  }
  if (!/mayFetchProgram\s*\(\s*adapter\s*,/.test(code)) {
    findings.push(`(e2) ${ROUTE} does not gate on mayFetchProgram(). The resumer authorises a PROGRAM of up to MAX_REQUESTS_PER_RUN vendor requests in one decision; a per-fetch cost cannot express that, and \`costOf(days)\` is per-fetch by contract (capture-adapter.ts:121-126).`)
  }
  if (!/rangeSpans/.test(code)) {
    findings.push(`(e2) ${ROUTE} does not carry \`rangeSpans\`. ONE OWED RANGE IS ONE VENDOR REQUEST (universe-resumer.ts:201-203) and each range has its own day span; \`owed.ranges\` is computed here and reducing it to \`.length\` throws away the only thing \`costOf\` is defined over. On a rises-with-range adapter (GA4) that difference is the whole charge.`)
  }
}

// ── (g) IT NEVER WRITES ROWS OR DAY COMMITS ───────────────────────────────────────────────────────────
// ⛔ MOVED 2026-08-14, DELIBERATELY, IN THE SAME COMMIT AS THE CHANGE IT CAUGHT (LORAMER_WALK_UNWEDGE_AND_
// HEARTBEAT_V1). The blanket appendAttemptStarted ban encoded a superseded model: "opening = charging vendor
// spend". The covered-ground advance opens a ZERO-REQUEST bookkeeping pair (started(0)+'skipped') because
// 064's rotation reads phase='attempt_started' only — without it, a fully-covered window pins the rotation
// and the surface wedges forever (★WALK-WEDGES-AT-COVERED-GROUND, 346/346 surfaces, 21 hours, measured).
// THE PROPERTY THE LEG PROTECTS IS UNCHANGED AND NOW STATED PRECISELY: the resumer may never open a CHARGED
// attempt — every appendAttemptStarted call site in this route must pass literal `0` requests. The row/day/
// vendor bans are untouched. walk-unwedge-heartbeat.guard.mjs owns the skip pair's full shape.
if (route) {
  for (const [pat, why] of [
    [/upsertMetricsChunked|from\('metrics_daily'\)[\s\S]{0,80}\.(upsert|insert)/, 'writes captured rows'],
    [/appendDayCommitted/, 'writes a day_committed record'],
    [/appendAttemptStarted\((?!key, 0\))/, 'opens a CHARGED attempt — the resumer may append only the zero-request covered-skip pair; charged opens belong to the consumer'],
    [/googleAdsStreamFor|queryStream|customer\.query/, 'reaches the vendor. A scheduler that fetches is a scheduler that can spend without a message ever being counted'],
  ]) {
    if (pat.test(code)) findings.push(`(g) ${ROUTE} ${why}. WRITE-THEN-ADVANCE-PER-UNIT (June: run-backfill.ts:242-260) lives in universe-stream-capture's flush(); the resumer cannot break that ordering because it must never participate in it.`)
  }
}

// ── (h) SCHEDULED DELIBERATELY — THE HEADER MUST AGREE WITH vercel.json, IN BOTH DIRECTIONS ───────────
// ⛔ OPENED 2026-08-11 (LORAMER_WALK_SCHEDULED_V1, Russ's explicit GO; seen RED refusing the entry first).
// The exact cron shape is pinned by universe-stream-consumer.guard.mjs leg (e) — ONE owner per fact, not
// re-pinned here. What THIS leg now guards is the thing it always guarded one level up: the route's own
// header must tell the truth about whether it is scheduled. A header claiming NOT SCHEDULED over a live cron
// is how the next session walks into unattended spend believing the safety is still on; a header claiming
// SCHEDULED after the entry is deleted is the same lie in the safe-looking direction.
{
  const vercel = read('vercel.json')
  const routeSrc = read(ROUTE)
  const isScheduled = Boolean(vercel && /universe-resume/.test(vercel))
  const headerSaysScheduled = /SCHEDULED AS OF/.test(routeSrc)
  const headerSaysNot = /NOT SCHEDULED\. THIS ROUTE IS NOT IN/.test(routeSrc)
  if (isScheduled && (headerSaysNot || !headerSaysScheduled)) {
    findings.push(`(h) vercel.json SCHEDULES the resumer but the route header still claims it is not (or carries no SCHEDULED AS OF banner). The next session reads the header first and would believe the safety is still on.`)
  }
  if (!isScheduled && headerSaysScheduled) {
    findings.push(`(h) the route header claims SCHEDULED but vercel.json has no universe-resume entry — the walk was un-scheduled without the header moving, which hides that a decision was reversed.`)
  }
  // (the old "header must say NOT SCHEDULED" clause is subsumed by the two-direction check above)
  if (route && !/dryRun.*!==\s*'0'|dryRun\s*=\s*url\.searchParams\.get\('dryRun'\)\s*!==\s*'0'/.test(code)) {
    findings.push(`(h) ${ROUTE} does not DEFAULT TO DRY-RUN. An unattended publisher whose default is "publish" is one misconfigured cron away from an unbounded run.`)
  }
}

// ── BEHAVIOURAL: DRIVE THE REAL DECIDER ──────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-resumer-guard-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, DECIDER), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__stub.js'); writeFileSync(stub, `module.exports = new Proxy({}, { get: () => (() => {}) })`)
  Module._resolveFilename = function (req_, ...rest) {
    if (req_.startsWith('@/') || req_.startsWith('./') || req_.startsWith('../')) return stub
    return origResolve.call(this, req_, ...rest)
  }
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  const days = (from, n) => { const o = [], d = new Date(from + 'T00:00:00Z'); for (let i = 0; i < n; i++) { o.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) } return o }

  // ── (b) IMPLAUSIBLE COVERAGE ────────────────────────────────────────────────────────────────────────
  const W = { windowStart: '2025-12-01', windowEnd: '2025-12-10' }   // 10 days
  const ok = R.assessCoverage({ ...W, coverage: { covered: days('2025-12-01', 6), attestedEmpty: [], uncovered: days('2025-12-07', 4) }, floorDate: '2022-03-05', entryHasAnyRows: true })
  if (!ok.plausible) findings.push(`(b) a well-formed coverage answer was refused: ${ok.reason}`)

  // ⚠ HONEST NOTE ON THIS ONE: an owed set larger than its window ALWAYS also breaks the partition check,
  // so check (1) is SUBSUMED by check (2) and cannot be isolated by any input. It is kept for its clearer
  // message, not because it is independently load-bearing — and saying so is better than a red proof that
  // silently exercised a different leg.
  const tooBig = R.assessCoverage({ ...W, coverage: { covered: [], attestedEmpty: [], uncovered: days('2025-11-01', 40) }, floorDate: '2022-03-05', entryHasAnyRows: true })
  if (tooBig.plausible) findings.push(`(b) an OWED RANGE LARGER THAN THE DECLARED WINDOW was accepted — 40 owed days for a 10-day window. Arithmetically impossible: coverage is not answering the question it was asked.`)

  const notPartition = R.assessCoverage({ ...W, coverage: { covered: days('2025-12-01', 3), attestedEmpty: [], uncovered: days('2025-12-04', 3) }, floorDate: '2022-03-05', entryHasAnyRows: true })
  if (notPartition.plausible) findings.push(`(b) the three sets did NOT partition the window (3+0+3 of 10) and it was accepted. A LOST DAY IS A GAP NOTHING WOULD EVER WALK.`)

  const belowFloor = R.assessCoverage({ windowStart: '2021-01-01', windowEnd: '2021-01-10', coverage: { covered: [], attestedEmpty: [], uncovered: days('2021-01-01', 10) }, floorDate: '2022-03-05', entryHasAnyRows: true })
  if (belowFloor.plausible) findings.push(`(b) days BELOW the declared floor were accepted as owed. Publishing there spends quota to learn what the adapter already declares.`)

  // ⛔ AND THE NULL-FLOOR CASE MUST NOT BE FAKED INTO APPLYING — three of five platforms have no wall, and
  // inventing one from silence is the defect this whole arc exists to end.
  const nullFloor = R.assessCoverage({ windowStart: '1999-01-01', windowEnd: '1999-01-10', coverage: { covered: [], attestedEmpty: [], uncovered: days('1999-01-01', 10) }, floorDate: null, entryHasAnyRows: true })
  if (!nullFloor.plausible) findings.push(`(b) a NULL-FLOOR adapter's owed days were refused as "below the floor". THERE IS NO FLOOR — GA4, Shopify and WooCommerce have no vendor wall, and inventing one from silence is exactly LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1.`)

  // ⛔ THIS INPUT HAD TO BE FIXED, AND THE FIX IS THE FINDING. The first version passed all-empty sets,
  // which fails the PARTITION check (0+0+0 ≠ 10) — so leg (4) was never reached and a mutation that deleted
  // it stayed green. A guard whose cases are caught by the wrong leg is measuring the wrong thing.
  // This input PARTITIONS CORRECTLY (10 covered of 10) and is still a false all-clear: coverage says every
  // day is covered while the warehouse holds no row for this entry at any date.
  const falseAllClear = R.assessCoverage({ ...W, coverage: { covered: days('2025-12-01', 10), attestedEmpty: [], uncovered: [] }, floorDate: '2022-03-05', entryHasAnyRows: false })
  if (falseAllClear.plausible) findings.push(`(b) NOTHING OWED on an entry with NO rows anywhere and NO attestation was accepted. That is a FALSE ALL-CLEAR — it reads as complete while nothing has ever been captured — and it is the failure class this rebuild exists to end.`)

  // ── (d) BROKEN, and (f) NO-PROGRESS ─────────────────────────────────────────────────────────────────
  const base = { owedDays: 5, maxAttemptsAtMinSpan: 3, minSpanDays: 1, last: { outcome: null, attemptNo: null, daysCommitted: 0 } }
  const broken = R.decideRepublish({ ...base, spanDays: 1, attemptsAtMinSpan: 3 })
  if (broken.publish || broken.verdict !== 'broken') findings.push(`(d) an entry with 3 attempts at the 1-day MINIMUM span was still published (${JSON.stringify(broken)}). It must STOP being published and become reportable — never silently retried forever.`)
  const misSized = R.decideRepublish({ ...base, spanDays: 30, attemptsAtMinSpan: 3 })
  if (!misSized.publish) findings.push(`(d) an entry with 3 attempts at THIRTY days was treated as broken. That is MIS-SIZED — the consumer narrows — and calling it broken tells a customer their data is broken when we simply asked for too much at once.`)

  const noProgress = R.decideRepublish({ ...base, spanDays: 30, attemptsAtMinSpan: 1, last: { outcome: 'ok', attemptNo: 1, daysCommitted: 0 } })
  if (noProgress.publish || noProgress.verdict !== 'no-progress') {
    findings.push(`(f) AN ENTRY WHOSE LAST ATTEMPT REPORTED SUCCESS AND COMMITTED ZERO DAYS WAS RE-PUBLISHED (${JSON.stringify(noProgress)}). This is June's bound — BackfillControl.tsx:81-83, "if the lap did not move the cursor, break". A lap that changed nothing will change nothing next time, and the three 300-second poison loops were exactly that, re-published forever.`)
  }
  const zeroNoProgress = R.decideRepublish({ ...base, spanDays: 30, attemptsAtMinSpan: 1, last: { outcome: 'zero', attemptNo: 1, daysCommitted: 0 } })
  if (zeroNoProgress.publish) findings.push(`(f) a 'zero' outcome that left the range STILL OWED was re-published. An honest zero should have attested those days empty and removed them from the owed set; if it did not, the attestation is not taking and this loops forever.`)
  const progressed = R.decideRepublish({ ...base, spanDays: 30, attemptsAtMinSpan: 1, last: { outcome: 'ok', attemptNo: 1, daysCommitted: 12 } })
  if (!progressed.publish) findings.push(`(f) an entry whose last attempt COMMITTED 12 DAYS and still owes more was refused — the walk would never finish a fragmented window.`)
  const nothing = R.decideRepublish({ ...base, owedDays: 0, spanDays: 30, attemptsAtMinSpan: 0 })
  if (nothing.publish) findings.push(`(f) an entry with ZERO owed days was published.`)

  // ── (c) THE BOUND, BEHAVIOURALLY ────────────────────────────────────────────────────────────────────
  const many = Array.from({ length: 40 }, () => ({ ranges: 3 }))
  const sel = R.boundedSelection(many, 20)
  if (sel.requests > 20) findings.push(`(c) boundedSelection took ${sel.requests} requests against a bound of 20.`)
  // ⛔ THE PROPERTY, NOT A HAND-COMPUTED COUNT. The guard's first version asserted "7 items" and was WRONG —
  // 6 × 3 = 18 fits and a 7th would be 21. Asserting an arithmetic answer I worked out in my head is how a
  // guard ends up measuring my arithmetic instead of the code (plan §24).
  if (sel.requests + many[0].ranges <= 20) findings.push(`(c) boundedSelection stopped at ${sel.requests} requests when another ${many[0].ranges}-range item would still have fit under 20 — it is leaving budget unused.`)
  if (sel.droppedForBound !== many.length - sel.taken.length) findings.push(`(c) droppedForBound (${sel.droppedForBound}) does not account for every candidate not taken (${many.length - sel.taken.length}). A silently dropped candidate reads as "nothing was owed".`)
  const oneHuge = R.boundedSelection([{ ranges: 500 }, { ranges: 1 }], 20)
  if (oneHuge.taken.length !== 1) {
    findings.push(`(c) an item whose own range count EXCEEDS the whole budget was skipped rather than admitted alone. Skipping it forever silently starves the most fragmented entries — the ones most likely to be genuinely broken.`)
  }
  const empty = R.boundedSelection([], 20)
  if (empty.taken.length !== 0 || empty.requests !== 0) findings.push(`(c) boundedSelection invented work from an empty candidate list.`)
} catch (e) {
  findings.push(`behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
}

if (findings.length) {
  console.error(`[universe-resumer] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-resumer] PASS — publishes from DERIVED coverage over the catalog denominator, never a list or a cursor · refuses and records four classes of implausible coverage (and does NOT invent a floor where the adapter declares none) · bounded in REQUESTS with single-window messages so the driver owns the loop · a BROKEN entry stops being published while a MIS-SIZED one narrows · an entry whose owed set did not shrink after a successful attempt is NOT re-published (June's bound) · the meter gates the publish and HOLDS when unreadable · it writes no row, no day commit and neither old table · and its schedule agrees with its own header (SCHEDULED as of 2026-08-11, LORAMER_WALK_SCHEDULED_V1; the exact cron shape is pinned by universe-stream-consumer leg (e)).`)
