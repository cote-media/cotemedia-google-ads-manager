#!/usr/bin/env node
// LORAMER_CHAT_STOP_CANCELS_SERVER_V1 — THE STOP BUTTON MUST STOP THE METER, NOT THE PAINT.
//
// ⛔ THE BANKED REQUIREMENT THIS EXISTS FOR: ★CHAT-STOP-BUTTON — "must cancel SERVER-SIDE, not just hide
// output, or the generation still bills." Every leg below is one link in the chain between the user's
// thumb and Anthropic's meter, and BREAKING ANY ONE OF THEM LEAVES A BUTTON THAT LOOKS RIGHT AND STILL
// BILLS — which is strictly worse than no button, because it also stops anyone from looking again.
//
// ═══ THE LEGS ═══════════════════════════════════════════════════════════════════════════════════════
//  (a) vercel.json opts /api/chat into cancellation. Vercel surfaces a client disconnect on
//      `request.signal` ONLY when `supportsCancellation` is set for the path; without it the function
//      runs to completion regardless and every other leg here is decoration.
//  (b) the route forwards `request.signal` into the model chain, and the SDK options type can carry it.
//      Aborting client→server does NOT abort server→Anthropic.
//  (c) a user abort CANNOT enter the fallback chain. An aborted stream misclassified as an error can
//      trigger a fallback that sends a SECOND FULL BILLED REQUEST
//      (github.com/anthropics/claude-code/issues/43295) — stop would then cost TWO generations, not zero.
//      ⚠ OUR CHAIN IS ALREADY SAFE BY CONSTRUCTION (`isOverloadedError` matches only 529 /
//      `overloaded_error`). THIS LEG IS THE ASSERTION THAT KEEPS IT SO: the next person to widen that
//      predicate — a timeout, a 5xx, a connection reset all look retryable — would otherwise reintroduce
//      the trap with nothing in the way.
//  (d) a stopped turn WRITES A SPEND ROW. `logSpend` lived only on the success path, so a stop recorded
//      ZERO for tokens genuinely billed. Hiding real money is the dishonest direction.
//  (e) a stopped turn is NOT RECOVERABLE. The recovery poll re-reads answers for RECOVERY_WINDOW_MS; a
//      cancelled turn reappearing minutes later is the failure mode that is worse than no button.
//
// ⛔ WHAT THIS GUARD CANNOT DO, ON ITS FACE: ★CHAT-RENDER-MEASUREMENT-MISSING is open — it reads TEXT.
// IT CANNOT PROVE BILLING STOPPED. Only `anthropic_spend_log` can, and the acceptance criteria are the
// ROW COUNT and the TOKEN DELTA between a stopped turn and a completed one — never the UI.
//
// ⛔ LORAMER_GUARD_ROOT: HONOURED (a scratch-tree proof reads the SCRATCH tree, which is what makes the
// RED half meaningful), module-relative fallback, NEVER process.cwd(), and FAILS CLOSED — an unreadable
// file is a FAILURE, not a pass.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} under ROOT ${ROOT} — ${e.message}. A guard that cannot read its evidence FAILS.`); return null }
}
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const vercelJson = read('vercel.json')
const route = read('src/app/api/chat/route.ts')
const chain = read('src/lib/lora-model-chain.ts')
const tools = read('src/lib/claude-tools.ts')
const hook = read('src/lib/next/use-lora-chat.ts')

// ── (a) THE PLATFORM FLAG ───────────────────────────────────────────────────────────────────────────
if (vercelJson) {
  let cfg = null
  try { cfg = JSON.parse(vercelJson) } catch (e) { findings.push(`(a) vercel.json is not valid JSON — ${e.message}. A malformed deploy config fails the build, so this is a FAILURE not a warning.`) }
  const fn = cfg?.functions?.['src/app/api/chat/route.ts']
  if (!fn || fn.supportsCancellation !== true) {
    findings.push('(a) vercel.json does not set `supportsCancellation: true` for src/app/api/chat/route.ts. Vercel surfaces a client disconnect on `request.signal` ONLY when cancellation is enabled for the path; without it THE FUNCTION RUNS TO COMPLETION REGARDLESS and every other part of the stop button is decoration — the meter keeps running while the browser shows nothing.')
  }
}

