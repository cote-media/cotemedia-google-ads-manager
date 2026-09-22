#!/usr/bin/env node
// LORAMER_IMPRESSION_SHARE_FAMILY_V1 (2026-09-22) — THE METRIC-FAMILY GATE LIVES ONCE, AND EVERY WALK SITE SELECTS THROUGH IT.
//
// A metric-family entry (family: { breakdownType, value, metrics }) is asked ONLY for a walk-marked connection: a legacy
// connection's impression share is the sync's (google-impression-share.ts) — one writer per surface (ruling n). The gate
// is ONE function in the writer module (selectableEntriesFor); the bare selectableEntries stays the LEGACY set so every
// count-only reader (guards, scripts, the hole map's default, the queues denominator for legacy clients) is unchanged.
//
// LEGS
//  (a) google-ads-universe-writer.ts: selectableEntries excludes family entries; selectableEntriesFor(doc, 'walk') includes
//      them and (doc, 'legacy') equals selectableEntries — driven on the REAL artifact, counts measured, never typed
//  (b) every walk site that knows its connection calls selectableEntriesFor with an engine and never the bare function:
//      universe-resume/route.ts · universe-start-publish.ts · backfill/universe-drive/route.ts · forward-driver.ts
//      (the queues route's done-signal denominator counts per client through the same function)
//  (c) the engine is read by engineOfConnection (refuses outside legacy|walk); no site defaults it
//  (d) breakdownTypeForSurface maps 'family.<type>.<value>' → <type>, and the registry generator's btFor agrees
//  (e) registered in scripts/run-guards.mjs
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Module, { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const SITES = ['src/app/api/cron/universe-resume/route.ts', 'src/lib/backfill/universe-start-publish.ts', 'src/app/api/backfill/universe-drive/route.ts', 'src/lib/backfill/forward-driver.ts', 'src/app/api/queues/google-ads-universe/route.ts']


// ── LOAD THE REAL WRITER + SURFACE OWNER + ENTITY DIMENSION, compiled to a temp dir; every OTHER '@/…' import is a stub
// (supabase, the upsert, concurrency): the functions under test are pure. Same shape as universe-derived-time.guard.mjs.
function loadWriter(ROOT) {
  const out = mkdtempSync(join(tmpdir(), 'loramer-writer-load-'))
  const files = ['src/lib/backfill/google-ads-universe-writer.ts', 'src/lib/backfill/universe-surfaces.ts', 'src/lib/backfill/entity-dimension.ts']
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [...files.map((f) => join(ROOT, f)),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
  if (r.error) throw new Error(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = new Proxy({ upsertMetricsChunked: async (rows) => ({ written: rows.length, chunks: 1 }) }, { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
  const real = { '@/lib/backfill/universe-surfaces': join(out, 'src/lib/backfill/universe-surfaces.js'), '@/lib/backfill/entity-dimension': join(out, 'src/lib/backfill/entity-dimension.js') }
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (real[request]) return real[request]
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
    return origResolve.call(this, request, ...rest)
  }
  try {
    const req = createRequire(import.meta.url)
    return { W: req(join(out, 'src/lib/backfill/google-ads-universe-writer.js')), S: req(real['@/lib/backfill/universe-surfaces']), out, done: () => rmSync(out, { recursive: true, force: true }) }
  } finally { Module._resolveFilename = origResolve }
}

// (a) the gate, driven on the real artifact through the compiled writer module
{
  let L = null
  try {
    L = loadWriter(ROOT)
    const { W, S } = L
    const doc = JSON.parse(read('docs/google-ads-capture-universe.json'))
    const legacy = W.selectableEntries(doc), forLegacy = W.selectableEntriesFor(doc, 'legacy'), walkSet = W.selectableEntriesFor(doc, 'walk')
    const fam = walkSet.filter((e) => e.family)
    if (legacy.some((e) => e.family)) findings.push(`(a) selectableEntries (the legacy set) includes ${legacy.filter((e) => e.family).length} metric-family entr(ies) — a legacy connection's family is the sync's`)
    if (forLegacy.length !== legacy.length) findings.push(`(a) selectableEntriesFor(doc,'legacy') = ${forLegacy.length} ≠ selectableEntries = ${legacy.length}`)
    if (walkSet.length !== legacy.length + fam.length) findings.push(`(a) selectableEntriesFor(doc,'walk') = ${walkSet.length} ≠ legacy ${legacy.length} + family ${fam.length}`)
    const artifactFamilies = doc.entries.filter((e) => e.family && e.delivers === true && !(Array.isArray(e.servesMetrics) && e.servesMetrics.length === 0)).length
    if (fam.length !== artifactFamilies) findings.push(`(a) the walk set carries ${fam.length} family entr(ies) but the artifact holds ${artifactFamilies} delivering ones — the gate dropped or invented a family`)
    if (fam.length === 0) findings.push(`(a) the artifact carries no delivering metric-family entry — the family was never emitted or never probed`)
    console.log(`[family-selects-by-engine] (a) legacy ${legacy.length} · walk ${walkSet.length} · family entries ${fam.length} (artifact delivering ${artifactFamilies})`)
    // (d) the mapping — the surface owner and the registry generator agree
    if (S.breakdownTypeForSurface('campaign', 'family.impression_share.search') !== 'impression_share') findings.push(`(d) breakdownTypeForSurface('campaign','family.impression_share.search') = '${S.breakdownTypeForSurface('campaign', 'family.impression_share.search')}', not 'impression_share'`)
    if (W.breakdownTypeFor({ resource: 'campaign', segment: 'family.impression_share.search', family: { breakdownType: 'impression_share', value: 'search', metrics: [] } }) !== 'impression_share') findings.push(`(d) the writer's breakdownTypeFor does not map a family entry to its breakdownType`)
    const gen = await import(`file://${resolve(ROOT, 'scripts/build-universe-registry.mjs')}`)
    if (gen.btFor({ resource: 'campaign', segment: 'family.impression_share.search', family: { breakdownType: 'impression_share', value: 'search', metrics: [] } }) !== 'impression_share') findings.push(`(d) build-universe-registry btFor does not map a family entry to its breakdownType`)
    // (a′) the family row shape, driven on a synthetic vendor row through the REAL builder
    const entry = doc.entries.find((e) => e.resource === 'campaign' && e.family?.value === 'search')
    if (entry) {
      const built = W.buildUniverseRowsAtGrain(entry, { clientId: 'c', userEmail: 'u', customerId: '123' }, [
        { segments: { date: '2026-01-02' }, campaign: { resource_name: 'customers/123/campaigns/9' }, metrics: { search_impression_share: 0.5, search_budget_lost_impression_share: -1 } },
        { segments: { date: '2026-01-02' }, campaign: { resource_name: 'customers/123/campaigns/10' }, metrics: { search_impression_share: -1 } },
      ])
      const row = built.rows[0]
      if (built.rows.length !== 1 || built.droppedNoRatio !== 1) findings.push(`(a′) family builder: expected 1 row + 1 droppedNoRatio, got ${built.rows.length} row(s) + ${built.droppedNoRatio}`)
      if (row && (row.entity_level !== 'campaign' || row.breakdown_type !== 'impression_share' || row.breakdown_value !== 'search' || row.entity_id !== '9' || row.entity_name !== null)) findings.push(`(a′) family row key is ${row?.entity_level}/${row?.breakdown_type}/${row?.breakdown_value} entity ${row?.entity_id} name ${row?.entity_name} — expected campaign/impression_share/search, bare id 9, null name`)
      if (row && (row.extra.search_impression_share !== 0.5 || row.extra.search_budget_lost_impression_share !== null || row.spend !== 0)) findings.push(`(a′) family row values: ratio ${row?.extra?.search_impression_share}, -1 → ${row?.extra?.search_budget_lost_impression_share} (must be null), spend ${row?.spend} (must be 0)`)
      if (row && Object.keys(row.extra).some((k) => /^(roas|cpa|cpc|ctr|cvr)$/.test(k))) findings.push(`(a′) family row carries derived spend ratios — a spend-based ratio over zero counts is not a fact`)
    }
  } catch (e) { findings.push(`(a) the writer could not be compiled or driven: ${e.message}`) }
  finally { if (L) L.done() }
}

// (b)+(c) the callers
for (const site of SITES) {
  const src = strip(read(site))
  if (!src) { findings.push(`(b) ${site} does not exist`); continue }
  if (!/selectableEntriesFor\(/.test(src)) findings.push(`(b) ${site} does not select through selectableEntriesFor — the family gate would be bypassed or copied`)
  if (/\bselectableEntries\(/.test(src.replace(/selectableEntriesFor\(/g, ''))) findings.push(`(b) ${site} still calls the bare selectableEntries — a walk connection would never be asked its metric families here`)
  if (!/engineOfConnection\(/.test(src) && !(/forward-driver/.test(site) && /DRIVER_ENGINES\.has\(/.test(src) && /REFUSED/.test(src))) findings.push(`(c) ${site} does not read the engine through engineOfConnection (the driver may use its own pinned DRIVER_ENGINES refusal) — a defaulted engine is indistinguishable from one the caller read`)
}
const writer = strip(read(WRITER))
if (!/export function engineOfConnection/.test(writer)) findings.push(`(c) ${WRITER} does not export engineOfConnection`)
if (!/throw new Error\([^)]*not legacy\|walk/.test(writer)) findings.push(`(c) engineOfConnection does not refuse a value outside legacy|walk`)

// (e)
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/family-selects-by-engine.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) { console.error('✗ family-selects-by-engine FAILED:'); for (const f of findings) console.error('  ' + f); process.exit(1) }
console.log('[family-selects-by-engine] PASS — one family gate (selectableEntriesFor) in the writer; the legacy set excludes metric families, the walk set adds exactly the artifact\'s delivering ones; every walk site selects through it with engineOfConnection; the surface owner and the registry generator map a family key to its breakdown_type (LORAMER_IMPRESSION_SHARE_FAMILY_V1).')
