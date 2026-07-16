#!/usr/bin/env node
// LORAMER_META_BREADTH_FORWARD_GUARD_V1
//
// FAILS if any Meta breadth dimension has a BACKFILL writer but no FORWARD capture.
//
// THE BUG IT GUARDS (2026-07-15 master audit, G1): six Meta breadth writers shipped with drain entries and NO forward
// wiring. The drain's rangeLap walks strictly BACKWARD, so each dim's data froze at its own ship date while clients
// kept spending — and meta_device/meta_video reached floor with backfill_complete=13/13, sealing the hole permanently.
// Nothing failed. sync_state read "complete", the cron returned 200, and 1,903 rows/client/day silently stopped
// existing. This guard is the mechanical check that would have caught it on the writer's own commit.
//
// IT GUARDS THE CLASS, NOT THE TEN. Nothing here is hardcoded to today's dimensions: the declared set is DERIVED from
// the writers themselves. Add a 7th writer emitting an 11th breakdown_type and forget to wire it forward → this FAILS.
//
// AUTHORITATIVE SOURCE = THE CODE, deliberately NOT docs/LORAMER_BREAKDOWN_REGISTRY.md.
// A guard built on a doc guards the doc. G3 is the proof: the registry says Google age/gender are "VERIFIED in-code"
// — true of the FETCH, false of persistence, and zero rows have ever landed. A doc can be honest-but-false; the
// writers cannot lie about which breakdown_type literals they emit. (Registry-vs-code drift is a SEPARATE guard.)
//
// HERMETIC: pure filesystem reads. No network, no DB, no API, no writes. Safe in CI/build.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BACKFILL_DIR = resolve(ROOT, 'src/lib/backfill')
const FORWARD_LIST = resolve(BACKFILL_DIR, 'meta-breadth-forward.ts')
const FORWARD_BASE_WRITER = resolve(ROOT, 'src/lib/intelligence/meta-metrics-row.ts')
const CRON_PATHS = [
  resolve(ROOT, 'src/app/api/cron/sync/route.ts'),
  resolve(ROOT, 'src/app/api/cron/catchup/route.ts'),
]

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
// Every row-builder in this codebase writes the breakdown_type as an object-literal key with a string literal.
const typesIn = (src) => new Set([...src.matchAll(/breakdown_type:\s*'([a-z_]*)'/g)].map((m) => m[1]))
const fail = (msg) => { failures.push(msg) }
const failures = []

// ── 1. DECLARED: every breadth breakdown_type any Meta backfill writer can emit ────────────────────────────────
// '' is the base-row sentinel (BREAKDOWN_REGISTRY §1), not a breadth dim — depth writers (campaign/adset_ad) emit
// only '' and are correctly excluded.
const writerFiles = readdirSync(BACKFILL_DIR).filter((f) => /^meta-.*-backfill\.ts$/.test(f))
if (writerFiles.length === 0) fail('no meta-*-backfill.ts writers found — guard cannot be trusted; check BACKFILL_DIR')
const declaredBy = new Map() // breakdown_type -> writer file that declares it
for (const f of writerFiles) {
  for (const t of typesIn(read(resolve(BACKFILL_DIR, f)) || '')) {
    if (t === '') continue
    if (!declaredBy.has(t)) declaredBy.set(t, f)
  }
}

// ── 2. Types the FORWARD BASE writer already covers (meta-metrics-row.ts: base '' + 'placement') ───────────────
const baseSrc = read(FORWARD_BASE_WRITER)
if (!baseSrc) fail(`forward base writer not found: ${FORWARD_BASE_WRITER}`)
const coveredByBase = new Set([...typesIn(baseSrc || '')].filter((t) => t !== ''))

