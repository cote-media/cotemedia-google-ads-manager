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
// ⛔ POSITION IS THE POINT, NOT PRESENCE. A resolution at module scope would run once per cold start and be
// shared across every message the instance handles — plan-time-by-another-name, and it would pass a naive
// "is it called?" check.
// ⛔ THE SITE MOVED 2026-08-13 (LORAMER_WALK_STOP_ONE_RESOLVER_V1) AND THIS LEG MOVED WITH IT, RED FIRST.
// The consumer's inline `readAccountWall(...)` + `composeWalkStop(...)` pair became `resolveWalkStop(...)`,
// which performs exactly that wall read and that composition, so that the RESUMER could compose the SAME
// stop without a second composition site (`inception-stop` leg (c) permits exactly one, and was NOT
// relaxed). **THE INTENT IS UNCHANGED AND IS WHAT IS CHECKED: the floor is resolved from stored
// per-(account,surface) state, in the same invocation that uses it.** Either spelling satisfies it; what
// still fails is resolving at module scope, or not resolving at all. Widening a guard to admit a rename is
// how a guard stops guarding — so this accepts a NAMED alternative, never a wildcard.
const handlerAt = code.search(/handleCallback\s*\(/)
const RESOLVERS = [/readAccountWall\s*\(/, /resolveWalkStop\s*\(/]
const positions = RESOLVERS.map((re) => code.search(re)).filter((i) => i !== -1)
const resolveAt = positions.length ? Math.min(...positions) : -1
if (resolveAt === -1) {
  findings.push(`(b) ${CONSUMER} calls neither readAccountWall() nor resolveWalkStop(). The floor must be resolved from stored ` +
    `per-(account,surface) state in the same invocation that uses it; nothing else closes the plan/execute gap.`)
} else if (handlerAt === -1) {
  findings.push(`(b) ${CONSUMER} has no handleCallback( — this guard cannot locate the execute-time boundary and FAILS rather than assuming.`)
} else if (resolveAt < handlerAt) {
  findings.push(`(b) ${CONSUMER} resolves the floor at MODULE SCOPE (resolution at ${resolveAt}, handler opens at ${handlerAt}). ` +
    `That is once per cold start and shared across every message the instance handles — plan time wearing a different hat.`)
}
// ⛔ AND THE RESOLVER ITSELF MUST DO THE WALL READ, or the rename above becomes a hole: a `resolveWalkStop`
// that stopped reading the per-surface wall would satisfy the leg while resolving nothing.
// ⚠ SCOPED TO THE INDIRECTION IT EXISTS TO COVER. A consumer that reads the wall INLINE has no resolver to
// assert, and demanding one would make this guard red on a tree that is perfectly correct — a guard that
// fails on correct code is a guard someone deletes.
if (/resolveWalkStop\s*\(/.test(code)) {
  const WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
  const w = readFileSync(resolve(ROOT, WRITER), 'utf8')
  // ⛔ `\n\}` ALONE IS WRONG HERE AND IT FIRED FALSELY THE FIRST TIME IT RAN. `resolveWalkStop`'s return type
  // is a multi-line object literal, so its closing `}` starts a line as `}>: {` — the non-greedy match ended
  // at the SIGNATURE and reported the body as empty of every call it in fact makes. Anchor on a closing brace
  // that ends its own line, which is the function's, not the type's.
  const body = w.match(/export async function resolveWalkStop[\s\S]*?\n\}\n/)
  if (!body) {
    findings.push(`(b) ${WRITER} exports no resolveWalkStop — ${CONSUMER} resolves through a function this guard cannot find.`)
  } else {
    if (!/readAccountWall\s*\(/.test(body[0])) findings.push(`(b) resolveWalkStop does not call readAccountWall() — the per-(account,surface) wall is not being read, so the "resolved" floor is not resolved from stored state.`)
    if (!/composeWalkStop\s*\(/.test(body[0])) findings.push(`(b) resolveWalkStop does not call composeWalkStop() — it returns a stop that was never composed with the account inception and the held-data safeguard.`)
  }
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
console.log(`[universe-floor-execute-time] PASS — ${CONSUMER} never reads a floor off the queue message · resolves it INSIDE the handler (execute time, not module scope) via readAccountWall/resolveWalkStop, and the resolver itself reads the per-surface wall and composes the stop · and advance() accepts \`string | null\` and branches on the null case explicitly. LIMIT: structural — it proves WHERE the floor is read, not that the value is right.`)
