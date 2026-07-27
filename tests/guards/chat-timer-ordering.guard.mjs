#!/usr/bin/env node
// LORAMER_CHAT_TIMER_ORDERING_GUARD_V1
//
// THE BUG IT GUARDS, and it is a real one that shipped: on 2026-07-26 the CLIENT timer was raised
// 120s -> 240s to stop killing healthy turns. The SERVER's model-chain budget (95s) and per-attempt
// SDK timeout (45s) were left alone. The next day a real question — "Do you think our prices are
// good?" — 500'd with the SDK's "Request timed out" after the server gave up, while the client sat
// waiting for four more minutes. No answer was produced, and the user was shown a connection story.
//
// lora-model-chain.ts already carried a comment saying "the two numbers move together or not at all".
// A comment is not a guard. This is (FIX-WITH-GUARD).
//
// ⚠ THE FIRST VERSION OF THIS GUARD WAS USELESS AND I AM RECORDING THAT. It asserted only the
// ORDERING — per-attempt < budget < client < route — and the shipped bug SATISFIED it: 45s < 95s <
// 240s < 300s is a perfectly valid ladder. The ordering was never inverted. The defect was that the
// server gave up LONG BEFORE the client was willing to wait, so every turn between 95s and 240s
// failed for no reason and burned a 500. A guard that passes on the bug it was written for is the
// "unenforceable guard that manufactures false confidence" the FIX-WITH-GUARD law names.
//
// SO IT ASSERTS THREE THINGS, and the second is the one that matters:
//   1. ORDERING — per-attempt < budget < client total < route maxDuration. Still worth holding.
//   2. NO ABANDONED PATIENCE — the chain budget must be at least 75% of the client's total wait.
//      If the client waits 240s and the server quits at 95s, 145 seconds of the user's patience can
//      never be spent, and every turn in that gap dies for nothing. THIS is what catches the real bug.
//   3. PER-ATTEMPT FLOOR — a single model call must have >= 90s. MEASURED: a heavy reasoning call
//      over 45s threw the SDK's "Request timed out" and 500'd the turn, while multi-call turns of 78s,
//      105s and 125s had survived only because each individual call fit under the cap.
//
// HERMETIC: filesystem reads only. LORAMER_GUARD_ROOT overrides the tree so this can be proven failing.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)

const chain = read('src/lib/lora-model-chain.ts')
const client = read('src/lib/chat-stream-read.ts')
const route = read('src/app/api/chat/route.ts')
if (!chain || !client || !route) { console.error('FAIL: cannot read the chain, the client reader, or the chat route'); process.exit(1) }

// Numeric literals, underscores allowed (95_000). Comments are stripped so a number quoted in prose
// explaining the rule cannot be mistaken for the rule.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const num = (src, name) => {
  const m = strip(src).match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`))
  return m ? Number(m[1].replace(/_/g, '')) : null
}

const perAttempt = num(chain, 'PER_ATTEMPT_TIMEOUT_MS')
const budget = num(chain, 'CHAIN_BUDGET_MS')
const clientTotal = num(client, 'CHAT_TOTAL_MS')
const idle = num(client, 'CHAT_IDLE_GAP_MS')
const maxDuration = num(route, 'maxDuration')
const maxDurationMs = maxDuration != null ? maxDuration * 1000 : null

const missing = Object.entries({ PER_ATTEMPT_TIMEOUT_MS: perAttempt, CHAIN_BUDGET_MS: budget, CHAT_TOTAL_MS: clientTotal, maxDuration })
  .filter(([, v]) => v == null).map(([k]) => k)
if (missing.length) {
  fail(`CANNOT READ ${missing.join(', ')} — the guard cannot verify the ordering; treat as failure, never a pass.`)
} else {
  const ladder = [
    ['per-attempt SDK timeout', perAttempt, 'chain budget', budget],
    ['chain budget', budget, 'client total abort', clientTotal],
    ['client total abort', clientTotal, 'route maxDuration', maxDurationMs],
  ]
  for (const [aName, a, bName, b] of ladder) {
    if (!(a < b)) {
      fail(`TIMER ORDERING VIOLATED: ${aName} (${a}ms) must be STRICTLY LESS THAN ${bName} (${b}ms). Whichever gives up first decides what the user sees — if the inner one out-waits the outer, the outer kills a turn the inner was still working on, and the user is told a story that did not happen.`)
    }
  }
  // 2. NO ABANDONED PATIENCE — the one that catches the real defect.
  const ratio = budget / clientTotal
  if (ratio < 0.75) {
    fail(`SERVER GIVES UP LONG BEFORE THE CLIENT DOES: chain budget ${budget}ms is only ${(ratio * 100).toFixed(0)}% of the client's ${clientTotal}ms wait, leaving ${clientTotal - budget}ms of user patience that can never be spent. Every turn lasting between ${budget}ms and ${clientTotal}ms dies for no reason. This is the 2026-07-27 defect exactly (95s budget against a 240s client) and it satisfied a pure ordering check, which is why the ordering check alone was not enough.`)
  }
  // 3. PER-ATTEMPT FLOOR — a single heavy reasoning call must fit.
  if (perAttempt < 90_000) {
    fail(`PER-ATTEMPT TIMEOUT ${perAttempt}ms IS BELOW THE 90s FLOOR. The SDK is handed min(perAttempt, remaining), so a single model call over this throws "Request timed out" and 500s the turn regardless of the budget. MEASURED 2026-07-27: 45s killed a real question outright.`)
  }
  if (idle != null && !(idle < clientTotal)) {
    fail(`IDLE GAP (${idle}ms) must be less than the client total (${clientTotal}ms), or the idle timer can never fire before the absolute deadline and a dead stream is only caught at the very end.`)
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_CHAT_TIMER_ORDERING_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log(`chat-timer-ordering.guard: PASS — ${perAttempt}ms attempt < ${budget}ms budget < ${clientTotal}ms client < ${maxDurationMs}ms route (idle ${idle}ms).`)
