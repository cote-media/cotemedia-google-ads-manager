#!/usr/bin/env node
// LORAMER_CAPTURE_COMPLETENESS_GATE_V1
//
// FORCING FUNCTION: fails the build (wired into `npm run guard` → `npm run build`, the pre-push gate) when a
// breakdown family we declare `captured` is actually a SLICE of the vendor surface — captured at FEWER grains than
// docs/LORAMER_DATA_COMPLETENESS.md says the vendor serves (scripts/capture-surface.manifest.mjs), OR captured by a
// writer but ABSENT from the query-layer source (src/lib/breakdown-registry.ts → Lora cannot read it = "unwired").
//
// SOURCES (hermetic — pure filesystem reads; no network, no DB; safe in CI/build):
//   • scripts/capture-surface.manifest.mjs  — DECLARED vendor-complete grain set + status per (platform, breakdown_type).
//   • src/lib/breakdown-registry.ts         — the CURATED captured grains (entityLevels) per (platform, breakdown_type),
//                                             the ONE source the query_breakdown enum + metrics-query allowlist derive from.
//
// BASELINE (why the build isn't bricked): the first run discovers the CURRENT slices/unwired; those are recorded in the
// manifest's KNOWN_INCOMPLETE allowlist = THE ORDERED COMPLETION QUEUE. The gate FAILS on any finding NOT in that
// allowlist (a NEW slice shipped) and on a STALE allowlist entry (a family that's now complete but still listed —
// shrink the queue). So going forward you cannot ship a family as a slice, and the queue can only shrink.
//
// NOT what green means: green proves manifest↔registry grain parity for `captured` families. It does NOT prove live-DB
// reachability (that's scripts/breakdown-reachability-check.mjs, prod). A green gate is not "Lora sees everything."
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import VENDOR_SURFACE, { KNOWN_INCOMPLETE } from './capture-surface.manifest.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }

// ── parse the captured grains per (platform, breakdown_type) from breakdown-registry.ts ─────────────────────────
const registrySrc = read('src/lib/breakdown-registry.ts')
if (!registrySrc) { console.error('✗ capture-completeness gate: cannot read src/lib/breakdown-registry.ts'); process.exit(2) }
const registry = new Map() // 'platform|bt' -> [entityLevels]
let parsed = 0
for (const line of registrySrc.split('\n')) {
  if (line.trimStart().startsWith('//')) continue
  if (!/breakdownType:/.test(line) || !/surface:/.test(line)) continue
  const platform = line.match(/platform:\s*'([a-z]+)'/)?.[1]
  const bt = line.match(/breakdownType:\s*'([^']*)'/)?.[1]
  const lv = line.match(/entityLevels:\s*\[([^\]]*)\]/)?.[1]
  if (!platform || bt === undefined || lv === undefined) continue
  if (bt === '') continue // base sentinel — not a breakdown
  const grains = lv.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  registry.set(`${platform}|${bt}`, grains)
  parsed++
}
if (parsed < 30) { console.error(`✗ capture-completeness gate: only ${parsed} registry entries parsed — the parser or breakdown-registry.ts changed; cannot be trusted`); process.exit(2) }

// ── compute findings: for every `captured` family, compare captured grains vs declared vendor-complete grains ────
const findings = [] // {platform, bt, kind:'slice'|'unwired', captured, complete, missing, note}
const manifestBugs = [] // captured MORE than declared complete → the manifest under-declares (fix the manifest)
let capturedChecked = 0
for (const [platform, fams] of Object.entries(VENDOR_SURFACE)) {
  for (const [bt, fam] of Object.entries(fams)) {
    if (fam.status !== 'captured') continue // gap/on-demand/deferred/removed = the queue, never grain-checked
    capturedChecked++
    const captured = registry.get(`${platform}|${bt}`)
    if (!captured) {
      findings.push({ platform, bt, kind: 'unwired', captured: [], complete: fam.grains, missing: fam.grains, note: fam.note })
      continue
    }
    const missing = fam.grains.filter((g) => !captured.includes(g))
    const extra = captured.filter((g) => !fam.grains.includes(g))
    if (missing.length) findings.push({ platform, bt, kind: 'slice', captured, complete: fam.grains, missing, note: fam.note })
    else if (extra.length) manifestBugs.push({ platform, bt, captured, complete: fam.grains, extra })
  }
}

