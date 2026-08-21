#!/usr/bin/env node
// LORAMER_RESUME_DIGEST_FRESHNESS_GUARD_V1 — the freshness gate, run at WRAP time instead of at
// RESUME time, so a wrap cannot ship a digest that will read RED tomorrow morning.
//
// ⛔ WHAT IT GUARDS, and it is a STRUCTURAL FALSE RED, not a one-off: the digest copies each source
// doc's content_hash FROM THE MANIFEST at build time. Build it before re-stamping the manifest and it
// records the PREVIOUS state — so §A mismatches the manifest as soon as the manifest is stamped, and
// the next session's gate falls back to the 10-file tiered read for no reason. That happened on
// 2026-07-27 and cost the morning's fast path; the same wrap also shipped a superseded §E opener and a
// §G law that did not exist at the stamped commit — three points in time in one file.
//
// ⚠ DISTINCT FROM ★DIGEST-BODY-FRESHNESS (queued, NOT this). That one is the opposite failure: a
// digest whose §A reads GREEN while a BODY section is stale — a false GREEN. This guard closes the
// false RED (stamps from the wrong moment) plus the two body checks that are mechanically decidable
// today (§A vs the live files, and §E vs CONTINUE_HERE's opener). Sections B/C/D/F/G/H/I are still
// only as fresh as the last regeneration — that is what ★DIGEST-BODY-FRESHNESS is for.
//
// HERMETIC: filesystem only, no git, no network — so it is safe inside `npm run guard`, which Vercel
// runs. LORAMER_GUARD_ROOT overrides the tree so it can be proven RED against an earlier checkout.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { selectHead } from '../../scripts/lib/continue-head.mjs'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)
const sha = (t) => createHash('sha256').update(t).digest('hex')

const manifestRaw = read('docs/HANDOFF_MANIFEST.json')
const digest = read('LORAMER_RESUME_DIGEST.md')
const continueHere = read('CONTINUE_HERE.md')
const builder = read('scripts/build-resume-digest.mjs')
if (!manifestRaw || !digest || !continueHere || !builder) {
  console.error('FAIL: cannot read the resume chain (manifest / digest / CONTINUE_HERE / builder). Treat as failure, never a pass.')
  process.exit(1)
}
const manifest = JSON.parse(manifestRaw)

