#!/usr/bin/env node
// LORAMER_SCOPED_DRILLDOWN_FALSE_ZERO_GUARD_V1 — the THIRD instance of the false-zero class, guarded.
//
// FAILS if query_breakdown, given a scope (parentEntityId/entityId), reports "no data captured" for a family
// whose rows demonstrably exist. A false zero is the defect; an honest scope limitation is acceptable.
//
// THE CLASS, and the two prior fixes whose shape this reuses rather than reinventing:
//   · LORAMER_WOO_SILENT_ZERO_FIX_V1 (2026-07-25) — "a thrown fetch is a FAILED fetch, not a $0 day." A
//     zero-filled success object is a lie; failure and zero must be DISTINGUISHABLE.
//   · query_metrics FALSE-ZERO on pre-data windows — 0 rows before data start rendered as "$0" instead of
//     "no data". Same disease one layer over.
//   THIS ONE: device scoped to a campaign returns rows=0 + "No device data captured for this client in
//   <window>" while the unscoped control returns MOBILE $63,992.80. The data exists; the SCOPE could not reach
//   it. Saying "not captured" is false, and a model told that has been handed a wrong fact — which is exactly
//   why Lora declined the drill-down chain on 2026-07-28 and was scored as if she had failed.
//
// ROOT CAUSE it guards against returning: metrics-query.ts resolves the entity level by probing COARSEST-FIRST
// and ignoring the scope args, then filters on that level. keyword/search_term (coarsest = ad_group) and hour
// (coarsest = campaign) happen to line up and work; device (coarsest = campaign) can never match an ad-group
// entityId, and campaign-level rows carry parent_entity_id = customer id, so a campaign parentEntityId misses too.
//
// ⛔ IT MUST NOT LICENSE A REGRESSION OF LORAMER_BREAKDOWN_LEVEL_SCOPE_V1 (2026-07-02). That fix exists because
// query_breakdown used to SUM every captured level and DOUBLE-COUNT (google hour $3,945.88 → true $2,427.36;
// the -next age card was ~4x inflated). ONE level, always. This guard therefore ALSO asserts single-level
// scoping still holds — a fix that widened the level set to "find the rows" would trade a false zero for a
// false total, which is strictly worse.
//
// NOT HERMETIC — it needs the real DB, so it is NOT in `npm run guard`/`build` (same posture as check:data and
// the evals: DB/paid work stays out of the Vercel build path). Run manually:  node scripts/check-scoped-drilldown.mjs
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
// supabase-js initialises a realtime client that wants a WebSocket ctor in bare Node. We never open a socket;
// this shim only lets the module construct. Test-harness only.
if (!globalThis.WebSocket) globalThis.WebSocket = class { constructor() { throw new Error('no realtime in guard') } }

const fail = (m) => { console.error(`\n✗ scoped-drilldown guard: ${m}\n`); process.exit(2) }

// compile + load the REAL query layer (a text scan cannot prove what a query returns)
const out = mkdtempSync(join(tmpdir(), 'loramer-scope-guard-'))
const cfgDir = mkdtempSync(join(tmpdir(), 'loramer-scope-cfg-'))
const cfg = join(cfgDir, 'tsconfig.json')
writeFileSync(cfg, JSON.stringify({ compilerOptions: { target: 'es2020', module: 'commonjs', moduleResolution: 'node',
  skipLibCheck: true, resolveJsonModule: true, baseUrl: ROOT, paths: { '@/*': ['./src/*'] }, rootDir: ROOT,
  outDir: out, noEmitOnError: false, noImplicitAny: false }, files: [join(ROOT, 'src/lib/metrics-query.ts')] }))
const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', cfg], { encoding: 'utf8' })
const cleanup = () => { rmSync(out, { recursive: true, force: true }); rmSync(cfgDir, { recursive: true, force: true }) }
if (r.error) { cleanup(); fail(`tsc — ${r.error.message}`) }
const rootReq = createRequire(join(ROOT, 'package.json'))
const origLoad = Module._load
Module._load = function (req, ...a) {
  if (req === 'server-only') return {}
  if (req.startsWith('@/')) return origLoad.call(this, join(out, 'src', req.slice(2) + '.js'), ...a)
  if (!req.startsWith('.') && !req.startsWith('/')) { try { return origLoad.call(this, rootReq.resolve(req), ...a) } catch { /* fall through */ } }
  return origLoad.call(this, req, ...a)
}
const req = createRequire(import.meta.url)
let Q
try { Q = req(join(out, 'src/lib/metrics-query.js')) } catch (e) { Module._load = origLoad; cleanup(); fail(`load — ${e.message}`) }

// ── FIXTURE: a real client with real multi-level device data, and its real top campaign / ad group ──────────
const C = '60e6dd99-fd42-466f-870f-48eb407835e8'   // Bath Fitter | O'Gorman Bros
const CAMP = '22835473330'                          // EM | North Jersey | Max Conversions
const AG = '185422837600'                           // Brand
const W = { startDate: '2026-06-01', endDate: '2026-06-30' }
const FALSE_ZERO = /no .* data captured for this client/i
const LEVELS = ['account', 'campaign', 'ad_group', 'ad_set', 'ad', 'keyword']

const results = []
const check = async (name, args, assertFn, core = false) => {
  let res = null, err = null
  try { res = await Q.queryBreakdown({ clientId: C, ...W, ...args }) } catch (e) { err = e }
  const got = { rows: res?.rows?.length ?? 0, distinct: res?.distinctValueCount ?? 0, note: res?.note ?? '', level: res?.rows?.[0]?.entityLevel }
  const problems = err ? [`THREW ${err.message}`] : assertFn(res, got)
  results.push({ name, got, problems, core })
  console.log(`  ${problems.length ? '✗' : '✓'} ${name}\n      rows=${got.rows} distinct=${got.distinct}${got.note ? ` note="${got.note.slice(0, 78)}"` : ''}`)
  problems.forEach((p) => console.log(`      → ${p}`))
}

