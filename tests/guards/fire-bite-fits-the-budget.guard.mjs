#!/usr/bin/env node
// LORAMER_FIRE_BITE_FITS_THE_BUDGET_V1 — THE BITE MAY NOT ASK FOR MORE TIME THAN THE FIRE HAS,
// AND THE LOOP MAY NEVER BE CUT OFF MID-WORK.
//
// ⛔ WHY THIS EXISTS. MAX_REQUESTS_PER_RUN used to be sized by the CONSUMER QUEUE's worst-case drain
// (40 × WALK_BUDGET_MS ÷ maxConcurrency ≤ the fire interval), and `queue-drain-fits-the-interval.guard.mjs`
// executed that identity. LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 retired the queue and that guard with it
// (run-guards.mjs:205), which left the bite with a STALE DERIVATION AND NO ENFORCER — a number whose stated
// reason had been deleted underneath it. This is the replacement enforcer, expressed against the constraint
// that actually binds now: the fire runs its units INLINE, so the bite answers to CAPTURE_BUDGET_MS.
//
// THE TWO PROPERTIES, and they are different claims:
//   (a) THE BITE FITS THE TIME THE FIRE ACTUALLY HAS. bite × the measured worst unit cycle ≤ the ceiling minus
//       the scan minus one unit reservation. If the bite may ask for more time than the fire holds, the fire is
//       relying on the loop to save it every time rather than only at the margin — and a bound that is always
//       wrong in the safe direction is not a bound, it is a number someone will later "fix" upward without
//       measuring.
//       ⛔ RE-CUT 2026-09-16 — THE SCAN IS CHARGED AT max(ALLOWANCE, WORST MEASURED), NOT AT THE ALLOWANCE.
//       CAPTURE_BUDGET_MS is defined as 300,000 − SCAN_ALLOWANCE_MS 55,000 − 10,000, and the capture clock
//       (`captureStartedAt`) starts AFTER the scan — so the contract's budget is only true while the scan fits
//       its allowance. Measured on the shipped concurrent code, the scan ran over 55 s on 16 of 19 fires, worst
//       70,982 ms. A bite derived from 235,000 would therefore authorise scan+capture of 305,982 ms against a
//       300,000 ms platform kill: the ONE thing the round called non-negotiable. Charging the larger of the two
//       makes the identity safe whichever way the allowance is later corrected.
//   (b) THE LOOP CANNOT BE CUT OFF MID-WORK. `shouldStartAnotherLap` is DRIVEN here, not read: a unit is
//       admitted only when the WORST unit observed so far still fits inside the budget, and the reservation
//       floor covers a unit that has not been measured yet. This is the property the round called
//       non-negotiable — leaving work half-done is worse than doing less.
//
// ⛔ WHAT THIS GUARD CANNOT SEE, stated so a green is not over-read: it proves the ARITHMETIC of the bound and
// the ADMISSION RULE. It cannot prove that a single unit finishes inside the reservation floor — a unit that
// blows through 10 s on its own is a vendor or database fact, not a scheduling one, and the deadline inside
// `processMessage` (DeadlineOpts) is what bounds that. Nor does it observe a real fire.
//
// HERMETIC: file reads plus a tsc compile of the two modules it drives. No network, no database.
// USAGE: node tests/guards/fire-bite-fits-the-budget.guard.mjs   EXIT 0 green · 1 findings · 2 broken instrument
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const LAP = 'src/lib/backfill/lap-budget.ts'
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const num = (src, name) => {
  const m = src.match(new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*([0-9][0-9_]*)`))
  return m ? Number(m[1].replace(/_/g, '')) : null
}

// ── (a) THE ARITHMETIC — the bite may not outrun the budget ──────────────────────────────────────────────
const resumer = read(RESUMER)
const contract = read(CONTRACT)
const bite = num(resumer, 'MAX_REQUESTS_PER_RUN')
const ceilingS = num(contract, 'CONSUMER_MAX_DURATION_S')
const scanMs = num(contract, 'SCAN_ALLOWANCE_MS')
const floorMs = num(contract, 'UNIT_RESERVATION_FLOOR_MS')
if (bite === null) findings.push(`(a) MAX_REQUESTS_PER_RUN not found in ${RESUMER} — the bound this invariant is about has moved or vanished.`)
if (ceilingS === null || scanMs === null || floorMs === null) findings.push(`(a) the timing constants could not be read from ${CONTRACT}; the budget cannot be recomputed.`)

// ⛔ THE CYCLE AND THE SCAN ARE READ FROM THE BITE'S OWN DERIVATION, NOT RETYPED HERE. A guard that carries its
// own copy of a measurement is a second source of truth for the same fact, and the two drift. The header must
// state both ms figures it divided from; this reads them back out and redoes the division.
const cycleM = resumer.match(/WORST measured cycle\s*=\s*([0-9][0-9,_]*)\s*ms/)
const cycleMs = cycleM ? Number(cycleM[1].replace(/[,_]/g, '')) : null
if (cycleMs === null) {
  findings.push(`(a) ${RESUMER} does not state the per-unit cycle its bite was divided from ("WORST measured cycle = <n> ms"). The bite is then a number with no derivation on the line, which is the class this repo refuses.`)
}
const scanMeasuredM = resumer.match(/WORST measured scan\s*=\s*([0-9][0-9,_]*)\s*ms/)
const scanMeasuredMs = scanMeasuredM ? Number(scanMeasuredM[1].replace(/[,_]/g, '')) : null
if (scanMeasuredMs === null) {
  findings.push(`(a) ${RESUMER} does not state the WORST MEASURED SCAN its bite was derived against ("WORST measured scan = <n> ms"). CAPTURE_BUDGET_MS charges the scan at SCAN_ALLOWANCE_MS and the capture clock starts after the scan, so a bite derived without a measured scan figure is derived against an assumption — and on this fleet that assumption is false on most fires.`)
}
if (bite !== null && ceilingS !== null && scanMs !== null && floorMs !== null && cycleMs !== null && scanMeasuredMs !== null) {
  const ceilingMs = ceilingS * 1000
  // The scan is charged at whichever is LARGER: what the contract allows, or what the fleet was measured doing.
  const scanCharge = Math.max(scanMs, scanMeasuredMs)
  const budgetMs = ceilingMs - scanCharge - floorMs
  const wants = bite * cycleMs
  if (wants > budgetMs) {
    findings.push(`(a) THE BITE ASKS FOR MORE TIME THAN THE FIRE HAS: ${bite} × ${cycleMs} ms = ${wants} ms against ${budgetMs} ms of real room (${ceilingMs} ceiling − ${scanCharge} scan charged at max(allowance ${scanMs}, measured ${scanMeasuredMs}) − ${floorMs} reservation). Either the bite is too large for the measured pace or the pace has been re-measured and this line was not.`)
  }
  const affords = Math.floor(budgetMs / cycleMs)
  if (bite !== affords) {
    findings.push(`(a) the bite is ${bite} but the fire's real room affords ${affords} at ${cycleMs} ms/unit (${budgetMs} ÷ ${cycleMs}). The bite must BE the derivation, not sit near it — a gap here is where the next unexplained constant comes from.`)
  }
  // ⛔ THE CEILING PROPERTY, STATED AS ITS OWN ASSERTION RATHER THAN LEFT TO FOLLOW FROM THE ONE ABOVE. This is
  // the claim the round called non-negotiable: a fire must never be killed mid-work. The platform kills at the
  // ceiling, and scan + capture + one unmeasured unit is the whole of a fire.
  const worstFire = scanCharge + wants + floorMs
  if (worstFire > ceilingMs) {
    findings.push(`(a) A FIRE AT THIS BITE CAN BE KILLED MID-WORK: worst scan ${scanCharge} + bite work ${wants} + reservation ${floorMs} = ${worstFire} ms against a ${ceilingMs} ms platform kill. The loop's admission rule cannot save it, because the admission budget is measured from the END of the scan and therefore cannot see the scan's overshoot.`)
  }
}

