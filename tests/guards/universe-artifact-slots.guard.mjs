#!/usr/bin/env node
// LORAMER_UNIVERSE_ARTIFACT_EMITS_EVERY_SLOT_V1 — THE FIX-WITH-GUARD HALF.
//
// THE DEFECT IT EXISTS TO PREVENT RETURNING: `build()` used to do `if (!p) continue` on any catalog slot the
// probe pass had not recorded, so 740 of 1,118 declared slots (66.2%) were absent from the artifact with no
// row, no reason and no trace. The file that exists to BE the denominator was under-counting the denominator
// by two thirds while reading as authoritative — and the highest-cardinality grain in the entire surface
// (geo_target_city, since measured at 16,067 distinct values on one account in one month) was one of the
// missing ones, so the walk would never have asked for it.
//
// TWO QUESTIONS, and the second is the one a text search cannot answer:
//   (A) DOES EVERY DECLARED CATALOG SLOT HAVE A ROW? Counted against the artifact's own catalog denominator.
//   (B) ARE `probed` AND `delivers` STILL TWO SEPARATE FACTS? Never-asked and asked-and-declined must not
//       collapse into one non-existence. Driven through the REAL `build()`, with inputs shaped to force the
//       collapse if the guard rail is gone.
//
// ⛔ DRIVES THE COMPILED MODULE, NOT A REGEX. The previous flight's leg 4 went green while broken because a
// regex matched a constant name that survived inside a function body. A guard that greps for a string proves
// the string is present; it never proves the code does the thing. Every leg below calls build() and asserts
// on what came back.
// ⛔ HERMETIC. No DB, no network, no quota — build() is pure by construction and this file keeps it that way.
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []
const gen = await import(`file://${join(ROOT, 'scripts/google-ads-capture-universe.mjs')}`)
const doc = JSON.parse(readFileSync(join(ROOT, 'docs/google-ads-capture-universe.json'), 'utf8'))

// ── (A) EVERY DECLARED SLOT HAS A ROW ──────────────────────────────────────────────────────────────────────
{
  const acc = doc.slotAccounting
  if (!acc) findings.push('(A) the artifact carries no slotAccounting block — the slot contract is unstated and therefore unverifiable.')
  else {
    if (acc.declaredSlots !== acc.emittedRows) findings.push(`(A) slotAccounting says ${acc.declaredSlots} declared slots but ${acc.emittedRows} emitted rows. Every declared slot emits a row; a shortfall is the 740-missing-slots defect.`)
    if (acc.emittedRows !== doc.entries.length) findings.push(`(A) slotAccounting claims ${acc.emittedRows} rows but the artifact holds ${doc.entries.length}. The accounting block is not describing this file.`)
  }
  // Independent of the accounting block: reconstruct the expectation from the rows themselves.
  const resourceRows = doc.entries.filter((e) => e.segment === null || e.segment === undefined)
  const expected = resourceRows.length + resourceRows.reduce((n, r) => n + (r.selectableSegments || 0), 0)
  if (doc.entries.length !== expected) {
    findings.push(`(A) the artifact holds ${doc.entries.length} rows; its own per-resource selectableSegments counts imply ${expected}. A slot the catalog declares and the file omits is exactly the defect this guard exists for.`)
  }
  const missingState = doc.entries.filter((e) => e.probed === undefined)
  if (missingState.length) findings.push(`(A) ${missingState.length} row(s) carry no \`probed\` field at all (e.g. ${missingState.slice(0, 3).map((e) => e.resource + '|' + (e.segment || '')).join(', ')}). A row with no state is the ambiguity the three-state contract replaced.`)
}

