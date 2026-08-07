#!/usr/bin/env node
// LORAMER_CHAT_FAILURE_BRANCHES_GUARD_V1
//
// TWO defects, one guard, both found live on 2026-07-25:
//
// (a) FAILURE BRANCHES COLLAPSED TO ONE STRING. Two prod turns died at 18:30:45Z / 18:32:08Z with Anthropic 529
//     overloaded_error → HTTP 500. The client rendered the same sentence a genuine server bug renders, so neither
//     the user nor a screenshot could distinguish "Anthropic is busy, wait a minute" from "something is broken".
//     A catch-all string is a false diagnosis delivered in the user's own words.
//
// (b) logSpend RECORDED A CONSTANT. The route logged `model: LORA_CHAT_MODEL` — fine while one model ever answers,
//     a FALSE COST the moment a fallback does. All three chain models carry different published rates, so a
//     Sonnet turn billed at the primary's rate would corrupt the spend ledger silently and permanently.
//
// GUARDS THE CLASS, not today's strings:
//   1. The route emits DISTINCT machine-readable `error` codes (not prose the client sniffs).
//   2. Every client failure branch resolves to a DISTINCT string — no two branches share one, and there is no
//      unlabeled catch-all. Derived by extracting the branch strings from the source, not by matching known text.
//   3. logSpend's `model:` is an expression, never a bare module-level constant.
//   4. The chain's models are all present in MODEL_PRICING, so no hop can log $0.
//
// AUTHORITATIVE SOURCE = THE CODE. HERMETIC: filesystem reads only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ROUTE = resolve(ROOT, 'src/app/api/chat/route.ts')
// LORAMER_LORA_CHAT_HOOK_V1 — the send loop and its failure branches MOVED out of ChatLauncher into
// the shared engine hook, because mobile Lora is now a PAGE and the shelf and the page must not fork
// it. The guard follows the code: a guard pinned to a file the logic has left reports a false failure
// and, worse, would report a false PASS if the logic were deleted rather than moved.
const CLIENT = resolve(ROOT, 'src/lib/next/use-lora-chat.ts')
const PRICING = resolve(ROOT, 'src/lib/spend-logger.ts')
const CHAIN = resolve(ROOT, 'src/lib/lora-model-chain.ts')

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)

const route = read(ROUTE)
const client = read(CLIENT)
const pricing = read(PRICING)
if (!route || !client || !pricing) { console.error('FAIL: cannot read chat route, use-lora-chat, or spend-logger'); process.exit(1) }

// ── 1. DISTINCT ERROR CODES FROM THE ROUTE ────────────────────────────────────────────────────────────────────
// Strip comments so prose describing the codes cannot satisfy the check.
const routeCode = route.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
if (!/error:\s*'overloaded'/.test(routeCode)) {
  fail("NO OVERLOAD CODE: the route never returns `error: 'overloaded'`. An exhausted model chain is then indistinguishable from a server bug at the client, which is the exact defect this guards.")
}
if (!/status:\s*503/.test(routeCode)) {
  fail('NO 503: an exhausted model chain must not return 500 — the client cannot branch on a status it shares with real errors.')
}

