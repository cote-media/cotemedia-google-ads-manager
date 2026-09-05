#!/usr/bin/env node
// LORAMER_FORWARD_OBSERVATION_LOG_V1 — THE HOLE MAP TELLS "ASKED AND EMPTY, UNSEALED" APART FROM "NEVER ASKED",
// AND NEVER FEEDS THE FORMER INTO COVERAGE.
//
// Ruling (F) wants positive evidence for a dormant day; condition 2 wants attested-empty WITH A STATED REASON.
// Between the two sits the observation: forward asked the surface, the vendor returned nothing, and the day is
// still inside the vendor's restatement window so nothing may seal it (LORAMER_RESTATEMENT_WINDOW_LAW_V1: 30 d
// default, 90 d for conversions). Before this tier the hole map listed such a day as a HOLE — indistinguishable
// from a day nobody asked — and would re-list it forever. Now it is its own tier, `observedUnsealed`, split out
// of cov.uncovered AFTER windowCoverage returns; the hole spans are built from the RESIDUAL only. Promotion
// (observation → attest) is the LOOKBACK lane's job and is not this commit's.
//
// LEGS
//  (a) google-hole-map.ts imports readForwardObservations from the observation module (never the attempt-log module)
//  (b) the tiers literal and SurfaceTally/HoleMapPage carry `observedUnsealed`
//  (c) the observation read happens AFTER windowCoverage in the loop and windowCoverage's call is unchanged —
//      `windowCoverage(key, effectiveStart, end)` — so an observation can never become a coverage input
//  (d) hole spans are built from the residual (`toRanges(residualUncovered)`), not from cov.uncovered
//  (e) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const ENUM = 'src/lib/backfill/google-hole-map.ts'
const src = strip(read(ENUM))
if (!src) findings.push(`UNREADABLE ${ENUM}`)
else {
  if (!/import\s*\{[^}]*\breadForwardObservations\b[^}]*\}\s*from\s*['"]@\/lib\/backfill\/forward-observation-log['"]/.test(src)) findings.push(`(a) ${ENUM} does not import readForwardObservations from the observation module — it cannot tell an asked-and-empty day from a never-asked one`)
  if (/from\s+['"]@\/lib\/backfill\/universe-attempt-log['"]/.test(src)) findings.push(`(a) ${ENUM} imports the attempt-log module — the spend-and-failure API reaching a coverage decision (universe-stream-consumer leg (g))`)
  const tiersLit = src.match(/const tiers\s*=\s*\{([^}]*)\}/)
  if (!tiersLit) findings.push(`(b) ${ENUM} has no \`const tiers = { … }\` literal`)
  else if (!/observedUnsealed\s*:/.test(tiersLit[1])) findings.push(`(b) the tiers literal carries no observedUnsealed — asked-and-empty days are still counted as holes`)
  const tally = src.match(/export interface SurfaceTally\s*\{([^}]*)\}/)
  if (!tally || !/observedUnsealed\s*:\s*number/.test(tally[1])) findings.push(`(b) SurfaceTally carries no \`observedUnsealed: number\``)
  const page = src.match(/export interface HoleMapPage\s*\{([\s\S]*?)\n\}/)
  if (!page || !/tiers:[^\n]*observedUnsealed/.test(page[1])) findings.push(`(b) HoleMapPage.tiers type carries no observedUnsealed`)
  const covAt = src.indexOf('await windowCoverage(key, effectiveStart, end)')
  const obsAt = src.indexOf('await readForwardObservations(')
  if (covAt === -1) findings.push(`(c) the coverage call is no longer the exact \`windowCoverage(key, effectiveStart, end)\` — its inputs changed, and an observation may have become one`)
  if (obsAt === -1) findings.push(`(c) ${ENUM} never calls readForwardObservations`)
  if (covAt !== -1 && obsAt !== -1 && obsAt < covAt) findings.push(`(c) readForwardObservations is called BEFORE windowCoverage — the observation must be a label over coverage's answer, never an input to it`)
  if (/windowCoverage\([^)]*obs/.test(src)) findings.push(`(c) an observation result is passed into windowCoverage`)
  if (!/toRanges\(residualUncovered\)/.test(src)) findings.push(`(d) hole spans are not built from \`toRanges(residualUncovered)\` — asked-and-empty days would be listed as holes`)
  if (/toRanges\(cov\.uncovered\)/.test(src)) findings.push(`(d) hole spans are still built from cov.uncovered`)
}
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/hole-map-observed-unsealed-tier.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length === 0) {
  console.log('hole-map-observed-unsealed-tier: PASSED — enumerateGoogleHoles reads forward observations AFTER windowCoverage, reports observedUnsealed as its own tier, builds hole spans from the residual only, and never feeds an observation into coverage.')
  process.exit(0)
}
console.error(`hole-map-observed-unsealed-tier: FAILED — ${findings.length} finding(s)`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
