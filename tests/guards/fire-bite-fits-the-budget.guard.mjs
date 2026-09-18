#!/usr/bin/env node
// LORAMER_FIRE_BITE_FITS_THE_BUDGET_V1 — THE BITE MAY NOT ASK FOR MORE TIME THAN THE FIRE HAS,
// AND THE LOOP MAY NEVER BE CUT OFF MID-WORK.
//
// ⛔ WHY THIS EXISTS. MAX_REQUESTS_PER_RUN used to be sized by the CONSUMER QUEUE's worst-case drain
// (40 × WALK_BUDGET_MS ÷ maxConcurrency ≤ the fire interval), and `queue-drain-fits-the-interval.guard.mjs`
// executed that identity. LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 retired the queue and that guard with it
// (run-guards.mjs:205), which left the bite with a STALE DERIVATION AND NO ENFORCER — a number whose stated
// reason had been deleted underneath it. This is the replacement enforcer, expressed against the constraint
// that actually binds now: the fire runs its units INLINE, so the bite answers to the fire's own clock.
//
// THE TWO PROPERTIES, and they are different claims:
//   (a) THE BITE FITS THE TIME THE FIRE ACTUALLY HAS. bite × the measured worst unit cycle <= FIRE_WORK_BUDGET_MS.
//       If the bite may ask for more time than the fire holds, the fire is relying on the loop to save it every
//       time rather than only at the margin — and a bound that is always wrong in the safe direction is not a
//       bound, it is a number someone will later "fix" upward without measuring.
//       ⛔ RE-CUT 2026-09-16 — LORAMER_FIRE_DEADLINE_FROM_FIRE_START_V1 REMOVED THE SCAN FROM THIS ARITHMETIC.
//       The 2026-09-16 (earlier) version of this leg charged the scan at max(SCAN_ALLOWANCE_MS, worst measured)
//       because the admission clock started AFTER the scan and could not see a scan overrun. The clock now starts
//       when the FIRE starts, so a long scan simply leaves less capture time, automatically, at any duration.
//       ⛔ AND THE CONSTANT THAT LEG DEMANDED WAS ALREADY STALE WHEN IT WAS WRITTEN: 70,982 ms from n=19 fires was
//       exceeded by 45 of the next 157 on the same shipped code (worst 139,911 ms). This leg now REFUSES a scan
//       figure in the derivation rather than requiring one.
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
const floorMs = num(contract, 'UNIT_RESERVATION_FLOOR_MS')
// ⛔ THE BUDGET IS READ BY ITS DERIVATION, NOT ITS LITERAL — FIRE_WORK_BUDGET_MS is declared as an expression,
// so `num()` cannot read it and a fallback that recomputes the SAME derivation is the honest reader here.
const budgetMs = (ceilingS === null || floorMs === null) ? null : (ceilingS * 1000) - floorMs
if (bite === null) findings.push(`(a) MAX_REQUESTS_PER_RUN not found in ${RESUMER} — the bound this invariant is about has moved or vanished.`)
if (ceilingS === null || floorMs === null) findings.push(`(a) the timing constants could not be read from ${CONTRACT}; the budget cannot be recomputed.`)

// ⛔ THE CYCLE IS READ FROM THE BITE'S OWN DERIVATION, NOT RETYPED HERE. A guard that carries its own copy of a
// measurement is a second source of truth for the same fact, and the two drift.
const cycleM = resumer.match(/WORST measured cycle\s*=\s*([0-9][0-9,_]*)\s*ms/)
const cycleMs = cycleM ? Number(cycleM[1].replace(/[,_]/g, '')) : null
if (cycleMs === null) {
  findings.push(`(a) ${RESUMER} does not state the per-unit cycle its bite was divided from ("WORST measured cycle = <n> ms"). The bite is then a number with no derivation on the line, which is the class this repo refuses.`)
}

