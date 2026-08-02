#!/usr/bin/env node
// LORAMER_CHAT_STATUS_FIRST_V1 — THE STATUS LINE MUST BE THE FIRST THING ON SCREEN, AND THE MARK MUST DRAW.
//
// PROVENANCE: three defects reported from a LIVE DEVICE (Gate-B, Chrome iOS, 2026-08-02) against 9fa8b86, the
// first build where LORA_CHAT_STREAMING was ON in production. Every one of them passed the V1 static guard.
//   D1  the status line took >1 MINUTE to appear; the three dots showed until it did
//   D2  the gradient sweep did not animate — static text
//   D3  the LM mark did not render AT ALL, neither as the working indicator nor as the avatar
//
// THREE LEGS:
//  (a) A `status` EVENT IS EMITTED BEFORE THE FIRST `tool` EVENT, ON A TURN WITH NO PREAMBLE TEXT. Driven
//      against the REAL compiled streaming loop. The no-preamble shape is the whole point: it is what a data
//      question produces, it is the slow turn this feature exists for, and it is the exact case where V1 had
//      nothing to show. Also asserts the FIRST emit of the turn is the status — because the route holds its
//      Response until the first emit, so whatever is emitted first is what decides when ANYTHING appears.
//  (b) THE LM MARK IS MOUNTED IN BOTH STATES — `working` inside the loading branch, AND un-`working` as the
//      avatar on an assistant turn inside the message list. V1 wired only the first, which is why the mark
//      was absent on every completed turn: a WIRING gap, invisible to a CSS check.
//  (c) THE WEBKIT FACTS THAT KILLED D2 AND D3, asserted as the mechanical residue of published browser
//      behaviour — see the honest limit below for what this can and cannot mean.
//
// ⛔ WHAT NO NODE GUARD CAN ASSERT, STATED SO A GREEN IS NEVER OVER-READ: whether the sweep VISUALLY animates,
// whether the mark is LEGIBLE at 14px, or whether the device has Reduce Motion enabled. Those are rendering
// facts that need a browser. What IS mechanical is the set of properties known to be broken on WebKit — the
// ones this repo just paid for — so leg (c) guards THOSE and says so, rather than dressing a presence check
// as a proof of appearance. Per LORAMER_GATE_B_TARGET_IS_CHROME_IOS_V1 the visual half is Gate-B, always.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[chat-status-visible] FAIL — ${m}`); process.exit(1) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }

const TOOLS_SRC = 'src/lib/claude-tools.ts'
const SUBJ_SRC = 'src/lib/chat/tool-subject.ts'
const MARK_SRC = 'src/components/redesign/LmMark.tsx'
const UI_SRC = 'src/components/redesign/ChatLauncher.tsx'
const CSS_SRC = 'src/components/redesign/chat.module.css'
const HOOK_SRC = 'src/lib/next/use-lora-chat.ts'
for (const f of [TOOLS_SRC, SUBJ_SRC, MARK_SRC, UI_SRC, CSS_SRC, HOOK_SRC]) {
  if (!existsSync(resolve(ROOT, f))) fail(`${f} is missing — the guard cannot see its subject, and that is not a pass.`)
}

// ── LEG (a) · DRIVE THE REAL LOOP: STATUS BEFORE TOOL, ON A NO-PREAMBLE TURN ──────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-status-visible-'))
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

