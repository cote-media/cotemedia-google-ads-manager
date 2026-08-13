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

// ── 5. LORAMER_CHAT_FIRST_FRAME_V1, 2026-08-11 — THE REORDER'S PINS, RUSS'S EXPLICIT TRADE ─────────────────
// ⛔ THE FOOTGUN RULE (never write SSE headers before the first token) WAS CONSCIOUSLY TRADED for the first
// frame: measured at ARRIVAL, headers were held 49.16s and the t+0.1s status frame arrived at t+49.17s —
// dead air at the start of every streamed turn, and the ★CHAT-STATUS-SILENT-WINDOWS "Working…" symptom was
// this same buffering. These legs pin the NEW shape so it cannot silently regress to the old one, and pin
// what the trade DID NOT give up.
{
  // (5a) THE HELD-HEADERS RACE IS GONE. Its reappearance re-creates the 35-50s dead-air window wholesale.
  if (/Promise\.race\s*\(\s*\[\s*firstTokenP|firstTokenP/.test(routeCode)) {
    fail('(5a) the settle-or-first-token race is BACK in the chat route. Holding the Response until the first model token buffers every status frame for the whole assembly + first-token wait — measured 49.16s of dead air at arrival. The trade was decided by Russ 2026-08-11 (LORAMER_CHAT_FIRST_FRAME_V1); reversing it is a new decision, not an edit.')
  }
  // (5b) NO JSON ESCAPE HATCH INSIDE THE STREAMING BRANCH. A NextResponse.json between the branch opening
  // and `return new Response(stream` means some failure path holds headers again (and would be unreachable
  // or wrong once they are out).
  const iBranch = routeCode.indexOf('if (CHAT_STREAMING) {')
  const iReturn = routeCode.indexOf('return new Response(stream')
  if (iBranch < 0 || iReturn < 0) {
    fail('(5b) cannot locate the streaming branch or its Response return — the shape this guard pins has moved; re-derive the pin rather than trusting a green.')
  } else if (routeCode.slice(iBranch, iReturn).includes('NextResponse.json')) {
    fail('(5b) a NextResponse.json sits INSIDE the streaming branch before the Response returns — a pre-token JSON path is creeping back, which re-holds the headers it exists to serve.')
  }
  // (5c) THE DEDUP HOLDS: exactly ONE /api/intelligence fetch in the route. Two sequential identical
  // fetches were the other half of the dead air (and could return DIVERGENT snapshots for the two builders).
  const fetches = (routeCode.match(/api\/intelligence\?clientId=/g) || []).length
  if (fetches !== 1) {
    fail(`(5c) the chat route holds ${fetches} /api/intelligence fetches; the dedup (one response feeding BOTH prompt builders) requires exactly 1. Two identical sequential fetches double the assembly wait and can hand the flat and cacheable prompts different snapshots.`)
  }
  // (5d) WHAT THE TRADE KEPT — auth/RBAC real status codes ABOVE the stream, and the overload detail line.
  const iStream = routeCode.indexOf('new ReadableStream')
  const i401 = routeCode.indexOf("status: 401")
  const i404 = routeCode.indexOf("status: 404")
  if (iStream < 0 || i401 < 0 || i404 < 0 || i401 > iStream || i404 > iStream) {
    fail('(5d) auth 401 / RBAC 404 no longer both sit ABOVE the stream construction with real JSON status codes — those are the two failures the original footgun rule said genuinely need one, and the trade explicitly kept them.')
  }
  if (!/ALL MODELS OVERLOADED \(streaming\)/.test(routeCode)) {
    fail('(5d) the streamed overload path no longer logs the `[chat] ALL MODELS OVERLOADED (streaming)` line with request ids. Failed streamed turns read HTTP 200 now, so this log line is the ONLY server-side telemetry of an exhausted chain — losing it makes streamed failures invisible twice.')
  }
}

// ── 6. BEHAVIOURAL — THE CLIENT RENDERS THE SAME SENTENCE FROM AN SSE ERROR FRAME AS FROM THE OLD JSON ────
// ⛔ THIS IS THE LEG THAT PROVES THE TRADE SAFE, mechanically: readChatResponse (the REAL compiled reader,
// not a stub of it) must return the same {ok:false, error:'overloaded'} shape for a pre-token failure
// arriving as an SSE frame on HTTP 200 as it does for the blocking path's 503 JSON — because every
// user-facing sentence keys on `d.error`, so shape-equality IS sentence-equality.
{
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createRequire } = await import('node:module')
  const out = mkdtempSync(join(tmpdir(), 'loramer-chat-read-'))
  const tsc = resolve(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, 'src/lib/chat-stream-read.ts'), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    fail(`(6) could not compile chat-stream-read.ts to drive it — ${r.error?.message || (r.stdout + r.stderr).trim().slice(0, 300)}. A leg that cannot run is not a pass.`)
  } else {
    const req = createRequire(import.meta.url)
    const { readChatResponse } = req(join(out, 'src/lib/chat-stream-read.js'))
    const sse = (body) => ({
      ok: true, status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null) },
      body: new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(body)); c.close() },
      }),
    })
    // A pre-token overload arriving as an SSE frame on 200 — the reorder's new shape.
    const viaFrame = await readChatResponse(sse('event: error\ndata: {"error":"overloaded"}\n\n'), () => {})
    if (viaFrame.ok !== false || viaFrame.error !== 'overloaded') {
      fail(`(6) an SSE error frame did not surface as {ok:false, error:'overloaded'} (got ${JSON.stringify(viaFrame)}). The client's per-failure sentences key on d.error, so this shape IS the user's sentence — a pre-token failure would render the generic string, or worse, a silent success.`)
    }
    // The blocking path's 503 JSON — must produce the IDENTICAL shape, so the two transports cannot diverge.
    const json503 = {
      ok: false, status: 503,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ error: 'overloaded' }),
    }
    const viaJson = await readChatResponse(json503, () => {})
    if (viaJson.ok !== false || viaJson.error !== 'overloaded') {
      fail(`(6) the 503 JSON path did not surface {ok:false, error:'overloaded'} (got ${JSON.stringify(viaJson)}).`)
    }
    // And a generic pre-token 500-class message must land in `error` (the client falls through to SERVER_ERROR).
    const viaFrame500 = await readChatResponse(sse('event: error\ndata: {"error":"Request timed out"}\n\n'), () => {})
    if (viaFrame500.ok !== false || viaFrame500.error !== 'Request timed out') {
      fail(`(6) a generic error frame did not carry its message through (got ${JSON.stringify(viaFrame500)}).`)
    }
  }
  rmSync(out, { recursive: true, force: true })
}

