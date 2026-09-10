#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 — THE DRIVER ASKS THE CATALOGUE MINUS THE ALIAS-COVERED AND THE LEGACY-ASKED SURFACES.
//
// DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (n): ONE WRITER PER SURFACE, no row written twice. The 16 DRAIN_ALIAS
// keys (4 identity + 12 geo aliases, universe-surfaces.ts) and the 14 catalogue surfaces the legacy family asks
// (FORWARD_PRODUCER_SURFACES) already have a writer; the driver's catalogue slices exclude both. MEASURED 2026-09-10
// (Gate-A, Escential): selectable 349 − 16 alias-covered − 14 legacy-asked = 319 = HEAVY 50 + REST 269.
//
// LEGS — the pure selection is driven with the REAL catalogue artifact and stubbed alias/legacy predicates:
//  (a) src/lib/backfill/forward-driver-slices.ts compiles standalone and exports selectDriverSurfaces + sliceOf
//  (b) with 16 alias keys and the 14 legacy keys stubbed in, the selection excludes every one of them
//  (c) the counts are 50 HEAVY + 269 REST on docs/google-ads-capture-universe.json (N=319) (a drift here is a catalogue
//      change and must be re-measured, never silently absorbed)
//  (d) forward-driver.ts wires the alias predicate to drainAliasFor(surfaceOfEntry(e)) and the legacy predicate to
//      FORWARD_PRODUCER_SURFACES — the pure module never guesses at either
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
const ALIAS_KEYS = [
  'campaign|', 'ad_group|', 'ad_group_ad|', 'customer|',
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
      const entries = doc.entries.filter((e) => e.delivers === true)
      const key = (e) => `${e.resource}|${e.segment ?? ''}`
      const alias = new Set(ALIAS_KEYS), legacy = new Set(LEGACY_KEYS)
      const sel = M.selectDriverSurfaces(entries, (e) => alias.has(key(e)), legacy)
      const leaked = sel.filter((e) => alias.has(key(e)) || legacy.has(key(e))).map(key)
      if (leaked.length) findings.push(`(b) selectDriverSurfaces let ${leaked.length} alias-covered / legacy-asked surface(s) through: ${leaked.slice(0, 6).join(' · ')}${leaked.length > 6 ? ' …' : ''} — a second writer on a surface (ruling n)`)
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
      if (hv !== 50 || rs !== 269) findings.push(`(c) the driver catalogue reads HEAVY ${hv} · REST ${rs} on the current artifact; Gate-A 2026-09-10 measured 50 · 269 (N=319: the five search-term/landing resources incl. search_term_view's 9 segments) — the catalogue moved; re-measure before trusting the slice map`)
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
}

const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-skips-alias-covered.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ driver-skips-alias-covered FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log('[driver-skips-alias-covered] PASS — selectDriverSurfaces excludes all 16 alias-covered and 14 legacy-asked keys on the real catalogue; HEAVY 50 · REST 269 (N=319, Gate-A 2026-09-10); the driver wires the predicate through surfaceOfEntry → drainAliasFor and FORWARD_PRODUCER_SURFACES.')
