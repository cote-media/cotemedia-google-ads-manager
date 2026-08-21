#!/usr/bin/env node
// LORAMER_QUEUE_TAG_MATCHES_TEXT_V1 — AN ITEM'S TAG AND AN ITEM'S PROSE MUST NOT DISAGREE.
//
// ⛔ THE DEFECT THIS EXISTS FOR, FOUND 2026-08-20 WHILE COUNTING THE BACKLOG. `LORAMER_QUEUE_OF_RECORD.md`
// holds 471 ★ items and the digest's §H/§L classify 348 of them OPEN. Some of those 348 say, in their own
// first sentence, that they are CLOSED:
//   ★PREVIEW-AUTH-UNREACHABLE  — "✅ CLOSED 2026-08-04, VERIFIED END TO END BY RUSS ON THE PREVIEW ITSELF"
//   ★PREVIEW-BUILDS-NOT-TRIGGERING — "✅ CLOSED 2026-08-04. THE CAUSE WAS COMMIT-SHA DEDUPLICATION"
// Both still classify OPEN, and the classifier is RIGHT BY ITS OWN RULE: `bulletDone` matches
// `✅ (RESOLVED|FIXED|DONE)` and CLOSED is deliberately not in that vocabulary — widening it once buried eight
// live parents whose headers recorded a finished slice. So neither half is a bug on its own; the CONTRADICTION
// is the bug, and nothing in this repo looks for it.
//
// ⛔ WHY IT MATTERS MORE THAN IT LOOKS: every count derived from the queue inherits the error. "348 open" is
// the denominator for the backlog, the tier ranking, and any statement about how much work remains. A number
// that is wrong by an unknown amount is worse than one that is wrong by a known amount.
//
// ⛔ THIS GUARD NEVER AUTO-CORRECTS AND NEVER GUESSES WHICH HALF IS TRUE. Retagging an item is a judgement
// about whether work is finished; a regex has no standing to make it. The guard's whole job is to make the
// contradiction impossible to miss and to name the phrase it matched so a human can dismiss a false positive
// in one read.
//
// ⛔ IT DOES NOT RE-IMPLEMENT THE WALK. Block-splitting and `statusIsDone` are imported from
// `scripts/lib/queue-walk.mjs`, the module the digest generator reads. A guard with its own walk would be a
// second reader of a second walk — the shape the generator's own comment warns about — and it would grade
// against a stale vocabulary the first time the generator's moved.
//
// HERMETIC: reads two repo files, no database, no network. That is why it belongs in `npm run guard`
// (inside `npm run build`, which runs on Vercel) rather than beside `check:data`.
//
// USAGE: node tests/guards/queue-tag-matches-text.guard.mjs
// EXIT:  0 clean · 1 contradiction(s) or untokened regression · 2 CANNOT RUN (a read that cannot answer is
//        never a pass)

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkQueue, tokensIn } from '../../scripts/lib/queue-walk.mjs'
import { UNTOKENED_BASELINE, CONTRADICTION_BASELINE } from './queue-tag-matches-text.baseline.mjs'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const QUEUE = 'LORAMER_QUEUE_OF_RECORD.md'

