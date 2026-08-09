#!/usr/bin/env node
// LORAMER_NEXT_STEP_OBEYS_RANKING_GUARD_V1
//
// WHY THIS EXISTS: LORAMER_COMPLETION_PRIORITY_V1 was banked 2026-07-22 and then drove NOTHING. Its Tier-0 #1
// (the Woo Shelley stall) sat for three days and was finally hit BY ACCIDENT on 07-25 while chasing something
// else. The cause was not disagreement with the ranking — nobody ever read it at resume. CONTINUE_HERE's
// NEXT STEP was written freehand at wrap, pointing at whatever happened to be in flight, and the next session
// opened on that instead of on the ranking. A ranking that nothing consults is a document, not a priority.
//
// THIS IS THE RULE-HOME LAW APPLIED TO PRIORITISATION: the rule ("work the ranking") lived where the wrap
// author reads it and was broken by the wrap author. It needed an ENFORCER at the point the wrap is written.
//
// THREE LEGS:
//   1. The QUEUE's ranking block declares exactly ONE machine-readable `TOP-UNBLOCKED:` item.
//   2. CONTINUE_HERE carries exactly ONE `▶▶ NEXT STEP` opener and it lives INSIDE the ═══ NEXT STEP ═══
//      fence. (Two openers in two places is how the 07-25 wrap produced a digest whose hashes read 9/9 green
//      while its body pointed at the previous day.)
//   3. The opener either NAMES the top-unblocked item, or declares `DEPARTURE FROM RANKING:` and gives a
//      reason — in §E itself, where the next session will actually read it.
//
// AUTHORITATIVE SOURCE = THE DOCS. HERMETIC: filesystem reads only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)

const queue = read('LORAMER_QUEUE_OF_RECORD.md')
const ch = read('CONTINUE_HERE.md')
if (!queue || !ch) { console.error('FAIL: cannot read LORAMER_QUEUE_OF_RECORD.md or CONTINUE_HERE.md'); process.exit(1) }

// ── 1. THE RANKING DECLARES ITS TOP UNBLOCKED ITEM ────────────────────────────────────────────────────────
// A prose ranking cannot be parsed reliably, and a guard that guesses is worse than none — so the ranking
// states its own head explicitly. Updating that one line IS the act of re-ranking.
const topLines = queue.split('\n').filter((l) => /^\s*TOP-UNBLOCKED:/.test(l))
let token = null
if (topLines.length !== 1) {
  fail(`RANKING HEAD NOT DECLARED: found ${topLines.length} \`TOP-UNBLOCKED:\` lines in LORAMER_QUEUE_OF_RECORD.md, expected exactly 1. The ranking must name its own top unblocked item on one machine-readable line, or nothing can check that the session opened on it.`)
} else {
  const m = topLines[0].match(/TOP-UNBLOCKED:\s*(★[A-Z0-9-]+)/)
  if (!m) {
    fail(`RANKING HEAD HAS NO ★TOKEN: "${topLines[0].trim().slice(0, 120)}". It must name a ★ITEM token that §E can cite verbatim.`)
  } else {
    token = m[1]
  }
}

// ── 2. EXACTLY ONE OPENER, AND IT IS INSIDE THE FENCE ─────────────────────────────────────────────────────
const lines = ch.split('\n')
const openerIdx = lines.map((l, i) => (/^▶▶\s*NEXT STEP/.test(l) ? i : -1)).filter((i) => i >= 0)
const fenceIdx = lines.findIndex((l) => /^═+ NEXT STEP ═+/.test(l))

if (fenceIdx === -1) {
  fail('NO ═══ NEXT STEP ═══ FENCE in CONTINUE_HERE.md — the digest extractor reads §E from that fence; without it §E is whatever the extractor happens to land on.')
}
if (openerIdx.length === 0) {
  fail('NO `▶▶ NEXT STEP` OPENER in CONTINUE_HERE.md. Every wrap must leave exactly one, or the next session opens on nothing and picks up whatever was last in flight.')
} else if (openerIdx.length > 1) {
  fail(`TWO OR MORE \`▶▶ NEXT STEP\` OPENERS (lines ${openerIdx.map((i) => i + 1).join(', ')}). This is the 2026-07-25 defect exactly: the wrap wrote its opener into the session-log block while the fence still held the previous day's, so the digest's hashes read 9/9 GREEN while its body pointed at yesterday. One opener, in the fence.`)
}
if (openerIdx.length === 1 && fenceIdx !== -1) {
  // The fence body runs from the fence line to the next ═══ line.
  let end = lines.length
  for (let i = fenceIdx + 1; i < lines.length; i++) { if (/^═+/u.test(lines[i])) { end = i; break } }
  if (!(openerIdx[0] > fenceIdx && openerIdx[0] < end)) {
    fail(`OPENER IS OUTSIDE THE FENCE: \`▶▶ NEXT STEP\` is on line ${openerIdx[0] + 1}, but the ═══ NEXT STEP ═══ fence spans lines ${fenceIdx + 1}–${end}. The digest reads the fence, so an opener written anywhere else is invisible to the resume path — which is how a stale next step survived a green freshness gate.`)
  }
}

