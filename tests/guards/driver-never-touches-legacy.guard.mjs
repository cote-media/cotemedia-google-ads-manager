#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 — THE DRIVER NEVER TOUCHES THE LEGACY PATH, WHICH IS FROZEN FOR GOOGLE STANDARD ACCESS.
//
// DECISIONS:2461 (2026-08-14/15): legacy `/dashboard` and the demo twin 2617b163 are the EXHIBIT in the open Google Ads
// Standard Access RMF review — "the surface under review must not change while reviewers are looking at it."
// Russ, 2026-09-10 (round 9): nothing is built, moved, split or re-pointed on the legacy path — /dashboard, the session
// Google routes, the cron/sync google builders, client 2617b163; useful work is COPIED to new. The forward driver owns
// the 319 catalogue surfaces only and has its own caller. Precedent for the client: ★TWIN-AD-NAMES-HELD-BY-FREEZE
// excluded 2617b163 from a fleet metrics_daily repair. Client identity per the registry, src/lib/clients/canonical.ts.
//
// LEGS — on src/lib/backfill/forward-driver*.ts (the driver and its pure half):
//  (a) no import from the cron routes (cron/sync, cron/catchup) or from the legacy family module, and no runLegacyFamily
//  (b) no legacy metrics_daily key: the driver never names a legacy breakdown_type literal (device · hour · geo_* · user_geo_* ·
//      search_term · keyword · age · gender · conversion_action · impression_share) or entity_level 'account'|'campaign'|'ad_group'|'ad'
//      as a WRITE spelling — it writes the catalogue spelling only (ruling n, two spellings across the set)
//  (c) no frozen route or file is named: src/app/dashboard, /api/campaigns, /api/keywords, /api/daily, /api/google/, /api/accounts,
//      legacy-cohort, middleware
//  (d) DRIVER_EXCLUDED_CLIENTS carries 2617b163 and runForwardDriver filters it before any claim
//  (e) the LEGACY slice is gone: no 'LEGACY' slice literal in either file
//  (f) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const FILES = ['src/lib/backfill/forward-driver.ts', 'src/lib/backfill/forward-driver-slices.ts']
const TWIN = '2617b163-f392-427e-9a29-f134acc51406' // the demo twin — identity per the registry, src/lib/clients/canonical.ts
for (const f of FILES) {
  const raw = read(f)
  if (!raw) { findings.push(`${f} does not exist`); continue }
  const code = strip(raw)
  if (/from\s+['"][^'"]*(cron\/sync|cron\/catchup|forward-legacy-family)['"]/.test(code) || /runLegacyFamily/.test(code)) findings.push(`(a) ${f} imports or calls the legacy path (cron/sync · cron/catchup · forward-legacy-family · runLegacyFamily) — the legacy path is frozen (DECISIONS:2461); the driver is catalogue-only`)
  const legacyKey = code.match(/breakdown_type\s*:\s*['"](device|hour|geo_[a-z_]*|user_geo_[a-z_]*|search_term|keyword|age|gender|conversion_action|impression_share)['"]/)
  if (legacyKey) findings.push(`(b) ${f} writes a legacy breakdown_type literal (${legacyKey[1]}) — the driver writes the catalogue spelling only (ruling n)`)
  const legacyLevel = code.match(/entity_level\s*:\s*['"](account|campaign|ad_group|ad)['"]/)
  if (legacyLevel) findings.push(`(b) ${f} writes a legacy entity_level literal (${legacyLevel[1]})`)
  const frozen = code.match(/src\/app\/dashboard|\/api\/campaigns|\/api\/keywords|\/api\/daily|\/api\/google\/|\/api\/accounts|legacy-cohort|middleware/)
  if (frozen) findings.push(`(c) ${f} names a frozen route or file (${frozen[0]})`)
  if (/['"]LEGACY['"]/.test(code)) findings.push(`(e) ${f} still carries a 'LEGACY' slice literal — the legacy family is not the driver's`)
}
const driver = strip(read(FILES[0]))
if (driver) {
  const excl = driver.match(/export const DRIVER_EXCLUDED_CLIENTS[^\n]*=\s*(?:new Set\()?\s*\[([\s\S]*?)\]/)
  if (!excl) findings.push(`(d) ${FILES[0]} does not declare export const DRIVER_EXCLUDED_CLIENTS = [...] — the frozen demo twin has no exclusion`)
  else if (!excl[1].includes(TWIN)) findings.push(`(d) DRIVER_EXCLUDED_CLIENTS does not carry ${TWIN} (the RMF-frozen demo twin, DECISIONS:2461)`)
  const runIdx = driver.indexOf('export async function runForwardDriver')
  const body = runIdx === -1 ? '' : driver.slice(runIdx)
  const claimIdx = body.indexOf('claimUnit(')
  const exclIdx = body.indexOf('DRIVER_EXCLUDED_CLIENTS')
  if (runIdx === -1) findings.push(`(d) ${FILES[0]} does not export runForwardDriver`)
  else if (exclIdx === -1 || (claimIdx !== -1 && exclIdx > claimIdx)) findings.push(`(d) runForwardDriver does not filter DRIVER_EXCLUDED_CLIENTS before its first claimUnit( — an excluded client could be claimed`)
}
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-never-touches-legacy.guard.mjs')) findings.push('(f) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ driver-never-touches-legacy FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log(`[driver-never-touches-legacy] PASS — forward-driver*.ts import nothing from cron/sync, cron/catchup or a legacy family, write no legacy key, name no frozen route, carry no LEGACY slice, and exclude ${TWIN.slice(0, 8)} before any claim (DECISIONS:2461).`)
