#!/usr/bin/env node
// LORAMER_LORA_GROUNDING_GATE_V1
//
// FORCING FUNCTION for LAYER 1→2 of the LORA-COMPLETENESS AUDIT (DECISIONS: LORAMER_LORA_COMPLETENESS_AUDIT_V1 —
// six layers: queryable · retrieved · in-context · interpreted · cross-referenced · remembered; the law says the arc
// MUST terminate in a CODE GATE, not a doc). This gate covers the seam the capture gate cannot see: a family can be
// perfectly CAPTURED and perfectly ENUMERATED and still be invisible to Lora, because an enum member with no prose
// is a name she has no reason to select and no idea how to read.
//
// SIBLING of scripts/check-capture-completeness.mjs, modelled on it deliberately (same parse, same baseline
// mechanics, same self-limiting green line). That gate asks "is every captured family DECLARED?" — this one asks
// "is every declared family DISCOVERABLE and SAFELY READABLE?"
//
// SOURCES (hermetic — pure filesystem reads; no network, no DB; safe in CI/build):
//   • src/lib/breakdown-registry.ts  — the ONE declared source; both the tool enums and the query layer derive from it.
//   • src/lib/claude-tools.ts        — the query_breakdown tool literal, whose PROSE is the discovery surface.
//
// ── THE TWO ASSERTIONS, and why each is the honest one for its layer ────────────────────────────────────────────
// (a) DISCOVERABLE. Every tool-facing type in the GENERATED enum must also appear in the query_breakdown tool's
//     HAND-WRITTEN prose. The enum is generated and therefore always complete; the prose is typed by a human and
//     therefore drifts. An enum member with no prose is reachable in principle and unreachable in practice: nothing
//     tells Lora the dimension exists, what it means, or when to reach for it. Measured 2026-07-20 at 28 of 61 —
//     the 33 missing were, almost exactly, the two most recent days of capture work.
// (b) CAVEAT-COVERED. Every LOAD-BEARING entry must carry a non-empty `note`. Load-bearing is DERIVED from the
//     registry's own flags, never a hand-kept list (a hand-kept list is the drift this file exists to kill):
//       · additive: false        → a non-additive projection. Summing it produces a confident WRONG number.
//       · highCardinality: true  → wide reads risk the 8s statement_timeout; results truncate, and a truncated
//                                  ranking silently reads as a complete one.
//       · rankBy: 'conversions'  → the SPEND_ZERO families. Their spend columns are 0 BY CONSTRUCTION; reading that
//                                  0 as "this converted for free" is the failure mode.
//
// ⚠ DELIBERATE NARROWING, stated on the face of it: GEO MEMBERSHIP ALONE DOES NOT REQUIRE A PER-ENTRY NOTE.
//   The geo caveat that actually matters — ad-location (where you TARGETED) vs user-location (where the person
//   PHYSICALLY WAS), which are NOT interchangeable — is already owned, in full, by the geoScope/geoGrain
//   descriptions in the tool schema. Requiring it again on each of the 23 geo entries would manufacture 23 copies
//   of one fact, which is the exact pathology the DOC-OWNERSHIP gates exist to stop (~27 copied facts, 5 of the 7
//   silent-drift defects of 2026-07-16/17). A copy in code is not safer than a copy in a doc — it is the same bug
//   with a compiler. Geo entries that are ALSO high-cardinality are still caught, by the high-cardinality rule,
//   which is the part that carries real per-family risk. Flip REQUIRE_NOTE_ON_ALL_GEO to true to demand them.
//
// NOT what green means: green proves a tool-type is NAMED and a risky family is ANNOTATED. It does NOT prove Lora
// reads the note, selects the right dimension, or reasons correctly — that is the eval set's question
// (tests/lora-evals), and no static gate can answer it. Stated so a green run is never mistaken for the larger claim.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }

// ── BASELINE — the completion queue, same contract as the capture gate's KNOWN_INCOMPLETE ───────────────────────
// A gap listed here is GRANDFATHERED (does not fail). A gap NOT listed FAILS. An entry listed here that is no
// longer a gap ALSO FAILS (stale baseline) — so the queue can only ever shrink. Format: 'discover:<toolType>'
// or 'caveat:<platform>.<breakdown_type>'.
export const KNOWN_LORA_GAPS = [
  // EMPTY BY INTENT. The 2026-07-20 red baseline (33 undiscoverable + 8 uncaveated) was CLOSED by fixing the
  // content, not by baselining it. Add an entry here only to deliberately defer a gap, never to silence one.
]

const REQUIRE_NOTE_ON_ALL_GEO = false // see the DELIBERATE NARROWING note above

// ── parse the registry (same line contract the capture gate + reachability check rely on) ────────────────────────
const registrySrc = read('src/lib/breakdown-registry.ts')
if (!registrySrc) { console.error('✗ lora-grounding gate: cannot read src/lib/breakdown-registry.ts'); process.exit(2) }

