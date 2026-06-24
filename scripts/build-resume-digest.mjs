// LORAMER_RESUME_DIGEST_V1
// Pure assembler (no AI, no network): reads the authoritative repo docs + the manifest and REGENERATES
// LORAMER_RESUME_DIGEST.md WHOLE, every run (never append/edit-in-place). The digest collapses the 10-file
// tiered resume read into ONE paste WITHOUT becoming a stale-doc lie: every section is pulled verbatim/
// condensed from its source doc (so it can't drift), and a FRESHNESS STAMP records each source doc's
// manifest content_hash so a stale digest is detectable (gate falls back to the full read on any mismatch).
//
//   Run:  node scripts/build-resume-digest.mjs
//   Wrap: regen the manifest for changed docs FIRST, THEN run this (it reads the updated manifest), THEN
//         re-stamp this file's own manifest entry, THEN commit (per LORAMER_HANDOFF.md wrap-step).
//
// Repo root is derived from THIS file's location (works on iMac + Air despite the different folder names).

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const must = (label, s) => {
  if (!s || !String(s).trim()) throw new Error(`build-resume-digest: empty extraction for "${label}" — a source doc's structure changed; fix the extractor before relying on the digest.`)
  return String(s).replace(/\s+$/u, '')
}

// Markdown section from a header line (matched by substring) up to the next header matching stopRe (exclusive).
function sectionByHeader(text, headerIncludes, stopRe) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.includes(headerIncludes))
  if (start === -1) throw new Error(`section header not found: ${headerIncludes}`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) { if (stopRe.test(lines[i])) { end = i; break } }
  return lines.slice(start, end).join('\n')
}

// Body of a ═══-fenced section: the lines between the ═══ that closes the title box and the next ═══ line.
function fenceSection(text, titleIncludes) {
  const lines = text.split('\n')
  const h = lines.findIndex((l) => l.includes(titleIncludes))
  if (h === -1) throw new Error(`fence section title not found: ${titleIncludes}`)
  let i = h + 1
  while (i < lines.length && !/^═+/u.test(lines[i])) i++ // skip rest of multi-line title
  i++ // step past the closing ═══
  let j = i
  while (j < lines.length && !/^═+/u.test(lines[j])) j++
  return lines.slice(i, j).join('\n')
}

const essence = read('LORAMER_ESSENCE.md')
const handoff = read('LORAMER_HANDOFF.md')
const decisions = read('LORAMER_DECISIONS.md')
const continueHere = read('CONTINUE_HERE.md')
const queue = read('LORAMER_QUEUE_OF_RECORD.md')
const manifest = JSON.parse(read('docs/HANDOFF_MANIFEST.json'))

// ── A. freshness stamp ──
const head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
const generatedAt = new Date().toISOString()
const SOURCE_DOCS = ['LORAMER_ESSENCE.md', 'LORAMER_HANDOFF.md', 'CONTINUE_HERE.md', 'LORAMER_DECISIONS.md', 'LORAMER_QUEUE_OF_RECORD.md']
const hashLines = SOURCE_DOCS.map((d) => `    - ${d}: ${manifest[d]?.content_hash ?? 'MISSING-FROM-MANIFEST'}`).join('\n')

