#!/usr/bin/env node
// LORAMER_EVENT_ATTRIBUTION_V1 + LORAMER_PERIOD_RESOLUTION_NAMED_V1 — THE BLOCK STAYS IN THE CACHED PREFIX,
// WITH ITS BAN, ITS HEDGE LIST, ITS OVER-CORRECTION CLAUSE AND ITS DISCLOSURE RULE INTACT.
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────────────
// C13 (2026-08-14 baseline, reconstructed records-first 2026-08-15): Lora ran 4-5 real queries, found a REAL
// discontinuity, and asserted an EVENT no tool can attest — "Confirmed: … That's the go-live" — because
// nothing anywhere told her events and numbers have different evidentiary standing. V7: she resolved an
// ambiguous "q2" silently. Both rules live in ONE static prefix block; this guard is their FIX-WITH-GUARD.
//
// A block like this dies in the same three silent ways capture-facts-in-prefix.guard.mjs names:
//   1. a refactor moves the push below `lines = suffixLines` → correct content, billed EVERY answer;
//   2. an edit drops the HEDGE list → "likely your go-live" walks straight back in, politely;
//   3. an edit drops the OVER-CORRECTION clause → she stops describing discontinuities at all, trading the
//      fabrication defect for an over-refusal defect (the adversary's other attack, addressed by name).
//
// ── HONEST LIMIT ───────────────────────────────────────────────────────────────────────────────────────
// STATIC READ + fragment pins. Proves the block is wired, placed in the prefix region, and intact. It does
// NOT prove the model OBEYS it — behavioural re-measure of C13/V7 is PAYWALLED and joins the one paid
// baseline run (LORAMER_EVAL_PAYWALL_MOVED_TO_END_OF_WIRING_V1). Read a green as "the rule reaches her,
// cached", never "the failure is fixed".
//
// USAGE: node tests/guards/event-attribution-in-prefix.guard.mjs [--inject-suffix] [--inject-drop-hedge]
import { readFileSync } from 'node:fs'
import path from 'node:path'
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }
const CTX = 'src/lib/intelligence/build-claude-context.ts'
const CHAT = 'src/app/api/chat/route.ts'
const MARK = '=== EVENT ATTRIBUTION & PERIOD RESOLUTION'
const INJECT_SUFFIX = process.argv.includes('--inject-suffix')
const INJECT_DROP = process.argv.includes('--inject-drop-hedge')

// ── REQUIRED FRAGMENTS, pinned VERBATIM (the banned-expressions registry pattern) ──────────────────────
// The BAN and its scope:
const BAN = [
  'It does NOT attest EVENTS',
  'NEVER ASSERT AN UNATTESTED EVENT',
  'no query result can currently attest that any such event happened',
]
// The HEDGE list — each phrase individually pinned, because dropping one re-opens exactly that phrasing:
const HEDGES = [
  'A HEDGE IS THE SAME CLAIM IN WEAKER CLOTHES',
  '"consistent with a restructure"',
  '"likely your go-live"',
  '"appears to be the migration"',
  '"probably when you launched"',
  'Softening the verb does not add evidence',
]
// The OVER-CORRECTION clause — she must keep DESCRIBING discontinuities:
const DESCRIBE = [
  'DESCRIBING A CHANGE IS NEVER RESTRICTED',
  'The ban is ONLY on naming the unattested cause',
]
// The CORRECT SHAPE — candidate + invite + user-attribution door:
const SHAPE = [
  'OFFER any observed discontinuity as a candidate',
  'INVITE the user to confirm the date',
  'If the USER asserts the event or its date',
]
// PERIOD RESOLUTION (V7's named-resolution rule, banked at the rubric re-certification):
const PERIOD = [
  'NAME THE PERIOD YOU CHOSE',
  'state your resolution at the FIRST mention of the period',
  'Silent resolution of an ambiguous period is a wrong answer even when the numbers are perfect',
]

// ── PURE CORE ──────────────────────────────────────────────────────────────────────────────────────────
export function decideEventBlockPlacement({ prefixBindLine, blockLine, swapLine, missing, cacheWrapped }) {
  const f = []
  if (blockLine < 0) f.push(`the event-attribution block is GONE from ${CTX} — C13's "Confirmed: that's the go-live" has nothing standing in its way again.`)
  else {
    if (prefixBindLine < 0 || swapLine < 0) f.push(`could not locate the prefix/suffix boundary in ${CTX} — BROKEN INSTRUMENT.`)
    else if (!(blockLine > prefixBindLine && blockLine < swapLine)) {
      f.push(`the block is pushed at line ${blockLine} but the prefix region is ${prefixBindLine}..${swapLine}. It is in the UNCACHED SUFFIX — correct content, billed on EVERY answer instead of once per cache window.`)
    }
  }
  for (const p of missing) f.push(`required fragment missing from the block: "${p}"`)
  if (!cacheWrapped) f.push(`${CHAT} no longer applies cache_control to the prefix — the block is no longer cached.`)
  return { findings: f, ok: f.length === 0 }
}

// ── INPUTS (the statement-vs-mention lesson is inherited from capture-facts, not relearned) ────────────
const src = read(CTX)
if (!src) { console.error(`✗ ${CTX} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const lines = src.split('\n')
const stmtLineOf = (re) => lines.findIndex((l) => re.test(l) && !/^\s*(\/\/|\*)/.test(l)) + 1 || -1
const prefixBindLine = stmtLineOf(/^\s*let lines: string\[\] = prefixLines\b/)
let blockLine = lines.findIndex((l) => l.includes(MARK) && !/^\s*(\/\/|\*)/.test(l)) + 1 || -1
const swapLine = stmtLineOf(/^\s*lines = suffixLines\b/)

if (INJECT_SUFFIX && blockLine > 0) {
  blockLine = swapLine + 1
  console.log('  [--inject-suffix] moved the block BELOW the suffix swap in the check INPUT (no file written) — it must go RED.')
}
const required = [...BAN, ...HEDGES, ...DESCRIBE, ...SHAPE, ...PERIOD]
const dropped = INJECT_DROP ? HEDGES[1] : null
if (dropped) console.log(`  [--inject-drop-hedge] removed required fragment "${dropped}" from the check INPUT (no file written) — it must go RED.`)
const missing = required.filter((r) => (dropped === r ? true : !src.includes(r)))

const chatSrc = read(CHAT)
if (!chatSrc) { console.error(`✗ ${CHAT} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const cacheWrapped = /text:\s*prefix,\s*cache_control/.test(chatSrc.replace(/\s+/g, ' '))

const verdict = decideEventBlockPlacement({ prefixBindLine, blockLine, swapLine, missing, cacheWrapped })
console.log(`[event-attribution-prefix] prefix region = lines ${prefixBindLine}..${swapLine} · block pushed at ${blockLine}`)
console.log(`[event-attribution-prefix] required fragments present: ${required.length - missing.length}/${required.length} (${BAN.length} ban · ${HEDGES.length} hedge · ${DESCRIBE.length} over-correction · ${SHAPE.length} shape · ${PERIOD.length} period)`)
console.log(`[event-attribution-prefix] ${CHAT} wraps the prefix in cache_control: ${cacheWrapped}`)
console.log('[event-attribution-prefix] STATIC READ — proves the rules REACH her, cached; obedience is the paywalled baseline\'s to measure.')
if (!verdict.ok) {
  console.error(`✗ event-attribution-prefix FAIL — ${verdict.findings.length} finding(s):`)
  for (const f of verdict.findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ event-attribution-prefix OK — block present, inside the cached prefix, ban/hedges/over-correction/shape/period all intact.')
process.exit(0)
