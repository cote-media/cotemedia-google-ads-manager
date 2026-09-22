#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 — THE DRIVER ASKS THE CATALOGUE MINUS THE ALIAS-COVERED AND THE LEGACY-ASKED SURFACES.
//
// DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (n): ONE WRITER PER SURFACE, no row written twice. The 12 DRAIN_ALIAS
// keys (the geo aliases, universe-surfaces.ts) and the 14 catalogue surfaces the legacy family asks
// (FORWARD_PRODUCER_SURFACES) already have a writer; the driver's catalogue slices exclude both. MEASURED 2026-09-10
// (Gate-A, Escential): selectable 349 − 16 alias-covered − 14 legacy-asked = 319 = HEAVY 50 + REST 269.
// LORAMER_WALK_BASE_DEALIAS_V1 (2026-09-12): the four base spellings (campaign| · ad_group| · ad_group_ad| · customer|)
// left the alias map; ruling (n) amended — they are TWO-WRITER-TWO-KEY (forward at '', the driver at the walk
// spelling), so the driver subtracts DEALIASED_BASE_SURFACES from its legacy exclusion: 349 − 12 − 14 = 323 = 50 + 273.
//
// LEGS — the pure selection is driven with the REAL catalogue artifact and stubbed alias/legacy predicates:
//  (a) src/lib/backfill/forward-driver-slices.ts compiles standalone and exports selectDriverSurfaces + sliceOf
//  (b) with the 12 alias keys and the 14 legacy keys stubbed in, the selection excludes every one of them — and the
//      four de-aliased bases are SELECTED (a base that still hides behind the legacy exclusion is the 2026-09-12 defect)
//  (c) the counts are 50 HEAVY + 273 REST on docs/google-ads-capture-universe.json (N=323) (a drift here is a catalogue
//      change and must be re-measured, never silently absorbed)
//  (d) forward-driver.ts wires the alias predicate to drainAliasFor(surfaceOfEntry(e)) and the legacy predicate to
//      FORWARD_PRODUCER_SURFACES — the pure module never guesses at either
//  (f) the driver's pending-set read (forward-observation-log.ts readSliceObservationState) counts only producers
//      like 'driver-%' — never another family's observations (LORAMER_DRIVER_PENDING_OWN_PRODUCER_V1)
//  (e) registered in scripts/run-guards.mjs
//  (c′) LORAMER_DRIVER_CATALOGUE_PER_ENGINE_V1 (2026-09-22): driven with the WALK predicates (no alias, no legacy exclusion)
//      the selection is EVERY strict-selectable entry — the count is measured from the artifact, never typed — and it
//      exceeds the legacy count by exactly the alias + legacy key sets the artifact actually carries
//  (d′) forward-driver.ts driverCatalogue takes the engine (no default), its walk branch carries `() => false` and
//      `new Set<string>()`, and the call site reads conn.engine and REFUSES any value outside legacy|walk
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
const DEALIASED_BASE_KEYS = ['campaign|', 'ad_group|', 'ad_group_ad|', 'customer|'] // LORAMER_WALK_BASE_DEALIAS_V1
const ALIAS_KEYS = [
  'geographic_view|segments.geo_target_city', 'geographic_view|segments.geo_target_metro', 'geographic_view|segments.geo_target_region',
  'geographic_view|segments.geo_target_state', 'geographic_view|segments.geo_target_county', 'geographic_view|segments.geo_target_postal_code',
  'geographic_view|segments.geo_target_most_specific_location', 'user_location_view|segments.geo_target_metro',
  'user_location_view|segments.geo_target_region', 'user_location_view|segments.geo_target_state',
  'user_location_view|segments.geo_target_district', 'user_location_view|segments.geo_target_province',
]
const LEGACY_KEYS = [
  'ad_group|segments.device', 'ad_group|segments.hour', 'ad_group_ad|segments.device', 'age_range_view|', 'campaign|segments.device',
  'campaign|segments.hour', 'gender_view|', 'geographic_view|', 'geographic_view|segments.geo_target_district', 'keyword_view|',
  'keyword_view|segments.device', 'search_term_view|', 'user_location_view|segments.geo_target_city', 'user_location_view|segments.geo_target_county',
]

