#!/usr/bin/env node
// LORAMER_FIRE_CEILING_600_V1 — leg (d): THE DELETE JOB'S QUIET-WAIT DERIVES FROM THE CEILING, NEVER COPIES IT.
//
// ⛔ THE DEFECT, found in round 14 of 2026-09-25 while inventorying the ceiling raise. The customer-facing
// "Delete Google data" job waits for the walk to go quiet before it deletes anything — it must, or a wipe starts
// under a live fire that is still writing. `waitForQuiet` (google-delete/job.ts) decides "quiet" from two
// numbers, and both were BARE LITERALS copied from the old ceiling:
//     const LEASE_TTL_MS = 330_000     // = LEASE_TTL_S 330 × 1000
//     const RUN_RESERVE_MS = 320_000   // = the pump's STEP_RESERVE_MS
// At a 600 s ceiling the real windows are 630,000 and 620,000, so the copies would declare quiet roughly half a
// window early and the delete would begin while a fire was mid-write. Nothing about that failure is loud: the
// re-count at the end would simply find rows the walk wrote after the sweep passed.
// The same file already shows the correct shape one constant above — `CLAIM_RESERVE_S = PUMP_MAX_DURATION_S + 20`
// with the comment "⇐ PUMP_MAX_DURATION_S + 20, the universe-run-pump's STEP_RESERVE derivation" — so this is a
// copy sitting beside a derivation, which is exactly how the value went stale unnoticed.
//
// LEGS
//  (d1) no bare 330_000 / 320_000 survives in the job
//  (d2) LEASE_TTL_MS derives from the contract's LEASE_TTL_S
//  (d3) RUN_RESERVE_MS derives from the contract's CONSUMER_MAX_DURATION_S in the pump's own form
//  (d4) the derived values actually exceed the live windows at the declared ceiling
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const JOB = 'src/lib/google-delete/job.ts'
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const job = read(JOB)
const contract = read(CONTRACT)
const code = job.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

// (d1)
for (const lit of ['330_000', '320_000', '330000', '320000']) {
  check(!new RegExp(`=\\s*${lit}\\b`).test(code),
    `(d1) ${JOB} still assigns the bare literal ${lit}. It was copied from a 300 s ceiling; at any other ceiling waitForQuiet declares the walk quiet while a fire is still writing, and the wipe starts under it.`)
}
// (d2) (d3)
check(/LEASE_TTL_MS\s*=\s*LEASE_TTL_S \* 1000/.test(code),
  `(d2) ${JOB}: LEASE_TTL_MS must be LEASE_TTL_S * 1000, imported from the contract — the fire lease's TTL is the only thing that says how long a holder can live.`)
check(/RUN_RESERVE_MS\s*=\s*\(CONSUMER_MAX_DURATION_S \+ \d+\) \* 1000/.test(code),
  `(d3) ${JOB}: RUN_RESERVE_MS must be derived as (CONSUMER_MAX_DURATION_S + <margin>) * 1000 — the same form the pump's STEP_RESERVE_MS uses, because it is measuring the same window.`)
check(/from '@\/lib\/backfill\/universe-v2-contract'/.test(job),
  `(d3) ${JOB} does not import from the v2 contract, so whatever it uses for these windows is a second declaration of a number the contract owns.`)

// (d4) the numbers at the declared ceiling
const ceiling = Number((contract.match(/export const CONSUMER_MAX_DURATION_S = (\d+)/) || [])[1])
const graceM = (contract.match(/export const LEASE_TTL_S = CONSUMER_MAX_DURATION_S \+ (\d+)/) || [])[1]
if (Number.isFinite(ceiling) && graceM) {
  const leaseMs = (ceiling + Number(graceM)) * 1000
  check(leaseMs > ceiling * 1000,
    `(d4) the derived lease window ${leaseMs} ms does not exceed the ${ceiling * 1000} ms a holder can live — the wait could pass while a holder is alive.`)
}

if (findings.length) {
  console.error(`✗ quiet-wait-derives-from-the-constants FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ quiet-wait-derives-from-the-constants OK — the delete job's quiet-wait reads the contract's LEASE_TTL_S and CONSUMER_MAX_DURATION_S instead of copies, so a ceiling change moves the wait with it.`)
