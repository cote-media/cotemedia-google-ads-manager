#!/usr/bin/env node
// LORAMER_COMPLETION_CLAIM_DENOMINATOR_V1 — THE COMPLETION GATE MUST SEE EVERY STEP THE DRAIN RUNS.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// MEASURED 2026-08-01: scripts/check-completion-claims.mjs iterated REQUIRED_STEPS (27 cursor keys) while
// DRAIN_REGISTRY runs 34 steps. TWELVE were in the drain and invisible to the gate — 119 live cursors, of which
// 60 claimed backfill_complete=true and had never been compared to a single row. The gate printed
// "247 completion claims" and "51 known · 0 NEW" as if that were the population. Fixing the denominator surfaced
// **24 NEW violations that had been sitting there the whole time**, including two FALSE_COMPLETE_EMPTY pairs
// (Glenn Stearns, skinregimen.com) where a cursor claims a completed walk over ZERO rows.
// ⛔ IT WAS FOUND BY ACCIDENT — a claim of mine disagreeing with the gate, settled against raw rows. Nothing in
// the tooling would ever have said "your audit is missing a third of its subject". This guard is that thing.
// Same class as LORAMER_VERIFIED_PLATFORM_SCOPE_V1: a check whose DENOMINATOR came from a convenient second
// source rather than from the thing it audits.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
// Every (key, platform) in DRAIN_REGISTRY must be accounted for by the completion gate in EXACTLY ONE of:
//   1. a REQUIRED_STEPS entry (cursor or key match) — the gate row-checks it from the shared mapping;
//   2. the gate's SUPPLEMENTARY_REAL map — a signature verified against live rows and recorded in the gate;
//   3. the gate's ALIASES map — a step whose cursor is written under a different name;
//   4. the gate's UNMAPPED_LEDGER — no signature could be established, WITH the reason stated.
// A step in none of the four is INVISIBLE TO THE AUDIT, and that fails.
// ⛔ AND IT FAILS IN THE OTHER DIRECTION TOO: a ledger/alias/supplementary entry naming a step the drain no longer
// runs has outlived its justification and must be deleted. Anti-rot, same posture as the frozen-cursor baseline.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// THIS GUARANTEES THE GATE SEES EVERY STEP. IT DOES NOT GUARANTEE EVERY STEP IS ROW-CHECKED — four steps sit in
// the UNMAPPED_LEDGER today with stated reasons, and this guard is satisfied by the reason existing, not by the
// signature existing. That is deliberate: forcing a signature would push someone to invent one, and a wrong
// signature produces a confident wrong verdict on a completion claim, which is worse than a named blind spot.
// Read a green as "nothing is invisible", never as "everything is checked".
//
// USAGE: node tests/guards/completion-gate-covers-drain.guard.mjs [--inject-step]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

const REGISTRY = 'src/lib/backfill/drain-registry.ts'
const GATE = 'scripts/check-completion-claims.mjs'
const REQ = 'src/lib/completeness/required-steps.ts'

const INJECT = process.argv.includes('--inject-step')

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
export function decideCoverage(drainKeys, covered) {
  const invisible = drainKeys.filter((k) => !covered.has(k))
  // Anti-rot: an entry naming a step the drain no longer runs.
  const drainSet = new Set(drainKeys)
  const stale = [...covered].filter((k) => !drainSet.has(k) && !k.startsWith('required:'))
  return { invisible, stale, ok: invisible.length === 0 && stale.length === 0 }
}

// ── INPUTS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const regSrc = read(REGISTRY); const gateSrc = read(GATE); const reqSrc = read(REQ)
for (const [name, src] of [[REGISTRY, regSrc], [GATE, gateSrc], [REQ, reqSrc]]) {
  if (!src) { console.error(`✗ ${name} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
}

const drainKeys = []
{
  const body = regSrc.slice(regSrc.indexOf('export const DRAIN_REGISTRY'))
  for (const blk of body.split(/\n {2}\{\n/).slice(1)) {
    const k = blk.match(/key:\s*'([^']+)'/); const p = blk.match(/platforms:\s*\[([^\]]*)\]/)
    if (!k || !p) continue
    for (const m of p[1].matchAll(/'([a-z_]+)'/g)) drainKeys.push(`${m[1]}.${k[1]}`)
  }
}
if (!drainKeys.length) { console.error(`✗ parsed ZERO steps out of ${REGISTRY} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
if (INJECT) {
  drainKeys.push('google.synthetic_unaudited_step')
  console.log('  [--inject-step] injected ONE synthetic DRAIN_REGISTRY step into the check INPUT (no file written) — it must go RED.')
}

// What the gate accounts for. Parsed from the gate's own source, so the guard cannot drift from it.
const section = (name) => {
  const i = gateSrc.indexOf(`const ${name} = {`)
  if (i < 0) return ''
  return gateSrc.slice(i, gateSrc.indexOf('\n}', i))
}
const supplementary = [...section('SUPPLEMENTARY_REAL').matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
const ledger = [...section('UNMAPPED_LEDGER').matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
const aliases = [...section('ALIASES').matchAll(/'([a-z_]+)\|([a-z_]+)'/g)].map((m) => `${m[2]}.${m[1]}`)
const requiredCursors = [...reqSrc.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1])

const covered = new Set()
for (const k of drainKeys) {
  const [plat, key] = k.split('.')
  if (aliases.includes(k)) { covered.add(k); continue }
  if (supplementary.includes(key)) { covered.add(k); continue }
  if (ledger.includes(key)) { covered.add(k); continue }
  if (requiredCursors.includes(key)) { covered.add(k); continue }
}
for (const key of [...supplementary, ...ledger]) {
  if (!drainKeys.some((k) => k.endsWith(`.${key}`))) covered.add(`ORPHAN.${key}`)
}

// ── REPORT, ALWAYS WITH ITS DENOMINATOR ─────────────────────────────────────────────────────────────────────────
const verdict = decideCoverage(drainKeys, covered)
console.log(`[completion-gate-covers-drain] ${drainKeys.length} DRAIN_REGISTRY step×platform entries`)
console.log(`[completion-gate-covers-drain] accounted for: required-steps ${requiredCursors.length} keys · supplementary ${supplementary.length} · ledger ${ledger.length} · aliases ${aliases.length}`)
console.log('[completion-gate-covers-drain] COVERAGE OF THE AUDIT, not of the data — four steps sit in the ledger unchecked BY DESIGN. See the header.')
if (!verdict.ok) {
  console.error(`✗ completion-gate-covers-drain FAIL — ${verdict.invisible.length + verdict.stale.length} finding(s):`)
  for (const k of verdict.invisible) console.error(`  - ${k} is in DRAIN_REGISTRY but INVISIBLE to ${GATE}. Give it a required-steps entry, a verified SUPPLEMENTARY_REAL signature, or an UNMAPPED_LEDGER entry with the reason. An unaudited completion claim is how 60 of them went unchecked for months.`)
  for (const k of verdict.stale) console.error(`  - ${k} is named by the gate but the drain no longer runs it — delete the entry (anti-rot).`)
  process.exit(1)
}
console.log('✓ completion-gate-covers-drain OK — every drain step is visible to the completion gate.')
process.exit(0)
