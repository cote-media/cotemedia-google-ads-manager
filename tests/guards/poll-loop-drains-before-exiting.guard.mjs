#!/usr/bin/env node
// LORAMER_POLL_DRAINS_BEFORE_EXITING_V1 — A POLLER MAY NOT BELIEVE THE FIRST SILENCE.
//
// ⛔ THE DEFECT, MEASURED, NOT IMAGINED. 2026-08-22 03:36:02Z the poll lane logged
//     {"processed":0,"stopped":"empty","elapsedMs":102,"budgetMs":180000}
// — it exited in 102ms with 179.9 SECONDS of budget unspent, 44 seconds after the producer published ~35
// messages. The loop did `if (empty) break`. It shipped green through 138 guards because nothing asserted
// what a poll loop must do when the queue answers "nothing right now".
//
// ⛔ AND "NOTHING RIGHT NOW" IS ALL AN EMPTY RECEIVE EVER MEANS. Vercel's own poll-mode example carries the
// instruction in a comment — `if (!result.ok && result.reason === 'empty') { // No messages available, wait
// before polling again }` — and there is NO long-poll parameter in the SDK or the HTTP API to wait on the
// server side. The producer's fire takes ~106s and publishes throughout it, so multi-second gaps mid-fire
// are NORMAL. A loop that treats the first gap as the end of the queue converts a 3-minute worker into a
// 0.1-second one.
//
// THREE LEGS, all read from the lane's own declared constants so no number is retyped here:
//   (a) the empty branch may not exit on a single empty — it must compare a CONSECUTIVE counter against a
//       declared maximum of at least 2, and it must WAIT (a positive backoff) before retrying.
//   (b) the quiet window (max consecutive empties × backoff) must be at least the lane's own declared
//       MIN_QUIET_WINDOW_MS floor. A counter of 2 at a 1ms backoff satisfies (a) and still quits instantly.
//   (c) the run must be able to report what it left behind: the lane must emit `budgetUnspentMs`. The old
//       output said `processed:0 · stopped:"empty"`, which reads like a drained queue and was not one.
//
// ⚠ WHAT THIS CANNOT REACH, SO ITS GREEN IS NOT OVER-READ: it proves the loop's SHAPE, never that the chosen
// window is long enough for a producer that later gets slower. The runtime half of that is the lane's own
// `budgetUnspentMs` / `emptyPolls` output, which is where a too-short window becomes visible.
//
// USAGE: node tests/guards/poll-loop-drains-before-exiting.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const LANE = process.env.LORAMER_POLL_LANE || 'src/app/api/cron/universe-drain-poll/route.ts'
const findings = []

let src = ''
try { src = readFileSync(resolve(ROOT, LANE), 'utf8') } catch (e) {
  console.error(`[poll-loop-drains-before-exiting] CANNOT RUN — ${LANE} unreadable (${e.message}). A guard that cannot read its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}

const num = (name) => {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*([\\d_]+)`).exec(src)
  return m ? Number(m[1].replace(/_/g, '')) : null
}

const maxEmpties = num('MAX_CONSECUTIVE_EMPTIES')
const backoff = num('EMPTY_BACKOFF_MS')
const floorMs = num('MIN_QUIET_WINDOW_MS')

// ── (a) NO EXIT ON A SINGLE EMPTY ─────────────────────────────────────────────────────────────────────────
if (maxEmpties === null) {
  findings.push(`(a) ${LANE} declares no MAX_CONSECUTIVE_EMPTIES. Without a consecutive counter the loop can only exit on the FIRST empty, which is the 102ms defect this guard exists for.`)
} else if (maxEmpties < 2) {
  findings.push(`(a) MAX_CONSECUTIVE_EMPTIES is ${maxEmpties}. One empty receive means "nothing visible right now", never "drained" — exiting on it is the defect, not a tuning choice.`)
}
if (backoff === null || backoff <= 0) {
  findings.push(`(a) ${LANE} declares no positive EMPTY_BACKOFF_MS. There is no long-poll parameter in the Queues SDK or HTTP API, so the wait between empty receives has to be ours; without it the loop spins the queue instead of waiting for it.`)
}
// The empty branch itself must not break unconditionally. Anchored on the counter comparison rather than on
// a variable name, so a rename does not silently disarm the leg.
const emptyBranch = /reason\s*===\s*'empty'[\s\S]{0,600}?\n\s*\}/.exec(src)
if (!emptyBranch) {
  findings.push(`(a) no \`reason === 'empty'\` branch found in ${LANE}. The lane must handle the empty case explicitly — an unhandled empty is an infinite loop or an instant exit, and both are defects.`)
} else {
  const body = emptyBranch[0]
  if (!/consecutive/i.test(body)) {
    findings.push(`(a) the empty branch does not consult a CONSECUTIVE counter. It reads:\n      ${body.replace(/\s+/g, ' ').slice(0, 220)}\n    An exit that does not require repeated silence is an exit on the first gap mid-fire.`)
  }
  if (!/await\s+sleep\s*\(|await\s+new\s+Promise/.test(body)) {
    findings.push(`(a) the empty branch does not AWAIT a backoff before retrying. Vercel's own poll-mode example says "wait before polling again"; without the wait this is a spin.`)
  }
}

// ── (b) THE QUIET WINDOW MUST BE REAL ─────────────────────────────────────────────────────────────────────
if (floorMs === null) {
  findings.push(`(b) ${LANE} declares no MIN_QUIET_WINDOW_MS. The floor is a DECISION about how long silence must last before it is believed; leaving it implicit means leg (b) is asserting nothing.`)
} else if (maxEmpties !== null && backoff !== null) {
  const quiet = maxEmpties * backoff
  if (quiet < floorMs) {
    findings.push(`(b) the quiet window is ${maxEmpties} × ${backoff}ms = ${quiet}ms, BELOW the lane's own declared floor of ${floorMs}ms. Leg (a) can be satisfied by a counter of 2 at a 1ms backoff and still quit in milliseconds — this is the leg that stops that.`)
  }
}

// ── (c) THE RUN MUST REPORT WHAT IT LEFT BEHIND ───────────────────────────────────────────────────────────
if (!/budgetUnspentMs/.test(src)) {
  findings.push(`(c) ${LANE} does not report \`budgetUnspentMs\`. The 102ms run reported \`processed:0 · stopped:"empty"\` and read exactly like a drained queue. An exit that leaves most of its budget unused must be visible on the face of the output, not inferred from elapsedMs by a reader who thought to check.`)
}

if (findings.length) {
  console.error(`[poll-loop-drains-before-exiting] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('  ⇒ SPEC: DECISIONS LORAMER_POLL_DRAINS_BEFORE_EXITING_V1. An empty receive means "nothing visible right now" — the producer publishes across a ~106s fire, so gaps are normal and the first one is not the end.')
  process.exitCode = 1
} else {
  console.log(`[poll-loop-drains-before-exiting] PASS — the lane waits ${backoff}ms between empty receives and requires ${maxEmpties} consecutive empties (${maxEmpties * backoff}ms of continuous silence, floor ${floorMs}ms) before it exits, and reports budgetUnspentMs. ⛔ LIMIT: this proves the SHAPE, never that the window is long enough for a producer that later gets slower.`)
}