if (!read(SLICES)) findings.push(`(a) ${SLICES} does not exist — the driver's pure slice selection has not been built`)
else {
  const out = mkdtempSync(join(tmpdir(), 'loramer-driver-slices-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
      resolve(ROOT, SLICES), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
      '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
    ], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const M = createRequire(import.meta.url)(join(out, 'src/lib/backfill/forward-driver-slices.js'))
    if (typeof M.selectDriverSurfaces !== 'function' || typeof M.sliceOf !== 'function') findings.push(`(a) ${SLICES} does not export selectDriverSurfaces and sliceOf`)
    else {
      const doc = JSON.parse(read('docs/google-ads-capture-universe.json'))
      // the same selectable filter the writer applies, restated minimally: the guard needs only that the alias/legacy
      // exclusion holds on every entry the driver could be handed
      // LORAMER_IMPRESSION_SHARE_FAMILY_V1 — metric-family entries select for WALK connections only (family-selects-by-engine
      // guard pins the gate); the legacy legs below restate the legacy set, so they exclude `family`; (c′) adds them back.
      const entriesAll = doc.entries.filter((e) => e.delivers === true)
      const entries = entriesAll.filter((e) => !e.family)
      const key = (e) => `${e.resource}|${e.segment ?? ''}`
      const alias = new Set(ALIAS_KEYS), legacy = new Set(LEGACY_KEYS)
      const sel = M.selectDriverSurfaces(entries, (e) => alias.has(key(e)), legacy)
      const leaked = sel.filter((e) => alias.has(key(e)) || legacy.has(key(e))).map(key)
      if (leaked.length) findings.push(`(b) selectDriverSurfaces let ${leaked.length} alias-covered / legacy-asked surface(s) through: ${leaked.slice(0, 6).join(' · ')}${leaked.length > 6 ? ' …' : ''} — a second writer on a surface (ruling n)`)
      // LORAMER_WALK_BASE_DEALIAS_V1 — the four bases must be SELECTED once the driver subtracts them from its legacy exclusion.
      const selKeys = new Set(sel.map(key))
      const missingBase = DEALIASED_BASE_KEYS.filter((k) => !selKeys.has(k))
      if (missingBase.length) findings.push(`(b) the de-aliased base surface(s) ${missingBase.join(' · ')} are NOT selected — the driver would leave them to forward's '' writer and the lookback lane would have no walk rows to restate (LORAMER_WALK_BASE_DEALIAS_V1)`)
      const driverSrc = strip(read(DRIVER))
      if (!/DEALIASED_BASE_SURFACES/.test(driverSrc)) findings.push(`(d) ${DRIVER} does not subtract DEALIASED_BASE_SURFACES from its legacy exclusion — the four bases would stay legacy-only (LORAMER_WALK_BASE_DEALIAS_V1)`)
      // LORAMER_DRIVER_PENDING_OWN_PRODUCER_V1 (2026-09-12) — the pending-set read counts ONLY the driver's own producers. Seen live:
      // the 21:30Z fire read the legacy family's window_end observations of the four bases as its own ("273/273 observed") while
      // the ledger held 0 driver-observed bases. The filter must sit on the window_end read inside readSliceObservationState.
      const OBS_MODULE = 'src/lib/backfill/forward-observation-log.ts'
      const obsSrc = strip(read(OBS_MODULE))
      const fnStart = obsSrc.indexOf('export async function readSliceObservationState')
      const fnBody = fnStart >= 0 ? obsSrc.slice(fnStart, obsSrc.indexOf('return { observedAtWindowEnd', fnStart)) : ''
      const atEndRead = fnBody.slice(fnBody.indexOf(".eq('window_end'"), fnBody.indexOf("if (e1)"))
      if (fnStart < 0) findings.push(`(f) ${OBS_MODULE} no longer exports readSliceObservationState — the driver's pending predicate moved`)
      else if (!/\.like\('producer',\s*`\$\{DRIVER_PRODUCER_PREFIX\}%`\)/.test(atEndRead)) findings.push(`(f) ${OBS_MODULE} readSliceObservationState's window_end read carries no producer filter — the driver derives "already observed" from other families' records and skips its own catalogue (LORAMER_DRIVER_PENDING_OWN_PRODUCER_V1)`)
      const heavy = sel.filter((e) => M.sliceOf(e) === 'HEAVY').length, rest = sel.filter((e) => M.sliceOf(e) === 'REST').length
      const other = sel.length - heavy - rest
      if (other) findings.push(`(c) ${other} selected surface(s) fall in neither HEAVY nor REST — every driver surface belongs to exactly one slice`)
      // (c) the measured counts, on exactly the entries selectableEntries admits — the writer's filter restated term for
      // term (delivers · date-combinable · not a derived time segment · not DEFERRED · serves ≥1 metric); DEFERRED keys are
      // read from the writer's own source so this guard never carries a copy of that list
      const DERIVED = new Set(['segments.date', 'segments.week', 'segments.month', 'segments.quarter', 'segments.year', 'segments.day_of_week'])
      const writerSrc = read('src/lib/backfill/google-ads-universe-writer.ts')
      const defBlock = writerSrc.slice(writerSrc.indexOf('export const DEFERRED_ENTRIES'), writerSrc.indexOf('export const servesNoMetrics'))
      const DEFERRED = new Set([...defBlock.matchAll(/'([a-z_]+\|[a-z_.]*)'\s*:/g)].map((m) => m[1]))
      if (DEFERRED.size === 0) findings.push('(c) could not read DEFERRED_ENTRIES keys from the writer — the count leg cannot run')
      const strict = sel.filter((e) => (e.segment === null || e.dateCombinable === true) && !(e.segment && DERIVED.has(e.segment))
        && !DEFERRED.has(key(e)) && !(Array.isArray(e.servesMetrics) && e.servesMetrics.length === 0))
      const hv = strict.filter((e) => M.sliceOf(e) === 'HEAVY').length, rs = strict.filter((e) => M.sliceOf(e) === 'REST').length
      if (hv !== 50 || rs !== 273) findings.push(`(c) the driver catalogue reads HEAVY ${hv} · REST ${rs} on the current artifact; Gate-A 2026-09-10 measured 50 · 269 (N=319) and LORAMER_WALK_BASE_DEALIAS_V1 2026-09-12 re-measured 50 · 273 (N=323: + the four de-aliased bases, all REST) — the catalogue moved; re-measure before trusting the slice map`)
      // (c′) LORAMER_DRIVER_CATALOGUE_PER_ENGINE_V1 — the WALK catalogue: no alias, no legacy exclusion → every entry.
      const strictAll = entriesAll.filter((e) => (e.segment === null || e.dateCombinable === true) && !(e.segment && DERIVED.has(e.segment))
        && !DEFERRED.has(key(e)) && !(Array.isArray(e.servesMetrics) && e.servesMetrics.length === 0))
      const familyInArtifact = strictAll.filter((e) => e.family).length
      const walkSel = M.selectDriverSurfaces(strictAll, () => false, new Set())
      const walkKeys = new Set(walkSel.map(key))
      const aliasInArtifact = strictAll.filter((e) => alias.has(key(e))).length
      const legacyInArtifact = strictAll.filter((e) => legacy.has(key(e)) && !DEALIASED_BASE_KEYS.includes(key(e))).length
      if (walkSel.length !== strictAll.length) findings.push(`(c′) the walk catalogue selects ${walkSel.length} of ${strictAll.length} strict-selectable entries — a walk connection has no other writer, so NOTHING may be excluded`)
      if (walkSel.length !== strict.length + aliasInArtifact + legacyInArtifact + familyInArtifact) findings.push(`(c′) walk ${walkSel.length} ≠ legacy ${strict.length} + alias ${aliasInArtifact} + legacy-asked ${legacyInArtifact} + family ${familyInArtifact} — the two catalogues differ by something other than the alias, legacy and family sets`)
      for (const k of [...ALIAS_KEYS, ...LEGACY_KEYS]) if (strictAll.some((e) => key(e) === k) && !walkKeys.has(k)) findings.push(`(c′) walk catalogue omits ${k}`)
      console.log(`[driver-skips-alias-covered] (c′) walk catalogue = ${walkSel.length} (legacy ${strict.length} + alias ${aliasInArtifact} + legacy-asked ${legacyInArtifact} + family ${familyInArtifact}; HEAVY ${walkSel.filter((e) => M.sliceOf(e) === 'HEAVY').length} · REST ${walkSel.filter((e) => M.sliceOf(e) === 'REST').length})`)
    }
  } catch (e) { findings.push(`(a) ${SLICES} could not be compiled or driven: ${e.message}`) }
  finally { rmSync(out, { recursive: true, force: true }) }
}