// ── (b) THE SIGNAL REACHES THE SDK ──────────────────────────────────────────────────────────────────
if (route) {
  const code = strip(route)
  const sites = (code.match(/signal:\s*request\.signal/g) || []).length
  if (sites < 2) {
    findings.push(`(b) /api/chat forwards request.signal at ${sites} call site(s); BOTH the streaming and the blocking chain invocations need it. Stop must work whichever path served the turn, or the button is honest on one and cosmetic on the other.`)
  }
}
if (tools && !/signal\?:\s*AbortSignal/.test(strip(tools))) {
  findings.push('(b) claude-tools requestOptions cannot carry `signal`, so the abort stops at the route and never reaches anthropic.messages.*. Aborting client→server does NOT abort server→Anthropic.')
}

// ── (c) AN ABORT MUST NOT ADVANCE THE CHAIN ─────────────────────────────────────────────────────────
if (chain) {
  const code = strip(chain)
  if (!/export function isUserAbort/.test(code)) {
    findings.push('(c) lora-model-chain exports no isUserAbort. The abort/failure distinction would then be implicit, and a future widening of isOverloadedError (timeouts and 5xx all look retryable) would silently send a SECOND FULL BILLED REQUEST on every stop — claude-code#43295.')
  }
  // The abort check must come BEFORE the overload classification, or a widened predicate swallows it.
  const iAbort = code.indexOf('isUserAbort(err)')
  const iOver = code.indexOf('isOverloadedError(err)')
  if (iAbort === -1 || iOver === -1 || iAbort > iOver) {
    findings.push('(c) the isUserAbort check does not precede isOverloadedError in the catch. Ordering is the whole protection: placed after, any future widening of the overload predicate captures the abort first and the fallback fires — two billed generations for a button whose job is zero.')
  }
  if (!/if\s*\(\s*isUserAbort\(err\)\s*\)\s*throw err/.test(code)) {
    findings.push('(c) a user abort is not rethrown unchanged out of the chain. It must leave immediately: no attempt row, no onOverload callback, no next model.')
  }
}

// ── (d) A STOPPED TURN WRITES A SPEND ROW ───────────────────────────────────────────────────────────
if (route) {
  const code = strip(route)
  if (!/endpoint:\s*'chat-stopped'/.test(code)) {
    findings.push("(d) no spend row is written for a stopped turn (no `endpoint: 'chat-stopped'`). logSpend lives on the success path, so a stop would record ZERO for tokens genuinely generated and genuinely billed. Hiding real money is the dishonest direction, and the marker is also what keeps existing `endpoint = 'chat'` queries from averaging partial turns into completed ones.")
  }
  if (!/partialUsage/.test(code)) {
    findings.push('(d) the route never reads `partialUsage`. The accumulator lives in the tool loop’s closure and the chain promise has already REJECTED, so the only channel that reaches the catch is the error object itself — without it the row would be written with nothing in it.')
  }
}
if (tools && !/partialUsage/.test(strip(tools))) {
  findings.push('(d) claude-tools does not attach `partialUsage` to the thrown error, so the completed-turn usage dies with the abort and the spend row cannot be honest.')
}

// ── (e) A STOPPED TURN IS NOT RECOVERABLE ───────────────────────────────────────────────────────────
if (hook) {
  const code = strip(hook)
  if (!/userStoppedRef/.test(code)) {
    findings.push('(e) the hook cannot tell a USER stop from a DEADLINE abort (`controller.signal.aborted` is true for both). Without the distinction a stop takes the aborted branch, shows ABORTED_UNCONFIRMED and starts a recovery poll — and the turn the user paid to cancel renders itself minutes later.')
  }
  const iStop = code.indexOf('userStoppedRef.current')
  const iClassify = code.indexOf('classifyTurnFailure(')
  if (iStop === -1 || iClassify === -1 || iStop > iClassify) {
    findings.push('(e) the user-stop branch does not short-circuit BEFORE classifyTurnFailure. Placed after, the recovery path has already been chosen.')
  }
}

if (findings.length) {
  console.error(`[chat-stop-cancels-server] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[chat-stop-cancels-server] PASS — vercel.json opts /api/chat into cancellation · request.signal reaches BOTH chain call sites and the SDK options type carries it · a user abort is rethrown before any overload classification · a stopped turn writes an endpoint=chat-stopped row from partialUsage carried on the error · a user stop short-circuits before classifyTurnFailure so it can never be recovered. ⛔ TEXT ONLY — THIS CANNOT PROVE BILLING STOPPED. Only anthropic_spend_log can: compare ROW COUNT and OUTPUT TOKENS for a stopped turn against a completed one.')