const entries = []
for (const line of registrySrc.split('\n')) {
  if (line.trimStart().startsWith('//')) continue
  if (!/breakdownType:/.test(line) || !/surface:/.test(line)) continue // BOTH required — excludes the interface field
  const platform = line.match(/platform:\s*'([a-z]+)'/)?.[1]
  const bt = line.match(/breakdownType:\s*'([^']*)'/)?.[1]
  const toolType = line.match(/toolType:\s*'([^']*)'/)?.[1]
  const surface = line.match(/surface:\s*'([a-z]+)'/)?.[1]
  if (!platform || bt === undefined || toolType === undefined) continue
  if (bt === '' || surface === 'base') continue // base rows are read via query_metrics `level`, not query_breakdown
  entries.push({
    platform, bt, toolType,
    additive: !/additive:\s*false/.test(line),
    highCardinality: /highCardinality:\s*true/.test(line),
    spendZero: /rankBy:\s*'conversions'/.test(line),
    isGeo: toolType === 'geo' || /geoScope:/.test(line),
    note: (line.match(/note:\s*'(.*)'/)?.[1] || '').trim(),
  })
}
// PARSER TRIPWIRE — refuse to vouch for a parse this file cannot trust (mirrors the capture gate's guard).
if (entries.length < 30) {
  console.error(`✗ lora-grounding gate: only ${entries.length} registry entries parsed — the parser or breakdown-registry.ts changed; cannot be trusted`)
  process.exit(2)
}

// ── the DISCOVERY SURFACE = the query_breakdown tool literal's hand-written prose ────────────────────────────────
const toolsSrc = read('src/lib/claude-tools.ts')
if (!toolsSrc) { console.error('✗ lora-grounding gate: cannot read src/lib/claude-tools.ts'); process.exit(2) }
const start = toolsSrc.indexOf('QUERY_BREAKDOWN_TOOL')
const end = toolsSrc.indexOf('runQueryBreakdownTool')
if (start < 0 || end < 0 || end <= start) { console.error('✗ lora-grounding gate: cannot locate the QUERY_BREAKDOWN_TOOL literal in claude-tools.ts'); process.exit(2) }
// Strip the GENERATED enum calls: they always contain every type, so counting them would make this gate
// tautologically green. Only prose a human typed counts as discovery.
const prose = toolsSrc.slice(start, end).replace(/breakdownToolTypes\(\)|breakdownPlatforms\(\)|breakdownEntityLevels\(\)|geoGrains\(\)|geoScopes\(\)/g, '')

// ── findings ────────────────────────────────────────────────────────────────────────────────────────────────────
const toolTypes = [...new Set(entries.map((e) => e.toolType))].sort()
const findings = []
for (const tt of toolTypes) {
  if (!new RegExp(`\\b${tt}\\b`).test(prose)) findings.push({ kind: 'discover', key: `discover:${tt}`, label: tt, why: 'in the generated enum, never named in the tool prose — Lora has no reason to select it' })
}
for (const e of entries) {
  const reasons = []
  if (!e.additive) reasons.push('non-additive')
  if (e.highCardinality) reasons.push('high-cardinality')
  if (e.spendZero) reasons.push('spend-zero')
  if (REQUIRE_NOTE_ON_ALL_GEO && e.isGeo) reasons.push('geo')
  if (reasons.length && !e.note) {
    findings.push({ kind: 'caveat', key: `caveat:${e.platform}.${e.bt}`, label: `${e.platform}.${e.bt}`, why: `load-bearing (${reasons.join(' + ')}) with an EMPTY note` })
  }
}

// ── classify against the baseline ───────────────────────────────────────────────────────────────────────────────
const baseline = new Set(KNOWN_LORA_GAPS)
const accepted = findings.filter((f) => baseline.has(f.key))
const novel = findings.filter((f) => !baseline.has(f.key))
const findingKeys = new Set(findings.map((f) => f.key))
const stale = [...baseline].filter((k) => !findingKeys.has(k))

// ── REPORT ──────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('LORAMER_LORA_GROUNDING_GATE_V1')
console.log(`  registry breakdown entries : ${entries.length}  |  distinct tool-facing types : ${toolTypes.length}`)
console.log(`  discoverable in prose      : ${toolTypes.length - findings.filter((f) => f.kind === 'discover').length}/${toolTypes.length}`)
console.log(`  findings : ${findings.length}  (undiscoverable ${findings.filter((f) => f.kind === 'discover').length} · uncaveated ${findings.filter((f) => f.kind === 'caveat').length})  |  baselined ${accepted.length} · NEW ${novel.length} · stale-baseline ${stale.length}`)

if (findings.length) {
  console.log('\nLORA-GROUNDING QUEUE — declared families Lora cannot find, or can misread:')
  for (const f of findings.sort((a, b) => (a.kind + a.label).localeCompare(b.kind + b.label))) {
    console.log(`  ${baseline.has(f.key) ? '·' : '★'} ${f.kind.toUpperCase().padEnd(8)} ${f.label.padEnd(30)} ${f.why}`)
  }
  console.log('  (· = baselined/known-queue · ★ = NEW — this run introduced it → FAILS)')
}

const fatal = []
if (novel.length) fatal.push(`${novel.length} NEW grounding gap(s) — a family must be DISCOVERABLE (named in the query_breakdown prose) and, if load-bearing, CAVEATED (non-empty note) before it lands. Fix the content, or (deliberately) add its key to KNOWN_LORA_GAPS to defer it.`)
if (stale.length) fatal.push(`${stale.length} STALE baseline entr(ies) [${stale.join(', ')}] — no longer gaps but still listed. Remove them so the queue reflects reality.`)

if (fatal.length) {
  console.error('\n✗ LORA-GROUNDING GATE FAILED:')
  for (const f of fatal) console.error('  • ' + f)
  process.exit(1)
}
console.log(`\n✓ GATE PASSED — every declared tool-type is named in the tool prose; every load-bearing family carries a caveat. (discoverability + caveat-presence; NOT proof Lora reasons correctly — that's the eval set.)`)