// ── classify against the KNOWN_INCOMPLETE baseline (the completion queue) ────────────────────────────────────────
const key = (f) => `${f.platform}.${f.bt}`
const baseline = new Set(KNOWN_INCOMPLETE || [])
const accepted = findings.filter((f) => baseline.has(key(f)))
const novel = findings.filter((f) => !baseline.has(key(f)))
const findingKeys = new Set(findings.map(key))
const stale = [...baseline].filter((k) => !findingKeys.has(k)) // in the queue but no longer incomplete → complete it in the manifest/registry

// ── REPORT ──────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('LORAMER_CAPTURE_COMPLETENESS_GATE_V1')
console.log(`  registry (captured) tuples : ${parsed}  |  captured families checked : ${capturedChecked}`)
console.log(`  findings : ${findings.length}  (slice ${findings.filter((f) => f.kind === 'slice').length} · unwired ${findings.filter((f) => f.kind === 'unwired').length})  |  baselined ${accepted.length} · NEW ${novel.length} · stale-baseline ${stale.length}`)

const line = (f, tag) => {
  const reason = f.kind === 'slice'
    ? `captured [${f.captured.join(', ')}]  missing [${f.missing.join(', ')}]  of vendor [${f.complete.join(', ')}]`
    : `captured by writer but ABSENT from breakdown-registry.ts (Lora cannot read it) — declared vendor grains [${f.complete.join(', ')}]`
  return `  ${tag} ${f.kind.toUpperCase().padEnd(7)} ${(f.platform + '.' + f.bt).padEnd(34)} ${reason}`
}
if (findings.length) {
  console.log('\nCOMPLETION QUEUE — captured families that are NOT at full vendor surface:')
  for (const f of findings.sort((a, b) => (a.kind + a.platform + a.bt).localeCompare(b.kind + b.platform + b.bt))) {
    console.log(line(f, baseline.has(key(f)) ? '·' : '★'))
  }
  console.log('  (· = baselined/known-queue · ★ = NEW — this run introduced it → FAILS)')
}
if (manifestBugs.length) {
  console.log('\n⚠ MANIFEST UNDER-DECLARES (code captures MORE than the manifest calls complete — fix the manifest, not the code):')
  for (const b of manifestBugs) console.log(`  ${b.platform}.${b.bt} captures [${b.captured.join(', ')}] beyond declared [${b.complete.join(', ')}] (extra: ${b.extra.join(', ')})`)
}

const fatal = []
if (novel.length) fatal.push(`${novel.length} NEW slice/unwired family(ies) shipped — a fill must be COMPLETE (full vendor grains + wired to breakdown-registry.ts) before it lands. Fix it, or (deliberately) add "<platform>.<bt>" to KNOWN_INCOMPLETE in the manifest to grandfather it into the queue.`)
if (stale.length) fatal.push(`${stale.length} STALE baseline entr(ies) [${stale.join(', ')}] — these are now COMPLETE but still in KNOWN_INCOMPLETE. Remove them from the manifest so the queue reflects reality.`)
if (manifestBugs.length) fatal.push(`${manifestBugs.length} manifest under-declaration(s) — the declared vendor-complete grain set is smaller than what code captures; correct scripts/capture-surface.manifest.mjs.`)

if (fatal.length) {
  console.error('\n✗ CAPTURE-COMPLETENESS GATE FAILED:')
  for (const f of fatal) console.error('  • ' + f)
  process.exit(1)
}
console.log(`\n✓ GATE PASSED — no NEW slices; ${accepted.length} known-incomplete family(ies) remain the completion queue (baselined). (manifest↔registry grain parity; NOT live-DB reachability.)`)
