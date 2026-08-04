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

/** ⛔ WHAT THE REGISTRY DECLARES IS WHAT LANDS IN metrics_daily — which since LORAMER_UNIVERSE_DERIVED_TIME_V1
 *  is NOT the same set as what we REQUEST from Google. The six derived time families are computed locally from
 *  `date` and still stored, so they must still be declared or Lora cannot read rows that exist. This mirrors
 *  `declarableEntries()` in the writer, NOT `selectableEntries()`. */
export const selectable = (doc) => doc.entries.filter((e) => e.delivers === true && (e.segment === null || e.dateCombinable === true))
/** The six segments we no longer request — kept in step with the writer's DERIVED_TIME_FAMILIES. */
export const DERIVED_TIME = new Map([
  ['segments.date', 'NOT REQUESTED AND NOT COMPUTED — the BASE family already carries it at the same grain (proven lossless 2026-08-03: 0 rows unreachable, 0 value mismatches). Rows already stored keep their meaning; nothing new is written here'],
  ['segments.week', 'ISO week start (Monday) = date - (isodow-1) days'],
  ['segments.month', 'first day of the calendar month'],
  ['segments.quarter', 'first day of the CALENDAR quarter (not fiscal)'],
  ['segments.year', 'calendar year'],
  ['segments.day_of_week', 'Google DayOfWeek enum ordinal, MONDAY=2 ... SUNDAY=8 (isodow + 1)'],
])
/** The writer's own naming rule. Same shape as breakdownTypeFor() — segment short name, else the resource. */
export const btFor = (e) => (e.segment ? e.segment.replace(/^segments\./, '').replace(/\./g, '_') : e.resource)

// ⛔ TYPES ALREADY DECLARED BY HAND ARE NOT RE-EMITTED. The registry's granularity is one entry per
// (platform, breakdown_type); a second line for the same type would make entryFor()/resolveToolType() read
// the first and silently ignore the second.
// ⛔ DERIVED FROM THE FILE, NEVER HARDCODED — and it was hardcoded first, which broke on the very next
// re-probe: the 2026-08-03 re-probe surfaced `segments.hour` as a universe slot while `hour` was already a
// hand-authored line, and a frozen `new Set(['device','conversion_action'])` happily emitted a duplicate.
// Reading the hand-authored region means a type can never be declared twice no matter what a future probe
// surfaces; the guard then reports which levels still need merging into the hand line.
export function handDeclaredTypes(registrySrc) {
  const hand = registrySrc.slice(0, registrySrc.indexOf(BEGIN) === -1 ? registrySrc.length : registrySrc.indexOf(BEGIN))
  const out = new Set()
  for (const m of hand.matchAll(/platform: 'google', breakdownType: '([^']*)'/g)) out.add(m[1])
  return out
}

/** HIGH CARDINALITY — the vendor's own measured distinct-value count for this account, when it carries one. */
const HIGH_CARD_AT = 40

export function buildBlock(doc, registrySrc = readFileSync(resolve(ROOT, REGISTRY), 'utf8')) {
  const handDeclared = handDeclaredTypes(registrySrc)
  const byType = new Map()
  for (const e of selectable(doc)) {
    const t = btFor(e)
    if (!byType.has(t)) byType.set(t, { levels: new Set(), dv: 0, segment: e.segment, derived: DERIVED_TIME.get(e.segment || '') || null, refusals: [] })
    const g = byType.get(t)
    g.refusals.push(Array.isArray(e.refusesMetrics) ? e.refusesMetrics : [])
    g.levels.add(e.resource)
    g.dv = Math.max(g.dv, typeof e.distinctValues === 'number' ? e.distinctValues : 0)
  }
  const lines = []
  for (const t of [...byType.keys()].sort()) {
    if (handDeclared.has(t)) continue
    const g = byType.get(t)
    const levels = [...g.levels].sort().map((l) => `'${l}'`).join(', ')
    const hc = g.dv >= HIGH_CARD_AT
    // ⛔ REUSE SPEND_ZERO RATHER THAN INVENT A PARALLEL MECHANISM (LORAMER_UNIVERSE_REFUSED_METRIC_V1).
    // metrics-query already has SPEND_ZERO_BREAKDOWNS, driven off `rankBy: 'conversions'`, for families whose
    // spend column is structurally 0 — it ranks by conversions and attaches a note instead of ranking by a
    // meaningless zero. A family whose cost_micros the vendor REFUSES at EVERY grain it serves is exactly that
    // shape, so it joins that set rather than getting a second one.
    // ⚠ ONLY WHEN IT IS REFUSED AT EVERY GRAIN. Refusal varies by entity_level on 8 of 111 types (e.g. `device`
    // is full at campaign and refuses cost_micros at shopping_performance_view); marking those SPEND_ZERO
    // would lie about the grains where spend is real. Those keep rankBy 'spend' and rely on the ROW stamp.
    const everyGrainRefusesSpend = g.refusals.length > 0 && g.refusals.every((r) => r.includes('metrics.cost_micros'))
    const anyGrainRefuses = g.refusals.some((r) => r.length > 0)
    const rank = everyGrainRefusesSpend ? 'conversions' : 'spend'
    const refusalNote = everyGrainRefusesSpend
      ? ` ⛔ SPEND-REFUSED AT EVERY GRAIN: the vendor will not report cost_micros here, so spend/CPC/CPA/ROAS are UNAVAILABLE, not zero. Ranked by conversions. Every row carries refusedMetrics + the vendor reason verbatim.`
      : anyGrainRefuses
        ? ` ⚠ PARTIAL AT SOME GRAINS: the vendor refuses one or more metrics at a SUBSET of this family's entity_levels, so a blanket rule would be wrong. Read extra.refusedMetrics ON THE ROW — a refused metric reads 0 because the column is NOT NULL, and it is NOT a zero.`
        : ''
    const note = g.derived
      ? `COMPUTED, NOT CAPTURED (LORAMER_UNIVERSE_DERIVED_TIME_V1). This family is NOT requested from Google — it is derived locally from the row date and stored as a TRUE aggregate, one row per entity per period. Derivation: ${g.derived}. Every row carries extra.provenance='COMPUTED_FROM_DATE' with the rule on the row; a row without it is a bug the guard fails on. Reconciled against the vendor's own rows on 2026-08-03 with ZERO mismatches. entity_level IS the GAQL FROM resource.`
      : `vendor-named grain (LORAMER_UNIVERSE_ENTITY_AXIS_V1): entity_level IS the GAQL FROM resource and entity_id is its resource_name. ` +
        `Vendor-measured distinct values on the probe account: ${g.dv || 'unmeasured'}.`
    lines.push(
      `  { platform: 'google', breakdownType: '${t}', toolType: '${t}', surface: 'breakdown', entityLevels: [${levels}], ` +
      `rankBy: '${rank}', additive: true, highCardinality: ${hc}, note: '${(note + refusalNote).replace(/'/g, "\\'")}' },`,
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
