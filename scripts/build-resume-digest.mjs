// LORAMER_RESUME_DIGEST_V1
// Pure assembler (no AI, no network): reads the authoritative repo docs + the manifest and REGENERATES
// LORAMER_RESUME_DIGEST.md WHOLE, every run (never append/edit-in-place). The digest collapses the 10-file
// tiered resume read into ONE paste WITHOUT becoming a stale-doc lie: every section is pulled verbatim/
// condensed from its source doc (so it can't drift), and a FRESHNESS STAMP records each source doc's
// manifest content_hash so a stale digest is detectable (gate falls back to the full read on any mismatch).
//
//   Run:  node scripts/build-resume-digest.mjs
//   Wrap (HARD GATE): re-stamp HANDOFF_MANIFEST.json for EVERY changed gated SOURCE_DOC (now 10) FIRST, THEN run
//         this (it reads the updated manifest), THEN re-stamp this file's own manifest entry, THEN run the
//         FRESHNESS GATE — it MUST read 10/10 PASS before commit. A skipped re-stamp = RED gate next resume = STOP.
//         (per the LORAMER_HANDOFF.md SESSION-WRAP gate.)
//
// Repo root is derived from THIS file's location (works on iMac + Air despite the different folder names).

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { walkQueue } from './lib/queue-walk.mjs'

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
// GATED SET = 9 (was 10). docs/LORAMER_DEFINITIVE_CAPTURE_INVENTORY.md RETIRED from the gated set
// 2026-07-17 (LORAMER_DOCS_SINGLE_OWNER_V1): its own header admits it is stale + pre-dates 6 shipped
// writers ("a map can rot silently while every hash stays green"). It stays TRACKED in the manifest and
// in place at its path (so the ~10 live §6 gap-list references do not dangle), but it is no longer
// stamped as a current gated source. Replacement path = derive it from the writers (QUEUE: MAP-vs-CODE
// DRIFT / derive-INVENTORY-from-writers). Do NOT re-add without regenerating it from code.
const SOURCE_DOCS = ['LORAMER_ESSENCE.md', 'LORAMER_HANDOFF.md', 'CONTINUE_HERE.md', 'LORAMER_DECISIONS.md', 'LORAMER_QUEUE_OF_RECORD.md', 'docs/LORAMER_BREAKDOWN_REGISTRY.md', 'RESUME_INSTRUCTIONS.md', 'docs/LORAMER_ASSET_LAYER_SCOPE_V1.md', 'docs/LORAMER_SECURITY_POSTURE.md']
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
// LORAMER_DIGEST_NEXTSTEP_AMBIGUITY_V1 — FAIL LOUDLY ON AMBIGUITY, never silently read the wrong block.
// THE 2026-07-25 DEFECT: the wrap wrote its `▶▶ NEXT STEP` opener into the session-log block near the top of
// CONTINUE_HERE, while the ═══ NEXT STEP ═══ fence still held the 07-24 opener. This extractor read the fence,
// so the digest body pointed at the PREVIOUS DAY — and because the manifest hashes were re-stamped correctly,
// the freshness gate read 9/9 GREEN over it. Hash equality proves the file was not edited behind our back; it
// proves nothing about WHICH block the body came from. So: count the openers, and refuse to guess.
const __openerLines = continueHere.split('\n')
  .map((l, i) => (/^▶▶\s*NEXT STEP/.test(l) ? i + 1 : 0))
  .filter(Boolean)