// ── 7. THE DURABLE FAILED-TURN INSTRUMENT — LORAMER_CHAT_TURN_FAILED_DURABLE_V1 ─────────────────────────────
// ★CHAT-TURN-FAILED-TELEMETRY-INVISIBLE: the old `[chat] TURN FAILED` console.error lived in a CLIENT
// component and never reached a server log — an instrument unreadable where the reader stands. The durable
// record is chat_turn_failures via /api/debug/turn-failed (the viewport-probe gate shape). Post-pair-write,
// a failed turn leaves NO conversation row, so this is the ONLY witness for "asked and got nothing".
// These legs honor LORAMER_GUARD_ROOT so their reds are provable on throwaway copies.
{
  const GROOT = process.env.LORAMER_GUARD_ROOT || ROOT
  const gread = (rel) => { try { return readFileSync(resolve(GROOT, rel), 'utf8') } catch { return null } }
  const hookSrc = gread('src/lib/next/use-lora-chat.ts')
  const hookCode = hookSrc ? hookSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1') : null

  // (7a) the hook REPORTS — three call sites (catch, recovery verdict, mount-recovery) — and NEVER awaits.
  if (!hookCode) fail('(7a) cannot read use-lora-chat.ts')
  else {
    const calls = (hookCode.match(/reportTurnFailure\s*\(/g) || []).length
    if (calls < 3) fail(`(7a) reportTurnFailure has ${calls} call site(s) in use-lora-chat — the instrument needs THREE (the catch, the recovery verdict, the mount-recovery verdict): a failure with no verdict cannot answer "did the user get nothing?", and the mount path is the died-browser class's only witness.`)
    if (/await\s+reportTurnFailure\s*\(/.test(hookCode)) fail(`(7a) reportTurnFailure is AWAITED — the reporter must never block or delay the turn; it is fire-and-forget by contract (log-conversation-turn's exact posture).`)
  }

  // (7b) DRIVE the real module via its own fetchImpl seam: one POST, right route, exact tag, NO text fields,
  // and a THROWING fetch must be swallowed.
  try {
    const { spawnSync } = await import('node:child_process')
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createRequire } = await import('node:module')
    const outDir = mkdtempSync(join(tmpdir(), 'loramer-turnfail-'))
    const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
    const r = spawnSync(tsc, [resolve(GROOT, 'src/lib/next/report-turn-failure.ts'), '--target', 'es2020', '--module', 'commonjs',
      '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(GROOT), '--outDir', outDir], { encoding: 'utf8' })
    if (r.error) fail(`(7b) could not run tsc — ${r.error.message}`)
    const mod = createRequire(import.meta.url)(join(outDir, 'src/lib/next/report-turn-failure.js'))
    const captured = []
    mod.reportTurnFailure(
      { clientId: 'c-1', surface: 'next-ask-lora', phase: 'turn-failed', branch: 'aborted', errName: 'AbortError', errMessage: 'x', signalAborted: true, elapsedMs: 12, correlationKey: 'k-1' },
      (url, init) => { captured.push({ url, body: JSON.parse(init.body) }); return Promise.resolve(new Response(null, { status: 204 })) },
    )
    if (captured.length !== 1) fail(`(7b) the reporter made ${captured.length} POST(s) — exactly one per call.`)
    else {
      const { url, body } = captured[0]
      if (url !== '/api/debug/turn-failed') fail(`(7b) the reporter posts to '${url}' — the route is /api/debug/turn-failed.`)
      if (body.probe !== 'chat-turn-failed') fail(`(7b) the reporter omits the exact literal probe tag — a stray POST must be indistinguishable from noise at the route.`)
      for (const banned of ['content', 'message', 'question', 'answer', 'text']) {
        if (banned in body) fail(`(7b) the reporter carries a '${banned}' field — the record is failure METADATA; question/answer text never leaves the browser through this instrument.`)
      }
    }
    let threw = false
    try { mod.reportTurnFailure({ surface: 's', phase: 'turn-failed', correlationKey: 'k' }, () => { throw new Error('boom') }) } catch { threw = true }
    if (threw) fail(`(7b) a throwing fetch escaped the reporter — telemetry must never break a turn.`)
    rmSync(outDir, { recursive: true, force: true })
  } catch (e) {
    fail(`(7b) could not DRIVE report-turn-failure — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
  }

  // (7c) the route: session gate, exact literal tag, exactly ONE insert, into chat_turn_failures only.
  const routeSrc = gread('src/app/api/debug/turn-failed/route.ts')
  if (!routeSrc) fail('(7c) src/app/api/debug/turn-failed/route.ts is MISSING — the reporter has nowhere durable to land.')
  else {
    const rc = routeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    if (!/getServerSession/.test(rc) || !/status:\s*401/.test(rc)) fail(`(7c) the route is not session-gated with a 401 — the probe precedent's first gate.`)
    if (!/probe\s*!==\s*'chat-turn-failed'/.test(rc)) fail(`(7c) the route does not hard-gate on the exact literal 'chat-turn-failed' — a stray or malformed POST must write nothing (the viewport-probe rule).`)
    const inserts = (rc.match(/\.insert\s*\(/g) || []).length
    if (inserts !== 1) fail(`(7c) the route has ${inserts} insert call(s) — exactly one, append-only.`)
    if (!/chat_turn_failures/.test(rc)) fail(`(7c) the route does not write chat_turn_failures.`)
    if (/client_conversations/.test(rc)) fail(`(7c) the route touches client_conversations — telemetry must never write anywhere near the conversation store.`)
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_CHAT_FAILURE_BRANCHES_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log('chat-failure-branches.guard: PASS — distinct error codes from the route, distinct non-duplicated client strings with an explicit overloaded branch, logSpend records the answering model, every chain model priced; the first-frame reorder holds (no held-headers race, no pre-token JSON in the streaming branch, ONE intelligence fetch, 401/404 real codes above the stream) and an SSE error frame surfaces to the client identically to the old 503 JSON (driven on the real compiled reader).')
