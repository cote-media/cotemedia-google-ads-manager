#!/usr/bin/env node
// LORAMER_FIRE_LOG_WITNESSES_OPENED_V1 — THE FIRE ROW'S requests_selected CARRIES THE REQUESTS THE WORKER ACTUALLY OPENED.
//
// THE DEFECT (QUEUE ★FIRE-LOG-WITNESSES-DEFERRED, found live 2026-09-14 by the pinned fleet meter): the completion
// heartbeat wrote `requestsSelected: sel.requests + lookbackRequestsToSend + selMissed.requests` — the PLANNER's number.
// Three things make a fire open fewer attempts than it selected, and none of them reached the row: (A) the fire-level
// deadline (route: `deferredUnits = toSend.length - unitIdx; break` before the unit is pushed), (B) the in-unit range
// deadline (worker: `deferredForBudget = owed.ranges.length - indexOf(range); break`, durable only as a 'skipped' row's
// text), (C) execute-time re-derivation (the unit re-computes owed ranges when it runs and may open 0 — the covered
// skip — or a different count). Fire 7847 (Veterinary mastermind, 17:19:58Z, 258 s): selected 47, opened 46 → the meter
// read a true DRIFT +1 on three consecutive pinned reads. The witness measured intent; the meter measures action.
// THE FIX: count where the work happens. processMessage returns { requestsOpened } (one per appendAttemptStarted(…, 1, …),
// a continuation's child summed into its parent), the route sums it across every executed unit, and the heartbeat's
// requestsSelected carries THAT. Selection stays a separate JSON fact (bound.requestsSelected). No column, no migration.
//
//  (α) STATIC — the completion heartbeat's requestsSelected is the summed worker return (`requestsOpened`), never
//      sel.requests / lookbackRequestsToSend / selMissed.requests; the execute loop sums `.requestsOpened`.
//  (β) DRIVEN on the REAL compiled worker (universe-v2-worker.ts) through a scripted module map: requestsOpened equals
//      the number of appendAttemptStarted(…, 1, …) calls — 3-range unit → 3 · in-unit BUDGET STOP after range 1 → 1 ·
//      covered-skip (0 owed) → 0 · mis-size continuation → parent 0 + children 1 + 1 = 2.
//  (γ) THE ARITHMETIC — decideFleetMeterVisibility on fire 7847's numbers: opened 46 vs meter 46 → VISIBLE; the old
//      expression's 47 vs 46 → DRIFT.
//  (δ) registered in scripts/run-guards.mjs.
// Seen RED first against 257271e: (α) sel.requests in the heartbeat · (β) processMessage returned undefined on all four shapes.
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'
const CHECK = 'scripts/check-fleet-meter-visibility.mjs'
const RUNNER = 'scripts/run-guards.mjs'
const SELF = 'tests/guards/fire-log-witnesses-opened.guard.mjs'