// ── (b) THE ADMISSION RULE, DRIVEN — a unit is never admitted without room for the worst one seen ────────
{
  let out = null
  try {
    out = mkdtempSync(join(tmpdir(), 'loramer-bite-'))
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
      resolve(ROOT, LAP), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
      '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
    ], { encoding: 'utf8' })
    const js = join(out, 'src/lib/backfill/lap-budget.js')
    if (!existsSync(js)) throw new Error(`tsc produced no output (${(r.stdout || '').slice(0, 300)})`)
    const { shouldStartAnotherLap } = createRequire(import.meta.url)(js)
    const BUDGET = 235_000, FLOOR = 10_000
    const cases = [
      // [name, elapsed, worstUnitSoFar, expected]
      ['the first unit is always admitted (nothing elapsed, nothing measured)', 0, 0, true],
      ['a unit is admitted while the worst one seen still fits', 200_000, 20_000, true],
      ['a unit is REFUSED when the worst one seen would cross the budget', 220_000, 20_000, false],
      ['an unmeasured unit reserves the FLOOR, not zero', BUDGET - FLOOR + 1, 0, false],
      ['exactly at the boundary is admitted (<=, not <)', BUDGET - FLOOR, 0, true],
      ['a slow unit shrinks the admission window for every later one', 100_000, 140_000, false],
    ]
    for (const [name, elapsed, worst, expected] of cases) {
      const got = shouldStartAnotherLap(elapsed, worst, BUDGET, FLOOR)
      if (got !== expected) findings.push(`(b) admission fixture "${name}" returned ${got}, expected ${expected} — the rule that stops a fire being cut off mid-work does not behave.`)
    }
  } catch (e) {
    findings.push(`(b) could not drive the admission rule (${e.message}); the mid-work property is unproven on this machine.`)
  } finally {
    if (out) rmSync(out, { recursive: true, force: true })
  }
}