// ⛔ REWRITTEN 2026-09-16 — LORAMER_FIRE_DEADLINE_FROM_FIRE_START_V1. THIS LEG USED TO DEMAND A "WORST MEASURED
// SCAN" FIGURE AND CHARGE THE BITE max(allowance, measured) FOR IT. That demand existed because the admission
// clock started AFTER the scan and so could not see a scan overrun — the bite had to carry the scan's risk on
// the bite's own line. IT NO LONGER DOES: the deadline is now counted from the fire's start
// (fire-deadline-from-fire-start.guard.mjs proves the property behaviourally at scans up to 400,000 ms), so a
// scan overrun comes out of capture automatically and no scan constant belongs in this arithmetic at all.
// ⛔ AND DEMANDING ONE WAS ACTIVELY HARMFUL: the figure it demanded (70,982 ms, n=19) was measured on one
// afternoon and was already exceeded by 45 of the next 157 fires. A guard that requires a stale constant to be
// restated keeps the staleness alive and calls it rigour.
if (resumer.match(/WORST measured scan\s*=\s*[0-9]/)) {
  findings.push(`(a) ${RESUMER} still states a "WORST measured scan" figure in its bite derivation. The bite no longer charges the scan — the fire clock does — and a scan constant left in the derivation is a second source of truth that will go stale exactly as the last one did.`)
}
if (bite !== null && budgetMs !== null && cycleMs !== null && floorMs !== null) {
  const wants = bite * cycleMs
  // ⛔ THE PROPERTY: the bite, taken alone at the measured pace, must fit inside the fire's whole work budget.
  // This is the BEST case (a scan of zero). It is not the guarantee that the fire stops in time — the clock is,
  // and its own guard proves it — it is the guarantee that the COUNT never promises more than the CLOCK can hold.
  if (wants > budgetMs) {
    findings.push(`(a) THE BITE ASKS FOR MORE TIME THAN A FIRE HAS EVEN WITH A ZERO-LENGTH SCAN: ${bite} × ${cycleMs} ms = ${wants} ms against FIRE_WORK_BUDGET_MS ${budgetMs} ms. The clock would defer the overflow rather than overrun, so this is not a kill risk — it is a bite that cannot mean what it says.`)
  }
  // ⛔ THE BITE MAY SIT BELOW WHAT THE BUDGET AFFORDS, AND MUST SAY SO ON ITS OWN LINE. Under the superseded
  // model the bite had to EQUAL the derivation because the bite was the only stop. Now the clock is the stop and
  // the bite is a cap, so a bite below the maximum is legitimate — but an unexplained gap is how the next
  // unexplained constant gets in, so the gap must be argued where the number lives.
  const affords = Math.floor(budgetMs / cycleMs)
  if (bite < affords && !/KEPT RATHER THAN RE-DERIVED UPWARD/.test(resumer)) {
    findings.push(`(a) the bite is ${bite} while the fire budget affords ${affords} at ${cycleMs} ms/unit, and ${RESUMER} does not argue why it is held below the maximum. A bite under its own ceiling is allowed; an unexplained one is not.`)
  }
  if (bite > affords) {
    findings.push(`(a) the bite is ${bite}, above the ${affords} the budget affords at ${cycleMs} ms/unit. The clock will defer the excess, but a bound that is never reachable is a bound that is not telling the truth about itself.`)
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
  // LORAMER_UNIT_RESERVE_PER_SURFACE_V1 (2026-09-18): the fourth argument is the unit's OWN reserve (c.reserveMs ≥ the floor), no longer the flat floor.
  if (!/shouldStartAnotherLap\(\s*Date\.now\(\) - startedAt,\s*maxUnitMs,\s*FIRE_WORK_BUDGET_MS,\s*c\.reserveMs\s*\)/.test(route)) {
    findings.push('(c) the execution loop no longer admits units through shouldStartAnotherLap against the FIRE budget on the FIRE clock. Raising the bite is only safe BECAUSE that gate exists; without it the bite becomes an unbounded promise.')
  }
  // ⛔ RE-CUT 2026-09-15 — LORAMER_FIRE_UNITS_CONCURRENT_V1. The loop is now per-surface queues run
  // concurrently, so "what did this fire not reach" is a SUM across queues rather than one subtraction from a
  // single index. The property is unchanged and is the same denominator law: a fire that quietly drops work is
  // indistinguishable from one that had none.
  if (!/deferredUnits\s*\+=\s*queue\.length - qi/.test(route)) {
    findings.push('(c) the loop no longer accumulates deferredUnits per surface queue. With concurrent queues a single subtraction cannot express what was not reached, and an unrecorded drop is a silent one.')
  }
  if (!/deadlineAt: fireDeadlineAt\(startedAt\)/.test(route)) {
    findings.push('(c) the per-unit deadline is no longer derived from the fire clock. Two clocks for one fire is how a unit outlives the loop that admitted it.')
  }
}

if (findings.length) {
  for (const f of findings) console.error(`✗ ${f}`)
  console.error(`[fire-bite-fits-the-budget] FAIL — ${findings.length} finding(s).`)
  process.exit(1)
}
console.log(`[fire-bite-fits-the-budget] PASS — the bite (${bite}) fits the fire's whole work budget (${budgetMs} ms) at the measured worst unit cycle (${cycleMs} ms), carries NO scan constant (the fire clock charges the scan now), argues its own headroom, and the loop still admits on the FIRE clock and records what it deferred.`)
