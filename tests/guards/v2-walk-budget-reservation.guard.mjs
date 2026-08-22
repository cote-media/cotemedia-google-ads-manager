#!/usr/bin/env node
// LORAMER_V2_WALK_BUDGET_RESERVATION_V1 — THE WALK MAY NOT START A RANGE IT CANNOT FINISH INSIDE maxDuration.
//
// ⛔ THE RULE IS NOT NEW AND THAT IS THE WHOLE POINT (★V2-HAS-NO-BETWEEN-ITERATION-BUDGET-RESERVATION, sweep C1).
// `lap-budget.ts:14-17` already states it: **"A BETWEEN-ITERATION BUDGET CHECK IS ONLY SAFE IF ONE ITERATION
// CANNOT EXCEED THE REMAINING CEILING."** It is implemented at `lap-budget.ts:28-31` and applied by the drain at
// `cron/drain/route.ts:327`. The v2 consumer had `maxDuration = 300` and dispatched every owed range with no
// clock consulted anywhere in the file — so it DETECTED the resulting kill after the fact, via the BROKEN bound
// at three attempts on the minimum span, instead of not incurring it. Three kills to learn what one reservation
// prevents, and each kill still spends its request (charged at `appendAttemptStarted`, before the vendor call).
//
// ⛔ IT MUST BE THE SHIPPED FUNCTION, NOT A SECOND ONE. LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1
// and the 08-08 read-what-already-ships law both land here: a local re-implementation would drift from the
// drain's, and `lap-budget.ts:23-27` records why the reservation is a PARAMETER rather than a lowered shared
// default. Leg (c) fails a fork.
//
// ⛔ WHAT IT CANNOT DO: it cannot prove the RESERVATION IS BIG ENOUGH. `FIRST_LAP_MS` is a conservative
// unmeasured default and a range slower than the reservation still overruns. It proves the check exists, is the
// shared one, runs between iterations, and that the budget leaves real headroom under the platform ceiling.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CONSUMER = 'src/lib/backfill/universe-v2-worker.ts'
const findings = []

let raw
try { raw = readFileSync(resolve(ROOT, CONSUMER), 'utf8') } catch {
  console.error(`[v2-walk-budget-reservation] FAIL — ${CONSUMER} unreadable. A guard that cannot read its subject is not a pass.`)
  process.exit(1)
}
const src = raw.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

// ── (a) IT IMPORTS THE SHIPPED RULE ───────────────────────────────────────────────────────────────────────
if (!/import\s*\{[^}]*\bshouldStartAnotherLap\b[^}]*\}\s*from\s*['"][^'"]*lap-budget['"]/s.test(src)) {
  findings.push(
    `${CONSUMER} DOES NOT IMPORT shouldStartAnotherLap FROM lap-budget.\n` +
    `      The rule already exists (lap-budget.ts:28-31) and the drain already applies it (cron/drain/route.ts:327).\n` +
    `      Re-deriving it is the exact failure the 2026-08-08 law names, and it is what let v2 ship with no check at all.`
  )
}

// ── (b) IT IS CALLED BETWEEN ITERATIONS, BEFORE THE VENDOR CALL ───────────────────────────────────────────
const loopIdx = src.search(/for\s*\(\s*const\s+range\s+of\s+owed\.ranges/)
const callIdx = src.indexOf('shouldStartAnotherLap(')
const captureIdx = src.indexOf('captureSurfaceStreaming(')
if (loopIdx === -1) {
  findings.push(`${CONSUMER}: the owed-range loop shape changed — \`for (const range of owed.ranges\` not found. Re-point this guard rather than deleting it; an unfindable loop is an unguarded loop.`)
} else if (callIdx === -1) {
  findings.push(
    `${CONSUMER} NEVER CALLS shouldStartAnotherLap(...). The owed-range loop at that position dispatches every\n` +
    `      range with no clock consulted, under maxDuration = 300. That is the 504 class that caused the teardown.`
  )
} else {
  if (callIdx < loopIdx) {
    findings.push(`${CONSUMER}: shouldStartAnotherLap is called OUTSIDE the owed-range loop. A single check before the loop reserves nothing for the second range onward — which is precisely the shape lap-budget.ts:14-17 rules out.`)
  }
  if (captureIdx !== -1 && callIdx > captureIdx) {
    findings.push(`${CONSUMER}: the budget check appears AFTER the vendor call. A reservation consulted after the spend is a log line, not a gate.`)
  }
}

// ── (c) NO FORK ───────────────────────────────────────────────────────────────────────────────────────────
if (/function\s+shouldStartAnotherLap|const\s+shouldStartAnotherLap\s*=/.test(src)) {
  findings.push(`${CONSUMER} DEFINES ITS OWN shouldStartAnotherLap. One rule, one home — a second copy drifts from the drain's, and lap-budget.ts:23-27 already records why the reservation is a parameter instead of a lowered shared default.`)
}
if (/Date\.now\(\)\s*-\s*\w+\s*>\s*[A-Z_]*BUDGET/.test(src)) {
  findings.push(`${CONSUMER} contains a BARE ELAPSED CHECK (\`Date.now() - started > BUDGET\`). That is the pre-fix drain shape: it reserves NOTHING for the iteration it is about to begin, which is how a lap dispatched just under the line ran past maxDuration and was killed with no cursor, no log line and no stamp.`)
}

// ── (d) THE BUDGET LEAVES REAL HEADROOM UNDER THE PLATFORM CEILING ────────────────────────────────────────
// ⛔ WIDENED 2026-08-18 — LORAMER_COMPLETION_SIGNAL_V1. `maxDuration` is no longer a literal here: it now
// REFERENCES `CONSUMER_MAX_DURATION_S` in the contract, because an observer (the drive) has to read the same
// ceiling and a number restated in two files is a number that drifts. The property this guard protects is
// UNCHANGED — the reservation must be measured against the real ceiling — so the read follows the constant to
// its declaration instead of demanding a digit. A literal is still accepted; both forms resolve to one value,
// and `drive-ceiling-pin.guard.mjs` is what stops them disagreeing.
// ⛔ THE CEILING NOW LIVES ON THE DELIVERY LANE, NOT ON THE WORKER — LORAMER_POLL_MODE_CUTOVER_V1. The
// reservation and the ceiling used to sit in one file because the worker WAS the route. With delivery moved
// to a cron-driven poller the worker is a library that declares no `maxDuration`, and the ceiling it runs
// under is declared by whichever lane invokes it. THE PROPERTY IS UNCHANGED — the reservation must be
// measured against the REAL ceiling — so the read follows the ceiling to the lane instead of assuming the
// two share a file. A lane that declares no ceiling is still a finding, which is what keeps this strict.
// RE-ANCHORED BY LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 - third relocation of this ceiling. The poll
// lane is gone; the worker's ceiling is now declared by the INLINE EXECUTION HOST that invokes it
// (the scheduled fire). The property is byte-identical: the reservation is measured against the REAL
// ceiling, read from the lane that dies at it. The host's own CAPTURE budget is swept in below
// exactly as the poll lane's POLL_BUDGET_MS was - a second budget under the same kill.
const LANE = 'src/app/api/cron/universe-resume/route.ts'
let laneSrc = ''
try { laneSrc = readFileSync(resolve(ROOT, LANE), 'utf8') } catch { laneSrc = '' }
const mdRef = /export\s+const\s+maxDuration\s*=\s*CONSUMER_MAX_DURATION_S\b/.test(laneSrc)
const md = mdRef
  ? (readFileSync(resolve(ROOT, 'src/lib/backfill/universe-v2-contract.ts'), 'utf8').match(/export const CONSUMER_MAX_DURATION_S\s*=\s*(\d+)/))
  : laneSrc.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/)