// ── (c) THE LOOP STILL CONSULTS THE RULE, AND STILL RECORDS WHAT IT DEFERRED ─────────────────────────────
{
  const route = read('src/app/api/cron/universe-resume/route.ts')
  if (!/shouldStartAnotherLap\(\s*Date\.now\(\) - captureStartedAt,\s*maxUnitMs,\s*CAPTURE_BUDGET_MS,\s*UNIT_RESERVATION_FLOOR_MS\s*\)/.test(route)) {
    findings.push('(c) the execution loop no longer admits units through shouldStartAnotherLap against the capture budget. Raising the bite is only safe BECAUSE that gate exists; without it the bite becomes an unbounded promise.')
  }
  // ⛔ RE-CUT 2026-09-15 — LORAMER_FIRE_UNITS_CONCURRENT_V1. The loop is now per-surface queues run
  // concurrently, so "what did this fire not reach" is a SUM across queues rather than one subtraction from a
  // single index. The property is unchanged and is the same denominator law: a fire that quietly drops work is
  // indistinguishable from one that had none.
  if (!/deferredUnits\s*\+=\s*queue\.length - qi/.test(route)) {
    findings.push('(c) the loop no longer accumulates deferredUnits per surface queue. With concurrent queues a single subtraction cannot express what was not reached, and an unrecorded drop is a silent one.')
  }
  if (!/deadlineAt:\s*captureStartedAt \+ CAPTURE_BUDGET_MS/.test(route)) {
    findings.push('(c) the per-unit deadline is no longer derived from the same capture budget. Two clocks for one fire is how a unit outlives the loop that admitted it.')
  }
}

if (findings.length) {
  for (const f of findings) console.error(`✗ ${f}`)
  console.error(`[fire-bite-fits-the-budget] FAIL — ${findings.length} finding(s).`)
  process.exit(1)
}
console.log(`[fire-bite-fits-the-budget] PASS — the bite (${bite}) IS the fire's real room divided by the measured worst unit cycle (${cycleMs} ms), the scan is charged at max(allowance ${scanMs}, measured ${scanMeasuredMs}) so scan + bite work + reservation cannot reach the ${ceilingS}s kill, the admission rule refuses a unit that would not fit and reserves the floor for an unmeasured one (6 fixtures), and the loop still consults it and records what it deferred. LIMIT: this proves the arithmetic and the rule, never that a single unit finishes inside the reservation.`)
