#!/usr/bin/env node
// LORAMER_CHAT_STATUS_SUBJECT_V1 — guard the status-line protocol.
//
// THREE LEGS:
//   (a) THE BLOCKING PATH IS UNTOUCHED. The emit site sits in the STREAMING loop, but executeToolUses is
//       SHARED with the blocking loop — so a careless edit there changes what a non-streaming turn returns
//       and persists. With LORA_CHAT_STREAMING off (which is how it ships) that is every production turn.
//       Asserted structurally: zero emit() in the blocking loop, zero emit() in the shared executor.
//   (b) EVERY TOOL START HAS A MATCHING FINISH, INCLUDING WHEN THE TOOL FAILS. Driven against the REAL
//       compiled runClaudeToolLoopStreaming with a stubbed Anthropic and a query layer rigged to THROW.
//       A missing finish is the one outcome the client cannot recover from: the line hangs on "Reading …"
//       forever and the user cannot tell a slow turn from a dead one — which is the exact defect this
//       whole feature exists to end.
//   (c) NO UUID EVER REACHES THE CLIENT on a tool event. Asserted on the emitted payload, not on intent.
//
// ⚠ WHAT THIS DOES NOT ASSERT, so a green is never over-read: it does not prove the line is LEGIBLE, that
// the sweep animates, or that reduced-motion is honoured — those are CSS facts a Node guard cannot see.
// It proves the PROTOCOL carries the subject and closes every line it opens.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[chat-status-line] FAIL — ${m}`); process.exit(1) }

