// LORAMER_CONTINUE_HEAD_ONE_SELECTOR_V1 — WHICH BLOCK OF CONTINUE_HERE IS THE HEAD. EXACTLY ONE ANSWER,
// READ BY EXACTLY ONE FUNCTION, IMPORTED BY EVERY CONSUMER.
//
// ⛔ THE DEFECT THIS EXISTS FOR, MEASURED 2026-08-21 AND LIVE IN THE REPO AT THE TIME. `build-resume-digest.mjs`
// extracted §E from the `═══ NEXT STEP ═══` FENCE and from nowhere else. CONTINUE_HERE's own convention had
// meanwhile moved: the last two session closes were written as `╔═══ SESSION CLOSE …` BOXES at the TOP of the
// file, above the fence. The fence still held the 2026-08-19 opener. So §E told every resuming session that the
// head was ★THREE-CLEAN-RUNS-BEFORE-FAMILY — **an item already marked ✅ SATISFIED 2026-08-19** — while the real
// head sat 1,580 lines higher in a shape the extractor could not see.
// ⛔ AND EVERY GATE READ GREEN OVER IT. The manifest hashes matched 9/9. `resume-digest-freshness.guard.mjs`
// compared the digest's `▶▶ NEXT STEP` opener to CONTINUE_HERE's `▶▶ NEXT STEP` opener; both found the SAME
// stale line, agreed, and passed. **A check that compares two readers of one stale source proves they agree,
// never that they are right.**
//
// ⛔ WHY A SHARED MODULE AND NOT A SECOND COPY IN THE GUARD. Same law as `scripts/lib/queue-walk.mjs`: two
// readers of one walk drift only if there are two walks. A guard with its own notion of "the head" would grade
// the generator against a rule the generator does not follow, and the first time either moved it would go quietly
// wrong in one direction or the other. The generator PICKS the head; the guard ASSERTS the digest carries the
// head; both ask THIS function.
//
// ⛔ IT REFUSES RATHER THAN GUESSES, AND THAT IS THE WHOLE POINT — inherited from
// LORAMER_DIGEST_NEXTSTEP_AMBIGUITY_V1, which already refused two `▶▶` openers. Silence is not completion: a
// selector that quietly picks one of two disagreeing heads reproduces the exact failure above, one shape later.
//
// PURE: takes text, returns a record or throws. No file reads, no writes, no process.exit.

// A head block written as a box. ⛔ `SESSION CLOSE` ONLY — a `╔═══ TIMED ITEMS …` box is a standing-clock block,
// not a next step, and one of them literally says "READ THIS BLOCK BEFORE ANYTHING ELSE IN THIS FILE" while
// being three closes old. Widening this to every box would make that block the head.
export const BOX_HEAD = /^╔═+\s*SESSION CLOSE\b/u
export const BOX_END = /^╚═/u
export const OPENER = /^▶▶\s*NEXT STEP/
export const FENCE = /^═+ NEXT STEP ═+/u

// A block that says it is history is not a candidate. This is how the file already demotes its own old heads —
// the convention predates this module (`⛔ SUPERSEDED 2026-08-15 · HISTORY · DO NOT ACT ON ITS DATES`).
export const IS_HISTORY = /\bSUPERSEDED\b|\bHISTORY\b/i

const DATE = /\b(20\d{2}-\d{2}-\d{2})\b/

/**
 * Every LIVE head candidate in CONTINUE_HERE, in file order.
 * Returns [{ kind: 'box'|'opener', line (1-based), date, header, blockStart, blockEnd }].
 * `blockEnd` is EXCLUSIVE. For a box it is the line after its `╚═` terminator; for the fence opener it is the
 * end of the fence section, which is what §E has always emitted.
 */
export function headCandidates(text) {
  const ls = text.split('\n')
  const out = []
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]
    if (BOX_HEAD.test(l)) {
      if (IS_HISTORY.test(l)) continue
      let end = ls.length
      for (let j = i + 1; j < ls.length; j++) { if (BOX_END.test(ls[j])) { end = j + 1; break } }
      out.push({ kind: 'box', line: i + 1, date: (l.match(DATE) || [])[1] || null, header: l, blockStart: i, blockEnd: end })
      continue
    }
    if (OPENER.test(l)) {
      if (IS_HISTORY.test(l)) continue
      // The opener's block is its fence section: from the ═══ NEXT STEP ═══ line above it to the next fence.
      let fence = -1
      for (let j = i; j >= 0; j--) { if (FENCE.test(ls[j])) { fence = j; break } }
      let end = ls.length
      for (let j = (fence === -1 ? i : fence) + 1; j < ls.length; j++) {
        if (/^═+/u.test(ls[j]) || /^### /.test(ls[j])) { end = j; break }
      }
      out.push({ kind: 'opener', line: i + 1, date: (l.match(DATE) || [])[1] || null, header: l, blockStart: fence === -1 ? i : fence, blockEnd: end })
    }
  }
  return out
}

/**
 * THE head. Throws — loudly, naming every candidate — rather than returning a guess.
 *
 * THE RULE: the newest head wins, and NEWEST MUST BE UNAMBIGUOUS IN BOTH AXES AT ONCE — it carries the latest
 * date AND sits topmost in the file. CONTINUE_HERE is written newest-first; when date order and file order
 * disagree, one of the two is lying and nothing here can tell which.
 */
export function selectHead(text) {
  const cands = headCandidates(text)
  const describe = (c) => `    CONTINUE_HERE.md:${c.line}  [${c.kind}]  ${c.date || 'NO DATE'}  ${c.header.trim().slice(0, 110)}`

  if (cands.length === 0) {
    throw new Error(
      'CONTINUE_HERE HAS NO LIVE HEAD. Neither a `╔═══ SESSION CLOSE …` box nor a `▶▶ NEXT STEP` opener was found ' +
      'that is not marked SUPERSEDED/HISTORY. §E has no source and the next session has no next step.'
    )
  }

  const undated = cands.filter((c) => !c.date)
  if (undated.length) {
    throw new Error(
      `HEAD SELECTOR REFUSES TO GUESS: ${undated.length} live head candidate(s) carry NO DATE, so "newest" is ` +
      `undecidable. Put a YYYY-MM-DD in the header, or mark the block SUPERSEDED/HISTORY.\n` +
      undated.map(describe).join('\n')
    )
  }

  const newest = cands.reduce((a, b) => (b.date > a.date ? b : a))
  const tied = cands.filter((c) => c.date === newest.date)
  if (tied.length > 1) {
    throw new Error(
      `HEAD SELECTOR REFUSES TO GUESS: ${tied.length} live head candidates share the newest date ${newest.date}. ` +
      `Exactly one block may be the head. Demote the others with SUPERSEDED/HISTORY.\n` +
      tied.map(describe).join('\n')
    )
  }

  const topmost = cands.reduce((a, b) => (b.line < a.line ? b : a))
  if (topmost.line !== newest.line) {
    throw new Error(
      `HEAD SELECTOR REFUSES TO GUESS: FILE ORDER AND DATE ORDER DISAGREE. CONTINUE_HERE is written newest-first, ` +
      `but the topmost live head is not the newest-dated one — so either a stale block was left live at the top, ` +
      `or a new block was appended below an old one. Fix the file; do not let a reader pick.\n` +
      `  topmost: \n${describe(topmost)}\n  newest:  \n${describe(newest)}\n` +
      `  all live candidates:\n${cands.map(describe).join('\n')}`
    )
  }

  return { ...newest, block: text.split('\n').slice(newest.blockStart, newest.blockEnd).join('\n'), candidates: cands }
}