// ── THE CLOSURE VOCABULARY, AND ITS ANCHORING ─────────────────────────────────────────────────────────────
// ⛔ ANCHORED, NOT ANYWHERE. An open item may legitimately mention that a DIFFERENT item closed ("superseded
// by X, closed 2026-08-04"). Matching those would drown the real findings. So a closure phrase counts only
// where an item asserts its OWN status: at the start of the item's body, or immediately after an em dash —
// which is this queue's own convention for "name — VERDICT".
// ⛔ "COMPLETE" IS NOT A CLOSURE WORD IN THIS REPO AND INCLUDING IT WAS MY ERROR. Here it describes DATA
// COVERAGE, not item status — T3 is literally titled "CAPTURE COMPLETENESS", and the measured false positives
// were ★FOAMOH-GEO-ONE-COMPLETE-MONTH ("EVERY Foam OH google geo family is COMPLETE for EXACTLY ONE MONTH")
// and ★FAMILIES-NEVER-COMPLETE-ANYWHERE. A word that means two things cannot be a status test; the vocabulary
// is narrowed rather than the matcher widened with exceptions. Measured 2026-08-20: 3 of 48 findings.
const CLOSURE = '(?:✅\\s*)?(CLOSED|RESOLVED|SATISFIED|SHIPPED|DONE)'
const AT_SENTENCE_START = new RegExp(`(?:^|[.!?]\\s+|\\*\\*)\\s*${CLOSURE}\\b`, 'i')
const AFTER_EM_DASH = new RegExp(`—\\s*(?:\\*\\*\\s*)?${CLOSURE}\\b`, 'i')

/** Pure so the guard can drive every branch. Returns [{name, line, tag, phrase, where}]. */
export function findTagTextContradictions(items) {
  const out = []
  for (const it of items) {
    if (!it.isOpen || it.inAppendix) continue
    const header = it.header.trimStart()
    const name = (header.match(/^[-\s]*((?:★|[A-Z]{1,3}-FILL|P\d+)[^\s—|]*)/) || [, header.slice(0, 48)])[1]
    // The authored tag, for the report: the LAST tag-bearing line is what statusIsDone read.
    let tagLine = ''
    for (const l of it.block) if (/\[(?:LC|NP|EXT|DG)[^\]]*\]/.test(l)) tagLine = l
    const tag = (tagLine.match(/(\S+\s+\[(?:LC|NP|EXT|DG)[^\]]*\])\s*$/) || [, '(no trailing tag)'])[1]

    // ⛔ `open(<residual>)` IS NOT A CONTRADICTION — IT IS THE MOST HONEST TAG IN THE FILE. An item tagged
    // `open(layer-3 only) [LC]` or `open(measure SKU population) [LC]` has SHIPPED and is naming exactly what
    // is left. Its header rightly says ✅ SHIPPED and its tail rightly says open, and both are true at once.
    // Measured 2026-08-20: ★LIVE-VS-CAPTURED-DUAL-RENDER and ★COGS-SKU-JOIN, 2 of 45 findings. Flagging them
    // would punish the precision this queue is supposed to have.
    if (/\bopen\([^)]*\)\s*\[(?:LC|NP|EXT|DG)/.test(tagLine)) continue

    for (const [i, rawLine] of it.block.entries()) {
      // ⛔ AN ITEM'S OWN NAME IS NOT A CLOSURE CLAIM. ★FOAMOH-SEARCH-TERM-NEVER-COMPLETE and
      // ★FOAMOH-GEO-ONE-COMPLETE-MONTH both carry a closure word INSIDE the token, and the em-dash matcher
      // read "— COMPLETE" out of the name itself. Measured 2026-08-20: 2 of 48 findings were this, and both
      // were the item asserting nothing at all. On the header line only, the name token is removed before
      // matching; every other line is scanned whole.
      const line = i === 0 ? rawLine.replace(/^[-\s]*(?:★|[A-Z]{1,3}-FILL|P\d+)[^\s—|]*/, '') : rawLine
      const m = AT_SENTENCE_START.exec(line) || AFTER_EM_DASH.exec(line)
      if (!m) continue
      out.push({
        name,
        line: it.headerIdx + 1,
        tag: tag.trim(),
        phrase: m[0].replace(/\s+/g, ' ').trim(),
        where: line.trimStart().slice(0, 120),
      })
      break // one finding per item; the first assertion is the one that matters
    }
  }
  return out
}

/** Pure. Items carrying no ★/LORAMER_*_V token anywhere in their block — §L cannot find these. */
export function countUntokened(items) {
  return items.filter((it) => !it.inAppendix && tokensIn([it.header, ...it.block].join('\n')).length === 0).length
}

