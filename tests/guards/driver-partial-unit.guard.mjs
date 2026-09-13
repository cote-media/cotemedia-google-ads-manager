#!/usr/bin/env node
// LORAMER_DRIVER_PARTIAL_UNIT_V1 — AN OVER-BUDGET UNIT IS ADMITTED, CUT AT THE DEADLINE, AND RESUMED FROM THE PENDING REMAINDER.
//
// THE DEFECT (measured 2026-09-13, Bath Fitter 60e6dd99): every driver fire from 13:40Z logged
//   "REST: pending 273/273 · estimate 717452 rows ≈ 768 s vs remaining 676 s → skip-over-budget"
// — decideUnit refused the unit BEFORE the claim because its estimate (rows ÷ rate + surfaces × latency) exceeded
// DRIVER_BUDGET_MS, and a unit whose estimate exceeds the WHOLE budget can never run. Bath Fitter's REST slice went
// unobserved for 09-11 and 09-12. The same unit had ALREADY run across two fires on 2026-09-11 (112 surfaces, cut at
// the deadline 11:51:23Z; the remaining 157 on the 12:00Z fire; 269/269, zero duplicates) — the in-unit deadline cut
// (runCatalogueUnit) and the ledger-as-cursor resume (readSliceObservationState set-difference) are the proven seam;
// only the door refused. Prior art bounds the in-flight ITEM, never the job (Shopify/job-iteration; oneuptime.com
// job checkpointing) — the budget is measured at the cut, not predicted at admission.
//
// THE FIX, three halves, each pinned below:
//  (α) decideUnit admits a unit whenever remainingMs ≥ MIN_PARTIAL_MS, WHATEVER the estimate; 'skip-over-budget'
//      survives only for remainingMs < MIN_PARTIAL_MS (an admission below that burns a 900 s claim lease for ≤ 1 ask
//      and hands the next fire a claim-lost). MIN_PARTIAL_MS = 120,000 = maxDuration 800 s − DRIVER_BUDGET_MS 680 s,
//      the headroom that bounds ONE worst-case in-flight surface (09-12 fleet: HEAVY worst 104,198 rows ≈ 98 s at the
//      1,060 rows/s shared-host rate; Bath Fitter REST worst 57,254 ≈ 54 s) plus its observation write. The admitted
//      unit is then cut by runCatalogueUnit's deadline check before the next ask — the seam this leg drives.
//  (β) forward-driver.ts estimates over pendingOnly — BOTH terms, rows and the per-surface latency — never the whole
//      slice. Without this an admitted unit that ran 112 of 273 re-estimates at the full 768 s next fire and "admit"
//      never becomes "resume". (Under (α) the estimate no longer gates admission, but it is printed in the FIRE line
//      and read by Russ as the unit's expected duration; a whole-slice number there is a wrong number.)
//  (γ) a surface deferred by the deadline leaves ZERO observations — no phantom coverage: observe() runs only after an
//      ask, and the deadline check sits BEFORE the ask. (Seen red against a module without the deadline check.)
//  (δ) the driver's FIRE log line prints deferredForDeadline — the cut is visible in the log, not only the JSON body.
//  (e) registered in scripts/run-guards.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const SLICES = 'src/lib/backfill/forward-driver-slices.ts'
const DRIVER = 'src/lib/backfill/forward-driver.ts'
const EXPECTED_MIN_PARTIAL_MS = 120_000 // = 800_000 (DRIVER_MAX_DURATION_S) − 680_000 (DRIVER_BUDGET_MS)