const __fenceLine = continueHere.split('\n').findIndex((l) => /^═+ NEXT STEP ═+/.test(l)) + 1
if (__fenceLine === 0) {
  throw new Error('DIGEST REFUSES TO GUESS: no ═══ NEXT STEP ═══ fence in CONTINUE_HERE.md — §E has no defined source.')
}
if (__openerLines.length !== 1) {
  throw new Error(
    `DIGEST REFUSES TO GUESS: found ${__openerLines.length} \`▶▶ NEXT STEP\` openers in CONTINUE_HERE.md` +
    (__openerLines.length ? ` (lines ${__openerLines.join(', ')})` : '') +
    `. Exactly one is required. Two openers is the 2026-07-25 defect: the digest reads the fence at line ${__fenceLine}, ` +
    `so an opener written anywhere else is silently ignored while the hashes still read 9/9 green.`
  )
}
{
  const __ls = continueHere.split('\n')
  let __end = __ls.length
  for (let i = __fenceLine; i < __ls.length; i++) { if (/^═+/u.test(__ls[i])) { __end = i; break } }
  if (!(__openerLines[0] > __fenceLine && __openerLines[0] <= __end)) {
    throw new Error(
      `DIGEST REFUSES TO GUESS: the single \`▶▶ NEXT STEP\` opener is on line ${__openerLines[0]}, OUTSIDE the ` +
      `═══ NEXT STEP ═══ fence (lines ${__fenceLine}–${__end}). Move the opener into the fence — reading the fence ` +
      `while the real opener lives elsewhere is exactly how a stale §E survived a green freshness gate.`
    )
  }
}
// ⛔ EXTRACT FROM THE FENCE THE VALIDATOR ABOVE ALREADY FOUND — DO NOT RE-FIND IT BY SUBSTRING.
// THE 2026-07-27 DEFECT, and it is why §E shipped a superseded opener while the checks above passed:
// this line used to be `sectionByHeader(continueHere, '═══ NEXT STEP ═══', /^### /)`, and
// sectionByHeader matches with `line.includes(...)`. The 2026-07-25 fix wrote an explanatory note that
// QUOTES the fence marker in prose ("…because it lived OUTSIDE the ═══ NEXT STEP ═══ fence…") at
// CONTINUE_HERE line 154 — 650 lines above the real fence. The substring match hit the PROSE, so the
// digest's §E was a history paragraph about a superseded opener, permanently.
// THE REAL BUG IS THE DISAGREEMENT: the opener validation at `__fenceLine` uses the ANCHORED regex
// /^═+ NEXT STEP ═+/ and was therefore always right; the extraction used a substring and was always
// wrong. One function validated a region and another read a different one, and only the second
// reached the digest. Same shape as a guard that fires on its own documentation — a marker that also
// appears in prose about the marker must be matched ANCHORED, never by substring.
const nextStep = must('E next-step', (() => {
  const ls = continueHere.split('\n')
  const start = __fenceLine - 1                       // __fenceLine is 1-based, and already validated
  let end = ls.length
  for (let i = start + 1; i < ls.length; i++) { if (/^═+/u.test(ls[i]) || /^### /.test(ls[i])) { end = i; break } }
  return ls.slice(start, end).join('\n')
})())

// ── F. date-gated ──
const dateGated = must('F date-gated', fenceSection(queue, 'DATE-GATED (CONTINUE_HERE'))

// ── G. settled-decisions index (every do-not-relitigate line) ──
// ⛔ TWO FORMATS, AND FOR MONTHS THIS READ ONLY ONE — LORAMER_DIGEST_MISSED_THE_SECTION_FORMAT_V1.
// The filter was `/\|\s*do not relitigate/i`, which is the BULLET trailer (`| LORAMER_X_V1, date | do not
// relitigate.`). `LORAMER_DECISIONS.md` also banks decisions as `## ` SECTIONS, a legitimate format that
// predates this consumer — and **that filter matched ZERO of them**. MEASURED 2026-08-19: 20 section
// decisions existed and **10 were absent from the digest entirely**, including two GOVERNING rules banked by
// Russ that same night. The ten that did appear got there only because a QUEUE entry happened to cite their
// token — reachability by luck, not by design.
// ⛔ SAME CLASS AS `three-source-header.guard.mjs`'s format hole one day earlier, one consumer over: a real
// format the reader did not know about. The fix is to WIDEN THE READER, never to retype the decisions.
// ⛔ AND NO "do not relitigate" PREDICATE ON THE SECTION SIDE — the same argument this repo already settled
// for `three-source-header.guard.mjs`'s subject selection: **the `## ` format is only ever used for a banked
// decision**, so a dated `## LORAMER_*_V<n>` heading IS one by construction and needs no tag to prove it.
// Requiring the phrase re-created the hole at half size: it still dropped SIX of twenty, because headings
// legitimately say "Do not reintroduce a default", "MEASURED, not modelled", "OPEN PROBLEM, NAMED".
const SECTION_DECISION = /^##\s+LORAMER_[A-Z0-9_]+_V\d+\b/
const settled = must('G settled-decisions', decisions.split('\n')
  .filter((l) => /\|\s*do not relitigate/i.test(l) || SECTION_DECISION.test(l))
  .join('\n'))

// ── H. open-queue index — SELECT BY MEANING, NOT BY POSITION ──
// Emit one line per OPEN queue item — its header line. An item is its header PLUS the continuation
// lines under it (up to the next item / section boundary), so a multi-line item whose status tag sits
// on a later line ("src: … open [LC]") is still seen. Two independent filters:
//   • CANDIDACY (INCLUDE_RE): the block carries an open-ish status keyword followed by a bracket tag —
//     the same breadth the old per-line filter had, now evaluated over the whole block.
//   • DONE-OVERRIDE (statusIsDone): on the LAST tag-bearing line, after stripping parentheticals, a
//     done word (resolved/done/closed) sits ADJACENT (≤26 chars) to the FINAL tag. Narrow on purpose —
//     a mid-history "CLOSED"/"done" far from the tag must NOT bury an open item (RBAC, P8), and
//     "partial(V1 done) [LC]" is partial, not done.
// POSITION-INDEPENDENT: an item appended ANYWHERE is considered; the ONLY region skipped wholesale is
// the fenced "DONE — DO NOT REBUILD" appendix blob (bounded by its own fences, so items added AFTER it
// are unaffected). Guards the class the 2026-07-17 omission exposed: the old code sliced qLines at the
// marker and silently dropped EVERY item banked below it (the whole post-07-15 audit list + every ★
// follow-on). See DECISIONS LORAMER_SOURCE_CONFLICT_GATE_V1.
// LORAMER_QUEUE_WALK_SHARED_V1 — the walk moved to scripts/lib/queue-walk.mjs so the guard that grades this
// queue reads THE SAME block-splitting and THE SAME statusIsDone. Two readers of one walk drift only if there
// are two walks. Behaviour is unchanged: the module is a byte-faithful transcription of the code that was here,
// and the swap was proven by regenerating the digest with both implementations and diffing — identical SHA-256
// once the inherently-per-run `generated_at` line is removed (2026-08-20).
const { items: allQueueItems, doneMarker, appendixEnd } = walkQueue(queue)
const openHeaders = allQueueItems.filter((i) => i.isOpen).map((i) => i.header)
const openItems = must('H open-queue', openHeaders.join('\n'))

// ── I. lessons index ──

// ── L. DECISION-TOPIC INDEX ────────────────────────────────────────────────────────────────────────────
// LORAMER_DECISION_TOPIC_INDEX_V1 — GENERATED, NEVER HAND-MAINTAINED.
//
// WHY IT EXISTS, from the 2026-07-31 precedent: FOUR topics were discussed as though open when all four were
// already decided or built — the readiness meter (shipped 07-13), the two-class document rule, variant/SKU
// grain, and the in-app nudge layer. ESSENCE law 7 (the CLAIM-OF-NOVELTY GATE) exists precisely to stop that
// and did NOT fire, because it is a rule about BEHAVIOUR and rules about behaviour are the ones that fail.
// RULE-HOME LAW: a rule broken more than once needs an ENFORCER. This is the mechanical version of law 7.
//
// ⛔ KEYED ON THE ★TOKEN AND THE LORAMER_*_V* MARKER, NOT ON FREE-TEXT TOPICS. Free text needs the good search
// term this index exists to remove the dependence on. Both markers already exist, are unique, and are already
// how entries cross-reference each other.
//
// ⛔ STATUS COMES FROM THE SAME WALK AND THE SAME statusIsDone AS §H (allQueueItems above), so the index and
// the open-queue list cannot disagree. Two readers of one walk drift only if there are two walks.
const TOKEN_RE = /(★[A-Z0-9][A-Z0-9._-]*[A-Z0-9]|LORAMER_[A-Z0-9_]*_V\d+)/g
const DATE_RE = /(\d{4}-\d{2}-\d{2})/g
const tokensIn = (t) => [...new Set((t.match(TOKEN_RE) || []).map((x) => x.replace(/[.,;:]+$/, '')))]
const latestDate = (t) => { const d = (t.match(DATE_RE) || []).sort(); return d.length ? d[d.length - 1] : null }

const idx = new Map() // token -> { decisions:n, queue:n, open:bool, done:bool, last:string|null }
const bump = (tok, where, extra = {}) => {
  const e = idx.get(tok) || { decisions: 0, queue: 0, open: false, done: false, last: null }
  e[where] += 1
  if (extra.open) e.open = true
  if (extra.done) e.done = true
  if (extra.last && (!e.last || extra.last > e.last)) e.last = extra.last
  idx.set(tok, e)
}

// DECISIONS: one entry per "do not relitigate" line (the same set §G indexes).
const decisionEntries = decisions.split('\n').filter((l) => /\|\s*do not relitigate/i.test(l))
let decisionsUntokened = 0
const decisionsUntokenedSamples = []
for (const line of decisionEntries) {
  const toks = tokensIn(line)
  if (!toks.length) { decisionsUntokened++; if (decisionsUntokenedSamples.length < 6) decisionsUntokenedSamples.push(line.slice(0, 96)); continue }
  for (const t of toks) bump(t, 'decisions', { last: latestDate(line) })
}

// QUEUE: every item from the shared walk, with its real status.
let queueUntokened = 0
const queueUntokenedSamples = []
for (const it of allQueueItems) {
  const text = [it.header, ...it.block].join('\n')
  const toks = tokensIn(text)
  if (!toks.length) { queueUntokened++; if (queueUntokenedSamples.length < 6) queueUntokenedSamples.push(it.header.trim().slice(0, 96)); continue }
  for (const t of toks) bump(t, 'queue', { open: it.isOpen, done: !it.isOpen, last: latestDate(text) })
}

const tokens = [...idx.entries()].sort((a, b) => a[0].localeCompare(b[0]))
const both = tokens.filter(([, e]) => e.decisions > 0 && e.queue > 0)
const onlyDecisions = tokens.filter(([, e]) => e.decisions > 0 && e.queue === 0)
const onlyQueue = tokens.filter(([, e]) => e.queue > 0 && e.decisions === 0)
const statusOf = (e) => (e.queue === 0 ? 'DECIDED' : e.open ? 'OPEN' : 'DONE')
const indexLines = tokens.map(([t, e]) =>
  `- ${t} — ${statusOf(e)} · decisions ${e.decisions} · queue ${e.queue}${e.last ? ` · last ${e.last}` : ''}`)

const topicIndex = [
  `HOW TO USE: before writing "NEW" on any finding, gap or correction, GREP THIS SECTION for the ★token or`,
  `LORAMER_*_V* marker you are about to mint. A token collision is DECIDABLE; a topic match is not. This is`,
  `ESSENCE law 7 made mechanical — the law is a rule about behaviour, and on 2026-07-31 four already-decided`,
  `topics were discussed as open while it was in force.`,
  `TOTALS: ${tokens.length} tokens indexed · ${both.length} resolve to BOTH a decision and a queue item ·`,
  `${onlyDecisions.length} decision-only · ${onlyQueue.length} queue-only.`,
  `⛔ UNINDEXABLE — THIS COUNT IS THE BACKLOG, NOT A DISCLAIMER: ${decisionsUntokened} DECISIONS entries and`,
  `${queueUntokened} QUEUE items carry NO token at all, so they cannot be found this way. An untokened decision`,
  `is invisible to the enforcer; the fix is to mint a token when banking, not to widen the matcher. Samples —`,
  ...decisionsUntokenedSamples.map((x) => `  · [decision] ${x}…`),
  ...queueUntokenedSamples.map((x) => `  · [queue] ${x}…`),
  ``,
  ...indexLines,
].join('\n')

// --print-index: emit ONLY this section and exit, so a guard can recompute and diff it without writing the
// digest. Recomputing into a scratch buffer is how a hand-edit and a stale section are caught by one check.
// ⛔ writeSync TO FD 1, NOT process.stdout.write — and NOT because of style. When stdout is a PIPE (which is
// exactly how the guard consumes this, via spawnSync), process.stdout.write is ASYNCHRONOUS, and process.exit()
// terminates before the buffer drains: the 36,448-byte section arrived as 7,617 bytes, silently. It looked
// correct in every hand-check because a terminal and a `>` redirect are both synchronous — the truncation
// appears ONLY under the machine consumer. A truncated index that still parses is the silent-truncation class
// this repo keeps banking: the reader sees a well-formed section and cannot tell it is missing four fifths of
// its rows. Caught by the guard on its first real run, which is the argument for the guard.
if (process.argv.includes('--print-index')) { fs.writeSync(1, topicIndex + '\n'); process.exit(0) }

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
- Machines: iMac ~/Downloads/cotemedia-ads-manager · MacBook Air ~/Downloads/cotemedia-google-ads-manager (folder names differ BY DESIGN). Stack: Next.js 14 App Router + TS + Tailwind, Supabase (Postgres), NextAuth (Google OAuth), Anthropic (model ids OWNED BY THE CODE — LORA_CHAT_MODEL / LORA_INSIGHT_MODEL defaults in chat/insight route.ts; NOT restated here, this line carried two stale ids), Vercel auto-deploy on push to main. (full: LORAMER_HANDOFF.md → Tech stack + MACHINES & ENV STATE)
- HOW TO USE: run the section-A freshness gate. FRESH → read this file IN FULL, restate the section-G decisions + section-H queue items relevant to the task (RESTATE-TO-PROVE), state the section-E NEXT STEP, WAIT for Russ's "go". Before calling anything NEW, grep §L (the token index). STALE → ignore this file, do the full tiered read (RESUME_INSTRUCTIONS fallback). This digest NEVER overrides the authoritative docs; it is a derived fast path.

## K. GATED REFERENCE DOCS (hash-guarded in §A; read on-demand — they can't silently rot)
These load-bearing docs are now in the FRESHNESS-GATE SOURCE_DOCS set (their hashes are stamped in §A). They are NOT embedded here (the digest stays lean = ONE paste); open them when the task needs them — the gate guarantees they are current, and a change to any of them WITHOUT a manifest re-stamp turns §A RED on the next resume:
- docs/LORAMER_BREAKDOWN_REGISTRY.md — per-dimension {entity_level, encoding, reconcile} + governing breakdown rules; the companion every breadth writer follows.
- RESUME_INSTRUCTIONS.md — the canonical resume-flow wording (§J above summarizes it; the gate now guards the two from drifting).
- docs/LORAMER_ASSET_LAYER_SCOPE_V1.md — the T3b creative/asset + asset-combination-attribution SCOPE (post-launch FLAGSHIP; per-platform serve+ceilings, new-table shapes, the per-combination MODELING-layer requirement, the 4 opening decision-forks).
- docs/LORAMER_SECURITY_POSTURE.md — the 2026-06-29 security MAP (route-auth gate classes, secrets/blast-radius, plaintext token storage, tenant isolation, RLS-is-inert reality, the GAP LIST = 4 launch-critical + 7 fast-follow). The 4 launch-critical fixes are the next security build flight (NOT applied yet).

## L. DECISION-TOPIC INDEX — token → where it was decided and whether it is open  (GENERATED from DECISIONS + QUEUE)
${topicIndex}

--- end of digest · regenerate with: node scripts/build-resume-digest.mjs ---
`

fs.writeFileSync(path.join(ROOT, 'LORAMER_RESUME_DIGEST.md'), out)
const lineCount = out.split('\n').length - 1
console.log(`[build-resume-digest] wrote LORAMER_RESUME_DIGEST.md — ${lineCount} lines, built from HEAD ${head.slice(0, 7)}`)
console.log(`[build-resume-digest] sections: A freshness · B role-contract · C governing-law · D operating-rules · E next-step · F date-gated · G settled-decisions(${settled.split('\n').length}) · H open-queue(${openItems.split('\n').length}) · I lessons · J machines/how-to · L topic-index(${tokens.length} tokens, ${decisionsUntokened + queueUntokened} untokened)`)
