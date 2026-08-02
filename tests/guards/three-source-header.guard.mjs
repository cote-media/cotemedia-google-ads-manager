#!/usr/bin/env node
// LORAMER_THREE_SOURCE_PRECONDITION_V1 — GUARD. A NEW BUILD OR DESIGN DECISION MUST SHOW ITS THREE SOURCES.
//
// ⛔ THIS IS AN AMENDMENT'S ENFORCER, NOT A NEW LAW. The law is LORAMER_WEB_FIRST_DIAGNOSIS_V1 (ESSENCE,
// 2026-07-19, widened 2026-07-23), which ALREADY requires the three-field HISTORY · WEB · REPO header. What
// this adds is the thing that law explicitly said it did NOT have: an enforcer. Its own words —
//   "the header makes skipping VISIBLE; it cannot make searching HAPPEN — that stays discipline."
// Discipline was tried for two weeks. This moves the header off the ephemeral paste and onto the COMMITTED
// ARTIFACT, where a guard can actually see it.
//
// ⛔ THE HONEST LIMIT, STATED HERE AND IN THE LAW — READ IT BEFORE TRUSTING A GREEN.
// A repo guard CANNOT observe whether a chat search or a web search happened. Those occur before any code
// exists, in a transcript this process cannot read and a browser it cannot see. NOTHING here proves a search
// occurred, that it was competent, or that it informed the design. What is enforceable is the ARTIFACT: the
// entry either carries three legs with real content, or it does not.
// The named failure mode is RUBBER-STAMPING — three legs filled with plausible words nobody searched for.
// This is not a hypothetical we invented: it is documented prior art. See the ADR-enforcement literature's
// warning that "one rubber-stamp ADR that an agent later references as prior art propagates bad reasoning
// forward" (johnclick.ai, ADR-first development). A presence check cannot reach it. A HUMAN READING THE LEGS
// CAN — which is why the legs must name WHAT WAS SEARCHED, not merely report a verdict.
//
// ⛔ SCOPE — WHAT FIRES AND WHAT DOES NOT. This is the whole design; a guard that cries wolf gets deleted.
// IN SCOPE: a LORAMER_DECISIONS.md entry whose bracket tag carries a CONSTRUCTION verb — DECIDED / DECISION /
//   SHIPPED / LAW — and whose date is on or after the floor below. Those tags are the repo's own word for
//   "we are authorising or recording new construction."
// NOT IN SCOPE, and each exclusion is mechanical, not a judgement call:
//   · PURE FIX COMMITS and DOC-ONLY COMMITS — they bank no decision entry, so there is nothing to scan. The
//     trigger is the ENTRY, never the diff. A fix that is significant enough to bank as a DECIDED entry is a
//     design decision by this repo's own taxonomy, and it does fire. If that ever proves wrong the fix is the
//     TAXONOMY (bank it as VERIFIED/FINDING), not a looser guard.
//   · MEASUREMENT AND OBSERVATION ENTRIES — MEASURED / VERIFIED / FINDING / PROVEN / FACT. A reading of the
//     world is not a decision about it, and demanding a web search before recording a number is theatre.
//   · RETIREMENTS AND CORRECTIONS — RETIRED / CLOSED / SUPERSEDED / CORRECTION. These unwind or repair an
//     existing decision; the sources belonged to the decision being unwound.
//   · ENTRIES DATED BEFORE THE FLOOR — the law binds forward from the moment it was banked. Retro-stamping
//     headers onto 300 historical entries whose searches were never run would manufacture exactly the
//     provenance this law exists to make real. That is the rubber stamp, at scale, in one commit.
//
// ⛔ WHAT IT DOES NOT ATTEMPT, deliberately: it does not judge whether a leg's content is TRUE, RELEVANT, or
// SUFFICIENT. That is comprehension. Same refusal, same reason, as doc-ownership.guard.mjs declining to detect
// a restated decision.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const DOC = 'LORAMER_DECISIONS.md'
const findings = []

