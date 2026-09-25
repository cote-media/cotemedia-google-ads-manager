#!/usr/bin/env node
// LORAMER_FIRE_CEILING_600_V1 — leg (g): NO SINGLE UNIT MAY RESERVE MORE THAN HALF THE FIRE.
//
// ⛔ WHY THIS APPEARS ONLY NOW. `timeCappedDays` caps a window so its reserve fits `consumerMaxS`, and the cap
// only bites above (consumerMaxS − 18) ÷ (1.48 × 360) s/day: 0.529 at a 300 s ceiling, 1.092 at 600. Raising the
// ceiling therefore UNCAPS every surface in the band between — a 0.63 s/day surface (the measured fleet worst)
// goes from a 302-day unit to a 360-day one reserving 353,664 ms. That is 61% of a 582,000 ms budget in ONE unit.
//
// ⛔ WHY HALF, DERIVED RATHER THAN CHOSEN. A fire's plan phase is measured at 112,470–129,282 ms (rounds 10/12),
// so up to 22% of the budget is spent before any unit runs. A unit reserving more than half of the budget cannot
// be retried inside its own fire and cannot share the fire with a second surface: if it dies, the fire has
// bought nothing, and Vercel's termination is a 504 with the unit's work discarded
// (vercel.com/docs/functions/limitations: "If a Vercel Function doesn't complete within the duration, a 504
// error code (FUNCTION_INVOCATION_TIMEOUT) is returned"). Half is the largest fraction that leaves room for a
// second attempt or a second surface, which is the property that matters.
//
// LEGS
//  (g1) the contract declares UNIT_RESERVE_MAX_FRACTION
//  (g2) driven against the REAL unitReserveMs/timeCappedDays at every measured s/day, no unit exceeds the cap
//  (g3) the cap is applied at the sizer's callers, not just declared
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const ADAPTER = 'src/lib/backfill/capture-adapter.ts'
const RESUME = 'src/app/api/cron/universe-resume/route.ts'

const contract = read(CONTRACT)
check(/export const UNIT_RESERVE_MAX_FRACTION = 0\.5/.test(contract),
  `(g1) ${CONTRACT} does not export UNIT_RESERVE_MAX_FRACTION = 0.5. Without it a ceiling raise silently uncaps every surface between the old and new s/day thresholds.`)

// MEASURED s/day, 2026-09-25 and the contract's own basis: the fleet worst is 0.63; the re-ask head rows run
// 0.030–0.346; 1.0 and 1.468 are the band the 600 s ceiling newly uncaps.
const MEASURED_SPD = [0.030, 0.293, 0.346, 0.529, 0.63, 1.0, 1.092, 1.468]
const out = mkdtempSync(join(tmpdir(), 'unit-reserve-fraction-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, ADAPTER), resolve(ROOT, CONTRACT),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const req = createRequire(import.meta.url)
  const A = req(join(out, 'src/lib/backfill/capture-adapter.js'))
  const C = req(join(out, 'src/lib/backfill/universe-v2-contract.js'))
  const frac = C.UNIT_RESERVE_MAX_FRACTION
  const budget = C.FIRE_WORK_BUDGET_MS
  const ceilingS = C.CONSUMER_MAX_DURATION_S
  if (typeof A.fractionCappedDays !== 'function') findings.push('(g2) capture-adapter.ts does not export fractionCappedDays — the share cap has no shared implementation and each caller would grow its own.')
  if (typeof frac !== 'number') {
    findings.push('(g2) UNIT_RESERVE_MAX_FRACTION is not exported as a number — this guard cannot drive the cap and therefore FAILS.')
  } else {
    const cap = Math.floor(budget * frac)
    for (const spd of MEASURED_SPD) {
      // Composed exactly as the route composes them: the TIME cap first, then the SHARE cap.
      const timeCapped = A.timeCappedDays({ maxSecPerDay: spd, days: 360, minDays: 1, consumerMaxS: ceilingS }).days
      const days = A.fractionCappedDays({ maxSecPerDay: spd, days: timeCapped, minDays: 1, budgetMs: budget, fraction: frac })
      const reserve = A.unitReserveMs({ maxSecPerDay: spd, days })
      check(reserve <= cap,
        `(g2) at the measured ${spd} s/day the sizer yields a ${days}-day unit reserving ${reserve} ms — ${Math.round(100 * reserve / budget)}% of the ${budget} ms fire budget, over the ${cap} ms cap. A unit this size cannot be retried inside its own fire, and a 504 discards all of it.`)
    }
  }
} catch (e) {
  findings.push(`unit-reserve-fraction CANNOT RUN — ${e?.message ?? e}. A guard that cannot drive its subject FAILS rather than passing.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// (g3) applied, not merely declared
const resume = read(RESUME)
check(/UNIT_RESERVE_MAX_FRACTION/.test(resume),
  `(g3) ${RESUME} never references UNIT_RESERVE_MAX_FRACTION — the cap is declared in the contract and applied nowhere, which is a constant with no enforcer.`)

if (findings.length) {
  console.error(`✗ unit-reserve-fraction FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ unit-reserve-fraction OK — at every measured s/day the real sizer yields a unit reserving at most half the fire budget, and the cap is applied at the callers rather than only declared.')