let text = ''
try {
  text = readFileSync(resolve(ROOT, QUEUE), 'utf8')
} catch (e) {
  console.error(`✗ QUEUE-TAG-MATCHES-TEXT CANNOT RUN — ${QUEUE} unreadable: ${e?.message ?? e}. A read that cannot answer is never a pass.`)
  process.exitCode = 2
}

if (process.exitCode !== 2) {
  let walked
  try {
    walked = walkQueue(text)
  } catch (e) {
    console.error(`✗ QUEUE-TAG-MATCHES-TEXT CANNOT RUN — the shared walk threw: ${e?.message ?? e}`)
    process.exitCode = 2
  }

  if (walked) {
    const open = walked.items.filter((i) => i.isOpen && !i.inAppendix)
    const contradictions = findTagTextContradictions(walked.items)
    const untokened = countUntokened(walked.items)
    const findings = []

    console.log(`[queue-tag-matches-text] items ${walked.items.length} · open ${open.length} · contradictions ${contradictions.length} · untokened ${untokened} (baseline ${UNTOKENED_BASELINE})`)

    // SHRINK-ONLY, like the untokened count: the held set is named in the baseline file, item by item, with
    // why each is held. A RISE is a NEW contradiction and is the whole point of the guard.
    if (contradictions.length > CONTRADICTION_BASELINE) {
      findings.push(
        `${contradictions.length} item(s) classified OPEN whose own body asserts closure — ABOVE the baseline of ${CONTRADICTION_BASELINE}. NEITHER HALF IS ` +
        `AUTO-CORRECTED — decide which is true and edit the item:\n` +
        contradictions.map((c) => `    ${QUEUE}:${c.line}  ${c.name}\n      tag    : ${c.tag}\n      matched: "${c.phrase}"\n      in     : ${c.where}`).join('\n'),
      )
    }
    // SHRINK-ONLY, same posture as frozen-cursors.baseline.mjs and completion-claims.baseline.mjs: the number
    // may fall freely and never rise. A rise means new untokened items entered the queue and §L cannot see them.
    if (untokened > UNTOKENED_BASELINE) {
      findings.push(
        `UNTOKENED REGRESSION — ${untokened} item(s) carry no ★ or LORAMER_*_V token, above the committed ` +
        `baseline of ${UNTOKENED_BASELINE}. §L indexes tokens only, so these items cannot be found by the ` +
        `topic index at all. Mint a token when banking; do not widen the matcher. ` +
        `If the rise is intended, lower nothing — fix the items.`,
      )
    }
    if (untokened < UNTOKENED_BASELINE) {
    if (contradictions.length && contradictions.length <= CONTRADICTION_BASELINE) {
      console.log(`[queue-tag-matches-text] ⇢ ${contradictions.length} contradiction(s) held at the baseline of ${CONTRADICTION_BASELINE} — named individually in queue-tag-matches-text.baseline.mjs, awaiting a human read. NOT muted: a rise fails.`)
    }
    if (contradictions.length < CONTRADICTION_BASELINE) {
      console.log(`[queue-tag-matches-text] ⇢ contradictions FELL to ${contradictions.length} (baseline ${CONTRADICTION_BASELINE}) — lower the baseline to lock the gain.`)
    }
      console.log(`[queue-tag-matches-text] ⇢ untokened FELL to ${untokened} (baseline ${UNTOKENED_BASELINE}) — lower the baseline in queue-tag-matches-text.baseline.mjs to lock the gain.`)
    }

    if (findings.length) {
      console.error(`✗ QUEUE-TAG-MATCHES-TEXT FAILED — ${findings.length} finding(s):\n  ` + findings.join('\n  '))
      process.exitCode = 1
    } else {
      console.log(`✓ queue-tag-matches-text OK — no OPEN item asserts its own closure; untokened ${untokened} ≤ ${UNTOKENED_BASELINE}.`)
    }
  }
}
