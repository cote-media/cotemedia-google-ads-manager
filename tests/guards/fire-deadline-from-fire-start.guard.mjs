#!/usr/bin/env node
// LORAMER_FIRE_DEADLINE_FROM_FIRE_START_V1 — THE FIRE'S CLOCK STARTS WHEN THE FIRE STARTS.
//
// ⛔ THE DEFECT THIS EXISTS TO MAKE UNREPEATABLE. The fire's admission deadline used to be
// `captureStartedAt + CAPTURE_BUDGET_MS`, and `captureStartedAt` is taken AFTER the selection scan. So the
// deadline FLOATED: every millisecond the scan ran over its allowance was a millisecond added to the fire's
// total that the admission rule could not see. A fire that actually spent its budget ran `scan + 235,000`
// against a 300,000 ms platform kill and would have been terminated MID-WORK.
//
// ⛔ AND THE OBVIOUS FIX WAS WORSE THAN IT LOOKED. Raising SCAN_ALLOWANCE_MS to the worst measured scan is a
// constant that must be re-cut every time the scan changes shape. MEASURED 2026-09-16 on the shipped code
// (n=157 wet fires, scan derived per fire as first universe_attempt_log.recorded_at minus fire start):
// min 22,963 · p50 65,380 · p90 83,848 · p99 133,891 · MAX 139,911 ms. 132 of 157 exceeded the live 55,000
// allowance and 45 of 157 exceeded the 71,000 that was proposed to replace it — a constant derived from a
// 19-fire sample was already wrong for 29% of fires one day later. An absolute deadline needs no such number.
//
// ⛔ WHAT THIS GUARD CHECKS, AND IT IS BEHAVIOURAL WHERE IT MATTERS RATHER THAN TEXTUAL EVERYWHERE:
//   (a) the contract exports fireDeadlineAt + FIRE_WORK_BUDGET_MS and no longer exports a scan allowance
//       or a capture budget — ONE SOURCE OF TRUTH means the superseded names cannot come back by import
//   (b) the identity FIRE_WORK_BUDGET_MS + UNIT_RESERVATION_FLOOR_MS = CONSUMER_MAX_DURATION_S × 1000
//   (c) BEHAVIOURAL, the whole point: for scan durations from 0 to well past anything ever measured, a unit
//       admitted by the rule still finishes before the platform kill. This is run against the REAL exported
//       function and the REAL admission predicate, not a restatement of them.
//   (d) the route derives its deadline from the FIRE clock (`fireDeadlineAt(startedAt)`) and its lap check
//       from the FIRE clock — never from `captureStartedAt`, which survives for reporting only
//   (e) no OTHER module reintroduces a second clock by computing a deadline from a post-scan timestamp
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}

const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const LAP = 'src/lib/backfill/lap-budget.ts'

const contract = read(CONTRACT)
const route = read(ROUTE)