// ── (α) STATIC ────────────────────────────────────────────────────────────────────────────────────────────
{
  const src = strip(read(ROUTE))
  const hb = src.match(/fireHeartbeat\(\{\s*fireOutcome:\s*'completed'[\s\S]*?\n\s*\}\)/)
  if (!hb) findings.push(`(α) ${ROUTE}: no fireHeartbeat({ fireOutcome: 'completed' … }) call found`)
  else {
    const call = hb[0]
    if (/requestsSelected:\s*sel\.requests/.test(call) || /lookbackRequestsToSend|selMissed\.requests/.test(call.match(/requestsSelected:[^\n]*/)?.[0] ?? '')) findings.push(`(α) ${ROUTE}: the completion heartbeat's requestsSelected is still the PLANNER's sum (sel.requests / lookbackRequestsToSend / selMissed.requests) — a deferred or re-derived unit is counted as sent and the meter reads drift by exactly the deferrals`)
    if (!/requestsSelected:\s*requestsOpened\b/.test(call)) findings.push(`(α) ${ROUTE}: the completion heartbeat's requestsSelected is not \`requestsOpened\` (the summed worker return)`)
  }
  if (!/requestsOpened\s*\+=\s*[\s\S]{0,80}processMessage\(/.test(src) && !/const\s+\w+\s*=\s*await processMessage\([\s\S]{0,200}?requestsOpened\s*\+=/.test(src)) findings.push(`(α) ${ROUTE}: the execute loop does not sum processMessage's requestsOpened`)
}
// ── (δ) REGISTERED ─────────────────────────────────────────────────────────────────────────────────────────
if (!read(RUNNER).includes(SELF)) findings.push(`(δ) ${RUNNER} does not register ${SELF}`)

// ── (β) DRIVEN — the real compiled worker, every '@/lib/…' import scripted ──────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-opened-'))
const origResolve = Module._resolveFilename
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [resolve(ROOT, WORKER),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`(β) tsc did not run: ${r.error.message}`)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `
const W = () => globalThis.__W
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
module.exports = {
  // google-ads-universe-writer
  recordAccountWall: async () => {}, discoverAccountInception: async () => null,
  readWalkStopAccountFacts: async () => ({ inceptionDate: '2020-01-01', earliestHeldDate: null }),
  resolveWalkStop: async () => ({ stopDate: '2020-01-01', basis: 'fixture inception', inceptionKnown: true, surfaceWall: null }),
  // universe-stream-capture
  captureSurfaceStreaming: async () => ({ rowsWritten: 1, apiRows: 1, daysCommitted: [], orderViolation: false, error: null, skipped: null, nonGrainOnly: false }),
  serializeVendorError: (e) => String(e && e.message || e),
  // google-ads.adapter
  googleAdsCaptureAdapter: () => ({ platform: 'google', sizing: { minDays: 1, maxDays: 30, coldStartDays: 7, rowBudget: 300000 }, retention: { floorDate: null }, meter: { cap: 8009, costOf: () => 1, spentSoFar: async () => 0 } }),
  surfaceOfEntry: (e) => ({ resource: e.resource, segment: e.segment ?? '', entityLevel: e.resource, breakdownType: e.segment ?? '' }),
  isRetentionWallRefusal: () => false,
  // capture-adapter
  mayFetch: async () => ({ ok: true, reason: 'fixture' }),
  // universe-coverage — owed ranges per window span, scripted by the fixture
  rangesStillOwed: async (k, start, end) => { const rs = W().owedFor(start, end); return { ranges: rs, coverage: { covered: [], attestedEmpty: [], uncovered: rs.map((x) => x.start), probes: 0, ms: 0 } } },
  // universe-attempt-log — THE COUNTER: one opened request per appendAttemptStarted(…, 1, …)
  appendAttemptStarted: async (key, requests) => { W().starts.push({ key, requests }); if (requests === 1) W().opened += 1; return { attemptNo: 1 } },
  appendDayCommitted: async () => {}, appendAttemptFinished: async () => {}, appendMessageFinished: async () => {},
  readAttemptsAtSpan: async (key) => W().attemptsAt(key), readAttemptLaneSpendToday: async () => 0,
  // universe-sizing
  sizeNextWindow: async () => ({ days: 7, basis: 'fixture', sizedOnRowsPerDay: null, estimateRowsPerDay: null, reason: 'fixture' }), dayDiff,
  // universe-resumer — the pure split, re-stated for a 30-day window (halves at 15)
  planMisSizedSplit: ({ windowStart, windowEnd, minDays }) => { const span = dayDiff(windowStart, windowEnd) + 1; const half = Math.max(minDays, Math.floor(span / 2)); const lowerEnd = addDays(windowStart, half - 1); return { halfDays: half, lower: { start: windowStart, end: lowerEnd }, upper: lowerEnd < windowEnd ? { start: addDays(lowerEnd, 1), end: windowEnd } : null } },
  // universe-window-log
  checkDiskFloor: async () => ({ ok: true, freeBytes: 1e12, reason: 'fixture' }),
  // universe-vendor-stream
  googleAdsStreamFor: async () => (async function* () {}),
  // retention-wall (LORAMER_RETENTION_WALL_CANARY_V1) — the fixture walks above the wall; the canary reads served
  wallLineFor: () => '2023-08-18', readRetentionCanary: async () => ({ state: 'served', at: null, ageMs: 0, detail: 'fixture' }),
  classifyEmptyAnswer: ({ rangeEnd, wallLine, canary }) => (rangeEnd < wallLine && canary !== 'served' ? 'unresolved' : 'zero'), UNRESOLVED_PAST_WALL_MARKER: 'UNRESOLVED_PAST_WALL',
  // universe-idle-skip (LORAMER_IDLE_SKIP_V1) — no memo is passed by these fixtures, so the skip never runs
  ACCOUNT_ACTIVITY_RESOURCE: '__account_activity', IDLE_ATTESTED_MARKER: 'IDLE_ATTESTED_BY_ACCOUNT',
  // universe-v2-contract
  VENDOR: 'google', MAX_ATTEMPTS_AT_MIN_SPAN: 3, NARROW_AFTER_ATTEMPTS: 2, EMPTY_STRETCH_REPORT_AFTER: 400, CONSUMER_MAX_DURATION_S: 300, UNIT_RESERVATION_FLOOR_MS: 0,
  // google-quota-store / universe-quota-hold
  readGoogleQuotaPause: async () => ({ paused: false, state: 'not_blocked', until: null, since: null, reason: '' }), holdGoogleWork: () => false, recordQuotaHold: async () => {},
  // walk-quota-store (LORAMER_WALK_QUOTA_SCOPE_V1) — no lane hold in these fixtures
  readWalkLaneHold: async () => ({ held: false, state: 'clear', until: null, reason: null }), holdWalkLane: () => false,
  // lap-budget — scripted answers, then true
  shouldStartAnotherLap: () => { const a = W().lapAnswers; return a.length ? a.shift() : true },
}
`)
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith('@/')) return stub
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  const worker = req(join(out, 'src/lib/backfill/universe-v2-worker.js'))
  if (typeof worker.processMessage !== 'function') findings.push(`(β) ${WORKER} does not export processMessage`)
  else {
    const console_ = { log: console.log, warn: console.warn, error: console.error }
    console.log = console.warn = console.error = () => {} // the worker narrates every step; the fixtures judge the return
    const msg = (start, end) => ({ clientId: 'c1', userEmail: 'u@x', customerId: '123', entry: { resource: 'campaign', segment: '' }, startDate: start, endDate: end, lane: 'descend', windowsRemaining: 1 })
    const fresh = (over) => { globalThis.__W = { opened: 0, starts: [], lapAnswers: [], attemptsAt: () => 0, owedFor: () => [], ...over } }
    const one = (s, e) => [{ start: s, end: e }]
    try {
      // b1 — a 3-range unit opens 3
      fresh({ owedFor: () => [{ start: '2026-08-01', end: '2026-08-03' }, { start: '2026-08-05', end: '2026-08-06' }, { start: '2026-08-09', end: '2026-08-09' }] })
      const r1 = await worker.processMessage(msg('2026-08-01', '2026-08-10'), {})
      if (!r1 || r1.requestsOpened !== 3 || globalThis.__W.opened !== 3) findings.push(`(β1) a 3-range unit returned ${JSON.stringify(r1)} with ${globalThis.__W.opened} attempt(s) opened — expected requestsOpened 3`)
      // b2 — in-unit BUDGET STOP after range 1 opens 1 (the deferred two are neither opened nor counted)
      fresh({ owedFor: () => [{ start: '2026-08-01', end: '2026-08-03' }, { start: '2026-08-05', end: '2026-08-06' }, { start: '2026-08-09', end: '2026-08-09' }], lapAnswers: [true, false] })
      const r2 = await worker.processMessage(msg('2026-08-01', '2026-08-10'), {})
      if (!r2 || r2.requestsOpened !== 1 || globalThis.__W.opened !== 1) findings.push(`(β2) an in-unit budget stop after range 1 returned ${JSON.stringify(r2)} with ${globalThis.__W.opened} opened — expected requestsOpened 1 (deferred ranges are not opened and must not be counted)`)
      // b3 — nothing owed on delivery: the covered skip opens 0 (appendAttemptStarted with requests 0)
      fresh({ owedFor: () => [] })
      const r3 = await worker.processMessage(msg('2026-08-01', '2026-08-10'), {})
      const zeroStart = globalThis.__W.starts.length === 1 && globalThis.__W.starts[0].requests === 0
      if (!r3 || r3.requestsOpened !== 0 || !zeroStart) findings.push(`(β3) a covered-skip unit returned ${JSON.stringify(r3)} (starts ${JSON.stringify(globalThis.__W.starts.map((s) => s.requests))}) — expected requestsOpened 0 with one 0-request start`)
      // b4 — a mis-sized 30-day unit (attempts at span ≥ NARROW_AFTER_ATTEMPTS) opens nothing itself and runs two children, 1 range each
      fresh({ owedFor: (s, e) => one(s, e), attemptsAt: (key) => (dayDiff30(key) ? 2 : 0) })
      function dayDiff30(key) { return Math.round((Date.parse(key.windowEnd + 'T00:00:00Z') - Date.parse(key.windowStart + 'T00:00:00Z')) / 86400000) + 1 >= 30 }
      const r4 = await worker.processMessage(msg('2026-08-01', '2026-08-30'), {})
      if (!r4 || r4.requestsOpened !== 2 || globalThis.__W.opened !== 2) findings.push(`(β4) a mis-size continuation returned ${JSON.stringify(r4)} with ${globalThis.__W.opened} opened — expected requestsOpened 2 (upper half 1 + lower half 1, summed into the parent)`)
    } finally { Object.assign(console, console_) }
  }
} catch (e) {
  findings.push(`(β) could not DRIVE processMessage — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
  delete globalThis.__W
}

// ── (γ) THE ARITHMETIC ON FIRE 7847 ───────────────────────────────────────────────────────────────────────
try {
  const mod = existsSync(resolve(ROOT, CHECK)) ? await import(pathToFileURL(resolve(ROOT, CHECK)).href) : null
  const d = mod?.decideFleetMeterVisibility
  if (typeof d !== 'function') findings.push(`(γ) ${CHECK} does not export decideFleetMeterVisibility`)
  else {
    const opened = d({ selected: 46, meterBackfill: 46, attemptStarted: 46, windowLog: 0, fires: 1, ceiling: 50 })
    const planned = d({ selected: 47, meterBackfill: 46, attemptStarted: 46, windowLog: 0, fires: 1, ceiling: 50 })
    if (opened.state !== 'VISIBLE') findings.push(`(γ) fire 7847 witnessed as OPENED (46 vs meter 46) reads ${opened.state} — expected VISIBLE`)
    if (planned.state !== 'DRIFT') findings.push(`(γ) fire 7847 witnessed as PLANNED (47 vs meter 46) reads ${planned.state} — expected DRIFT (the pinned meter must still see a real divergence)`)
  }
} catch (e) { findings.push(`(γ) could not drive the meter core — ${e.message}`) }

if (findings.length) {
  console.error(`[fire-log-witnesses-opened] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[fire-log-witnesses-opened] PASS — the completion heartbeat witnesses requests OPENED (the summed worker return, never the planner\'s sum); DRIVEN on the real compiled worker: 3-range unit → 3 · in-unit budget stop → 1 · covered skip → 0 · mis-size continuation → 2; fire 7847 reads VISIBLE at 46/46 and DRIFT at 47/46; registered.')