// ⛔ TURN 1 EMITS **NO TEXT AT ALL** AND GOES STRAIGHT TO tool_use. That is not a convenience — it is the
// EXACT shape that produced the >1-minute defect, because the old gate only released on a text delta.
const TOOL_USE_ID = 'toolu_visible_0001'
const mkStream = (turn) => ({
  on() { return this },   // no `text` handler ever invoked on turn 0 — deliberately silent
  async finalMessage() {
    if (turn === 0) {
      return { stop_reason: 'tool_use', usage: {}, content: [
        { type: 'tool_use', id: TOOL_USE_ID, name: 'query_metrics',
          input: { clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', platform: 'google', startDate: '2024-11-01', endDate: '2024-12-31' } },
      ] }
    }
    return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Here is the answer.' }] }
  },
})
let turnNo = 0
const anthropic = { messages: { stream: () => mkStream(turnNo++) } }

const events = []
let gateReleasedAfter = null   // how many events had been emitted when the route's commit gate released
let loopErr = null
try {
  await mod.runClaudeToolLoopStreaming({
    anthropic, model: 'guard-model', maxTokens: 100, system: 'x', messages: [{ role: 'user', content: 'q' }],
    clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', userEmail: 'guard@example.com', clientName: 'Foam OH',
    emit: (event, data) => events.push({ event, data }),
    onFirstTurnStarted: () => { if (gateReleasedAfter === null) gateReleasedAfter = events.length },
  })
} catch (e) { loopErr = e }
Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })
if (loopErr) findings.push(`the streaming loop THREW while being driven: ${loopErr.message}. Leg (a) could not run — a crashed instrument is neither a pass nor a fail.`)

if (!loopErr) {
  const firstStatus = events.findIndex((e) => e.event === 'status')
  const firstTool = events.findIndex((e) => e.event === 'tool')
  if (firstStatus === -1) {
    findings.push(`(a) NO 'status' EVENT WAS EMITTED ON A TURN THAT CALLS A TOOL WITH NO PREAMBLE TEXT. This is the exact shape a data question produces. Without it the first thing the client can render is the tool event — on the device that was more than a MINUTE of three dots, because the route holds its Response until the first emit.`)
  } else if (firstTool !== -1 && firstStatus > firstTool) {
    findings.push(`(a) the first 'tool' event (index ${firstTool}) precedes the first 'status' event (index ${firstStatus}). The status line must LEAD the turn, not trail the first tool call.`)
  }
  if (firstStatus !== 0) {
    findings.push(`(a) the FIRST emitted frame is '${events[0]?.event ?? '(none)'}', not 'status'. The route does not return its Response until the first emit, so whatever is emitted first decides when ANYTHING reaches the browser — a status must be the frame that opens the channel.`)
  }
  if (gateReleasedAfter === null) {
    findings.push(`(a) onFirstTurnStarted was NEVER called across the whole turn. The route awaits it before returning the Response, so nothing would reach the browser until the model chain settled — this is the >1-minute defect exactly.`)
  } else if (gateReleasedAfter > 1) {
    findings.push(`(a) the commit gate released only after ${gateReleasedAfter} events had been emitted; it must release on the FIRST one, or every frame before it sits in a stream whose Response has not been returned.`)
  }
  const s0 = events[firstStatus]?.data
  if (s0 && !s0.label) findings.push(`(a) the status event carries no 'label' — the client renders data.label, so a labelless status is an event the UI cannot show.`)
  // ⛔ IT MAY NOT CLAIM WORK IT HAS NOT STARTED. The pre-model status must not name a client, a platform or a
  // date window: nothing has been read at that point, and a false status is worse than a silent one.
  const preToolStatuses = events.slice(0, firstTool === -1 ? events.length : firstTool).filter((e) => e.event === 'status')
  for (const s of preToolStatuses) {
    const label = String(s.data?.label ?? '')
    if (/\bFoam OH\b|\bgoogle\b|\bmeta\b|\bshopify\b|Nov|2024|Reading /i.test(label)) {
      findings.push(`(a) a status emitted BEFORE any tool ran claims specific work: "${label}". Nothing has been read at that point — naming a client, a platform or a window there is a FALSE STATUS, the same class as a spinner implying progress it cannot measure.`)
    }
  }
}

