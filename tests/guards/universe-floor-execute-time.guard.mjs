#!/usr/bin/env node
// LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 — THE FLOOR IS EVALUATED AT EXECUTE TIME, NEVER CARRIED ON A MESSAGE.
//
// ⛔ THE DEFECT: the v2 consumer read `msg.floorDate ?? VENDOR_FLOOR_DATE`. A floor decided by the PUBLISHER,
// frozen onto a queue message, and consumed by the CONSUMER an unknown time later. **TWO OWNERS, ONE FACT.**
//
// ⛔ AND THE WALL-CLOCK MAKES IT THE WORST POSSIBLE RATIO, which is why it is a build failure rather than a
// tidiness note: this repo's own record puts queue messages at the default 24h TTL, and ANY rolling boundary
// moves ONE DAY PER DAY. A window planned flush against the boundary executes up to one full boundary-day
// outside it. The check and the use were in different invocations, so no amount of care at plan time could
// close it — only moving the evaluation could.
//
// ⛔ WHY A GREP AND NOT A DRIVE: the failure is a DATA-FLOW property (where a value is READ), not a return
// value. Driving the handler would need a live queue message, a vendor stream and a database. The check is
// structural on purpose, and its limit is stated rather than hidden: it proves the message field is not READ
// on this path. It cannot prove the resolved value is correct — `google-account-floor.guard.mjs` (a) does that.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const CONSUMER = process.env.LORAMER_FLOOR_CONSUMER || 'src/app/api/queues/google-ads-universe-v2/route.ts'

let src = ''
try { src = readFileSync(resolve(ROOT, CONSUMER), 'utf8') }
catch (e) {
  console.error(`[universe-floor-execute-time] FAIL — UNREADABLE ${CONSUMER}: ${e.message}. A guard that cannot read its evidence FAILS.`)
  process.exit(1)
}
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── (a) THE MESSAGE'S FLOOR FIELD MAY NOT BE READ ────────────────────────────────────────────────────
// Any of `msg.floorDate`, `{ floorDate } = msg`, or a destructure of the message that pulls it out.
if (/\bmsg\s*\.\s*floorDate\b/.test(code)) {
  findings.push(`(a) ${CONSUMER} reads \`msg.floorDate\`. THE FLOOR MAY NOT RIDE THE MESSAGE. It is decided by the publisher ` +
    `and used by the consumer up to a 24h queue TTL later, against a boundary that moves one day per day.`)
}
const destructures = code.match(/const\s*\{[^}]*\}\s*=\s*msg\b/g) || []
for (const d of destructures) {
  if (/\bfloorDate\b/.test(d)) {
    findings.push(`(a) ${CONSUMER} destructures \`floorDate\` off the message: ${d.replace(/\s+/g, ' ')}. Same defect, different syntax.`)
  }
}

// ── (b) THE FLOOR MUST BE RESOLVED INSIDE THE HANDLER — i.e. AT EXECUTE TIME ─────────────────────────
// ⛔ POSITION IS THE POINT, NOT PRESENCE. A `readAccountWall()` at module scope would run once per cold
// start and be shared across every message the instance handles — plan-time-by-another-name, and it would
// pass a naive "is it called?" check.
const handlerAt = code.search(/handleCallback\s*\(/)
const resolveAt = code.search(/readAccountWall\s*\(/)
if (resolveAt === -1) {
  findings.push(`(b) ${CONSUMER} never calls readAccountWall(). The floor must be resolved from stored per-(account,surface) state ` +
    `in the same invocation that uses it; nothing else closes the plan/execute gap.`)
} else if (handlerAt === -1) {
  findings.push(`(b) ${CONSUMER} has no handleCallback( — this guard cannot locate the execute-time boundary and FAILS rather than assuming.`)
} else if (resolveAt < handlerAt) {
  findings.push(`(b) ${CONSUMER} resolves the floor at MODULE SCOPE (readAccountWall at ${resolveAt}, handler opens at ${handlerAt}). ` +
    `That is once per cold start and shared across every message the instance handles — plan time wearing a different hat.`)
}

// ── (c) THE ADVANCE MUST ACCEPT AN UNKNOWN FLOOR ─────────────────────────────────────────────────────
// ⛔ IF `advance` CANNOT TAKE null IT CANNOT REPRESENT UNKNOWN, and a caller will hand it a default to make
// the type check — which is the constant coming back in through the type system.
if (/function\s+advance\s*\([^)]*floorDate\s*:\s*string\s*[,)]/.test(code)) {
  findings.push(`(c) advance() takes \`floorDate: string\` — it CANNOT represent UNKNOWN. A surface with no observed wall has no floor, ` +
    `and a signature that cannot say so forces a caller to invent one. It must be \`string | null\`.`)
}
if (!/floorDate\s*!==\s*null/.test(code) && !/floorDate\s*===\s*null/.test(code)) {
  findings.push(`(c) ${CONSUMER} never branches on a null floor. UNKNOWN must be handled explicitly — never defaulted, never ` +
    `silently compared against, and never read as "no history".`)
}

if (findings.length) {
  console.error(`[universe-floor-execute-time] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-floor-execute-time] PASS — ${CONSUMER} never reads a floor off the queue message · resolves it via readAccountWall INSIDE the handler (execute time, not module scope) · and advance() accepts \`string | null\` and branches on the null case explicitly. LIMIT: structural — it proves WHERE the floor is read, not that the value is right.`)
