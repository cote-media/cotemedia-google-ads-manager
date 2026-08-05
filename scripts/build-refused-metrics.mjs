#!/usr/bin/env node
// LORAMER_REFUSED_RATIO_IS_NULL_V1 — regenerate src/lib/google-refused-metrics.ts from the artifact.
// ⛔ THE ARTIFACT IS THE SOURCE. Which metrics Google refuses at which grain was MEASURED by the probe and
// lives in docs/google-ads-capture-universe.json; this file only projects it into a shape the read path can
// use without loading the whole artifact at query time. A hand-edited copy would drift from the thing that
// actually decided what to request, and the guard fails the build if the two disagree.
//   node scripts/build-refused-metrics.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEYS = {
  'metrics.cost_micros': 'spend', 'metrics.impressions': 'impressions', 'metrics.clicks': 'clicks',
  'metrics.conversions': 'conversions', 'metrics.conversions_value': 'conversion_value',
}

export function buildMap(doc) {
  const m = {}
  for (const e of doc.entries) {
    if (!e.refusesMetrics || e.refusesMetrics.length === 0) continue
    const bt = e.segment ? e.segment.replace(/^segments\./, '').replace(/\./g, '_') : e.resource
    m[`${bt}|${e.resource}`] = [...new Set(e.refusesMetrics.map((x) => KEYS[x] || x))].sort()
  }
  return m
}

// ⛔ NOTHING BELOW RUNS ON IMPORT. The guard imports buildMap() to compare the generated file against the
// artifact; when this module's top level wrote the file unconditionally, merely RUNNING THE GUARD REGENERATED
// THE REPO. A guard that mutates what it inspects cannot be trusted to have inspected anything — it would
// always find the file up to date because it had just rewritten it.
const RUN_DIRECTLY = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (!RUN_DIRECTLY) { /* imported for buildMap only */ }
else {
const doc = JSON.parse(readFileSync(resolve(ROOT, 'docs/google-ads-capture-universe.json'), 'utf8'))
const map = buildMap(doc)
const lines = Object.keys(map).sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`)
const out = `// LORAMER_REFUSED_RATIO_IS_NULL_V1 — GENERATED FROM docs/google-ads-capture-universe.json. DO NOT HAND-EDIT.
//   node scripts/build-refused-metrics.mjs
//
// ⛔ WHICH METRICS GOOGLE REFUSES AT WHICH GRAIN, keyed \`\${breakdown_type}|\${entity_level}\`.
//
// ⛔ WHY THE READ PATH CANNOT USE THE ROW'S OWN STAMP INSTEAD. queryBreakdown has two aggregation paths and
// the fast one is a SQL GROUP BY (\`query_breakdown_agg\`, migration 038) that returns SUMS ONLY — \`extra\`
// never crosses the wire. A read-path defence built on the per-row stamp would therefore work on the JS
// paging path and SILENTLY NOT WORK on the SQL path, which is the one that runs for every large breakdown.
// Refusal is a property of the (resource, segment) GRAIN, not of an individual row — the artifact says so and
// the writer decides it the same way — so keying on the grain is both correct and path-independent.
//
// ⛔ REFUSAL VARIES BY entity_level ON 10 OF 111 TYPES, which is why the key is a PAIR. A map keyed on
// breakdown_type alone would be wrong for exactly those ten and right everywhere else — the worst shape.
export const GOOGLE_REFUSED_METRICS: Record<string, string[]> = {
${lines.join('\n')}
}

/** Refused metric names for a grain, or an empty array. Unknown grain = nothing refused (never a guess). */
export function refusedMetricsFor(platform: string, breakdownType: string, entityLevel?: string | null): string[] {
  if (platform !== 'google' || !entityLevel) return []
  return GOOGLE_REFUSED_METRICS[\`\${breakdownType}|\${entityLevel}\`] || []
}

/** The six derived ratios and the metrics each is built from. A ratio is UNAVAILABLE if EITHER side is refused. */
export const RATIO_INPUTS: Record<string, [string, string]> = {
  ctr: ['clicks', 'impressions'], cpc: ['spend', 'clicks'], cpm: ['spend', 'impressions'],
  roas: ['conversion_value', 'spend'], cpa: ['spend', 'conversions'], convRate: ['conversions', 'clicks'],
}

/**
 * ⛔ THE READ-PATH SUPPRESSION, AS A PURE FUNCTION SO A GUARD CAN EXECUTE IT.
 * Written inline in metrics-query it could only be guarded by searching the source for a name — and that
 * exact shape went green over broken behaviour three times in 24 hours
 * (★CODE-HYGIENE-SWEEP-KNOWN-HAZARDS item 3). A decision that must be guarded has to be callable.
 *
 * ⛔ IT LIVES IN THE GENERATOR TEMPLATE, NOT APPENDED TO THE OUTPUT. It was first hand-appended to the
 * generated file and the very next regeneration DELETED IT — caught only because the guard drives the
 * function rather than grepping for it. Nothing may be added to a generated file except through its
 * generator.
 *
 * Returns metrics and derived ratios with every refused value replaced by null:
 *   · a REFUSED METRIC becomes null — not zero, so a caller cannot sum or divide it
 *   · a RATIO becomes null when EITHER input is refused, not only the denominator. CPC = spend/clicks is
 *     meaningless if either side is missing, and a half-real ratio is worse than none.
 */
export function applyRefusal(
  metrics: Record<string, number>,
  derived: Record<string, number | null>,
  refused: string[]
): { metrics: Record<string, number | null>; derived: Record<string, number | null> } {
  const r = new Set(refused)
  const outM: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(metrics)) outM[k] = r.has(k) ? null : v
  const outD: Record<string, number | null> = { ...derived }
  for (const [name, [numer, denom]] of Object.entries(RATIO_INPUTS)) {
    if (r.has(numer) || r.has(denom)) outD[name] = null
  }
  return { metrics: outM, derived: outD }
}
`
writeFileSync(resolve(ROOT, 'src/lib/google-refused-metrics.ts'), out)
console.log(`wrote src/lib/google-refused-metrics.ts — ${Object.keys(map).length} grain entries`)
}
