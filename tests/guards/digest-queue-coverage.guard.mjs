#!/usr/bin/env node
// LORAMER_DIGEST_QUEUE_COVERAGE_GUARD_V1
//
// FORCING FUNCTION for the resume path: every OPEN, TRACKED item in LORAMER_QUEUE_OF_RECORD.md must appear in
// the regenerated LORAMER_RESUME_DIGEST.md section H. If one does not, the build FAILS and names it.
//
// WHY THIS EXISTS. §H has now silently dropped real work TWICE. 2026-07-17: the extractor sliced the queue at
// the DONE marker and lost every item banked below it (31 open items). 2026-07-19: it matched only "- " bullets,
// so the ENTIRE indented fill queue — the active build order — was absorbed as continuation text and truncated
// (M-FILL#3, GA-FILL#1, W-FILL#*, S-FILL#4-7, G-FILL#4-10 all invisible), AND its status gate silently dropped
// any tagged item that did not use the "src: … open [TAG]" prose convention. Both omissions were invisible from
// the digest itself: it read complete because nothing announces what is missing. Prose cannot catch that. A
// check that fails the build can. (ESSENCE FIX-WITH-GUARD: a fix is not done until a mechanical check fails
// when it regresses; the guard ships in the same commit.)
//
// INDEPENDENCE: this deliberately does NOT import the extractor. It re-derives the expected set from the QUEUE
// with its own simple rules, so a regression in build-resume-digest.mjs cannot hide behind shared logic. The two
// implementations agreeing is the signal; if they drift, this fails and a human decides which is right.
//
// EXIT: 0 = every expected item present · 1 = one or more missing (names printed) · 2 = cannot read the inputs.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }

const queue = read('LORAMER_QUEUE_OF_RECORD.md')
const digest = read('LORAMER_RESUME_DIGEST.md')
if (!queue || !digest) { console.error('✗ digest-queue-coverage: cannot read QUEUE and/or DIGEST'); process.exit(2) }

// §H span of the digest
const hStart = digest.indexOf('## H. OPEN-QUEUE INDEX')
const hEnd = digest.indexOf('\n## I.', hStart)
if (hStart === -1 || hEnd === -1) { console.error('✗ digest-queue-coverage: digest section H not found — the digest shape changed'); process.exit(2) }
const sectionH = digest.slice(hStart, hEnd)

// ── expected set, derived independently from the QUEUE ───────────────────────────────────────────────────
const lines = queue.split('\n')
const doneMarker = lines.findIndex((l) => l.includes('DONE — DO NOT REBUILD'))
const fence = /^═+/u
let appendixEnd = lines.length
if (doneMarker !== -1) {
  const fenceAfter = lines.findIndex((l, i) => i > doneMarker && fence.test(l))
  for (let i = (fenceAfter === -1 ? doneMarker : fenceAfter) + 1; i < lines.length; i++) {
    if (fence.test(lines[i]) || /^##\s/.test(lines[i])) { appendixEnd = i; break }
  }
}
const TAG = /\[(?:LC|NP|EXT|DG)[^\]]*\]/
const FILL = /^[A-Z]{1,3}-FILL\b/
// DONE detection mirrors the queue's authored vocabulary, split by shape exactly as the extractor does — a
// FILL marks itself done at the HEAD of the entry; a "- " bullet may mention a finished SLICE mid-line and
// still be open, so only the narrow words count there.
const fillDone = (t) => /^[A-Z]{1,3}-FILL\S*(\s+\S+)?\s+✅\s*(SHIPPED|DONE|COMPLETE|CLOSED|RESOLVED|FIXED|APPLIED)\b/i.test(t)
const bulletDone = (t) => /✅\s*(RESOLVED|FIXED|DONE)\b/i.test(t) || /^-\s*\[x\]/i.test(t)
const doneStatus = (t) => {
  const s = t.replace(/\([^)]*\)/g, ' ')
  let last = -1, re = /\[(?:LC|NP|EXT|DG)[^\]]*\]/g, m
  while ((m = re.exec(s))) last = m.index
  if (last < 0) return false
  const kws = [...s.slice(Math.max(0, last - 26), last).matchAll(/\b(open(?:-watch)?|partial|blocked|deferred|banked|parked|proposed|standing|resolved|done|closed)\b/gi)]
  return kws.length ? /^(resolved|done|closed)$/i.test(kws[kws.length - 1][1]) : false
}

const expected = []
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i]
  const t = raw.trimStart()
  const isBullet = t.startsWith('- ')
  const isFill = FILL.test(t)
  if (!isBullet && !isFill) continue
  if (i >= doneMarker && i < appendixEnd) continue                 // the DONE appendix blob
  if (!TAG.test(t)) continue                                       // untracked prose
  if (isFill ? fillDone(t) : bulletDone(t)) continue               // header says the whole item is done
  if (doneStatus(t)) continue                                      // terminal tag says done
  expected.push({ line: i + 1, text: t })
}

// ── assert presence ──────────────────────────────────────────────────────────────────────────────────────
// Match on a distinctive prefix rather than the whole line: §H carries header lines verbatim, but comparing
// full strings would make the guard brittle to any future trimming. 70 chars is long enough to be unique.
const keyOf = (t) => t.slice(0, 70)
const missing = expected.filter((e) => !sectionH.includes(keyOf(e.text)))

console.log('LORAMER_DIGEST_QUEUE_COVERAGE_GUARD_V1')
console.log(`  queue items expected in §H : ${expected.length}  (fill entries: ${expected.filter((e) => FILL.test(e.text)).length})`)
console.log(`  present in digest §H       : ${expected.length - missing.length}`)
console.log(`  MISSING                    : ${missing.length}`)

if (missing.length) {
  console.error('\n✗ DIGEST-QUEUE COVERAGE GUARD FAILED — these OPEN queue items are absent from the digest §H:')
  for (const m of missing.slice(0, 25)) console.error(`  QUEUE:${m.line}  ${m.text.slice(0, 110)}`)
  if (missing.length > 25) console.error(`  … and ${missing.length - 25} more`)
  console.error('\n  The digest is the ONE paste read at session open. An item missing here is invisible work.')
  console.error('  FIX: regenerate with `node scripts/build-resume-digest.mjs` (and re-stamp docs/HANDOFF_MANIFEST.json')
  console.error('  for any changed gated doc). If it is still missing after regenerating, the §H extractor dropped it —')
  console.error('  that is the bug, not the queue.')
  process.exit(1)
}
console.log('\n✓ GUARD PASSED — every open, tracked queue item appears in the regenerated digest §H.')