const TOOLS_SRC = 'src/lib/claude-tools.ts'
const SUBJ_SRC = 'src/lib/chat/tool-subject.ts'
for (const f of [TOOLS_SRC, SUBJ_SRC]) if (!existsSync(resolve(ROOT, f))) fail(`${f} is missing.`)
const toolsText = readFileSync(resolve(ROOT, TOOLS_SRC), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const code = stripComments(toolsText)

// ── LEG (a) · THE BLOCKING PATH ───────────────────────────────────────────────────────────────────────
const sliceBetween = (src, startRe, endRe) => {
  const i = src.search(startRe)
  if (i === -1) return null
  const rest = src.slice(i + 1)
  const j = rest.search(endRe)
  return j === -1 ? src.slice(i) : src.slice(i, i + 1 + j)
}
const blocking = sliceBetween(code, /export async function runClaudeToolLoop\b/, /export (async )?function |export const /)
const executor = sliceBetween(code, /async function executeToolUses\b/, /export (async )?function |export const /)
if (!blocking) findings.push(`${TOOLS_SRC}: could not locate runClaudeToolLoop — the blocking loop was renamed or removed, and leg (a) is now blind. Fix the guard before trusting a green.`)
else if (/\bemit\s*\(/.test(blocking)) findings.push(`${TOOLS_SRC}: runClaudeToolLoop (the BLOCKING loop) now calls emit(). Streaming ships with the flag OFF, so the blocking path is every production turn — it must return and persist exactly what it did before.`)
if (!executor) findings.push(`${TOOLS_SRC}: could not locate executeToolUses — leg (a) is blind on the SHARED executor.`)
else if (/\bemit\s*\(/.test(executor)) findings.push(`${TOOLS_SRC}: executeToolUses now calls emit(). That function is SHARED with the blocking loop; emitting from it changes the non-streaming path.`)

// ── LEGS (b) + (c) · DRIVE THE REAL STREAMING LOOP ────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-status-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, TOOLS_SRC), resolve(ROOT, SUBJ_SRC), '--target', 'es2020', '--module',
  'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT),
  '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

// Stub every '@/' dependency EXCEPT the two real modules under test. THE QUERY LAYER IS RIGGED TO THROW —
// that is the point of leg (b): a tool that fails must still close its line. resolveAccess returns ok so the
// RBAC gate passes and the failure happens where we want it, in the query.
const stub = join(out, '__stub.js')
writeFileSync(stub, `
module.exports = new Proxy({
  resolveAccess: async () => ({ ok: true }),
  listAccessibleClientsWithNames: async () => [],
  logToolDecision: () => {},
  queryMetrics: async () => { throw new Error('rigged failure — leg (b)') },
  queryBreakdown: async () => { throw new Error('rigged failure — leg (b)') },
  queryMoney: async () => { throw new Error('rigged failure — leg (b)') },
  breakdownToolTypes: () => [], breakdownPlatforms: () => [], breakdownEntityLevels: () => [],
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

// A fake Anthropic: turn 1 asks for a tool, turn 2 answers. Mirrors the SDK surface the loop uses
// (messages.stream -> .on('text') -> .finalMessage()).
const TOOL_USE_ID = 'toolu_guard_0001'
const mkStream = (turn) => {
  const handlers = {}
  return {
    on(ev, fn) { handlers[ev] = fn; return this },
    async finalMessage() {
      if (turn === 0) {
        handlers.text?.('Let me pull that…')
        return { stop_reason: 'tool_use', usage: {}, content: [
          { type: 'tool_use', id: TOOL_USE_ID, name: 'query_metrics',
            input: { clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', platform: 'google', startDate: '2024-11-01', endDate: '2024-12-31' } },
        ] }
      }
      handlers.text?.('Here is the answer.')
      return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Here is the answer.' }] }
    },
  }
}
let turnNo = 0
const anthropic = { messages: { stream: () => mkStream(turnNo++) } }

const events = []
let loopErr = null
try {
  await mod.runClaudeToolLoopStreaming({
    anthropic, model: 'guard-model', maxTokens: 100, system: 'x', messages: [{ role: 'user', content: 'q' }],
    clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', userEmail: 'guard@example.com', clientName: 'Foam OH',
    emit: (event, data) => events.push({ event, data }),
  })
} catch (e) { loopErr = e }
Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })
if (loopErr) findings.push(`the streaming loop THREW while being driven: ${loopErr.message}. Legs (b) and (c) could not run — a crashed instrument is neither a pass nor a fail.`)

const toolEvents = events.filter((e) => e.event === 'tool').map((e) => e.data)
const starts = toolEvents.filter((d) => d?.phase === 'start')
const finishes = toolEvents.filter((d) => d?.phase === 'finish')

// LEG (b)
if (!loopErr) {
  if (starts.length === 0) findings.push(`no tool START event was emitted at all — the status line has nothing to render and leg (b) cannot be evaluated.`)
  for (const s of starts) {
    if (!s.id) findings.push(`a tool START carries no correlation id, so the client cannot pair it with a finish.`)
    else if (!finishes.some((f) => f.id === s.id)) {
      findings.push(`TOOL START WITH NO MATCHING FINISH (id ${s.id}). The tool was rigged to FAIL — this is precisely the case that must still close the line. Without a finish the status hangs on "Reading …" until the whole turn resolves, and the user cannot tell a slow turn from a dead one.`)
    }
  }
  const f0 = finishes.find((f) => f.id === TOOL_USE_ID)
  if (f0 && f0.ok !== false) findings.push(`the finish for a FAILED tool reports ok=${JSON.stringify(f0.ok)}; a rigged throw must report ok:false, or a failure renders as success.`)
  // The subject itself — proves the payload is subject-shaped, not the raw args.
  const s0 = starts[0]
  if (s0) {
    if (s0.client !== 'Foam OH') findings.push(`START did not resolve the client NAME server-side (got ${JSON.stringify(s0.client)}, expected "Foam OH"). The bound clientName is on the request and must be used, or the line cannot name who.`)
    if (s0.platform !== 'google') findings.push(`START lost the platform (got ${JSON.stringify(s0.platform)}).`)
    if (s0.window !== 'Nov–Dec 2024') findings.push(`START did not humanise the window (got ${JSON.stringify(s0.window)}, expected "Nov–Dec 2024").`)
    for (const leaked of ['baseRange', 'offsetsMonths', 'windows', 'items', 'properties', 'level', 'geoScope', 'entityLevel', 'preamble', 'input']) {
      if (leaked in s0) findings.push(`START carries raw tool argument "${leaked}". The event must be SUBJECT-shaped — shipping model-authored args to the browser is a widening nobody reviewed.`)
    }
  }
}

// LEG (c) — NO UUID ON THE WIRE, asserted on what was actually emitted.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
for (const d of toolEvents) {
  const json = JSON.stringify(d)
  if (UUID_RE.test(json)) findings.push(`A UUID REACHED THE CLIENT on a tool event: ${json.slice(0, 200)}. Resolve the name server-side and omit the client segment when it cannot be resolved — never render an id, never render "unknown".`)
}

if (findings.length) {
  console.error(`[chat-status-line] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[chat-status-line] PASS — blocking loop + shared executor emit nothing; ${starts.length} start/${finishes.length} finish paired on a FAILING tool; subject carries name+platform+window and no raw args; zero UUIDs on the wire.`)
