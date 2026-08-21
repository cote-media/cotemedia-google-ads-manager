// LORAMER_QUEUE_WALK_SHARED_V1 — THE QUEUE WALK, EXTRACTED SO THERE IS EXACTLY ONE OF IT.
//
// ⛔ WHY THIS FILE EXISTS AND WHY IT IS NOT A COPY. `scripts/build-resume-digest.mjs` already walks
// LORAMER_QUEUE_OF_RECORD.md to produce §H (open items) and §L (the token index), and its own comment states
// the principle this file preserves: "the walk is now SHARED. §H and §L are produced from the SAME pass over
// the same blocks with the SAME statusIsDone, so the index and the open-queue list CANNOT disagree about an
// item's status … two readers of one walk can drift only if there are two walks."
//
// A guard that re-implemented the split or the status test would BE a second walk, and the first time the
// generator's vocabulary moved, the guard would keep grading against the old one and stay green while
// disagreeing. So the logic moves here and BOTH read it.
//
// ⛔ THE FUNCTIONS BELOW ARE TRANSCRIBED FROM build-resume-digest.mjs WITHOUT A BEHAVIOUR CHANGE. Every regex,
// every window width, every ordering of the done-checks is byte-identical to lines 193-256 of that file at
// the time of extraction. The comments explaining WHY each branch exists are kept with the code they explain,
// because every one of them records a defect that shipped.
//
// PURE: takes the queue text, returns items. No file reads, no writes, no process.exit. That is what lets a
// guard import it without triggering the digest build (the generator is a top-level script: importing it
// would READ ten docs and REWRITE the 2.2 MB digest as a side effect).

// LORAMER_DIGEST_H_FILLQUEUE_V1 — item shapes. FILL entries and P-numbered lines are items too; the original
// `- ` bullet test dropped them, and losing the fill queue's tail is losing the work list.
export const FILL_ENTRY = /^[A-Z]{1,3}-FILL\b/
export const isItemStart = (l) => {
  const t = l.trimStart()
  return t.startsWith('- ') || /^P\d+ /.test(t) || FILL_ENTRY.test(t) || t.startsWith('DATA COMPLETENESS ONBOARDING')
}
export const TAG = /\[(?:LC|NP|EXT|DG)[^\]]*\]/
export const INCLUDE_RE = /\b(open(?:\([^)]*\))?|partial|blocked|decision-pending|deferred|banked|parked|mostly-closed|proposed|standing)\b[^[]*\[/i
export const FENCE_RE = /^═+/u

// The AUTHORED status is the LAST tag-bearing line of the block, and only the keyword governing the FINAL
// tag counts. Parentheticals are stripped first so "(V1 done)" cannot be read as the item's own status.
export const statusIsDone = (block) => {
  let statusLine = ''
  for (const l of block) if (TAG.test(l)) statusLine = l
  if (!statusLine) return false
  const s = statusLine.replace(/\([^)]*\)/g, ' ')
  let lastTag = -1, re = /\[(?:LC|NP|EXT|DG)[^\]]*\]/g, m
  while ((m = re.exec(s))) lastTag = m.index
  if (lastTag < 0) return false
  const window = s.slice(Math.max(0, lastTag - 26), lastTag)
  const kws = [...window.matchAll(/\b(open(?:-watch)?|partial|blocked|decision-pending|deferred|banked|parked|mostly-closed|proposed|standing|resolved|done|closed)\b/gi)]
  return kws.length ? /^(resolved|done|closed)$/i.test(kws[kws.length - 1][1]) : false
}

/**
 * Walk the queue text into items. Returns { items, doneMarker, appendixEnd }.
 * items: { header, headerIdx, block, isOpen, inAppendix }
 *
 * `headerIdx` is 0-based; add 1 for a human line number. The generator does not need it and does not compute
 * it; a guard reporting a finding does, so it is carried here rather than recomputed by a second walk.
 */
export function walkQueue(queueText) {
  const qLines = queueText.split('\n')
  const doneMarker = qLines.findIndex((l) => l.includes('DONE — DO NOT REBUILD'))
  if (doneMarker === -1) throw new Error('queue DONE appendix marker not found')
  const fenceAfterMarker = qLines.findIndex((l, i) => i > doneMarker && FENCE_RE.test(l))
  let appendixEnd = qLines.length
  for (let i = (fenceAfterMarker === -1 ? doneMarker : fenceAfterMarker) + 1; i < qLines.length; i++) {
    if (FENCE_RE.test(qLines[i]) || /^##\s/.test(qLines[i])) { appendixEnd = i; break }
  }

  const items = []
  for (let hdr = 0; hdr < qLines.length; hdr++) {
    if (!isItemStart(qLines[hdr])) continue
    let end = hdr + 1
    const block = [qLines[hdr]]
    for (; end < qLines.length; end++) {
      const t = qLines[end]
      if (isItemStart(t) || /^##\s/.test(t) || FENCE_RE.test(t) || t.includes('DONE — DO NOT REBUILD')) break
      block.push(t)
    }
    const headerIdx = hdr
    hdr = end - 1
    const rec = (isOpen, inAppendix = false) =>
      items.push({ header: qLines[headerIdx], headerIdx, block, isOpen, inAppendix })

    // ⛔ THE DONE APPENDIX IS SKIPPED WITHOUT BEING RECORDED, AND THAT IS NOT TIDINESS — IT IS THE ORIGINAL'S
    // BEHAVIOUR AND §L DEPENDS ON IT. The first cut of this module recorded appendix items with an
    // `inAppendix` flag and let callers filter. The digest's §L iterates the recorded set, so two "DONE — DO
    // NOT REBUILD" entries leaked into the token index: 932 tokens instead of 930, 452 queue-only instead of
    // 450, untokened 266 instead of 265. Caught by diffing the regenerated digest against the original's
    // output before this module was wired in. Record nothing here, exactly as the original `continue` did.
    if (headerIdx >= doneMarker && headerIdx < appendixEnd) continue

    // done-detection SPLIT BY ITEM SHAPE, and the split is load-bearing: widening the bullet test to
    // SHIPPED/COMPLETE/APPLIED buried 8 still-open parents whose headers merely recorded one finished slice.
    const isFill = FILL_ENTRY.test(qLines[headerIdx].trimStart())
    const fillDone = isFill && /^[A-Z]{1,3}-FILL\S*(\s+\S+)?\s+✅\s*(SHIPPED|DONE|COMPLETE|CLOSED|RESOLVED|FIXED|APPLIED)\b/i.test(qLines[headerIdx].trimStart())
    const bulletDone = !isFill && /✅\s*(RESOLVED|FIXED|DONE)\b/i.test(qLines[headerIdx])
    if (fillDone || bulletDone || /^-\s*\[x\]/i.test(qLines[headerIdx])) { rec(false); continue }

    // TRACKED = CARRIES A TAG. Absence of a recognised status word must never mean "omit".
    const blockText = block.join('\n')
    if (!TAG.test(blockText) && !INCLUDE_RE.test(blockText)) { rec(false); continue }
    if (statusIsDone(block)) { rec(false); continue }
    rec(true)
  }
  return { items, doneMarker, appendixEnd }
}

// The token shapes §L indexes. Kept here so a guard counting untokened items counts the SAME set the index
// declares unindexable.
export const TOKEN_RE = /(★[A-Z0-9][A-Z0-9._-]*[A-Z0-9]|LORAMER_[A-Z0-9_]*_V\d+)/g
export const tokensIn = (t) => [...new Set((t.match(TOKEN_RE) || []).map((x) => x.replace(/[.,;:]+$/, '')))]