// ── 2. CLIENT BRANCHES ARE DISTINCT, NO CATCH-ALL ─────────────────────────────────────────────────────────────
// Extract the user-facing strings assigned in the send() failure paths. Single-quoted JSX/TS strings with the
// typographic apostrophes this file uses; we only need the SET, not their order.
const clientCode = client.replace(/\/\/[^\n]*/g, '')
// ⛔ THE END MARKER IS SEARCHED *FROM THE FETCH*, NOT FROM THE TOP OF THE FILE, AND THAT IS A REAL BUG
// THIS GUARD SHIPPED WITH. `indexOf('setLoading(false)')` found the FIRST occurrence anywhere in the file.
// It happened to be send()'s `finally` only because send() was the only thing that set loading — the
// moment LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 added a resume effect ABOVE send() that also clears
// loading, the end index landed BEFORE the start index, `slice` returned '', and the guard reported
// "CANNOT LOCATE" against perfectly correct code. A locator that depends on being the only caller is not
// a locator. Searching forward from the fetch pins the `finally` that actually terminates THIS block.
const sendStart = clientCode.indexOf("await fetch('/api/chat'")
const sendEnd = sendStart === -1 ? -1 : clientCode.indexOf('setLoading(false)', sendStart)
const sendBlock = sendStart === -1 || sendEnd === -1 ? '' : clientCode.slice(sendStart, sendEnd)
if (!sendBlock) {
  fail('CANNOT LOCATE the /api/chat send block in use-lora-chat.ts — the guard cannot verify branches; treat as failure, never a pass.')
} else {
  const strings = [...sendBlock.matchAll(/'([^'\\]{25,}?)'/g)].map((m) => m[1]).filter((s) => /[a-z]\s/i.test(s))
  const uniq = new Set(strings)
  if (strings.length < 4) {
    fail(`TOO FEW BRANCH STRINGS (${strings.length}): expected at least 4 distinct user-facing failure sentences (client-not-found · overloaded · server error · connection dropped). A collapsed branch set is the original defect.`)
  }
  if (uniq.size !== strings.length) {
    const dupes = strings.filter((s, i) => strings.indexOf(s) !== i)
    fail(`DUPLICATE BRANCH STRING(S): ${[...new Set(dupes)].map((d) => `"${d.slice(0, 50)}…"`).join(', ')} — two different failures render the same sentence, so the user (and a screenshot) cannot tell them apart.`)
  }
  if (!/d\.error === 'overloaded'/.test(sendBlock)) {
    fail("CLIENT DOES NOT BRANCH ON 'overloaded': the route's 503 code is never read, so an overloaded chain falls through to the generic server-error string.")
  }
}

// ── 3. logSpend MODEL IS NOT A CONSTANT ───────────────────────────────────────────────────────────────────────
const spendCall = routeCode.slice(routeCode.indexOf('logSpend({'), routeCode.indexOf('return NextResponse.json({ response'))
if (!spendCall) {
  fail('CANNOT LOCATE the logSpend call in the chat route — treat as failure.')
} else {
  const m = spendCall.match(/model:\s*([A-Za-z_$][\w$]*)/)
  if (m && /^[A-Z0-9_]+$/.test(m[1])) {
    fail(`logSpend LOGS A CONSTANT (\`${m[1]}\`): a fallback turn would be billed at the primary model's rate — a FALSE COST in the spend ledger, silent and permanent. Log the model that actually answered.`)
  }
  if (!m) fail('logSpend has no resolvable `model:` — cannot verify it records the answering model.')
}

// ── 4. EVERY CHAIN MODEL IS PRICED ────────────────────────────────────────────────────────────────────────────
const chain = read(CHAIN)
if (chain) {
  const chainLine = routeCode.match(/const MODEL_CHAIN = \[([^\]]*)\]/)
  if (!chainLine) {
    fail('MODEL_CHAIN not found in the chat route — cannot verify fallback models are priced.')
  } else {
    const literals = [...chainLine[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])
    const priced = new Set([...pricing.matchAll(/'([a-z0-9-]+)':\s*\{\s*input:/g)].map((x) => x[1]))
    const unpriced = literals.filter((mdl) => !priced.has(mdl))
    if (unpriced.length) {
      fail(`UNPRICED CHAIN MODEL(S): ${unpriced.join(', ')} — absent from MODEL_PRICING, so computeCostUsd returns $0 and a fallback turn logs as free. Add the rate before the model can answer.`)
    }
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_CHAT_FAILURE_BRANCHES_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log('chat-failure-branches.guard: PASS — distinct error codes from the route, distinct non-duplicated client strings with an explicit overloaded branch, logSpend records the answering model, every chain model priced.')
