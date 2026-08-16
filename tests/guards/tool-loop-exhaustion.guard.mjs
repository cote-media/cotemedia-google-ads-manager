#!/usr/bin/env node
// LORAMER_TOOL_LOOP_EXHAUSTION_V1 — a tool loop may not end without an answer, and a bounded answer may not
// end without saying so.
//
// THE DEFECT THIS PINS, measured, not imagined. Both tool loops ran `for (turn = 0; turn < MAX; turn++)` and
// assigned the final response ONLY on the branch where the model stopped asking for tools. When every turn
// asked for another tool the loop simply fell out of the bottom and returned `last` — the final TOOL-CALLING
// message, whose only text block is the model's lead-in sentence. The user got HTTP 200 and the string
// "Confirming exactly which campaigns carried impressions on the jump day itself." after 92,185 input tokens.
// Across 509 well-formed loops in `lora_tool_decisions` (2026-07-24 → 2026-08-16), 9 — 1.77% — ended in that
// shape. A silent truncation is the worst thing a failure can be: it is shaped exactly like an answer.
//
// FIVE LEGS:
//   (a) BEHAVIOURAL, BLOCKING LOOP — driven against the REAL compiled runClaudeToolLoop with an Anthropic
//       stub that NEVER stops asking for tools. The returned text must be the FORCED answer, never the
//       preamble; `truncated` must be true; the forced request must carry NO `tools` array (that omission is
//       the entire mechanism — with tools attached the model can simply ask again and there is no floor).
//   (b) BEHAVIOURAL, STREAMING LOOP — the same drive against runClaudeToolLoopStreaming, which was the WORSE
//       of the two (it had no `out` variable at all). Additionally: the forced answer must STREAM, or the
//       user watches a dead line for the length of a full answer — the defect LORAMER_CHAT_STATUS_FIRST_V1
//       exists to kill.
//   (c) BEHAVIOURAL, THE CLOCK — with a deadline already inside the reserve, the loop must stop taking new
//       rounds and report reason 'time_budget', NOT 'turn_cap'. Two causes, two names: collapsing them is how
//       you spend a quarter raising a cap that was never binding.
//   (d) STRUCTURAL — neither loop may contain a `return` that ships `last` as the answer without an
//       exhaustion branch in front of it, and neither may carry an un-sourced literal cap.
//   (e) TELEMETRY — the chat route must emit `truncated` on BOTH paths, UNCONDITIONALLY. A key that appears
//       only on failure cannot be counted, and a rate is the only thing that would have caught 1.77%.
//
// ⚠ WHAT A GREEN HERE DOES NOT SAY: it does not say the forced answer is GOOD. The model is answering from
// tool results gathered mid-investigation, so it is bounded by construction. This guard proves the turn ends
// with an answer and reports that it was bounded. Whether 8 rounds is enough is an EVAL question, not a
// guard question, and the eval that catches it is tests/lora-evals.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[tool-loop-exhaustion] FAIL — ${m}`); process.exit(1) }

const TOOLS_SRC = 'src/lib/claude-tools.ts'
const SUBJ_SRC = 'src/lib/chat/tool-subject.ts'
const ROUTE_SRC = 'src/app/api/chat/route.ts'
for (const f of [TOOLS_SRC, SUBJ_SRC, ROUTE_SRC]) if (!existsSync(resolve(ROOT, f))) fail(`${f} is missing.`)