// ── LEG (b) · THE MARK IS MOUNTED IN BOTH STATES ──────────────────────────────────────────────────────
{
  const ui = read(UI_SRC) || ''
  if (!/import\s*\{\s*LmMark\s*\}/.test(ui)) findings.push(`(b) ${UI_SRC} does not import LmMark at all.`)
  // WORKING state — inside the `loading &&` branch, with the `working` prop.
  if (!/<LmMark\s+working\b/.test(ui)) {
    findings.push(`(b) no <LmMark working …> anywhere in ${UI_SRC}. The working indicator is not mounted, so a turn in flight shows no mark.`)
  }
  // AVATAR state — inside the messages.map render, WITHOUT `working`.
  const mapStart = ui.indexOf('messages.map(')
  const mapEnd = mapStart === -1 ? -1 : ui.indexOf('{loading &&', mapStart)
  if (mapStart === -1 || mapEnd === -1 || mapEnd < mapStart) {
    findings.push(`(b) could not locate the messages.map(...) render region in ${UI_SRC} — leg (b) is BLIND on the avatar half. Fix the guard before trusting a green.`)
  } else {
    const region = ui.slice(mapStart, mapEnd)
    const avatar = region.match(/<LmMark\b[^>]*\/>/g) || []
    if (avatar.length === 0) {
      findings.push(`(b) THE LM MARK IS NEVER MOUNTED AS AN ASSISTANT-TURN AVATAR. The banked design (2026-07-28) is ONE MARK, TWO STATES — working indicator AND avatar. Mounting only the working half is why the mark was absent on every completed turn on the device: a WIRING gap, which no CSS check can see.`)
    } else if (avatar.some((t) => /\bworking\b/.test(t))) {
      findings.push(`(b) the assistant-turn avatar is mounted with the \`working\` prop, so a finished answer animates as if Lora were still working. The two states must be visually distinct — that is the requirement the one-mark design rests on.`)
    }
  }
}