// The gated set is the builder's own SOURCE_DOCS — read it FROM the builder rather than restating it,
// so promoting or retiring a gated doc cannot leave this guard checking a different list. (The set is
// 9, not 10: docs/LORAMER_DEFINITIVE_CAPTURE_INVENTORY.md was retired from gated on 2026-07-17.)
const srcMatch = builder.match(/const SOURCE_DOCS = \[([^\]]*)\]/)
if (!srcMatch) { console.error('FAIL: cannot find SOURCE_DOCS in scripts/build-resume-digest.mjs.'); process.exit(1) }
const SOURCE_DOCS = [...srcMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

// ── 1. THE DIGEST'S §A STAMPS MUST MATCH THE LIVE MANIFEST ────────────────────────────────────────
// This is the exact comparison tomorrow's resume makes. Making it here means a RED can only ever be
// discovered by the person who can still fix it.
const stamped = new Map()
for (const line of digest.split('\n')) {
  const m = line.match(/^\s*-\s+(\S+):\s+([0-9a-f]{64}|MISSING-FROM-MANIFEST)\s*$/)
  if (m) stamped.set(m[1], m[2])
}
if (stamped.size !== SOURCE_DOCS.length) {
  fail(`THE DIGEST §A CARRIES ${stamped.size} STAMPS BUT THE GATED SET IS ${SOURCE_DOCS.length}. The freshness gate compares stamp-for-stamp; a missing line is a doc nobody is guarding.`)
}
for (const doc of SOURCE_DOCS) {
  const want = manifest[doc]?.content_hash
  const got = stamped.get(doc)
  if (!want) { fail(`GATED DOC ${doc} IS NOT IN THE MANIFEST — it cannot be stamped, so it cannot be guarded.`); continue }
  if (!got) { fail(`THE DIGEST §A HAS NO STAMP FOR ${doc}.`); continue }
  if (got !== want) {
    fail(`§A STAMP MISMATCH FOR ${doc}: digest says ${got.slice(0, 8)}…, manifest says ${want.slice(0, 8)}…. THIS IS TOMORROW'S RED GATE. It means the digest was built BEFORE the manifest was re-stamped — run \`node scripts/wrap-docs.mjs\`, which does it in the only order that works.`)
  }
}

// ── 2. THE MANIFEST MUST MATCH THE FILES ──────────────────────────────────────────────────────────
// §A matching the manifest is worthless if the manifest itself describes yesterday's files: digest and
// manifest would agree with each other and both be wrong, and the gate would read GREEN over it. This
// is also the CLAUDE.md hygiene failure found 2026-07-27 — stamped at c77be89 while the file had
// changed in 7ddebc5, four days unnoticed.
for (const [rel, entry] of Object.entries(manifest)) {
  const text = read(rel)
  if (text === null) { fail(`MANIFEST TRACKS ${rel}, WHICH DOES NOT EXIST. A deleted or moved doc still claimed as tracked.`); continue }
  if (sha(text) !== entry.content_hash) {
    fail(`MANIFEST IS STALE FOR ${rel}: stamped ${String(entry.content_hash).slice(0, 8)}… at ${entry.last_reconciled_head}, file is now ${sha(text).slice(0, 8)}…. Run \`node scripts/wrap-docs.mjs\`.`)
  }
}

// ── 3. THE DIGEST BODY'S §E OPENER MUST BE CONTINUE_HERE'S CURRENT ONE ────────────────────────────
// The stamps prove WHEN the digest was built. They prove nothing about WHAT it says. A superseded
// opener is the single most expensive kind of stale, because the whole point of §E is to tell the next
// session what to do — and it is checkable, so it is checked.
const opener = (t) => (t.split('\n').find((l) => /^▶▶\s*NEXT STEP/.test(l)) || '').trim()
const chOpener = opener(continueHere)
const dgOpener = opener(digest)
if (!chOpener) {
  fail('CONTINUE_HERE.md HAS NO `▶▶ NEXT STEP` OPENER. §E has no source; the digest cannot carry a next step.')
} else if (!dgOpener) {
  fail('THE DIGEST HAS NO `▶▶ NEXT STEP` OPENER IN §E — the one section the next session acts on is empty.')
} else if (chOpener !== dgOpener) {
  fail(`§E OPENER IS SUPERSEDED. CONTINUE_HERE says:\n      ${chOpener.slice(0, 150)}\n    the digest says:\n      ${dgOpener.slice(0, 150)}\n    The digest was regenerated before CONTINUE_HERE's opener was written. Run \`node scripts/wrap-docs.mjs\` AFTER the docs are final.`)
}

// ── 3b. THE HEAD THE DIGEST CARRIES MUST BE THE NEWEST HEAD IN CONTINUE_HERE ────────────────
// ⛔ LEG 3 ABOVE PASSES WHEN THE TWO FILES AGREE — INCLUDING WHEN THEY AGREE ON A STALE HEAD, WHICH IS
// EXACTLY WHAT HAPPENED. MEASURED 2026-08-21 at HEAD 5e7387d: CONTINUE_HERE's real head was the
// `╔═══ SESSION CLOSE 2026-08-20/21` box on line 1; §E carried the `▶▶ NEXT STEP — 2026-08-19` opener from the
// fence 1,584 lines below, naming ★THREE-CLEAN-RUNS-BEFORE-FAMILY — an item marked ✅ SATISFIED two days
// earlier. Leg 3 found the SAME stale opener in both files, agreed, and passed. Nine of nine hashes green.
// ⛔ A CHECK THAT COMPARES TWO READERS OF ONE STALE SOURCE PROVES THEY AGREE, NEVER THAT THEY ARE RIGHT.
// This leg asks a different question: is the head the digest carries the NEWEST head CONTINUE_HERE holds?
// The answer comes from `scripts/lib/continue-head.mjs`, the SAME selector the generator uses to pick it —
// a second implementation here would be a second walk (the `queue-walk.mjs` law), and would drift the first
// time either side moved.
try {
  const head = selectHead(continueHere)
  const headerLine = head.header.trim()
  if (!digest.includes(headerLine)) {
    const others = head.candidates.filter((c) => c.line !== head.line)
    fail(
      `§E DOES NOT CARRY THE NEWEST HEAD. CONTINUE_HERE's newest live head is a [${head.kind}] dated ${head.date} at ` +
      `CONTINUE_HERE.md:${head.line}:\n      ${headerLine.slice(0, 150)}\n` +
      `    and the digest does not contain that line anywhere. The digest is pointing the next session at an OLDER ` +
      `block, which is the failure the §A stamps and leg 3 both structurally cannot see.\n` +
      (others.length
        ? `    Older live candidates §E may be reading instead:\n${others.map((c) => `      CONTINUE_HERE.md:${c.line} [${c.kind}] ${c.date} ${c.header.trim().slice(0, 110)}`).join('\n')}\n`
        : '') +
      `    FIX: run \`node scripts/wrap-docs.mjs\` AFTER the head block is written.`
    )
  }
} catch (e) {
  // selectHead REFUSES rather than guessing — an ambiguous head is a failure, never a pass.
  fail(`HEAD SELECTION REFUSED — CONTINUE_HERE's head is AMBIGUOUS, so the digest cannot be trusted to carry it:\n    ${String(e.message).split('\n').join('\n    ')}`)
}

// ── 4. THE GOVERNING LAW BLOCK MUST BE PRESENT ────────────────────────────────────────────────────
// §C is what makes the digest safe to use INSTEAD of the tiered read. A digest missing it is not a
// fast path, it is a shortcut past the law.
if (!/^## C\. GOVERNING LAW/m.test(digest) || !/LORA SEES EVERYTHING/.test(digest)) {
  fail('THE DIGEST IS MISSING ITS §C GOVERNING LAW BLOCK. The digest is only allowed to replace the tiered read because it carries the law; without it, it is a shortcut past the law.')
}

if (failures.length) {
  console.error('\n❌ LORAMER_RESUME_DIGEST_FRESHNESS_GUARD_V1 FAILED — this wrap would ship a digest that reads RED (or wrong) at the next resume\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('\n  FIX: node scripts/wrap-docs.mjs   (manifest → digest → digest\'s own entry → this gate, in that order)\n')
  process.exit(1)
}
console.log(`resume-digest-freshness.guard: PASS — ${SOURCE_DOCS.length}/${SOURCE_DOCS.length} §A stamps match the manifest, all ${Object.keys(manifest).length} manifest entries match their files, §E opener matches CONTINUE_HERE, §E carries CONTINUE_HERE's NEWEST head, §C governing law present.`)
