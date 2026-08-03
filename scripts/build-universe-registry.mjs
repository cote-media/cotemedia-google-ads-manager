#!/usr/bin/env node
// LORAMER_UNIVERSE_ENTITY_AXIS_V1 — CODEGEN: the universe artifact → literal registry lines.
//
// ⛔ WHY CODEGEN AND NOT A RUNTIME READ. `breakdown-reachability-check.mjs` and
// `breakdown-registry-drift.guard.mjs` both TEXT-PARSE src/lib/breakdown-registry.ts — they never execute
// TypeScript. A registry array built at module load from readFileSync would be INVISIBLE to both, so the
// gate would pass while declaring nothing. Worse, the artifact has already been missing from a deployed
// bundle once (LORAMER_UNIVERSE_ARTIFACT_MUST_BE_TRACED_V1, d081752) — a second runtime dependency on it
// inside a file the whole read path imports is the same trap with a wider blast radius.
// So: the artifact stays THE source, and this script materialises it as literal lines that every existing
// reader already understands. `universe-registry-sync.guard.mjs` fails the build if the block drifts.
//
//   node scripts/build-universe-registry.mjs           # print the block (what the guard compares against)
//   node scripts/build-universe-registry.mjs --write   # splice it into breakdown-registry.ts
//
// ⛔ ENTITY LEVEL IS THE FROM RESOURCE, AND THAT IS THE WHOLE OF OPTION B. No mapping table, no switch, no
// per-resource branch: the vendor names the grain and we write down the name it used. Verified 2026-08-03
// against the vendor's own reporting doc — "Every report is initially segmented by the resource specified in
// the FROM clause. The resource_name field of the resource in the FROM clause is returned and metrics are
// segmented by it, even when the resource_name field is not explicitly included in the query" — and against
// a live A/B probe on Foam OH: the same query with and without campaign.id returned 418 rows BOTH TIMES,
// with campaign.resource_name present in the unselected case.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT = 'docs/google-ads-capture-universe.json'
const REGISTRY = 'src/lib/breakdown-registry.ts'
export const BEGIN = '  // ═══ BEGIN GENERATED — LORAMER_UNIVERSE_ENTITY_AXIS_V1 (node scripts/build-universe-registry.mjs --write) ═══'
export const END = '  // ═══ END GENERATED — LORAMER_UNIVERSE_ENTITY_AXIS_V1 ═══'

/** The artifact's own selection rule, duplicated NOWHERE ELSE — it mirrors selectableEntries() in the writer. */
export const selectable = (doc) => doc.entries.filter((e) => e.delivers === true && (e.segment === null || e.dateCombinable === true))
/** The writer's own naming rule. Same shape as breakdownTypeFor() — segment short name, else the resource. */
export const btFor = (e) => (e.segment ? e.segment.replace(/^segments\./, '').replace(/\./g, '_') : e.resource)

// ⛔ TYPES ALREADY DECLARED BY HAND ARE NOT RE-EMITTED. The registry's granularity is one entry per
// (platform, breakdown_type); a second line for the same type would make entryFor()/resolveToolType() read
// the first and silently ignore the second. These two are declared in the hand-authored block above the
// generated one, and their universe grains are merged INTO those lines by hand, once, on the record.
export const HAND_DECLARED = new Set(['device', 'conversion_action'])

/** HIGH CARDINALITY — the vendor's own measured distinct-value count for this account, when it carries one. */
const HIGH_CARD_AT = 40

export function buildBlock(doc) {
  const byType = new Map()
  for (const e of selectable(doc)) {
    const t = btFor(e)
    if (!byType.has(t)) byType.set(t, { levels: new Set(), dv: 0, segment: e.segment })
    const g = byType.get(t)
    g.levels.add(e.resource)
    g.dv = Math.max(g.dv, typeof e.distinctValues === 'number' ? e.distinctValues : 0)
  }
  const lines = []
  for (const t of [...byType.keys()].sort()) {
    if (HAND_DECLARED.has(t)) continue
    const g = byType.get(t)
    const levels = [...g.levels].sort().map((l) => `'${l}'`).join(', ')
    const hc = g.dv >= HIGH_CARD_AT
    const note = `vendor-named grain (LORAMER_UNIVERSE_ENTITY_AXIS_V1): entity_level IS the GAQL FROM resource and entity_id is its resource_name. ` +
      `Vendor-measured distinct values on the probe account: ${g.dv || 'unmeasured'}.`
    lines.push(
      `  { platform: 'google', breakdownType: '${t}', toolType: '${t}', surface: 'breakdown', entityLevels: [${levels}], ` +
      `rankBy: 'spend', additive: true, highCardinality: ${hc}, note: '${note.replace(/'/g, "\\'")}' },`,
    )
  }
  return [BEGIN, ...lines, END].join('\n')
}

export function readArtifact(root = ROOT) {
  return JSON.parse(readFileSync(resolve(root, ARTIFACT), 'utf8'))
}

export function currentBlock(root = ROOT) {
  const src = readFileSync(resolve(root, REGISTRY), 'utf8')
  const a = src.indexOf(BEGIN)
  const b = src.indexOf(END)
  if (a === -1 || b === -1) return null
  return src.slice(a, b + END.length)
}

if (process.argv[1] && process.argv[1].endsWith('build-universe-registry.mjs')) {
  const block = buildBlock(readArtifact())
  if (process.argv.includes('--write')) {
    const path = resolve(ROOT, REGISTRY)
    const src = readFileSync(path, 'utf8')
    const a = src.indexOf(BEGIN)
    const b = src.indexOf(END)
    if (a === -1 || b === -1) {
      console.error(`REFUSING: ${REGISTRY} has no generated-block markers. Add them inside REGISTRY before writing.`)
      process.exit(1)
    }
    writeFileSync(path, src.slice(0, a) + block + src.slice(b + END.length))
    console.log(`[build-universe-registry] wrote ${block.split('\n').length - 2} generated entries into ${REGISTRY}`)
  } else {
    console.log(block)
  }
}
