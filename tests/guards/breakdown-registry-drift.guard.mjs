#!/usr/bin/env node
// LORAMER_BREAKDOWN_REGISTRY_DRIFT_GUARD_V1  (G2 STEP 2B — generated-schema form)
//
// FAILS if the tool schema (src/lib/claude-tools.ts) or the query layer (src/lib/metrics-query.ts) STOP generating
// their breakdown enums/allowlist FROM the ONE declared source (src/lib/breakdown-registry.ts), or if the registry
// declares a geo tuple the tool's geo resolver cannot map (a CAPTURED-but-unreachable dimension).
//
// WHY (G2): the query_breakdown enum and the metrics-query allowlist used to be TWO hand-maintained lists that
// drifted from what the writers persist — 54 captured-but-unreachable tuples (Google geo, GA, meta age_gender). In
// 2B both were collapsed onto the registry and GENERATED from it, so they cannot drift by construction. This guard
// keeps them that way: re-introduce a hardcoded enum literal, or delete the registry import, and it goes RED.
//
// ⚠ WHAT GREEN MEANS — READ BEFORE TRUSTING IT: green proves the schema and the query layer BOTH derive from the
// registry (no drift) AND the registry is internally consistent (every geo tuple is resolvable). It does NOT — and
// CANNOT — prove Lora can reach every CAPTURED tuple in the LIVE database: CI has no network and the DB is prod.
// A green build guard is NOT "Lora sees everything." Live reachability is the SEPARATE, non-build check
// scripts/breakdown-reachability-check.mjs (loose-index-scan of live DISTINCT tuples vs the registry, run against prod).
//
// HERMETIC: pure filesystem reads. No network, no DB, no writes. Safe in CI/build.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)

const registry = read('src/lib/breakdown-registry.ts')
const tools = read('src/lib/claude-tools.ts')
const query = read('src/lib/metrics-query.ts')

// ── 1. claude-tools GENERATES the three query_breakdown enums from the registry (no hardcoded literal) ─────────
if (!tools) fail('missing src/lib/claude-tools.ts')
else {
  const s = tools.indexOf("name: 'query_breakdown'"), e = tools.indexOf("name: 'query_money'", s)
  const slice = s >= 0 ? tools.slice(s, e > s ? e : undefined) : ''
  if (!slice) fail('could not locate the query_breakdown tool block in claude-tools.ts')
  for (const [prop, gen] of [['breakdownType', 'breakdownToolTypes'], ['platform', 'breakdownPlatforms'], ['entityLevel', 'breakdownEntityLevels']]) {
    const m = slice.match(new RegExp(prop + '\\s*:\\s*\\{[\\s\\S]*?enum:\\s*([^,\\n]+)'))
    const expr = (m ? m[1] : '').trim()
    if (!new RegExp('^' + gen + '\\(\\)').test(expr)) {
      fail(`claude-tools query_breakdown "${prop}" enum must be GENERATED as ${gen}() — found "${expr.slice(0, 46)}". A hardcoded literal lets the schema drift from the registry.`)
    }
  }
  if (!/from '@\/lib\/breakdown-registry'/.test(tools)) fail('claude-tools.ts does not import from @/lib/breakdown-registry')
}

// ── 2. metrics-query CONSUMES the registry (the hand-maintained BREAKDOWN_PLATFORMS / SPEND_ZERO literals stay gone) ─
if (!query) fail('missing src/lib/metrics-query.ts')
else {
  if (!/BREAKDOWN_PLATFORMS[^\n]*=\s*breakdownPlatformsMap\(\)/.test(query)) fail('metrics-query BREAKDOWN_PLATFORMS must derive from breakdownPlatformsMap() — the hand-maintained literal must stay deleted.')
  if (!/SPEND_ZERO_BREAKDOWNS\s*=\s*spendZeroTypes\(\)/.test(query)) fail('metrics-query SPEND_ZERO_BREAKDOWNS must derive from spendZeroTypes().')
  if (!/from '@\/lib\/breakdown-registry'/.test(query)) fail('metrics-query.ts does not import from @/lib/breakdown-registry')
}

// ── 3. Registry internal consistency: parse entries; every 'geo' tuple must be resolvable (has geoGrain + geoScope) ─
const entries = []
for (const line of (registry || '').split('\n')) {
  if (!/breakdownType:/.test(line) || !/surface:/.test(line)) continue
  const platform = line.match(/platform:\s*'([a-z]+)'/)?.[1]
  const breakdownType = line.match(/breakdownType:\s*'([^']*)'/)?.[1]
  const toolType = line.match(/toolType:\s*'([^']*)'/)?.[1]
  const surface = line.match(/surface:\s*'(base|breakdown)'/)?.[1]
  const levels = line.match(/entityLevels:\s*\[([^\]]*)\]/)?.[1]
  const geoGrain = line.match(/geoGrain:\s*'([^']*)'/)?.[1]
  const geoScope = line.match(/geoScope:\s*'([^']*)'/)?.[1]
  if ([platform, breakdownType, toolType, surface, levels].some((x) => x === undefined)) {
    fail(`registry entry unparseable (missing a core field): ${line.trim().slice(0, 90)}`)
    continue
  }
  entries.push({ platform, breakdownType, toolType, surface, geoGrain, geoScope })
}
if (entries.length < 40) fail(`only ${entries.length} registry entries parsed — expected ~55; the parser or the file is wrong, guard cannot be trusted`)
const geoEntries = entries.filter((e) => e.surface === 'breakdown' && e.toolType === 'geo')
for (const e of geoEntries) {
  if (!e.geoGrain || !e.geoScope) {
    fail(`registry geo tuple breakdownType='${e.breakdownType}' (toolType 'geo') is MISSING geoGrain/geoScope — it is CAPTURED but the geo resolver cannot map it, so Lora CANNOT reach it.`)
  }
}

// ── REPORT ───────────────────────────────────────────────────────────────────────────────────────────────────
console.log('LORAMER_BREAKDOWN_REGISTRY_DRIFT_GUARD_V1')
console.log(`  registry entries parsed : ${entries.length}  (geo tuples: ${geoEntries.length})`)
console.log(`  claude-tools enums      : generated from registry (breakdownToolTypes/Platforms/EntityLevels)`)
console.log(`  metrics-query allowlist : generated from registry (breakdownPlatformsMap/spendZeroTypes)`)

if (failures.length) {
  console.error(`\n✗ GUARD FAILED — the breakdown schema/query-layer has drifted from the declared source (${failures.length} findings):\n`)
  for (const f of failures) console.error('  • ' + f)
  console.error('\nFIX: keep claude-tools.ts + metrics-query.ts GENERATING from breakdown-registry.ts, and give every')
  console.error('geo tuple a geoGrain + geoScope. REMINDER: a green run proves schema↔registry parity, NOT live-DB')
  console.error('reachability — that is scripts/breakdown-reachability-check.mjs (see header).\n')
  process.exit(1)
}
console.log('\n✓ GUARD PASSED — schema + query layer both generate from the registry; every geo tuple is resolvable (schema↔registry parity; NOT live-DB reachability).')