// ── LEG (c) · THE WEBKIT FACTS, AS MECHANICAL RESIDUE ─────────────────────────────────────────────────
{
  // ⛔ QUOTATION IS NOT ASSERTION — banked three times in this repo, most recently INSIDE the guard written to
  // catch it, and it caught THIS guard on its first run: both fix comments NAME the property they removed
  // ("the first cut had pathLength={1}", "the original keyframe was stroke-dashoffset: -1") and the raw-text
  // match read them as live code. A guard that fails on its own explanation teaches authors to delete the
  // explanation. Strip comments first; match only what the browser will actually parse.
  const cssRaw = read(CSS_SRC) || ''
  const markRaw = read(MARK_SRC) || ''
  const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  const stripTsx = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  const css = stripCss(cssRaw)
  const mark = stripTsx(markRaw)

  // D3 cause 1 — WebKit PARSES pathLength AND IGNORES IT. Every browser on iOS is WebKit, so a dash animation
  // that depends on it is dead on the only device that matters.
  if (/pathLength/.test(mark)) {
    findings.push(`(c) ${MARK_SRC} still uses pathLength. WebKit parses the attribute and does NOTHING with it — it does not scale stroke-dasharray/dashoffset the way Firefox and Chrome-on-desktop do. Every iOS browser is WebKit, so on the target device the normalisation never happens and the dash values are interpreted against the RAW path length. That is why the mark rendered as an invisible dotted smear.`)
  }
  // D3 cause 2 — Safari does not support NEGATIVE stroke-dashoffset, the standard self-erasing trick.
  const negOffset = css.match(/stroke-dashoffset:\s*-[\d.]/g)
  if (negOffset) {
    findings.push(`(c) ${CSS_SRC} animates a NEGATIVE stroke-dashoffset (${negOffset.join(', ')}). Safari does not support negative dash offsets, so the erase half of the loop is dead on the device. Use opacity for the dissolve.`)
  }
  // D2 — the WebKit pairing for background-clip:text. Both must be present, on the element itself.
  const sweep = css.slice(css.indexOf('.streamStatusText'), css.indexOf('@keyframes loramerSweep'))
  if (sweep) {
    if (/background-clip:\s*text/.test(sweep) && !/-webkit-background-clip:\s*text/.test(sweep)) {
      findings.push(`(c) .streamStatusText sets background-clip:text without the -webkit- prefix. Unprefixed background-clip:text is not honoured across WebKit versions; the text renders in a flat colour and the sweep is invisible.`)
    }
    if (/background-clip:\s*text/.test(sweep) && !/-webkit-text-fill-color:\s*transparent/.test(sweep)) {
      findings.push(`(c) .streamStatusText clips the background to text but never sets -webkit-text-fill-color: transparent. That is the load-bearing half of the WebKit pairing — -webkit-text-fill-color WINS over \`color\`, so relying on \`color: transparent\` alone leaves the glyphs painted opaque and the gradient never shows through.`)
    }
  } else {
    findings.push(`(c) could not isolate the .streamStatusText rule in ${CSS_SRC} — leg (c) is BLIND on the sweep. Fix the guard before trusting a green.`)
  }
  // The portal trap, scoped to the classes THIS feature owns. LORAMER_PORTAL_SEVERS_CSS_VARS_V1 cost five and
  // a half hours of an invisible send button; a var without a fallback in a portaled subtree resolves to
  // nothing and the declaration is dropped at computed-value time — silently, never as an error.
  const owned = css.split('\n').filter((l) => /var\(--/.test(l))
  for (const l of owned) {
    if (!/streamStatus|lmStroke|lmMark|avatarSlot/.test(l) && !/--muted|--ink|--accent/.test(l)) continue
    for (const m of l.matchAll(/var\(\s*(--[a-z-]+)\s*([,)])/g)) {
      if (m[2] === ')' && /stroke:|background-image:|color:|-webkit-text-fill-color:/.test(l) && /lmStroke|streamStatus/.test(css.slice(Math.max(0, css.indexOf(l) - 400), css.indexOf(l)))) {
        findings.push(`(c) ${CSS_SRC}: \`${m[1]}\` is used with NO FALLBACK in a rule this feature owns ("${l.trim().slice(0, 80)}"). The chat overlay is PORTALED to document.body — LORAMER_PORTAL_SEVERS_CSS_VARS_V1 — so a token that fails to inherit makes the declaration invalid at computed-value time and the mark or the line renders as nothing, with no error anywhere.`)
      }
    }
  }
  // Reduced motion must land on a WORKING state, not idle, and must not leave the text invisible.
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion'))
  if (!rm) findings.push(`(c) no prefers-reduced-motion block — accessibility is a closed question in this repo.`)
  else {
    if (!/-webkit-text-fill-color/.test(rm)) {
      findings.push(`(c) the reduced-motion block resets \`color\` but not \`-webkit-text-fill-color\`. On WebKit the fill colour wins, so the reduced-motion line would render INVISIBLE — the accessibility path failing worse than the animated one.`)
    }
    const opacity = /\.lmMarkWorking[^}]*opacity:\s*([\d.]+)/.exec(rm)
    if (!opacity) findings.push(`(c) the reduced-motion block does not give .lmMarkWorking a distinct static appearance — it must fall back to a STATIC WORKING state, not to idle. Killing the animation must not also kill the information.`)
    else if (Number(opacity[1]) >= 0.9) findings.push(`(c) the reduced-motion working mark is opacity ${opacity[1]}, indistinguishable from the 0.9 idle avatar. A user with Reduce Motion on could not tell "working" from "done".`)
  }
}

if (findings.length) {
  console.error(`[chat-status-visible] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[chat-status-visible] PASS — status leads the turn (frame 0 of ${events.length}, gate released on the first frame, no tool preamble); the LM mark is mounted BOTH as the working indicator and as an assistant avatar; no pathLength, no negative dash offset, WebKit's background-clip pairing complete, owned tokens carry fallbacks, reduced motion lands on a distinct static WORKING state. ⛔ NOT ASSERTED: that the sweep animates or that anything is legible — browser facts, Gate-B on Chrome iOS.`)
