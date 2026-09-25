#!/usr/bin/env node
// LORAMER_FIRE_CEILING_600_V1 — leg (a): THE PUMP'S STEP RESERVE MUST FIT THE PUMP'S OWN INVOCATION.
//
// ⛔ THE DEFECT THIS EXISTS FOR, found by arithmetic in round 12 of 2026-09-25 before it could ship:
// `universe-run-pump/route.ts` sets `maxDuration = 800` and derives
// `STEP_RESERVE_MS = (CONSUMER_MAX_DURATION_S + 20) * 1000`, then `universe-run-pump.ts:62` steps only
// `while (now + reserveMs <= deadlineMs)`. At a 300 s fire ceiling that reserves 320 s of an 800 s pump and
// leaves ~480 s of stepping. Raise the ceiling to 800 and the reserve becomes 820,000 ms against an 800,000 ms
// deadline: the condition is FALSE on the first iteration and THE PUMP TAKES ZERO STEPS, SILENTLY, FOREVER.
// The continuous run — the only thing that steps a customer's Backfill — dies with no error and no log.
//
// ⛔ AND THE INVARIANT IS STRICTER THAN "IT FITS TODAY". The pump HOSTS the fire in-process
// (universe-run-fire.ts), so a fire that runs to its own ceiling must still land inside the pump's. The ceiling
// must therefore be strictly below the pump's maxDuration with room for the step's bookkeeping — which is what
// makes 600 the value and not 800 (800 is Pro's GA maximum and the pump cannot be raised above it: the builder
// refuses 1–800 violations, community.vercel.com/t/…/47573).
//
// LEGS
//  (a1) the reserve is DERIVED from the contract's ceiling, never a literal
//  (a2) at the CURRENT ceiling the reserve leaves room for at least one step
//  (a3) THE GENERAL INVARIANT, driven at 300 / 600 / 800: reserve < pump maxDuration × 1000, so a ceiling raise
//       that would starve the pump fails HERE rather than in production silence
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const PUMP = 'src/app/api/cron/universe-run-pump/route.ts'
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const pump = read(PUMP)
const contract = read(CONTRACT)

// (a1) derived, not literal
const reserveForm = pump.match(/const STEP_RESERVE_MS = \(CONSUMER_MAX_DURATION_S \+ (\d+)\) \* 1000/)
check(!!reserveForm, `(a1) ${PUMP}: STEP_RESERVE_MS is not derived as (CONSUMER_MAX_DURATION_S + <margin>) * 1000. A literal reserve stops tracking the ceiling the moment the ceiling moves, and the failure is a pump that silently never steps.`)
const mdLit = pump.match(/export const maxDuration = (\d+)/)
check(!!mdLit, `(a1) ${PUMP}: maxDuration is not a literal number this guard can read.`)

const ceilingNow = Number((contract.match(/export const CONSUMER_MAX_DURATION_S = (\d+)/) || [])[1])
const margin = reserveForm ? Number(reserveForm[1]) : null
const pumpMaxS = mdLit ? Number(mdLit[1]) : null

if (margin !== null && pumpMaxS !== null && Number.isFinite(ceilingNow)) {
  const reserveAt = (ceilingS) => (ceilingS + margin) * 1000
  const pumpMs = pumpMaxS * 1000

  // (a2) room for one step at today's ceiling
  check(reserveAt(ceilingNow) < pumpMs,
    `(a2) at the declared ceiling ${ceilingNow} s the pump reserves ${reserveAt(ceilingNow)} ms of a ${pumpMs} ms invocation — no step can start. universe-run-pump.ts:62 steps only while now + reserveMs <= deadlineMs.`)

  // (a3) THE INVARIANT, driven both ways. The positives are ceilings that must fit; the NEGATIVE is the
  // self-test — 800 s is the Pro GA maximum and equals the pump's own, so a ceiling raised to it WOULD starve
  // the pump. A guard that cannot show itself catching that case is not evidence of anything.
  for (const ceilingS of [300, 600]) {
    const r = reserveAt(ceilingS)
    check(r < pumpMs,
      `(a3) A FIRE CEILING OF ${ceilingS} s STARVES THE PUMP: reserve ${r} ms >= pump maxDuration ${pumpMs} ms, so \`now + reserveMs <= deadlineMs\` is false at t=0 and the pump takes ZERO steps — no error, no log, the continuous run simply stops.`)
  }
  check(reserveAt(pumpMaxS) >= pumpMs,
    `(a3) SELF-TEST BROKEN: a fire ceiling equal to the pump's own ${pumpMaxS} s should be refused by this rule and is not. The rule can no longer catch the failure it exists for.`)
  check(ceilingNow + margin < pumpMaxS,
    `(a3) the DECLARED ceiling ${ceilingNow} s plus the ${margin} s margin must stay strictly under the pump's ${pumpMaxS} s — it is the host that runs the fire in-process, and a fire that outlives it dies mid-work at FUNCTION_INVOCATION_TIMEOUT.`)

  // the host that runs the fire must also outlive it
  const RUN = 'src/app/api/backfill/universe-run/route.ts'
  const runMax = Number((read(RUN).match(/export const maxDuration = (\d+)/) || [])[1])
  check(Number.isFinite(runMax) && runMax > ceilingNow,
    `(a3) ${RUN} awaits a step and must outlive it: maxDuration ${runMax} s against a ${ceilingNow} s fire ceiling.`)
}

if (findings.length) {
  console.error(`✗ pump-reserve-fits-the-pump FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ pump-reserve-fits-the-pump OK — STEP_RESERVE_MS derives from the contract ceiling, and at 300 / 600 / 800 s it stays strictly inside the pump's ${pumpMaxS} s invocation, so no ceiling in that range can silently stop the run.`)
