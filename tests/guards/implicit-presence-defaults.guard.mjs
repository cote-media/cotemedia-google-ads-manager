#!/usr/bin/env node
// LORAMER_IMPLICIT_PRESENCE_REASK_V1 (2026-09-24, round 50) — A FALSE THAT ARRIVES ABSENT IS STILL A VALUE.
//
// WHY. proto3 does not serialise a scalar set to its default; a nested `bool` without `optional` (implicit presence) arrives as a
// MISSING field when false. google/ads/googleads/v23/common/segments.proto:606 `bool interaction_on_this_asset = 2;` is the one such
// field the walk selects; the writer read the missing leaf as '' and dropped the row as "no segment value" — half the rows on five
// entries, the half holding the interactions (Tri-Copy July 2025: false clicks 5,789 vs true 302). Two legs:
//   (a) the compiled aggregation, driven with the two raw rows Google returned on 2026-09-24, lands BOTH sides;
//   (b) the shipped proto is parsed for every catalogue segment; any implicit-presence bool missing from the writer's
//       IMPLICIT_PRESENCE_DEFAULTS table is a finding — the table cannot drift behind the schema the client ships.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync, execSync } from 'node:child_process'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
function loadWriter() {
  const out = mkdtempSync(join(tmpdir(), 'ipd-writer-'))
  const files = ['src/lib/backfill/google-ads-universe-writer.ts', 'src/lib/backfill/universe-surfaces.ts', 'src/lib/backfill/entity-dimension.ts']
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [...files.map((f) => join(ROOT, f)), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--outDir', out, '--rootDir', ROOT], { encoding: 'utf8' })
  if (r.error) throw new Error(r.error.message)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
  const real = { '@/lib/backfill/universe-surfaces': join(out, 'src/lib/backfill/universe-surfaces.js'), '@/lib/backfill/entity-dimension': join(out, 'src/lib/backfill/entity-dimension.js') }
  const orig = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) { if (real[request]) return real[request]; if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub; return orig.call(this, request, ...rest) }
  try { return { W: createRequire(import.meta.url)(join(out, 'src/lib/backfill/google-ads-universe-writer.js')), done: () => rmSync(out, { recursive: true, force: true }) } } finally { Module._resolveFilename = orig }
}
let W, done = () => {}
try { ({ W, done } = loadWriter()) } catch (e) { findings.push(`CANNOT COMPILE the writer: ${e.message}`) }
if (W) {
  // (a) both sides land
  const doc = W.loadUniverse(ROOT)
  const entry = W.selectableEntriesFor(doc, 'walk').find((e) => e.resource === 'campaign' && e.segment === 'segments.asset_interaction_target.interaction_on_this_asset')
  if (!entry) findings.push('(a) the catalogue no longer carries campaign / segments.asset_interaction_target.interaction_on_this_asset')
  else {
    // WHY LITERAL IDS: these are the two raw rows Google returned on 2026-09-24 for Bath Fitter (customer 6871055643), the measured
    // fixture of the drop; the client uuid is the all-zero placeholder — this guard never reads the ledger or the registry.
    const rows = [
      { segments: { date: '2025-07-01', asset_interaction_target: { asset: 'customers/6871055643/assets/36994929532' } }, campaign: { resource_name: 'customers/6871055643/campaigns/1' }, metrics: { impressions: 58, clicks: 9, cost_micros: 1000000, conversions: 0, conversions_value: 0 } }, // fixture: the raw rows Google returned 2026-09-24 for Bath Fitter (customer 6871055643) — the measured drop; the uuid is the all-zero placeholder
      { segments: { date: '2025-07-01', asset_interaction_target: { asset: 'customers/6871055643/assets/36994929532', interaction_on_this_asset: true } }, campaign: { resource_name: 'customers/6871055643/campaigns/1' }, metrics: { impressions: 58, clicks: 0, cost_micros: 0, conversions: 0, conversions_value: 0 } }, // fixture: the raw rows Google returned 2026-09-24 for Bath Fitter (customer 6871055643) — the measured drop; the uuid is the all-zero placeholder
      { segments: { date: '2025-07-01' }, campaign: { resource_name: 'customers/6871055643/campaigns/1' }, metrics: { impressions: 1, clicks: 1, cost_micros: 0, conversions: 0, conversions_value: 0 } }, // fixture: the raw rows Google returned 2026-09-24 for Bath Fitter (customer 6871055643) — the measured drop; the uuid is the all-zero placeholder
    ]
    let built
    try { built = W.buildUniverseRowsAtGrain(entry, { clientId: '00000000-0000-0000-0000-000000000000', userEmail: 'guard@example.com', customerId: '6871055643' }, rows) } catch (e) { findings.push(`(a) buildUniverseRowsAtGrain threw: ${e.message}`) } // fixture: the raw rows Google returned 2026-09-24 for Bath Fitter (customer 6871055643) — the measured drop; the uuid is the all-zero placeholder
    const out = built?.rows ?? built?.out ?? (Array.isArray(built) ? built : [])
    const byVal = new Map(out.map((r) => [String(r.breakdown_value), r]))
    if (!byVal.has('true') || Number(byVal.get('true')?.clicks) !== 0) findings.push(`(a) the TRUE side did not land with clicks 0 — got ${JSON.stringify([...byVal.keys()])}`)
    if (!byVal.has('false') || Number(byVal.get('false')?.clicks) !== 9) findings.push(`(a) ⛔ the FALSE side did not land with clicks 9 — the absent implicit-presence bool is being dropped as noise; got values ${JSON.stringify([...byVal.keys()])}`)
    if (out.length !== 2) findings.push(`(a) expected exactly 2 rows (true, false) — a row with NO parent message must stay noise; got ${out.length}`)
  }
  // (b) the proto scan
  // every common/*.proto of the shipped v23 — nested segment messages (Keyword → KeywordInfo) live in criteria.proto
  const protos = execSync("find node_modules/google-ads-node -path '*v23/common/*.proto'", { cwd: ROOT }).toString().trim().split('\n').filter(Boolean)
  if (!protos.some((p) => p.endsWith('segments.proto'))) findings.push('(b) segments.proto (v23) not found under node_modules/google-ads-node')
  else {
    const messages = {}
    for (const P of protos) {
      const src = readFileSync(resolve(ROOT, P), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\[[^\]]*\]/g, '')
      const re = /message\s+(\w+)\s*\{([^{}]*)\}/g; let m
      while ((m = re.exec(src))) { const f = messages[m[1]] ?? {}; const fr = /(optional\s+)?([\w.]+)\s+(\w+)\s*=\s*\d+\s*;/g; let x; while ((x = fr.exec(m[2]))) f[x[3]] = { optional: !!x[1], type: x[2].split('.').pop() }; messages[m[1]] = f }
    }
    const table = W.IMPLICIT_PRESENCE_DEFAULTS ?? {}
    const segs = [...new Set(W.selectableEntriesFor(doc, 'walk').map((e) => e.segment).filter((s) => s && s.startsWith('segments.')))]
    let implicitBools = 0, unresolved = []
    for (const s of segs) {
      const path = s.replace(/^segments\./, '').split('.'); let msg = 'Segments', field = null
      for (const k of path) { field = messages[msg]?.[k]; if (!field) break; if (messages[field.type]) msg = field.type }
      if (!field) { unresolved.push(s); continue }
      if (field.type === 'bool' && !field.optional) { implicitBools++; if (!table[s.replace(/^segments\./, '')]) findings.push(`(b) ⛔ ${s} is an implicit-presence bool in the shipped proto and IMPLICIT_PRESENCE_DEFAULTS has no entry for it — its false side is being dropped`) }
    }
    if (unresolved.length) findings.push(`(b) ${unresolved.length} catalogue segment(s) could not be resolved in segments.proto: ${unresolved.slice(0, 6).join(', ')} — the scan must cover every selected segment`)
    for (const k of Object.keys(table)) if (!segs.includes('segments.' + k)) findings.push(`(b) IMPLICIT_PRESENCE_DEFAULTS names ${k}, which no walk entry selects — a stale table entry`)
    if (!findings.length) console.log(`[implicit-presence-defaults] proto scan: ${segs.length} segments resolved · ${implicitBools} implicit-presence bool(s), every one in the table`)
  }
}
done()
if (findings.length) { console.error(`[implicit-presence-defaults] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  - ${f}`); process.exit(1) }
console.log('[implicit-presence-defaults] PASS — an absent implicit-presence bool lands as its default beside the true side; a row with no parent message stays noise; the shipped proto names no implicit bool the table lacks.')