// ── SCOPE CONSTANTS ───────────────────────────────────────────────────────────────────────────────────
// The floor is the day the law was banked. Inclusive: an entry banked the same day, after the law, is bound.
const FLOOR = '2026-08-02'

// The two entries banked EARLIER on the floor day, BEFORE this law existed. Named and finite rather than a
// silent date cliff, so the grandfathering is auditable and cannot quietly grow. Do not add to this list;
// the correct response to a new entry that cannot show its sources is to go and search.
const GRANDFATHERED = new Set([
  'LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1',  // shipped 7f5a2ed, hours before the law
  'LORAMER_CHAT_STATUS_SUBJECT_V1',          // shipped 9fa8b86, hours before the law
  'LORAMER_COMPUTE_BASELINE_2026_08_02_V1',  // MEASURED — excluded by tag too; listed so the count is explicit
])

const CONSTRUCTION = /\b(DECIDED|DECISION|SHIPPED|LAW)\b/
const UNWINDING = /\b(RETIRED|CLOSED|SUPERSEDED|CORRECTION)\b/

// ── THE HEADER FORMAT ─────────────────────────────────────────────────────────────────────────────────
// THREE-SOURCE — PRIOR CHATS: <what was searched, what came back> · WEB: <…> · REPO: <…> — /THREE-SOURCE
// The closing marker is not decoration: without it REPO's content would run to the end of a 6,000-character
// entry and could never be empty, so the third leg would be unfalsifiable and the guard would be two-thirds
// of a check wearing the name of a whole one.
const OPEN = 'THREE-SOURCE —'
const CLOSE = '/THREE-SOURCE'
const LEGS = ['PRIOR CHATS:', 'WEB:', 'REPO:']

// "NONE FOUND" is a VALID answer — Russ, explicitly. Silence is not. These are the ways of writing silence.
const PLACEHOLDER = /^(tbd|todo|n\/?a|na|none|\?+|-+|—+|\.+|see above|as above|same|ditto|x)\.?$/i

let text
try { text = readFileSync(resolve(ROOT, DOC), 'utf8') } catch (e) {
  console.error(`[three-source-header] FAIL — ${DOC} unreadable (${e.message}). A guard that cannot read its subject is not a pass.`)
  process.exit(1)
}

