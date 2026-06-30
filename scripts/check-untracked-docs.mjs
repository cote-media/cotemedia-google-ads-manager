#!/usr/bin/env node
// LORAMER_UNTRACKED_DOC_DETECTOR_V1 — the CREATION catch for the doc registry. The freshness gate catches CHANGES to
// tracked docs and the wrap-gate forces re-stamping them, but NEITHER catches a BRAND-NEW doc that was never added to
// the manifest — a load-bearing doc can be written and silently never enter the handoff (how TOMORROW_OPENING_MESSAGE
// rotted). This read-only checker buckets every git-tracked .md/.txt and FAILS (exit 1) on anything UNBUCKETED.
//
// Buckets: GATED (in SOURCE_DOCS) · TRACKED (in HANDOFF_MANIFEST.json) · IGNORE (matches docs/DOC_REGISTRY_IGNORE.txt).
// UNTRACKED = none of the above = an offender. Pure read, no writes.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8')

// GATED = the SOURCE_DOCS array in the digest builder (single source of truth; parsed, not duplicated).
function parseSourceDocs() {
  const m = read('scripts/build-resume-digest.mjs').match(/const SOURCE_DOCS = \[([^\]]*)\]/)
  if (!m) { console.error('FATAL: could not parse SOURCE_DOCS from build-resume-digest.mjs'); process.exit(2) }
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

// IGNORE = path-or-glob lines (strip the trailing "# reason" comment); '*' is a wildcard.
function parseIgnore() {
  let lines
  try { lines = read('docs/DOC_REGISTRY_IGNORE.txt').split('\n') } catch { return [] }
  return lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('#')[0].trim())
    .filter(Boolean)
}
const toRegex = (glob) => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')

const gated = new Set(parseSourceDocs())
const tracked = new Set(Object.keys(JSON.parse(read('docs/HANDOFF_MANIFEST.json'))))
const ignore = parseIgnore().map(toRegex)
const docs = execSync("git ls-files '*.md' '*.txt'", { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean)

const buckets = { GATED: [], TRACKED: [], IGNORE: [], UNTRACKED: [] }
for (const d of docs) {
  if (gated.has(d)) buckets.GATED.push(d)
  else if (tracked.has(d)) buckets.TRACKED.push(d)
  else if (ignore.some((re) => re.test(d))) buckets.IGNORE.push(d)
  else buckets.UNTRACKED.push(d)
}

console.log(`Doc registry: ${docs.length} tracked .md/.txt → GATED ${buckets.GATED.length} · TRACKED ${buckets.TRACKED.length} · IGNORE ${buckets.IGNORE.length} · UNTRACKED ${buckets.UNTRACKED.length}`)
if (buckets.UNTRACKED.length) {
  console.error('\n❌ UNTRACKED docs (in NO bucket — add to HANDOFF_MANIFEST.json [TRACKED], SOURCE_DOCS [GATED, Russ-approved], or docs/DOC_REGISTRY_IGNORE.txt):')
  for (const d of buckets.UNTRACKED) console.error('   - ' + d)
  process.exit(1)
}
console.log('✅ CLEAN — every tracked doc is bucketed (no untracked docs).')