const toolsText = readFileSync(resolve(ROOT, TOOLS_SRC), 'utf8')
const routeText = readFileSync(resolve(ROOT, ROUTE_SRC), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const code = stripComments(toolsText)
const routeCode = stripComments(routeText)

const sliceBetween = (src, startRe, endRe) => {
  const i = src.search(startRe)
  if (i === -1) return null
  const rest = src.slice(i + 1)
  const j = rest.search(endRe)
  return j === -1 ? src.slice(i) : src.slice(i, i + 1 + j)
}

// ── LEG (d) · STRUCTURAL ──────────────────────────────────────────────────────────────────────────────
const LOOPS = [
  ['runClaudeToolLoop', /export async function runClaudeToolLoop\b/],
  ['runClaudeToolLoopStreaming', /export async function runClaudeToolLoopStreaming\b/],
]
for (const [name, startRe] of LOOPS) {
  const slice = sliceBetween(code, startRe, /\nexport (async )?function |\nexport const |\nexport type /)
  if (!slice) {
    findings.push(`${TOOLS_SRC}: could not locate ${name} — it was renamed or removed, and leg (d) is now blind on it. Fix the guard before trusting a green.`)
    continue
  }
  if (!/LORAMER_TOOL_LOOP_EXHAUSTION_V1/.test(toolsText)) {
    findings.push(`${TOOLS_SRC}: the LORAMER_TOOL_LOOP_EXHAUSTION_V1 marker is gone. The exhaustion handler is the only thing standing between a capped loop and a preamble-as-answer.`)
  }
  // The final-answer variable must be REASSIGNED after the loop. `const finalResp = last` — the exact line
  // that shipped the defect on the streaming side — cannot be, so this catches a revert directly.
  if (/const\s+finalResp[^\n]*=\s*last\s*$/m.test(slice)) {
    findings.push(`${TOOLS_SRC}: ${name} returns \`last\` unconditionally as the final response. \`last\` is the FINAL TOOL-CALLING message on an exhausted loop, and its only text block is the model's preamble — that is the shipped defect, restored.`)
  }
  if (!/truncated\s*=\s*true/.test(slice)) {
    findings.push(`${TOOLS_SRC}: ${name} never sets truncated = true. An exhausted loop that does not report itself is indistinguishable from a complete answer.`)
  }
  if (!/opts\.maxToolTurns\s*\?\?\s*TOOL_LOOP_MAX_TURNS/.test(slice)) {
    findings.push(`${TOOLS_SRC}: ${name} does not take its cap from the shared TOOL_LOOP_MAX_TURNS constant. A literal here is a number with no measurement attached to it, and the two loops drift apart the first time one is tuned.`)
  }
}
if (!/export const TOOL_LOOP_MAX_TURNS\b/.test(code)) findings.push(`${TOOLS_SRC}: TOOL_LOOP_MAX_TURNS is not exported. The cap must have ONE home carrying its own measurement.`)
if (!/export const FINAL_ANSWER_RESERVE_MS\b/.test(code)) findings.push(`${TOOLS_SRC}: FINAL_ANSWER_RESERVE_MS is not exported. Without a reserve, raising the turn cap trades a bounded answer for a dead spinner — strictly worse.`)

// ── LEG (e) · TELEMETRY ───────────────────────────────────────────────────────────────────────────────
const phaseLines = routeCode.split(/console\.log\('\[chat\] phases'/).slice(1)
if (phaseLines.length !== 2) {
  findings.push(`${ROUTE_SRC}: expected exactly 2 "[chat] phases" log sites (streaming + blocking), found ${phaseLines.length}. Leg (e) cannot tell which path is unobserved.`)
} else {
  for (const [i, chunk] of phaseLines.entries()) {
    const body = chunk.slice(0, chunk.indexOf('}))') + 1)
    const label = i === 0 ? 'streaming' : 'blocking'
    if (!/truncated\s*:/.test(body)) findings.push(`${ROUTE_SRC}: the ${label} "[chat] phases" line does not carry \`truncated\`. A truncation nobody records is a truncation nobody can count, and the rate is the finding.`)
    if (/truncated\s*&&/.test(body) || /if\s*\(\s*truncated/.test(body)) findings.push(`${ROUTE_SRC}: the ${label} "[chat] phases" line emits \`truncated\` conditionally. It must be logged on EVERY turn including false — a key present only on failure has no denominator.`)
  }
}
for (const site of ['runClaudeToolLoopStreaming', 'runClaudeToolLoop']) {
  if (!new RegExp(`${site}\\(\\{[\\s\\S]{0,2000}?deadlineAt`).test(routeCode)) {
    findings.push(`${ROUTE_SRC}: the ${site} call site passes no deadlineAt. The loop owns no clock of its own — only the route knows when its client gives up — so without this the turn cap is the only ceiling and a slow turn dies at the browser.`)
  }
}
if (!/CHAT_TOTAL_MS/.test(routeCode)) findings.push(`${ROUTE_SRC}: the deadline is not anchored on CHAT_TOTAL_MS. Re-typing the client's ceiling as a literal is how the two drift apart, which chat-deadline-margin.guard.mjs exists to prevent on the other side.`)

// ── LEGS (a) (b) (c) · DRIVE THE REAL LOOPS ───────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-exhaust-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, TOOLS_SRC), resolve(ROOT, SUBJ_SRC), '--target', 'es2020', '--module',
  'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT),
  '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

const stub = join(out, '__stub.js')
writeFileSync(stub, `
module.exports = new Proxy({
  resolveAccess: async () => ({ ok: true }),
  listAccessibleClientsWithNames: async () => [],
  logToolDecision: () => {},
  queryMetrics: async () => ({ rows: [] }),
  queryBreakdown: async () => ({ rows: [] }),
  queryMoney: async () => ({ rows: [] }),
  breakdownToolTypes: () => [], breakdownPlatforms: () => [], breakdownEntityLevels: () => [],
  allAdditiveExtraKeys: () => [],
  geoGrains: () => [], geoScopes: () => [], platformsForToolType: () => [],
  getCoverageForWindows: async () => ({}), coverageNotes: () => [],
  getBreakdownCoverage: async () => ({}), breakdownCoverageNote: () => null,
  annotateContribution: (x) => x,
}, { get: (t, k) => (k in t ? t[k] : (() => {})) })
`)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) {
    if (request.includes('tool-subject')) return join(out, 'src/lib/chat/tool-subject.js')
    return stub
  }
  return origResolve.call(this, request, ...rest)
}
const req = createRequire(import.meta.url)
let mod
try { mod = req(join(out, 'src/lib/claude-tools.js')) }
catch (e) { Module._resolveFilename = origResolve; rmSync(out, { recursive: true, force: true }); fail(`compiled module did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }

const PREAMBLE = 'Confirming exactly which campaigns carried impressions on the jump day itself.'
const FORCED = 'Impressions rose 7.19x on 2025-10-19 -> 2025-10-20. I could not finish checking which campaigns carried it.'
const TOOL_INPUT = { clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', platform: 'google', startDate: '2025-10-01', endDate: '2025-10-31' }

// A model that NEVER stops asking for tools — the exact production shape, and the one no cap can survive.
// It also emits the preamble beside every tool_use block, which the API documents as normal behaviour.
const insatiable = (calls) => ({
  create: async (params) => {
    calls.push(params)
    if (!params.tools) return { stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 11 }, content: [{ type: 'text', text: FORCED }] }
    return { stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 5 }, content: [
      { type: 'text', text: PREAMBLE },
      { type: 'tool_use', id: `toolu_guard_${calls.length}`, name: 'query_metrics', input: TOOL_INPUT },
    ] }
  },
  stream: (params) => {
    calls.push(params)
    const handlers = {}
    return {
      on(ev, fn) { handlers[ev] = fn; return this },
      async finalMessage() {
        if (!params.tools) {
          handlers.text?.(FORCED)
          return { stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 11 }, content: [{ type: 'text', text: FORCED }] }
        }
        handlers.text?.(PREAMBLE)
        return { stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 5 }, content: [
          { type: 'text', text: PREAMBLE },
          { type: 'tool_use', id: `toolu_guard_${calls.length}`, name: 'query_metrics', input: TOOL_INPUT },
        ] }
      },
    }
  },
})

const base = {
  model: 'guard-model', maxTokens: 100, system: 'x', messages: [{ role: 'user', content: 'q' }],
  clientId: TOOL_INPUT.clientId, userEmail: 'guard@example.com', clientName: 'Foam OH',
}

const drive = async (fn, extra) => {
  const calls = []
  const events = []
  let res = null, err = null
  try {
    res = await fn({ ...base, ...extra, anthropic: { messages: insatiable(calls) }, emit: (event, data) => events.push({ event, data }) })
  } catch (e) { err = e }
  return { calls, events, res, err }
}

const CAP = mod.TOOL_LOOP_MAX_TURNS
const RESERVE = mod.FINAL_ANSWER_RESERVE_MS

// LEG (a) — BLOCKING
const a = await drive(mod.runClaudeToolLoop, {})
if (a.err) findings.push(`the BLOCKING loop THREW while being driven: ${a.err.message}. Leg (a) could not run — a crashed instrument is neither a pass nor a fail.`)
else {
  if (a.res.responseText === PREAMBLE) findings.push(`LEG (a): the BLOCKING loop returned the model's PREAMBLE as the answer (${JSON.stringify(PREAMBLE.slice(0, 60))}…). This is the shipped defect verbatim: 92,185 input tokens spent, a 78-character deflection delivered at HTTP 200.`)
  if (a.res.responseText !== FORCED) findings.push(`LEG (a): the BLOCKING loop did not return the FORCED final answer (got ${JSON.stringify(String(a.res.responseText).slice(0, 80))}). On exhaustion the loop must ask once more with tools withheld and return THAT.`)
  if (a.res.truncated !== true) findings.push(`LEG (a): the BLOCKING loop returned truncated=${JSON.stringify(a.res.truncated)} on a loop where every single turn asked for a tool. The caller cannot report what it is not told.`)
  if (a.res.truncationReason !== 'turn_cap') findings.push(`LEG (a): expected truncationReason 'turn_cap', got ${JSON.stringify(a.res.truncationReason)}. No deadline was passed, so the cap is the only thing that can have stopped it.`)
  const forcedCalls = a.calls.filter((c) => !c.tools)
  if (forcedCalls.length !== 1) findings.push(`LEG (a): expected exactly ONE tools-free forced call, saw ${forcedCalls.length} of ${a.calls.length} total. Omitting \`tools\` is the whole mechanism — with a tools array attached the model can ask again and there is no floor.`)
  if (a.calls.length !== CAP + 1) findings.push(`LEG (a): the loop issued ${a.calls.length} model calls; ${CAP} capped turns plus 1 forced answer = ${CAP + 1} was expected. A different count means the cap or the exhaustion branch is not doing what it says.`)
  if (!(a.res.usage.output > 5)) findings.push(`LEG (a): the forced call's tokens are missing from usage (output=${a.res.usage.output}). It is a real billed request; a turn that under-reports its own cost is the same class of defect as one that truncates silently.`)
}

// LEG (b) — STREAMING
const b = await drive(mod.runClaudeToolLoopStreaming, {})
if (b.err) findings.push(`the STREAMING loop THREW while being driven: ${b.err.message}. Leg (b) could not run.`)
else {
  if (b.res.responseText === PREAMBLE) findings.push(`LEG (b): the STREAMING loop returned the PREAMBLE as the answer. This path was the WORSE of the two — it assigned \`const finalResp = last\` with no branch that could notice exhaustion at all.`)
  if (b.res.responseText !== FORCED) findings.push(`LEG (b): the STREAMING loop did not return the FORCED final answer (got ${JSON.stringify(String(b.res.responseText).slice(0, 80))}).`)
  if (b.res.truncated !== true) findings.push(`LEG (b): the STREAMING loop returned truncated=${JSON.stringify(b.res.truncated)}.`)
  if (b.res.truncationReason !== 'turn_cap') findings.push(`LEG (b): expected truncationReason 'turn_cap', got ${JSON.stringify(b.res.truncationReason)}.`)
  const forcedCalls = b.calls.filter((c) => !c.tools)
  if (forcedCalls.length !== 1) findings.push(`LEG (b): expected exactly ONE tools-free forced call, saw ${forcedCalls.length} of ${b.calls.length}.`)
  const deltas = b.events.filter((e) => e.event === 'delta').map((e) => e.data?.text).join('')
  if (!deltas.includes(FORCED)) findings.push(`LEG (b): the FORCED answer never reached the wire as deltas. A blocking create() here would leave the user staring at a finished status line for the entire length of the answer — the exact defect LORAMER_CHAT_STATUS_FIRST_V1 exists to kill.`)
}

// LEG (c) — THE CLOCK. A deadline already inside the reserve: turn 0 must still run (or the caller gets
// nothing at all), and the loop must then stop and say WHY.
const c = await drive(mod.runClaudeToolLoop, { deadlineAt: Date.now() + Math.floor(RESERVE / 2) })
if (c.err) findings.push(`the BLOCKING loop THREW under a near deadline: ${c.err.message}. Leg (c) could not run.`)
else {
  if (c.res.truncationReason !== 'time_budget') findings.push(`LEG (c): with only half the reserve left, expected truncationReason 'time_budget', got ${JSON.stringify(c.res.truncationReason)}. Two causes need two names — 'she wanted more rounds' and 'the clock ran out' are different product problems, and one number cannot show both.`)
  if (c.res.responseText !== FORCED) findings.push(`LEG (c): a clock-stopped loop must still force a final answer (got ${JSON.stringify(String(c.res.responseText).slice(0, 80))}). Falling out on the clock with a preamble is the same defect wearing a different hat.`)
  if (c.calls.length >= CAP) findings.push(`LEG (c): the clock gate never fired — ${c.calls.length} calls issued against a cap of ${CAP}. The deadline must stop NEW rounds, or an 8-turn cap on a 440s leash converts a bounded answer into a dead spinner.`)
  if (c.calls.length < 2) findings.push(`LEG (c): only ${c.calls.length} call(s) issued. Turn 0 must ALWAYS be attempted regardless of the clock, then the forced answer — a deadline that suppresses the first turn returns nothing at all.`)
}

Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`[tool-loop-exhaustion] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[tool-loop-exhaustion] PASS — cap ${CAP} turns, reserve ${RESERVE}ms; both loops force a tools-free final answer on exhaustion (blocking ${a.calls.length} calls, streaming ${b.calls.length}), the streamed forced answer reaches the wire, the clock gate fires at ${c.calls.length} calls with reason 'time_budget', and both route paths log truncated unconditionally.`)