// ── (a) ONE SOURCE OF TRUTH: the superseded constants are GONE, the new ones are exported ────────────
if (!/export const FIRE_WORK_BUDGET_MS\b/.test(contract)) {
  findings.push(`(a) ${CONTRACT} does not export FIRE_WORK_BUDGET_MS. The fire's budget must be ONE named number in the contract.`)
}
if (!/export function fireDeadlineAt\(/.test(contract)) {
  findings.push(`(a) ${CONTRACT} does not export fireDeadlineAt(). The deadline must be computed in ONE place that takes the fire's start as a NAMED argument — the only way to get this wrong is to add the budget to the wrong clock.`)
}
for (const dead of ['SCAN_ALLOWANCE_MS', 'CAPTURE_BUDGET_MS']) {
  if (new RegExp(`export const ${dead}\\b`).test(contract)) {
    findings.push(`(a) ${CONTRACT} still exports ${dead}. A per-phase allowance beside an absolute deadline is TWO sources of truth for the same ceiling, and the phase constant is the one that goes stale — it was wrong for 29% of fires within a day of being measured.`)
  }
}

// ── (b) THE IDENTITY ─────────────────────────────────────────────────────────────────────────────────
const num = (src, name) => {
  const m = new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)`).exec(src)
  return m ? Number(m[1].replace(/_/g, '')) : null
}
const ceilingS = num(contract, 'CONSUMER_MAX_DURATION_S')
const floorMs = num(contract, 'UNIT_RESERVATION_FLOOR_MS')
const budgetForm = /export const FIRE_WORK_BUDGET_MS = \(CONSUMER_MAX_DURATION_S \* 1000\) - UNIT_RESERVATION_FLOOR_MS/.test(contract)
if (!budgetForm) {
  findings.push(`(b) ${CONTRACT}: FIRE_WORK_BUDGET_MS is not derived as (CONSUMER_MAX_DURATION_S * 1000) - UNIT_RESERVATION_FLOOR_MS. A literal here is a number that stops following the ceiling the day the ceiling moves.`)
}
if (ceilingS === null || floorMs === null) {
  findings.push(`(b) ${CONTRACT}: could not read CONSUMER_MAX_DURATION_S / UNIT_RESERVATION_FLOOR_MS — unknown never defaults to fine.`)
}

// ── (c) BEHAVIOURAL: NO SCAN DURATION CAN PUSH ADMITTED WORK PAST THE KILL ───────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-fire-deadline-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, CONTRACT), resolve(ROOT, LAP), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = new Proxy({}, { get: () => (() => {}) })`)
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  const C = req(join(out, 'src/lib/backfill/universe-v2-contract.js'))
  const L = req(join(out, 'src/lib/backfill/lap-budget.js'))

  const KILL = C.CONSUMER_MAX_DURATION_S * 1000
  const FLOOR = C.UNIT_RESERVATION_FLOOR_MS

  // ⛔ THE SCAN DURATIONS. The first four are measured; the last three are deliberately PAST anything ever
  // observed, because "a scan longer than anything measured so far" is exactly the case the old allowance
  // could not survive and the case this property must hold for.
  const SCANS = [0, 22_963, 65_380, 139_911, 200_000, 280_000, 400_000]
  // ⛔ THE UNIT COSTS. maxUnitMs is measured LIVE per fire; before anything is measured the rule reserves
  // the floor. The worst legitimately observed unit and a deliberately pathological one both appear.
  const UNITS = [0, 608, 2_221, 9_999, FLOOR, 25_000]

  for (const scanMs of SCANS) {
    const fireStart = 1_000_000               // arbitrary epoch origin; only differences matter
    const deadlineAt = C.fireDeadlineAt(fireStart)
    for (const maxUnitMs of UNITS) {
      // The LATEST moment the loop could still be admitting: walk the clock to the last instant the
      // predicate says yes, then let one worst-case unit run from there.
      let lastAdmitAt = null
      for (let t = Math.max(scanMs, 0); t <= KILL + 200_000; t += 250) {
        if (L.shouldStartAnotherLap(t, maxUnitMs, C.FIRE_WORK_BUDGET_MS, FLOOR)) lastAdmitAt = t
      }
      if (lastAdmitAt === null) continue // nothing admitted at all — safe by construction
      const unitEndsAt = lastAdmitAt + Math.max(maxUnitMs, FLOOR)
      if (unitEndsAt > KILL) {
        findings.push(`(c) scan ${scanMs}ms + worst unit ${maxUnitMs}ms: the LAST unit the admission rule allows starts at ${lastAdmitAt}ms and ends at ${unitEndsAt}ms, past the ${KILL}ms platform kill. A fire would be terminated MID-WORK — the outcome refuse-and-record exists to prevent.`)
      }
      // And the worker's own range admission, which reserves against the same absolute deadline.
      const lastRangeStart = deadlineAt - fireStart - Math.max(maxUnitMs, FLOOR)
      if (lastRangeStart + Math.max(maxUnitMs, FLOOR) > KILL) {
        findings.push(`(c) scan ${scanMs}ms: a range admitted at the worker's boundary (deadlineAt − max(range, floor)) ends past the ${KILL}ms kill.`)
      }
    }
  }

  // ⛔ THE COUNTERFACTUAL, AND IT IS THE REASON THIS LEG IS EVIDENCE RATHER THAN CEREMONY. A property that
  // holds for the shipped code proves nothing unless the same arithmetic would CATCH the code we replaced.
  // So the superseded model is reconstructed here and asserted UNSAFE: a per-phase budget
  // (KILL − scanAllowance − floor) measured from a clock that starts AFTER the scan. If this ever stops
  // being detected as unsafe, the leg above has gone blind and every PASS it prints is worthless.
  {
    const SUPERSEDED_SCAN_ALLOWANCE = 55_000
    const supersededBudget = KILL - SUPERSEDED_SCAN_ALLOWANCE - FLOOR // the old CAPTURE_BUDGET_MS, 235,000
    let caught = 0
    for (const scanMs of [65_380, 83_848, 133_891, 139_911]) {
      let lastAdmitAt = null
      // the old clock: elapsed measured from CAPTURE start, so absolute time is scanMs + t
      for (let t = 0; t <= KILL + 200_000; t += 250) {
        if (L.shouldStartAnotherLap(t, 608, supersededBudget, FLOOR)) lastAdmitAt = scanMs + t
      }
      if (lastAdmitAt !== null && lastAdmitAt + FLOOR > KILL) caught++
    }
    if (caught === 0) {
      findings.push(`(c) THE COUNTERFACTUAL WENT UNDETECTED. The superseded form (budget ${supersededBudget}ms on a post-scan clock) was not flagged as running past the ${KILL}ms kill at ANY measured scan, so this leg cannot tell the fixed code from the broken code and its PASS means nothing.`)
    }
  }

  // ⛔ THE PROPERTY THAT SEPARATES THE TWO POSITIONS, ASSERTED DIRECTLY: the deadline does NOT move when
  // the scan does. Under the superseded form it moved by exactly the scan's duration.
  const dA = C.fireDeadlineAt(1_000_000)
  const dB = C.fireDeadlineAt(1_000_000)
  if (dA !== dB) findings.push(`(c) fireDeadlineAt is not a pure function of the fire's start.`)
  if (dA - 1_000_000 !== KILL - FLOOR) {
    findings.push(`(c) fireDeadlineAt(start) − start is ${dA - 1_000_000}ms; it must be the kill (${KILL}) minus the reservation floor (${FLOOR}) = ${KILL - FLOOR}, so the post-loop writes always fit.`)
  }
  // A scan that alone exhausts the budget must admit NOTHING rather than admit one more unit.
  if (L.shouldStartAnotherLap(KILL - FLOOR + 1, 0, C.FIRE_WORK_BUDGET_MS, FLOOR)) {
    findings.push(`(c) a fire already past its whole budget still admitted a unit. The overrun case must refuse-and-record, not proceed.`)
  }
} catch (e) {
  findings.push(`(c) the behavioural leg could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
}

// ── (d) THE ROUTE USES THE FIRE CLOCK, NOT THE CAPTURE CLOCK ─────────────────────────────────────────
if (!/deadlineAt: fireDeadlineAt\(startedAt\)/.test(route)) {
  findings.push(`(d) ${ROUTE} does not set its unit deadline to fireDeadlineAt(startedAt). The deadline must ride the FIRE's clock; anything later than startedAt hides the phase before it.`)
}
if (!/shouldStartAnotherLap\(\s*Date\.now\(\) - startedAt,\s*maxUnitMs,\s*FIRE_WORK_BUDGET_MS,\s*UNIT_RESERVATION_FLOOR_MS\s*\)/.test(route)) {
  findings.push(`(d) ${ROUTE}'s between-unit admission does not measure elapsed from startedAt against FIRE_WORK_BUDGET_MS. Two clocks in one fire is the defect, whichever one the deadline uses.`)
}
// `captureStartedAt` may exist for REPORTING. It may NOT feed admission.
const admissionUsesCaptureClock =
  /deadlineAt:[^\n]*captureStartedAt/.test(route) ||
  /shouldStartAnotherLap\([^)]*captureStartedAt/.test(route)
if (admissionUsesCaptureClock) {
  findings.push(`(d) ${ROUTE} feeds captureStartedAt into an ADMISSION decision. That timestamp is taken after the scan and is the exact blindness this guard exists to prevent; it survives for reporting only.`)
}

// ── (e) NO SECOND CLOCK ANYWHERE ELSE ────────────────────────────────────────────────────────────────
for (const f of [ROUTE, 'src/lib/backfill/universe-v2-worker.ts', 'src/lib/backfill/universe-resumer.ts']) {
  const src = read(f); if (!src) continue
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  if (/(SCAN_ALLOWANCE_MS|CAPTURE_BUDGET_MS)/.test(code)) {
    findings.push(`(e) ${f} names a superseded budget constant in CODE. The fire has one budget and it is FIRE_WORK_BUDGET_MS.`)
  }
}

if (findings.length) {
  console.error(`[fire-deadline-from-fire-start] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[fire-deadline-from-fire-start] PASS — the deadline is computed once from the FIRE's start · the identity holds · no scan duration from 0 to 400,000 ms lets an admitted unit finish past the ${'' + (num(contract, 'CONSUMER_MAX_DURATION_S') * 1000)}ms kill · the route admits on the fire clock and never on the capture clock · no superseded budget constant survives in code.`)