// ── (B) probed AND delivers ARE TWO FACTS — DRIVEN THROUGH THE REAL build() ────────────────────────────────
{
  const catalog = { resources: [{ name: 'r_probed_serving', metrics: ['metrics.impressions'], segments: ['segments.a'] },
                                { name: 'r_probed_declined', metrics: ['metrics.impressions'], segments: ['segments.b'] },
                                { name: 'r_never_probed', metrics: ['metrics.impressions'], segments: ['segments.c'] },
                                { name: 'r_zero_metric', metrics: [], segments: ['segments.d'] }] }
  const probes = {
    surfaces: {},
    slots: {
      'r_probed_serving|segments.a': { delivers: true, distinctValues: 7, dateCombinable: true },
      'r_probed_declined|segments.b': { delivers: false, distinctValues: 0, dateCombinable: true, vendorReason: '{"error_code":{"query_error":53}}' },
    },
  }
  const capture = { resources: [], segments: [] }
  let entries
  try { entries = gen.build({ catalog, probes, capture }) } catch (e) { findings.push(`(B) build() threw on a well-formed catalog: ${e.message}`) }
  if (entries) {
    const by = (r, s) => entries.find((e) => e.resource === r && e.segment === s)
    const expected = catalog.resources.length + catalog.resources.reduce((n, r) => n + r.segments.length, 0)
    if (entries.length !== expected) findings.push(`(B) build() emitted ${entries.length} rows for ${expected} catalog slots — a slot was dropped.`)

    const serving = by('r_probed_serving', 'segments.a')
    if (!serving || serving.probed !== true || serving.delivers !== true) findings.push(`(B) a probed+serving slot did not come back probed:true/delivers:true (got ${JSON.stringify(serving)}).`)

    const declined = by('r_probed_declined', 'segments.b')
    if (!declined || declined.probed !== true || declined.delivers !== false) findings.push(`(B) a probed+declined slot did not come back probed:true/delivers:false (got ${JSON.stringify(declined)}).`)
    if (declined && !declined.vendorReason) findings.push('(B) a probed+declined slot lost its vendorReason — the vendor answer must be carried verbatim, not reduced to a boolean.')

    const never = by('r_never_probed', 'segments.c')
    if (!never) findings.push('(B) an UNPROBED slot produced NO ROW. That is the `if (!p) continue` defect exactly: never-asked collapsing into does-not-exist.')
    else {
      if (never.probed !== false) findings.push(`(B) an unprobed slot came back probed:${never.probed} — it must be probed:false.`)
      if (never.delivers !== undefined) findings.push(`(B) an unprobed slot carries delivers:${never.delivers}. NOBODY ASKED — it may not assert a delivery verdict either way.`)
      if (!never.skipReason) findings.push('(B) an unprobed slot carries no skipReason. "Never asked" is only honest when it says why.')
    }

    const zero = by('r_zero_metric', 'segments.d')
    if (!zero || zero.probed !== false || !/0 selectable metrics|0 metrics/i.test(zero.skipReason || '')) {
      findings.push(`(B) a slot on a zero-metric resource did not come back probed:false with a metric-count reason (got ${JSON.stringify(zero)}).`)
    }

    // THE COLLAPSE TEST: an unprobed row and a declined row must be DISTINGUISHABLE without inference.
    if (never && declined && never.probed === declined.probed) {
      findings.push('(B) an unprobed slot and a declined slot carry the SAME `probed` value — the two states are indistinguishable, which is the whole defect.')
    }
  }

  // build() must REFUSE malformed states rather than emit them.
  const bad = { resources: [{ name: 'r', metrics: ['metrics.impressions'], segments: ['segments.x'] }] }
  let threw = false
  try { gen.build({ catalog: bad, probes: { surfaces: {}, slots: { 'r|segments.x': { distinctValues: 1 } } }, capture }) } catch { threw = true }
  if (!threw) findings.push('(B) build() ACCEPTED a probed slot with no delivers verdict. A probe that ran must record what the vendor said; emitting it silently is how a verdict goes missing.')
}

// ── (C) THE LIVE ARTIFACT IS INTERNALLY HONEST ─────────────────────────────────────────────────────────────
{
  for (const e of doc.entries) {
    const id = `${e.resource}|${e.segment || ''}`
    if (e.probed === false && e.delivers !== undefined) { findings.push(`(C) ${id} is probed:false yet asserts delivers:${e.delivers} — nobody asked, so nothing may be claimed.`); break }
    if (e.probed === false && !e.skipReason) { findings.push(`(C) ${id} is probed:false with no skipReason.`); break }
    if (e.probed === true && e.delivers === undefined) { findings.push(`(C) ${id} is probed:true with no delivers verdict.`); break }
    if (e.probed === true && e.delivers === false && !e.vendorReason) { findings.push(`(C) ${id} declined with no vendorReason — a refusal and an observed zero are different facts and must not both be a bare false.`); break }
  }
}

if (findings.length) {
  console.error(`[universe-artifact-slots] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
const a = doc.slotAccounting
console.log(`[universe-artifact-slots] PASS — ${a.emittedRows}/${a.declaredSlots} declared catalog slots emit a row; ${a.probedTrue} probed (${a.delivering} delivering, ${a.declined} declined with a reason) and ${a.probedFalse} unprobed, each saying why. probed and delivers remain two facts.`)
