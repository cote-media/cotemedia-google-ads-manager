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
//   (a) THE BITE FITS THE BUDGET. bite × the measured worst request cycle ≤ CAPTURE_BUDGET_MS. If the bite
//       may ask for more time than the budget holds, the fire is relying on the loop to save it every time
//       rather than only at the margin — and a bound that is always wrong in the safe direction is not a
//       bound, it is a number someone will later "fix" upward without measuring.
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

// ⛔ THE CYCLE IS READ FROM THE BITE'S OWN DERIVATION, NOT RETYPED HERE. A guard that carries its own copy of
// the measurement is a second source of truth for the same fact, and the two drift. The header must state the
// ms figure it divided by; this reads that figure back out and redoes the division.
const cycleM = resumer.match(/WORST measured cycle\s*=\s*([0-9][0-9,_]*)\s*ms/)
const cycleMs = cycleM ? Number(cycleM[1].replace(/[,_]/g, '')) : null
if (cycleMs === null) {
  findings.push(`(a) ${RESUMER} does not state the per-request cycle its bite was divided from ("WORST measured cycle = <n> ms"). The bite is then a number with no derivation on the line, which is the class this repo refuses.`)
}
if (bite !== null && ceilingS !== null && scanMs !== null && floorMs !== null && cycleMs !== null) {
  const budgetMs = ceilingS * 1000 - scanMs - floorMs
  const wants = bite * cycleMs
  if (wants > budgetMs) {
    findings.push(`(a) THE BITE ASKS FOR MORE TIME THAN THE FIRE HAS: ${bite} requests × ${cycleMs} ms = ${wants} ms against a ${budgetMs} ms capture budget (${ceilingS}s ceiling − ${scanMs} scan − ${floorMs} reservation). Either the bite is too large for the measured pace or the pace has been re-measured and this line was not.`)
  }
  const affords = Math.floor(budgetMs / cycleMs)
  if (bite !== affords) {
    findings.push(`(a) the bite is ${bite} but the budget affords ${affords} at ${cycleMs} ms/request (${budgetMs} ÷ ${cycleMs}). The bite must BE the derivation, not sit near it — a gap here is where the next unexplained constant comes from.`)
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
  if (!/deferredUnits\s*=\s*toSend\.length - unitIdx/.test(route)) {
    findings.push('(c) the loop no longer records how many units it deferred. A fire that quietly drops work is indistinguishable from one that had none — the denominator law applied to the bite.')
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
console.log(`[fire-bite-fits-the-budget] PASS — the bite (${bite}) IS the capture budget divided by the measured worst request cycle, the admission rule refuses a unit that would not fit and reserves the floor for an unmeasured one (6 fixtures), and the loop still consults it and records what it deferred. LIMIT: this proves the arithmetic and the rule, never that a single unit finishes inside the reservation.`)