// ⛔ EVERY BUDGET UNDER THAT CEILING IS CHECKED, NOT JUST THE WORKER'S. The cutover created a SECOND budget
// — the poll lane's own `POLL_BUDGET_MS`, which decides when the poller stops taking on another MESSAGE the
// way `WALK_BUDGET_MS` decides when the worker stops taking on another RANGE. Both run under the same
// platform ceiling, so both are subject to the same rule, and a guard that checked only the first would
// have let the new one sit at or above the ceiling unexamined. The strictest budget found is the one judged.
const budgets = [
  ...[...src.matchAll(/const\s+([A-Z_]*BUDGET_MS)\s*=\s*([\d_]+)/g)].map((m) => ({ name: m[1], v: Number(m[2].replace(/_/g, '')), from: CONSUMER })),
  ...[...laneSrc.matchAll(/const\s+([A-Z_]*BUDGET_MS)\s*=\s*([\d_]+)/g)].map((m) => ({ name: m[1], v: Number(m[2].replace(/_/g, '')), from: LANE })),
]
const worstBudget = budgets.length ? budgets.reduce((a, b) => (b.v > a.v ? b : a)) : null
const budget = worstBudget ? [null, String(worstBudget.v)] : null
if (!md) {
  findings.push(`${CONSUMER} declares no maxDuration — the ceiling this reservation is measured against is unknown.`)
} else if (budget) {
  const ceilingMs = Number(md[1]) * 1000
  const budgetMs = Number(budget[1].replace(/_/g, ''))
  if (budgetMs >= ceilingMs) {
    findings.push(`${CONSUMER}: BUDGET_MS ${budgetMs} is NOT below maxDuration ${md[1]}s (${ceilingMs}ms). A budget at or above the platform ceiling cannot stop anything — the ceiling kills first.`)
  } else if (ceilingMs - budgetMs < 60_000) {
    findings.push(`${CONSUMER}: only ${ceilingMs - budgetMs}ms of headroom between BUDGET_MS and maxDuration. The drain holds ~120s for the same reason — a range that starts just under budget must still be able to finish before the platform ceiling.`)
  }
} else {
  findings.push(`${CONSUMER} calls the reservation with no declared *BUDGET_MS constant, so the ceiling it reserves against cannot be read or checked.`)
}

if (findings.length) {
  console.error(`\n❌ LORAMER_V2_WALK_BUDGET_RESERVATION_V1 FAILED — ${findings.length} finding(s)\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  console.error('  ⛔ A BETWEEN-ITERATION BUDGET CHECK IS ONLY SAFE IF ONE ITERATION CANNOT EXCEED THE REMAINING')
  console.error('     CEILING. Lowering a constant does not fix this; it only moves the size of range that still overruns.\n')
  process.exit(1)
}
console.log(
  'v2-walk-budget-reservation.guard: PASS — the consumer imports the SHIPPED shouldStartAnotherLap, calls it ' +
  'between owed ranges before the vendor call, defines no fork, and its budget leaves headroom under maxDuration. ' +
  'LIMIT: it cannot prove the reservation is large enough — FIRST_LAP_MS is a conservative unmeasured default.'
)