const entries = text.split('\n').map((t, i) => ({ n: i + 1, t })).filter((l) => /^- \[/.test(l.t))
let inScope = 0, grandfathered = 0, undated = 0, excludedByTag = 0, belowFloor = 0

for (const e of entries) {
  const tagM = e.t.match(/^- \[([^\]]*)\]/)
  if (!tagM) continue
  const tag = tagM[1]

  const dates = [...tag.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1]).sort()
  if (dates.length === 0) { undated++; continue }
  if (dates[dates.length - 1] < FLOOR) { belowFloor++; continue }

  if (!CONSTRUCTION.test(tag) || UNWINDING.test(tag)) { excludedByTag++; continue }

  // ⛔ NAME THE RIGHT DECISION. The first cut took the first LORAMER_*_V<n> in the line and, on its very first
  // RED run, blamed LORAMER_WEB_FIRST_DIAGNOSIS_V1 — because this entry's TAG says "AMENDS [[…WEB_FIRST…]]".
  // A guard that names the wrong decision sends the reader to the wrong entry. Prefer the house's canonical
  // trailing token (`| LORAMER_X_V1, <date> |`), then the first token in the BODY (never the tag).
  const trailingM = e.t.match(/\|\s*(LORAMER_[A-Z0-9_]+_V\d+)\s*,/)
  const bodyM = e.t.slice(tagM[0].length).match(/\bLORAMER_[A-Z0-9_]+_V\d+\b/)
  const nameM = trailingM ? trailingM[1] : (bodyM ? bodyM[0] : null)
  const name = nameM || `(untokened entry at ${DOC}:${e.n})`
  if (nameM && GRANDFATHERED.has(name)) { grandfathered++; continue }

  inScope++

  const o = e.t.indexOf(OPEN)
  const c = e.t.indexOf(CLOSE)
  if (o === -1) {
    findings.push(`${DOC}:${e.n} — ${name} banks a NEW BUILD OR DESIGN DECISION with NO THREE-SOURCE HEADER. Required before the decision was written, per LORAMER_THREE_SOURCE_PRECONDITION_V1 (amending LORAMER_WEB_FIRST_DIAGNOSIS_V1): search prior chats, search the web, search this repo. Add: "THREE-SOURCE — PRIOR CHATS: <searched what, found what or NONE FOUND> · WEB: <…> · REPO: <…> — /THREE-SOURCE".`)
    continue
  }
  if (c === -1 || c < o) {
    findings.push(`${DOC}:${e.n} — ${name} opens a THREE-SOURCE header and never closes it with "${CLOSE}". Without the terminator the REPO leg runs to the end of the entry and can never be judged empty, which turns the third leg into decoration.`)
    continue
  }

  const block = e.t.slice(o + OPEN.length, c)

  // Locate the three labels IN ORDER. Order is required so each leg's content is unambiguously bounded by
  // the next label — not a style preference.
  const pos = []
  let cursor = 0, ordered = true
  for (const leg of LEGS) {
    const i = block.indexOf(leg, cursor)
    if (i === -1) { pos.push(-1); ordered = false; continue }
    pos.push(i)
    cursor = i + leg.length
  }

  for (let k = 0; k < LEGS.length; k++) {
    if (pos[k] !== -1) continue
    findings.push(`${DOC}:${e.n} — ${name} is MISSING THE "${LEGS[k].replace(':', '')}" LEG of its three-source header${ordered ? '' : ' (or the legs are out of order — they must read PRIOR CHATS, then WEB, then REPO)'}. All three are preconditions, not a menu: the day this law was written, every one of four corrections traced to a source that was not consulted.`)
  }
  if (pos.some((p) => p === -1)) continue

  for (let k = 0; k < LEGS.length; k++) {
    const start = pos[k] + LEGS[k].length
    const end = k + 1 < LEGS.length ? pos[k + 1] : block.length
    const raw = block.slice(start, end)
    const content = raw.replace(/[·•|,;—–-]+\s*$/, '').replace(/^\s*[·•|]\s*/, '').trim()
    if (content.length === 0) {
      findings.push(`${DOC}:${e.n} — ${name}'s "${LEGS[k].replace(':', '')}" leg is EMPTY. An empty leg is a claim that a search happened with nothing to say about it, which is indistinguishable from no search. "NONE FOUND" is a valid answer here; silence is not.`)
    } else if (PLACEHOLDER.test(content)) {
      findings.push(`${DOC}:${e.n} — ${name}'s "${LEGS[k].replace(':', '')}" leg is a PLACEHOLDER ("${content}"). Say what was searched and what came back. "NONE FOUND" is accepted; a token that defers the answer is not.`)
    }
  }
}

if (findings.length) {
  console.error(`[three-source-header] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}

// ⛔ EVERY ZERO CARRIES ITS DENOMINATOR (ESSENCE corollary). A guard with nothing in scope is VACUOUSLY green,
// and a vacuous green read as a real one is the narrow-green class this repo has banked repeatedly. The
// denominator is printed on every run so the reader can never mistake "nothing to check" for "checked".
console.log(`[three-source-header] PASS — ${inScope} in-scope entr${inScope === 1 ? 'y carries' : 'ies carry'} all three legs, non-empty and non-placeholder. DENOMINATOR of ${entries.length} total: ${belowFloor} predate the ${FLOOR} floor, ${excludedByTag} are measurement/observation/unwinding tags, ${grandfathered} explicitly grandfathered by name, ${undated} carry no date in their tag (unscoped — the known blind spot). ⛔ This proves the ARTIFACT, never that a search happened.`)