const driver = strip(read(DRIVER))
if (!driver) findings.push(`(d) ${DRIVER} does not exist`)
else {
  const callIdx = driver.indexOf('selectDriverSurfaces(')
  const call = callIdx === -1 ? '' : driver.slice(callIdx, callIdx + 600)
  if (!call || !/surfaceOfEntry\s*\(/.test(call) || !/drainAliasFor\s*\(/.test(call)) findings.push(`(d) ${DRIVER} does not wire selectDriverSurfaces' alias predicate through surfaceOfEntry(e) → drainAliasFor(entityLevel, breakdownType) — the driver must ask the registry, never a copied key list`)
  if (!/FORWARD_PRODUCER_SURFACES/.test(driver)) findings.push(`(d) ${DRIVER} does not derive the legacy-asked set from FORWARD_PRODUCER_SURFACES`)
  // (d′) LORAMER_DRIVER_CATALOGUE_PER_ENGINE_V1 — the catalogue is chosen by the CONNECTION's engine, read from its row.
  const sig = driver.match(/export function driverCatalogue\(([^)]*)\)/)
  if (!sig) findings.push(`(d′) ${DRIVER} no longer exports driverCatalogue`)
  else {
    if (!/^\s*engine\s*:\s*DriverEngine\s*,/.test(sig[1])) findings.push(`(d′) driverCatalogue's first parameter must be \`engine: DriverEngine\` with NO default — read \`(${sig[1].trim()})\`; a defaulted engine is indistinguishable from one the caller read`)
    const body = driver.slice(driver.indexOf('export function driverCatalogue'), driver.indexOf('export async function runForwardDriver'))
    if (!/engine === 'walk'\s*\?\s*selectDriverSurfaces\(\s*selectable\s*,\s*\(\)\s*=>\s*false\s*,\s*new Set<string>\(\)\s*\)/.test(body)) findings.push(`(d′) driverCatalogue's walk branch must select with NO alias predicate (\`() => false\`) and NO legacy keys (\`new Set<string>()\`) — a walk connection has no other writer for the 12 alias twins or the 14 legacy-asked surfaces`)
  }
  const run = driver.slice(driver.indexOf('export async function runForwardDriver'))
  if (!/catalogues\[engine\]/.test(run)) findings.push(`(d′) runForwardDriver does not pick the catalogue by the connection's engine (\`catalogues[engine]\`)`)
  if (!/conn\.engine/.test(run)) findings.push(`(d′) runForwardDriver does not read \`conn.engine\` from the platform_connections(*) row`)
  if (!/DRIVER_ENGINES\.has\(/.test(run) || !/REFUSED/.test(run) || !/refusedConnections\.push/.test(run)) findings.push(`(d′) runForwardDriver must REFUSE and record a connection whose engine is outside legacy|walk (DRIVER_ENGINES.has → refusedConnections.push) — never default it`)
  if (/driverCatalogue\(\s*\)/.test(run)) findings.push(`(d′) runForwardDriver calls driverCatalogue() with no engine`)
}

const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-skips-alias-covered.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ driver-skips-alias-covered FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log('[driver-skips-alias-covered] PASS — selectDriverSurfaces excludes all 12 alias-covered and 14 legacy-asked keys and selects the 4 de-aliased bases on the real catalogue; LEGACY HEAVY 50 · REST 273 (N=323, LORAMER_WALK_BASE_DEALIAS_V1 2026-09-12 over Gate-A 2026-09-10 at 50 · 269); WALK = every strict-selectable entry, measured (c′); the driver wires the predicate through surfaceOfEntry → drainAliasFor and FORWARD_PRODUCER_SURFACES and picks the catalogue by conn.engine, refusing anything outside legacy|walk (d′, LORAMER_DRIVER_CATALOGUE_PER_ENGINE_V1).')