// ── 3. THE OPENER OBEYS THE RANKING, OR SAYS WHY NOT — IN §E ──────────────────────────────────────────────
if (token && openerIdx.length === 1) {
  const opener = lines.slice(openerIdx[0], Math.min(openerIdx[0] + 3, lines.length)).join('\n')
  const namesTop = opener.includes(token)
  const departure = opener.match(/DEPARTURE FROM RANKING:\s*(.+)/)
  if (!namesTop && !departure) {
    fail(`§E DOES NOT OBEY THE RANKING: the opener names neither ${token} (the declared top unblocked item) nor a \`DEPARTURE FROM RANKING:\` reason. This is exactly how ${token}-class work sat untouched for three days while sessions opened on whatever was last in flight.`)
  }
  if (departure) {
    if (!namesTop) {
      fail(`DEPARTURE DOES NOT NAME WHAT IT DEPARTS FROM: §E declares a departure but never mentions ${token}. A departure that does not name the item it skipped reads, next session, as if the ranking said something else.`)
    }
    if ((departure[1] || '').trim().length < 40) {
      fail(`DEPARTURE REASON TOO THIN ("${(departure[1] || '').trim()}"): state why the ranking is being departed from in a full sentence. A one-word reason is how "we'll get to it" becomes three days.`)
    }
  }
}

// ── 4. THE OPENER CANNOT BE OLDER THAN THE NEWEST SESSION LOG IN THE SAME FILE ────────────────────────────
// ⛔ ADDED 2026-08-09 UNDER LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1, and it is banked because
// it ACTUALLY HAPPENED: the fence read `▶▶ NEXT STEP — 2026-08-06` while this same file carried a
// `## Session log (2026-08-08 → 2026-08-09 …)` block whose first words were "START HERE". Two sessions closed
// on top of that opener without moving it, so the resume path pointed at a five-link chain whose central
// premise had been FALSIFIED on 08-08 — and every existing leg stayed GREEN, because one opener, inside the
// fence, naming the ranking is all they ask. Legs 1-3 check WHERE the opener is and WHAT it names; nothing
// checked WHEN it was written. A stale opener is exactly as dangerous as a missing one and reads as current.
// ⚠ LIMIT, stated: this compares DATE STAMPS, not content. An opener re-dated without being rewritten passes.
// It catches the drift that actually occurred — a wrap that logged its session and forgot the fence.
{
  const dateOf = (s) => { const m = String(s).match(/\b(20\d{2}-\d{2}-\d{2})\b/g); return m ? m.sort().pop() : null }
  const logDates = lines.filter((l) => /^##\s*Session log/i.test(l)).map(dateOf).filter(Boolean).sort()
  const newestLog = logDates.length ? logDates[logDates.length - 1] : null
  if (!newestLog) {
    fail('NO DATED `## Session log` HEADING in CONTINUE_HERE.md — the wrap log is what dates the file, and without one the opener cannot be checked for staleness.')
  } else if (openerIdx.length === 1) {
    // ⛔ THE OPENER'S OWN STAMP, NOT ANY DATE ON THE LINE — and this was caught by the leg's own RED proof.
    // An opener body routinely cites other dates (a falsification, a measurement), so `max(dates on the line)`
    // would let a 08-06 stamp pass merely because its prose mentions 08-08. That is a guard that reads green
    // for the wrong reason, which is worse than no guard.
    const stampM = lines[openerIdx[0]].match(/^▶▶\s*NEXT STEP\s*[—–-]\s*(20\d{2}-\d{2}-\d{2})/)
    const openerDate = stampM ? stampM[1] : null
    if (!openerDate) {
      fail(`OPENER CARRIES NO DATE STAMP: "${lines[openerIdx[0]].slice(0, 100)}". It must begin \`▶▶ NEXT STEP — YYYY-MM-DD\` — a date somewhere in the body is not a stamp, and cannot be told apart from a date the opener is talking ABOUT.`)
    } else if (openerDate < newestLog) {
      fail(`STALE OPENER: \`▶▶ NEXT STEP\` is dated ${openerDate} while the newest \`## Session log\` in the same file is ${newestLog}. A session closed on top of the fence without moving it — which is precisely how a resume points at a chain whose premise was falsified two sessions ago while every other leg reads green.`)
    }
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_NEXT_STEP_OBEYS_RANKING_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log(`next-step-obeys-ranking.guard: PASS — one opener, inside the fence, obeying the ranking head ${token}.`)