// ── B. role contract ──
const roleContract = must('B role-contract', sectionByHeader(handoff, '## ⛔ OPERATING DISCIPLINE — DESTINATION vs ROUTE', /^## /))

// ── C. governing law ──
const govLaw = must('C governing-law', sectionByHeader(essence, '# ⛔ GOVERNING LAW', /^# [^⛔]/))
const honesty = must('C honesty-clause', essence.split('\n').filter((l) => l.trim()).slice(-1)[0])

// ── D. operating rules ──
const opProtocol = must('D operating-protocol', fenceSection(decisions, 'OPERATING PROTOCOL (how we work — settled)'))
const standing = must('D standing-principles', fenceSection(decisions, 'STANDING PRINCIPLES'))

// ── E. active workstream + next step ──
const activeLine = must('E active-workstream', continueHere.split('\n').find((l) => l.includes('ACTIVE WORKSTREAM = **DATA COMPLETENESS PROGRAM**')))
const nextStep = must('E next-step', sectionByHeader(continueHere, '═══ NEXT STEP ═══', /^### /))

// ── F. date-gated ──
const dateGated = must('F date-gated', fenceSection(queue, 'DATE-GATED (CONTINUE_HERE'))

// ── G. settled-decisions index (every do-not-relitigate line) ──
const settled = must('G settled-decisions', decisions.split('\n').filter((l) => /\|\s*do not relitigate/i.test(l)).join('\n'))

// ── H. open-queue index (active region only; DONE appendix + resolved items excluded) ──
const qLines = queue.split('\n')
const doneIdx = qLines.findIndex((l) => l.includes('DONE — DO NOT REBUILD'))
if (doneIdx === -1) throw new Error('queue DONE appendix marker not found')
const openItems = must('H open-queue', qLines.slice(0, doneIdx).filter((l) => {
  const t = l.trimStart()
  const isItem = t.startsWith('- ') || /^P\d+ /.test(t) || t.startsWith('DATA COMPLETENESS ONBOARDING')
  if (!isItem) return false
  const m = l.match(/\b(open(?:\([^)]*\))?|partial|blocked|decision-pending|deferred|banked|parked|resolved|mostly-closed)\b[^[]*\[/i)
  if (m && /^resolved/i.test(m[1])) return false           // drop inline-resolved items
  if (/✅\s*(RESOLVED|FIXED|DONE)\b/i.test(l)) return false  // drop ✅-stamped done items
  return true
}).join('\n'))

// ── I. lessons index ──
const lessons = must('I lessons', fenceSection(decisions, 'LESSONS 1–'))

const out = `# LORAMER_RESUME_DIGEST.md — full-context session resume (REGENERATED — DO NOT HAND-EDIT)
<!-- LORAMER_RESUME_DIGEST_V1 -->

> ⚠️ DERIVED FILE. Generated by scripts/build-resume-digest.mjs from the authoritative docs; NEVER hand-edit
> (edits are overwritten on the next wrap). This collapses the 10-file tiered read into ONE paste WITHOUT
> replacing the authoritative docs — it is a FAST PATH in front of the full SESSION START GATE, never a
> replacement. On ANY doubt or hash mismatch, the source docs win and the full tiered read takes over.

## A. FRESHNESS STAMP — the staleness detector
- generated_at: ${generatedAt}
- built_from HEAD: ${head}  (informational — do NOT gate on this; unrelated commits change HEAD without changing the digest's sources)
- FRESHNESS GATE (authoritative, deterministic): this digest is CURRENT iff EVERY source-doc content_hash
  below MATCHES the live docs/HANDOFF_MANIFEST.json. ALL match → read + use this digest. ANY mismatch (or
  this file missing) → FALL BACK to the full tiered read (the 10-file SESSION START GATE). The digest is
  exactly as fresh as the manifest is honest; the wrap-step regenerates manifest + digest together.
  Source-doc content_hash at build time:
${hashLines}

## B. ROLE CONTRACT — DESTINATION vs ROUTE  (source: LORAMER_HANDOFF.md)
${roleContract}

## C. GOVERNING LAW  (source: LORAMER_ESSENCE.md)
${govLaw}

${honesty}

## D. OPERATING RULES  (source: LORAMER_DECISIONS.md — OPERATING PROTOCOL + STANDING PRINCIPLES)
${opProtocol}
${standing}

## E. ACTIVE WORKSTREAM + NEXT STEP  (source: CONTINUE_HERE.md)
${activeLine}

${nextStep}

## F. DATE-GATED — DO NOT SLIP  (source: LORAMER_QUEUE_OF_RECORD.md)
${dateGated}

## G. SETTLED-DECISIONS INDEX — do-not-relitigate, the complete map  (source: LORAMER_DECISIONS.md)
${settled}

## H. OPEN-QUEUE INDEX — still-open items only (DONE appendix excluded)  (source: LORAMER_QUEUE_OF_RECORD.md)
${openItems}

## I. LESSONS INDEX 1–60 (+ dated)  (source: LORAMER_DECISIONS.md)
${lessons}

## J. MACHINES / STACK / HOW TO USE THIS DIGEST
- Machines: iMac ~/Downloads/cotemedia-ads-manager · MacBook Air ~/Downloads/cotemedia-google-ads-manager (folder names differ BY DESIGN). Stack: Next.js 14 App Router + TS + Tailwind, Supabase (Postgres), NextAuth (Google OAuth), Anthropic (claude-haiku-4-5 insight / claude-sonnet-4-6 chat, prompt caching), Vercel auto-deploy on push to main. (full: LORAMER_HANDOFF.md → Tech stack + MACHINES & ENV STATE)
- HOW TO USE: run the section-A freshness gate. FRESH → read this file IN FULL, restate the section-G decisions + section-H queue items relevant to the task (RESTATE-TO-PROVE), state the section-E NEXT STEP, WAIT for Russ's "go". STALE → ignore this file, do the full 10-file tiered read. This digest NEVER overrides the authoritative docs; it is a derived fast path.

--- end of digest · regenerate with: node scripts/build-resume-digest.mjs ---
`

fs.writeFileSync(path.join(ROOT, 'LORAMER_RESUME_DIGEST.md'), out)
const lineCount = out.split('\n').length - 1
console.log(`[build-resume-digest] wrote LORAMER_RESUME_DIGEST.md — ${lineCount} lines, built from HEAD ${head.slice(0, 7)}`)
console.log(`[build-resume-digest] sections: A freshness · B role-contract · C governing-law · D operating-rules · E next-step · F date-gated · G settled-decisions(${settled.split('\n').length}) · H open-queue(${openItems.split('\n').length}) · I lessons · J machines/how-to`)