// ── 3. Types covered by the shared forward breadth list (resolve each listed writer, read what IT emits) ───────
const listSrc = read(FORWARD_LIST)
const coveredByBreadth = new Set()
let listedWriters = []
if (!listSrc) {
  fail(`MISSING: ${FORWARD_LIST} — the shared forward breadth list does not exist, so NO Meta breadth dim has forward capture.`)
} else {
  // Resolve the actual modules imported by the list, then read the breakdown_types THEY emit — never trust the list's
  // own labels (a `key` is a log label, not a breakdown_type; 'device' writes device AND device_platform).
  listedWriters = [...listSrc.matchAll(/from\s+'\.\/(meta-[a-z-]+-backfill)'/g)].map((m) => m[1] + '.ts')
  const listedInArray = [...listSrc.matchAll(/run:\s*(run[A-Za-z]+)\s+as/g)].map((m) => m[1])
  if (listedInArray.length !== listedWriters.length) {
    fail(`meta-breadth-forward.ts imports ${listedWriters.length} writers but registers ${listedInArray.length} in META_BREADTH_FORWARD — an imported-but-unregistered writer is not wired.`)
  }
  for (const f of listedWriters) {
    const src = read(resolve(BACKFILL_DIR, f))
    if (!src) { fail(`meta-breadth-forward.ts imports ${f} which does not exist`); continue }
    for (const t of typesIn(src)) if (t !== '') coveredByBreadth.add(t)
  }
}

// ── 4. THE ASSERTION: every declared breadth type is covered by forward capture ────────────────────────────────
const uncovered = [...declaredBy.keys()]
  .filter((t) => !coveredByBase.has(t) && !coveredByBreadth.has(t))
  .sort()
for (const t of uncovered) {
  fail(`breakdown_type '${t}' (declared by ${declaredBy.get(t)}) has a BACKFILL writer but NO FORWARD capture — it will freeze at its ship date. Add its writer to META_BREADTH_FORWARD in src/lib/backfill/meta-breadth-forward.ts.`)
}

// ── 5. BOTH cron paths must iterate the SHARED list (L64: two authorities that can disagree are a stall trap) ──
for (const p of CRON_PATHS) {
  const src = read(p)
  const rel = p.replace(ROOT + '/', '')
  if (!src) { fail(`cron path not found: ${rel}`); continue }
  if (!/META_BREADTH_FORWARD/.test(src)) {
    fail(`${rel} does not reference META_BREADTH_FORWARD — this forward path captures NO Meta breadth (sync and catchup must not drift).`)
    continue
  }
  if (!/for\s*\(\s*const\s+\w+\s+of\s+META_BREADTH_FORWARD\s*\)/.test(src)) {
    fail(`${rel} imports META_BREADTH_FORWARD but never iterates it — an unused import is not capture.`)
  }
}

// ── REPORT ────────────────────────────────────────────────────────────────────────────────────────────────────
const declared = [...declaredBy.keys()].sort()
const covered = declared.filter((t) => coveredByBase.has(t) || coveredByBreadth.has(t))
console.log('LORAMER_META_BREADTH_FORWARD_GUARD_V1')
console.log(`  meta backfill writers scanned : ${writerFiles.length}`)
console.log(`  breadth types DECLARED (code) : ${declared.length} → ${declared.join(', ') || '(none)'}`)
console.log(`  covered by forward base writer: ${[...coveredByBase].sort().join(', ') || '(none)'}`)
console.log(`  covered by META_BREADTH_FORWARD (${listedWriters.length} writers): ${[...coveredByBreadth].sort().join(', ') || '(none)'}`)
console.log(`  covered / declared            : ${covered.length}/${declared.length}`)

if (failures.length) {
  console.error('\n✗ GUARD FAILED — Meta breadth capture is incomplete:\n')
  for (const f of failures) console.error('  • ' + f)
  console.error('\nWHY THIS MATTERS: a backfill-only dim freezes at its ship date and, once its cursor reaches floor')
  console.error('(backfill_complete=true), the hole is PERMANENT — no forward writer, no drain, no alarm.\n')
  process.exit(1)
}
console.log('\n✓ GUARD PASSED — every declared Meta breadth dimension has forward capture, and both cron paths iterate the shared list.')