if (!read(SLICES)) findings.push(`(α) ${SLICES} does not exist`)
else {
  const out = mkdtempSync(join(tmpdir(), 'loramer-driver-partial-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
      resolve(ROOT, SLICES), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
      '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
    ], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const M = createRequire(import.meta.url)(join(out, 'src/lib/backfill/forward-driver-slices.js'))
    if (typeof M.decideUnit !== 'function' || typeof M.runCatalogueUnit !== 'function') findings.push(`(α) ${SLICES} does not export decideUnit and runCatalogueUnit`)
    else {
      // (α) the door: over-budget but ≥ MIN_PARTIAL_MS remaining → admitted; below MIN_PARTIAL_MS → refused
      if (M.MIN_PARTIAL_MS !== EXPECTED_MIN_PARTIAL_MS) findings.push(`(α) ${SLICES} exports MIN_PARTIAL_MS=${M.MIN_PARTIAL_MS} — expected ${EXPECTED_MIN_PARTIAL_MS} (maxDuration 800 s − DRIVER_BUDGET_MS 680 s, the one-surface headroom)`)
      const admitted = M.decideUnit({ estimateMs: 768_000, remainingMs: 676_000 }) // the live Bath Fitter numbers, 2026-09-13
      if (admitted !== 'run') findings.push(`(α) decideUnit({estimateMs: 768000, remainingMs: 676000}) → '${admitted}' — an over-budget unit with a whole budget remaining must be ADMITTED and cut at the deadline, never skipped forever`)
      const refused = M.decideUnit({ estimateMs: 768_000, remainingMs: EXPECTED_MIN_PARTIAL_MS - 1 })
      if (refused !== 'skip-over-budget') findings.push(`(α) decideUnit({estimateMs: 768000, remainingMs: ${EXPECTED_MIN_PARTIAL_MS - 1}}) → '${refused}' — below MIN_PARTIAL_MS the unit must be refused (a claim here burns a 900 s lease for ≤ 1 ask)`)
      const edge = M.decideUnit({ estimateMs: 768_000, remainingMs: EXPECTED_MIN_PARTIAL_MS })
      if (edge !== 'run') findings.push(`(α) decideUnit at exactly remainingMs=MIN_PARTIAL_MS → '${edge}' — the floor is inclusive`)
      const small = M.decideUnit({ estimateMs: 10_000, remainingMs: 50_000 })
      if (small !== 'skip-over-budget') findings.push(`(α) decideUnit({estimateMs: 10000, remainingMs: 50000}) → '${small}' — below MIN_PARTIAL_MS nothing is admitted, however small the estimate: the lease cost is the same`)

      // (α, the cut) + (γ, no phantom coverage): 273 surfaces, a clock that crosses the deadline after 112 asks
      const surfaces = Array.from({ length: 273 }, (_, i) => ({ resource: `r${i}`, segment: '' }))
      let t = 0
      const asked = [], seen = []
      const res = await M.runCatalogueUnit({
        surfaces,
        ask: async (s) => { asked.push(s.resource); t += 1000; return { apiRows: 1, rowsWritten: 1, rowsByDay: { '2026-09-12': 1 }, requests: 1 } },
        observe: async (o) => { seen.push(o.resource) },
        window: { start: '2026-08-13', end: '2026-09-12' },
        deadlineAt: 112_000 - 1, // the 113th ask finds now() > deadline
        now: () => t,
      })
      if (res.surfacesAsked !== 112 || res.deferredForDeadline !== 161) findings.push(`(α) the cut: asked ${res.surfacesAsked}, deferred ${res.deferredForDeadline} — expected 112 asked / 161 deferred (the 2026-09-11 shape: 112 + 157 = 269 across two fires)`)
      if (seen.length !== asked.length) findings.push(`(γ) ${seen.length} observation(s) for ${asked.length} ask(s) — every asked surface is observed exactly once`)
      const phantom = seen.filter((r) => !asked.includes(r))
      if (phantom.length) findings.push(`(γ) ${phantom.length} surface(s) observed WITHOUT an ask (phantom coverage): ${phantom.slice(0, 3).join(', ')}${phantom.length > 3 ? ', …' : ''} — a deferred surface must leave no row, or the pending predicate never finds it again`)
      const deferredSeen = seen.filter((r) => Number(r.slice(1)) >= 112)
      if (deferredSeen.length) findings.push(`(γ) ${deferredSeen.length} deferred surface(s) carry an observation — no phantom coverage`)
    }
  } catch (e) { findings.push(`(α) ${SLICES} could not be compiled or driven: ${e.message}`) }
  finally { rmSync(out, { recursive: true, force: true }) }
}

const driver = strip(read(DRIVER))
if (!driver) findings.push(`(β) ${DRIVER} does not exist`)
else {
  // (β) the estimate is over the pending remainder — both terms
  const estIdx = driver.indexOf('const estimateRows =')
  const est = estIdx === -1 ? '' : driver.slice(estIdx, estIdx + 700)
  if (!est) findings.push(`(β) ${DRIVER} no longer computes estimateRows — the unit estimate moved`)
  else {
    if (!/const estimateRows = pendingOnly\.reduce\(/.test(est)) findings.push(`(β) ${DRIVER} estimateRows sums the WHOLE slice (surfaces.reduce) — must sum pendingOnly: a unit that ran 112 of 273 re-estimates at the full 768 s and is never resumed`)
    const call = est.slice(est.indexOf('estimateUnitMs('))
    if (!/estimateUnitMs\(\{[^}]*surfaces:\s*pendingOnly\.length/.test(call)) findings.push(`(β) ${DRIVER} estimateUnitMs' latency term counts the WHOLE slice (surfaces: surfaces.length) — must be pendingOnly.length`)
  }
  if (!/decideUnit\(\{\s*estimateMs,\s*remainingMs\s*\}\)/.test(driver)) findings.push(`(β) ${DRIVER} no longer routes the door through decideUnit({ estimateMs, remainingMs }) — leg (α) proves a function the driver does not call`)
  // (δ) the cut is visible in the log line, not only the response body
  const ranIdx = driver.indexOf('ran in ${')
  const ranLine = ranIdx === -1 ? '' : driver.slice(ranIdx, ranIdx + 400)
  if (!ranLine) findings.push(`(δ) ${DRIVER} no longer logs the per-unit "ran in" line`)
  else if (!/deferred \$\{res\.deferredForDeadline\}/.test(ranLine)) findings.push(`(δ) ${DRIVER} "ran in" log line does not print deferredForDeadline — a cut is invisible outside the JSON body (Vercel logs are the only hour-old record)`)
}

const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-partial-unit.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ driver-partial-unit FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log(`[driver-partial-unit] PASS — decideUnit admits an over-budget unit at ≥ MIN_PARTIAL_MS ${EXPECTED_MIN_PARTIAL_MS} ms and refuses below it; runCatalogueUnit cuts 273 surfaces at 112 asked / 161 deferred with one observation per ask and none for a deferred surface; forward-driver.ts estimates over pendingOnly (both terms) and logs deferredForDeadline.`)
