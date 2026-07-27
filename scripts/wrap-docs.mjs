#!/usr/bin/env node
// LORAMER_WRAP_DOCS_ORDER_V1 — THE WRAP'S DOC STEP, AS ONE COMMAND, IN AN ORDER THAT CANNOT BE GOT WRONG.
//
// ⛔ THE DEFECT THIS EXISTS TO KILL (diagnosed 2026-07-27 14:04Z, after a RED freshness gate cost the
// morning's fast path): the digest is built MID-WRAP, and it copies each source doc's content_hash FROM
// THE MANIFEST. If the manifest has not been re-stamped yet, the digest ships stamps describing the
// PREVIOUS state — so §A mismatches the manifest the moment the manifest is finally re-stamped, and the
// next morning's gate reads RED. That is a STRUCTURAL FALSE RED: the digest's BODY was fine; only its
// stamps were from the wrong point in time. It fired on EVERY wrap that stamped in the wrong order, and
// the same wrap shipped a superseded §E opener and a §G law that did not exist at the stamped commit —
// three different moments in one file.
//
// THE ORDER WAS ALREADY WRITTEN DOWN. LORAMER_HANDOFF.md step 6 → 6b says manifest FIRST, then digest,
// then re-stamp the digest's own entry. It was written down, and got done in the wrong order anyway.
// RULE-HOME LAW: a rule broken more than once does not need writing down again, it needs an ENFORCER.
// This is the enforcer — the order is now a function call sequence, not a thing to remember.
//
//   node scripts/wrap-docs.mjs            re-stamp → rebuild digest → re-stamp digest → verify
//   node scripts/wrap-docs.mjs --check    verify only, change nothing (what the guard runs)
//
// Hermetic apart from `git rev-parse HEAD`, which only ever fills in last_reconciled_head.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = 'docs/HANDOFF_MANIFEST.json'
const DIGEST = 'LORAMER_RESUME_DIGEST.md'
const abs = (rel) => path.join(ROOT, rel)
const read = (rel) => fs.readFileSync(abs(rel), 'utf8')

// The conventions the manifest has always used, stated once so a future stamper cannot drift from it:
// content_hash = sha256 of the raw file; line_count = split('\n').length (one MORE than `wc -l` for a
// file ending in a newline). Verified against the entries that were already correct.
export const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex')
export const linesOf = (text) => text.split('\n').length

const argv = process.argv.slice(2)
const CHECK_ONLY = argv.includes('--check')

// ── STEP 1 — RE-STAMP THE MANIFEST. Every tracked doc, not just the ones we think we touched. ───────
// "Every doc touched this session" is a judgement call, and judgement is what produced a CLAUDE.md
// entry stamped at c77be89 while the file had changed in 7ddebc5 and nobody noticed for four days.
// Comparing hashes is not a judgement call.
function restampManifest() {
  const manifest = JSON.parse(read(MANIFEST))
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()
  const today = execFileSync('date', ['-u', '+%Y-%m-%d'], { cwd: ROOT }).toString().trim()
  const changed = []
  const missing = []
  for (const [rel, entry] of Object.entries(manifest)) {
    if (!fs.existsSync(abs(rel))) { missing.push(rel); continue }
    const text = read(rel)
    const h = hashOf(text)
    if (h === entry.content_hash) continue
    changed.push({ rel, from: entry.content_hash.slice(0, 8), to: h.slice(0, 8), lines: `${entry.line_count}→${linesOf(text)}`, wasAt: entry.last_reconciled_head })
    entry.content_hash = h
    entry.line_count = linesOf(text)
    entry.last_reconciled_date = today
    entry.last_reconciled_head = head
  }
  if (missing.length) {
    console.error(`\n❌ MANIFEST NAMES ${missing.length} FILE(S) THAT DO NOT EXIST — a deleted or moved doc is still claimed as tracked:`)
    missing.forEach((m) => console.error('   • ' + m))
    process.exit(1)
  }
  if (!CHECK_ONLY && changed.length) fs.writeFileSync(abs(MANIFEST), JSON.stringify(manifest, null, 2) + '\n')
  return { changed, head, total: Object.keys(manifest).length }
}

// ── STEP 3 — RE-STAMP THE DIGEST'S OWN ENTRY, AFTER it has been rebuilt. ───────────────────────────
// Its `generated_at` changes on every run, so its hash ALWAYS changes; this is not optional and it can
// only happen after step 2.
function restampDigestEntry(head) {
  const manifest = JSON.parse(read(MANIFEST))
  if (!manifest[DIGEST]) { console.error(`❌ ${DIGEST} is not in the manifest at all.`); process.exit(1) }
  const text = read(DIGEST)
  manifest[DIGEST].content_hash = hashOf(text)
  manifest[DIGEST].line_count = linesOf(text)
  manifest[DIGEST].last_reconciled_date = execFileSync('date', ['-u', '+%Y-%m-%d'], { cwd: ROOT }).toString().trim()
  manifest[DIGEST].last_reconciled_head = head
  fs.writeFileSync(abs(MANIFEST), JSON.stringify(manifest, null, 2) + '\n')
}

if (CHECK_ONLY) {
  const { changed } = restampManifest()
  if (changed.length) {
    console.error(`\n❌ ${changed.length} MANIFEST ENTRY/ENTRIES ARE STALE (run: node scripts/wrap-docs.mjs)`)
    changed.forEach((c) => console.error(`   • ${c.rel}  ${c.from} → ${c.to}  lines ${c.lines}  (stamped at ${c.wasAt})`))
    process.exit(1)
  }
  console.log('[wrap-docs --check] manifest is in sync with every tracked file.')
  process.exit(0)
}

console.log('[wrap-docs] 1/4  re-stamping the manifest FIRST (the digest reads it)…')
const { changed, head, total } = restampManifest()
if (changed.length) changed.forEach((c) => console.log(`         restamped ${c.rel}  ${c.from} → ${c.to}  lines ${c.lines}`))
else console.log('         no source doc changed')
console.log(`         ${total} tracked docs, ${changed.length} re-stamped, HEAD ${head}`)

console.log('[wrap-docs] 2/4  rebuilding the digest FROM the just-stamped manifest…')
execFileSync(process.execPath, [abs('scripts/build-resume-digest.mjs')], { cwd: ROOT, stdio: 'inherit' })

console.log('[wrap-docs] 3/4  re-stamping the digest\'s OWN manifest entry (it changed in step 2)…')
restampDigestEntry(head)

console.log('[wrap-docs] 4/4  verifying — the same gate tomorrow\'s resume runs…')
execFileSync(process.execPath, [abs('tests/guards/resume-digest-freshness.guard.mjs')], { cwd: ROOT, stdio: 'inherit' })
console.log('[wrap-docs] DONE — manifest, digest and freshness gate are consistent. Commit them together.')
