#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 — THE DRIVER'S UNIT LEASE IS DERIVED FROM THE FORWARD ROUTE'S maxDuration, NEVER A LITERAL.
//
// The same law as forward-claim-lease-covers-max-duration (LORAMER_FORWARD_LANE_HYGIENE_V1): a Vercel invocation is
// terminated at maxDuration, so a holder's hold is ≤ maxDuration and a lease of maxDuration + margin cannot lapse
// under a live holder. The driver claims units under the sync route's ceiling, but it is a library module and
// cannot import a route file — so it declares DRIVER_MAX_DURATION_S itself and THIS guard pins that declaration to
// `export const maxDuration` in src/app/api/cron/sync/route.ts: the two may never differ.
//
// LEGS
//  (a) forward-driver.ts declares `export const DRIVER_MAX_DURATION_S = <n>` and it EQUALS the sync route's maxDuration
//  (b) `export const DRIVER_CLAIM_LEASE_S = DRIVER_MAX_DURATION_S + N`, N ≥ 60, and no bare-number assignment exists
//  (c) the driver's claim_backfill_cursor call passes p_lease_seconds: DRIVER_CLAIM_LEASE_S
//  (d) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const DRIVER = 'src/lib/backfill/forward-driver.ts'
const SYNC = 'src/app/api/cron/sync/route.ts'
const driver = strip(read(DRIVER))
const sync = strip(read(SYNC))
if (!driver) findings.push(`(a) ${DRIVER} does not exist — the driver module has not been built`)
if (!sync) findings.push(`(a) CANNOT READ ${SYNC}`)
if (driver && sync) {
  const routeMax = sync.match(/export const maxDuration\s*=\s*(\d+)/)
  const drvMax = driver.match(/export const DRIVER_MAX_DURATION_S\s*=\s*(\d+)/)
  if (!routeMax) findings.push(`(a) ${SYNC} declares no numeric export const maxDuration`)
  if (!drvMax) findings.push(`(a) ${DRIVER} does not declare \`export const DRIVER_MAX_DURATION_S = <n>\``)
  if (routeMax && drvMax && routeMax[1] !== drvMax[1]) findings.push(`(a) DRIVER_MAX_DURATION_S = ${drvMax[1]} but ${SYNC} maxDuration = ${routeMax[1]} — the driver's lease is derived from a ceiling that is not the one it runs under`)
  const lease = driver.match(/export const DRIVER_CLAIM_LEASE_S\s*=\s*DRIVER_MAX_DURATION_S\s*\+\s*(\d+)/)
  if (!lease) findings.push(`(b) ${DRIVER} does not declare \`export const DRIVER_CLAIM_LEASE_S = DRIVER_MAX_DURATION_S + N\``)
  else if (Number(lease[1]) < 60) findings.push(`(b) DRIVER_CLAIM_LEASE_S margin is ${lease[1]} s; it must be ≥ 60 s`)
  if (/DRIVER_CLAIM_LEASE_S\s*=\s*\d+/.test(driver)) findings.push(`(b) DRIVER_CLAIM_LEASE_S is assigned a bare number somewhere in ${DRIVER}`)
  const callIdx = driver.indexOf("rpc('claim_backfill_cursor'")
  if (callIdx === -1) findings.push(`(c) ${DRIVER} does not call claim_backfill_cursor — units are not claimed under a lease at all`)
  else if (!/p_lease_seconds:\s*DRIVER_CLAIM_LEASE_S/.test(driver.slice(callIdx, callIdx + 500))) findings.push(`(c) the driver's claim_backfill_cursor call does not pass p_lease_seconds: DRIVER_CLAIM_LEASE_S — it would run on the RPC's 480 s default, shorter than a measured 644–762 s unit`)
}
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/unit-lease-covers-max-duration.guard.mjs')) findings.push('(d) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ unit-lease-covers-max-duration FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log(`[unit-lease-covers-max-duration] PASS — DRIVER_CLAIM_LEASE_S = DRIVER_MAX_DURATION_S + N (N ≥ 60), DRIVER_MAX_DURATION_S equals the sync route's maxDuration, and the unit claim passes the lease.`)
