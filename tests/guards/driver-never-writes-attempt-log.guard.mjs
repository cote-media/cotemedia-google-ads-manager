#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 — THE DRIVER WRITES forward_observation_log AND NEVER universe_attempt_log.
//
// DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (b)/(f): a forward record is an OBSERVATION, not an attest; the
// driver is FORWARD-SHAPED (cron_runs · claim lease · budget) and "NEVER shares `universe_attempt_log` or the
// rotation". migrations/087 keeps the walk's coverage predicate blind to forward BY CONSTRUCTION — a driver that
// wrote an attempt row would re-create the seal-by-forward-zero class the observation table exists to make
// impossible. This guard refuses the driver source if it names the walk's ledger, its writers, or its module.
//
// LEGS
//  (a) src/lib/backfill/forward-driver.ts and forward-driver-slices.ts exist and export runForwardDriver /
//      runCatalogueUnit (the driver is catalogue-only — the legacy path is frozen, DECISIONS:2461)
//  (b) neither file names universe_attempt_log, imports universe-attempt-log, or calls appendAttemptStarted /
//      appendDayCommitted / appendAttemptFinished / universe_attempt_open
//  (c) the driver DOES import the observation module (the one it may write through)
//  (d) self-test: a planted body carrying `appendAttemptStarted(` must be refused by the same predicate
//  (e) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const FILES = ['src/lib/backfill/forward-driver.ts', 'src/lib/backfill/forward-driver-slices.ts']
const FORBIDDEN = [
  /universe_attempt_log/, /universe-attempt-log/, /appendAttemptStarted\s*\(/, /appendDayCommitted\s*\(/,
  /appendAttemptFinished\s*\(/, /universe_attempt_open/, /universe_surface_rotation/,
]
export function violations(code) {
  return FORBIDDEN.filter((re) => re.test(code)).map((re) => re.source)
}

for (const f of FILES) {
  const raw = read(f)
  if (!raw) { findings.push(`(a) ${f} does not exist — the isolated driver module has not been built`); continue }
  const code = strip(raw)
  const v = violations(code)
  if (v.length) findings.push(`(b) ${f} names the walk's ledger or its writers: ${v.join(' · ')} — the driver writes forward_observation_log and NEVER universe_attempt_log (ruling b/f)`)
}
const driver = strip(read(FILES[0]))
if (driver && !/from\s+['"]@\/lib\/backfill\/forward-observation-log['"]/.test(driver)) findings.push(`(c) ${FILES[0]} does not import @/lib/backfill/forward-observation-log — the driver must record every ask through the one observation module`)
if (driver && !/export async function runForwardDriver\s*\(/.test(driver)) findings.push(`(a) ${FILES[0]} does not export runForwardDriver`)
const slices = strip(read(FILES[1]))
if (slices && !/export async function runCatalogueUnit\s*\(/.test(slices)) findings.push(`(a) ${FILES[1]} does not export runCatalogueUnit`)

// (d) self-test — the predicate must refuse a planted writer
if (violations("const opened = await appendAttemptStarted(rangeKey, 1, { startDate, endDate }, prov, lane)").length === 0) findings.push('(d) SELF-TEST FAILED: the predicate accepted a planted appendAttemptStarted( call')
if (violations("await appendForwardObservation({ clientId, vendor: 'google' })").length !== 0) findings.push('(d) SELF-TEST FAILED: the predicate refused the observation writer')

const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-never-writes-attempt-log.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ driver-never-writes-attempt-log FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log('[driver-never-writes-attempt-log] PASS — forward-driver.ts and forward-driver-slices.ts never name universe_attempt_log or its writers; the driver records through forward-observation-log only (self-test 2/2).')
