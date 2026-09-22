#!/usr/bin/env node
// LORAMER_DRIVER_SETTINGS_WRITER_V1 (2026-09-22) — THE FORWARD DRIVER WRITES THE ENTITY-STATE SLICE FOR WALK CONNECTIONS ONLY,
// FROM ITS OWN TWO QUERIES, THROUGH THE INTELLIGENCE MODULE'S EXPORTED NORMALISERS. ONE TABLE, ONE SHAPE.
//
// WHY A GUARD: round 11 measured the raw vendor rows — status '3', channel '2' — against the stored rows — 'paused',
// 'Search' — and named a second spelling one copy away. Round 13 proved the exported-normaliser path identical to the
// sync's (177/177 facts, Bath Fitter). This guard keeps the driver on that path and off the legacy connections.
//
// LEGS
//  (a) forward-driver.ts calls persistEntityState with mode 'driver' INSIDE an `engine === 'walk'` branch, and nowhere else
//  (b) driver-settings.ts selects campaign.primary_status and maps through computeCampaignStatus + normalizeChannelTypeValue —
//      no local status map, no ordinal literal ('2'|'3'|'4'|'5' quoted) in the driver or its settings module
//  (c) the two GAQL clauses are the intel's: campaign WHERE status != 'REMOVED' (fields ⊆ the intel's enriched campaign
//      query) and the conversion_action query is the intel's exported CONVERSION_ACTION_ATTRIBUTE_GAQL, imported — never a copy
//  (d) google-intelligence.ts exports normalizeStatus, normalizePrimaryStatus, computeCampaignStatus
//  (e) registered in scripts/run-guards.mjs
//  (f) a failed query REFUSES the pass and records it (recordEntityStatePassError) — no toggle-only fallback in the driver path
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const DRIVER = 'src/lib/backfill/forward-driver.ts'
const SETTINGS = 'src/lib/backfill/driver-settings.ts'
const INTEL = 'src/lib/intelligence/google-intelligence.ts'
const ESH = 'src/lib/capture/entity-state-history.ts'

const driver = strip(read(DRIVER)), settings = strip(read(SETTINGS)), intel = read(INTEL), esh = strip(read(ESH))
if (!driver) findings.push(`(a) ${DRIVER} does not exist`)
if (!settings) findings.push(`(b) ${SETTINGS} does not exist — the driver's settings mapping has not been built`)
if (!intel) findings.push(`(d) ${INTEL} does not exist`)