console.log('LORAMER_SCOPED_DRILLDOWN_FALSE_ZERO_GUARD_V1\n')

// 1 CONTROL — unscoped device must have rows. If this fails the fixture is stale, not the code.
await check('CONTROL unscoped device has rows (fixture sanity)', { breakdownType: 'device', platform: 'google' },
  (res, g) => g.rows > 0 ? [] : ['fixture stale: unscoped device returned nothing — re-pick the client/window'])

// 2 + 3 THE DEFECT — device scoped to a campaign / ad group must NOT claim the data is not captured.
await check('device scoped to CAMPAIGN must not false-zero', { breakdownType: 'device', platform: 'google', parentEntityId: CAMP },
  (res, g) => FALSE_ZERO.test(g.note) ? ['FALSE ZERO: says "not captured" while unscoped device has rows. Return the rows, or state the scope limitation and name the level where it IS available.']
    : (g.rows === 0 && !g.note) ? ['empty with NO note — silent zero is the same defect without the sentence'] : [], true)
await check('device scoped to AD GROUP must not false-zero', { breakdownType: 'device', platform: 'google', entityId: AG },
  (res, g) => FALSE_ZERO.test(g.note) ? ['FALSE ZERO: says "not captured" while unscoped device has rows.']
    : (g.rows === 0 && !g.note) ? ['empty with NO note'] : [], true)

// 4-6 NON-REGRESSION — the three scopings MEASURED working on 2026-07-28 must keep working, unchanged.
await check('keyword scoped to AD GROUP still returns rows', { breakdownType: 'keyword', platform: 'google', entityId: AG },
  (res, g) => g.rows > 0 && g.distinct >= 45 ? [] : [`expected rows>0 and distinct>=45 (measured 45), got ${g.rows}/${g.distinct}`], true)
await check('search_term scoped to AD GROUP still returns rows', { breakdownType: 'search_term', platform: 'google', entityId: AG },
  (res, g) => g.rows > 0 && g.distinct >= 182 ? [] : [`expected distinct>=182 (measured 182), got ${g.distinct}`], true)
await check('hour scoped to CAMPAIGN still returns rows', { breakdownType: 'hour', platform: 'google', entityId: CAMP },
  (res, g) => g.rows > 0 && g.distinct === 24 ? [] : [`expected 24 hours, got ${g.distinct}`], true)

// 7 THE 4x INFLATION FIX MUST NOT REGRESS — LORAMER_BREAKDOWN_LEVEL_SCOPE_V1.
// google hour is captured at campaign AND ad_group with the SAME total. One level → ~81,962.98.
// Summing both levels → ~163,925.96. Assert the unscoped total is the ONE-LEVEL figure.
await check('4x INFLATION: unscoped hour totals ONE level, not the sum of two', { breakdownType: 'hour', platform: 'google', topN: 50 },
  (res, g) => {
    const total = (res?.rows || []).reduce((a, x) => a + Number(x.spend || 0), 0)
    if (total > 120000) return [`DOUBLE-COUNT: hour total $${total.toFixed(2)} — campaign+ad_group summed. LORAMER_BREAKDOWN_LEVEL_SCOPE_V1 regressed.`]
    if (total < 60000) return [`total $${total.toFixed(2)} is below the measured one-level figure (~81,962.98) — fixture stale or rows lost`]
    return []
  }, true)

// 8 THE HONEST-NOTE FALLBACK — the branch that fires when a scope genuinely matches nothing. This is the
// preference-2 path and it is the one that replaces the false zero, so it gets its own pinned assertion rather
// than being assumed. FIXTURE: device DOES exist (control above), but no device row anywhere carries this id.
await check('BOGUS scope hits the honest-note branch, not a false zero',
  { breakdownType: 'device', platform: 'google', entityId: '999999999999' },
  (res, g) => {
    const p = []
    if (FALSE_ZERO.test(g.note)) p.push('FALSE ZERO: an unreachable SCOPE was reported as uncaptured DATA — the exact defect this guard exists for')
    if (res?.scopeUnavailable !== true) p.push('scopeUnavailable not set — the caller cannot distinguish "scope missed" from "no data"')
    if (!Array.isArray(res?.availableEntityLevels) || !res.availableEntityLevels.length) p.push('availableEntityLevels empty — the note must NAME where the data IS')
    else if (!res.availableEntityLevels.every((l) => LEVELS.includes(l))) p.push(`availableEntityLevels not real levels: ${JSON.stringify(res.availableEntityLevels)}`)
    // pin the WORDING — the sentence is what a model reads, so drift in it is drift in the fix
    if (!/IS captured/i.test(g.note)) p.push('note must affirm the data IS captured')
    if (!/SCOPE limitation/i.test(g.note)) p.push('note must name it a SCOPE limitation')
    if (!/do NOT report it as zero/i.test(g.note)) p.push('note must forbid reporting zero')
    if (res?.rows?.length) p.push('fallback returned rows — fixture no longer reaches the branch (pick an id that matches nothing)')
    return p
  }, true)

Module._load = origLoad
cleanup()
const bad = results.filter((x) => x.problems.length)
if (bad.length) { console.error(`\n✗ scoped-drilldown guard: ${bad.length}/${results.length} failed (${bad.filter((x) => x.core).length} core)`); process.exit(2) }
console.log(`\n✓ scoped-drilldown guard: ${results.length}/${results.length} — scoped drill-down never reports captured data as uncaptured, and level scoping is still single-level.`)