// (a) persistEntityState(mode 'driver') only inside the walk branch
if (driver) {
  const calls = [...driver.matchAll(/persistEntityState\(\{[^}]*mode:\s*'([a-z]+)'/g)]
  if (calls.length === 0) findings.push(`(a) ${DRIVER} never calls persistEntityState with a mode — the walk connections' entity-state slice has no writer`)
  for (const c of calls) {
    if (c[1] !== 'driver') findings.push(`(a) ${DRIVER} calls persistEntityState with mode '${c[1]}' — the driver's pass is mode 'driver'`)
    const before = driver.slice(0, c.index)
    const branch = before.lastIndexOf("engine === 'walk'")
    const legacyBranch = before.lastIndexOf("engine === 'legacy'")
    if (branch === -1 || legacyBranch > branch) findings.push(`(a) ${DRIVER} calls persistEntityState outside an \`engine === 'walk'\` branch — a legacy connection's slice is the sync's (one writer per surface, ruling n)`)
  }
}

// (b) the mapping goes through the exported normalisers; no local status map, no ordinal literals
if (settings) {
  if (!/campaign\.primary_status/.test(settings)) findings.push(`(b) ${SETTINGS} does not select campaign.primary_status — 'ended' exists only through it (77 stored rows fleet-wide, 2026-09-22)`)
  if (!/computeCampaignStatus\(/.test(settings)) findings.push(`(b) ${SETTINGS} does not map status through computeCampaignStatus`)
  if (!/normalizeChannelTypeValue\(/.test(settings)) findings.push(`(b) ${SETTINGS} does not map channel type through normalizeChannelTypeValue`)
  if (!/from '@\/lib\/intelligence\/google-intelligence'/.test(settings)) findings.push(`(b) ${SETTINGS} does not import the normalisers from the intelligence module — a local copy is a second spelling`)
  for (const src of [[SETTINGS, settings], [DRIVER, driver]]) {
    const literals = [...src[1].matchAll(/['"](?:ENABLED|PAUSED|ENDED|ELIGIBLE)['"]\s*:|['"][2-9]['"]\s*:/g)]
    if (literals.length) findings.push(`(b) ${src[0]} carries a local status/ordinal map (${literals.length} entr(ies)) — the normalisers live in ${INTEL} and are imported, never copied`)
  }
}

// (c) the clauses are the intel's
if (settings && intel) {
  const campWhere = /WHERE campaign\.status != 'REMOVED'/.test(settings)
  if (!campWhere) findings.push(`(c) ${SETTINGS} campaign query does not carry WHERE campaign.status != 'REMOVED' (the intel's filter, google-intelligence.ts campaignQuery)`)
  const campGaql = settings.match(/DRIVER_CAMPAIGN_SETTINGS_GAQL\s*=\s*`SELECT ([^`]*) FROM campaign/)
  if (!campGaql) findings.push(`(c) ${SETTINGS} does not export DRIVER_CAMPAIGN_SETTINGS_GAQL as SELECT … FROM campaign`)
  else {
    const fields = campGaql[1].split(',').map((f) => f.trim())
    const intelFields = new Set(['campaign.primary_status', ...(intel.match(/CAMPAIGN_BASE_FIELDS = `([^`]*)`/)?.[1] ?? '').split(',').map((f) => f.trim())])
    for (const f of fields) if (!intelFields.has(f)) findings.push(`(c) ${SETTINGS} campaign query selects ${f}, which the intel's enriched campaign query does not — the field list is the intel's or nothing`)
    for (const need of ['campaign.id', 'campaign.status', 'campaign.primary_status', 'campaign.advertising_channel_type']) if (!fields.includes(need)) findings.push(`(c) ${SETTINGS} campaign query is missing ${need}`)
  }
  // The repo carries exactly ONE `FROM conversion_action` template (conversion-action-attribute-only guard, in the intel module);
  // the driver asks the identical question by IMPORTING it, never by carrying a copy.
  if (/FROM\s+conversion_action/.test(settings.replace(/\/\/.*$/gm, ''))) findings.push(`(c) ${SETTINGS} carries its own FROM conversion_action template — import CONVERSION_ACTION_ATTRIBUTE_GAQL from ${INTEL} instead (one template, one pin)`)
  if (!/CONVERSION_ACTION_ATTRIBUTE_GAQL/.test(settings) || !/DRIVER_CONVERSION_ACTION_GAQL\s*=\s*CONVERSION_ACTION_ATTRIBUTE_GAQL/.test(settings)) findings.push(`(c) ${SETTINGS} does not bind DRIVER_CONVERSION_ACTION_GAQL to the intel's exported CONVERSION_ACTION_ATTRIBUTE_GAQL`)
  if (!/export const CONVERSION_ACTION_ATTRIBUTE_GAQL = `\s*SELECT conversion_action\.id,[\s\S]*?FROM conversion_action\s*WHERE conversion_action\.status = 'ENABLED'\s*`/.test(intel)) findings.push(`(c) ${INTEL} does not export CONVERSION_ACTION_ATTRIBUTE_GAQL as the attribute-only SELECT … WHERE status = 'ENABLED'`)
}

// (d) the exports
if (intel) {
  const exp = intel.match(/^export \{([^}]*)\}/m)
  const names = new Set((exp?.[1] ?? '').split(',').map((n) => n.trim()))
  for (const n of ['normalizeStatus', 'normalizePrimaryStatus', 'computeCampaignStatus']) if (!names.has(n)) findings.push(`(d) ${INTEL} does not export ${n}`)
}

// (f) refusal path, no fallback
if (driver) {
  if (!/recordEntityStatePassError\(/.test(driver)) findings.push(`(f) ${DRIVER} does not record a refused settings pass (recordEntityStatePassError) — "we could not look" would be silent`)
  if (!/export async function recordEntityStatePassError/.test(esh)) findings.push(`(f) ${ESH} does not export recordEntityStatePassError`)
  if (/toggle|CAMPAIGN_BASE_FIELDS\)/.test(driver + settings)) findings.push(`(f) the driver path carries a toggle-only fallback — a degraded status is a second shape; the pass is refused instead`)
}

// (e) registration
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-settings-writer.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ driver-settings-writer FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log('[driver-settings-writer] PASS — forward-driver.ts persists the entity-state slice with mode \'driver\' inside the walk branch only; driver-settings.ts selects campaign.primary_status and maps through the intel\'s exported computeCampaignStatus + normalizeChannelTypeValue with no local map; both GAQL clauses are the intel\'s; a failed query refuses and records the pass (LORAMER_DRIVER_SETTINGS_WRITER_V1).')
