#!/usr/bin/env node
// LORAMER_PROTOCOL_GATE_ENFORCER_V1 — GUARD. ⛔ THE ENFORCER'S OWN FAILURE MUST NOT BE SILENT.
//
// ⛔ WHY THIS GUARD IS MANDATORY RATHER THAN NICE-TO-HAVE, and it is the whole reason it exists:
// Claude Code hooks FAIL OPEN. Vendor, verbatim: "Any other exit code doesn't block on its own for most hook
// events … the action proceeds, and the transcript shows a `<hook name> hook error` notice." The documented
// hard-enforce path is exit 2, and exit 2 is UNAVAILABLE to us because on UserPromptSubmit it "blocks prompt
// processing and ERASES THE PROMPT" — unusable for a man who types long instructions on a phone.
// So a broken enforcer does not fail loudly; it stops gating and everything proceeds. The only remaining
// defence is to run the enforcer inside the build. THIS FILE IS THAT DEFENCE. If it is removed from
// scripts/run-guards.mjs, the enforcer becomes unobserved again — that is the failure mode to watch.
//
// ⛔ IT DRIVES THE REAL CONTRACT, NOT THE FUNCTIONS. Every fixture is fed to the script as a SUBPROCESS over
// STDIN as the hook feeds it, and the assertion is made on the raw STDOUT JSON. An imported-function test
// would pass while the stdin parsing, the JSON shape or the exit code was wrong — which is exactly how a
// green check answers a narrower question than the reader assumes.
//
// SEVEN LEGS:
//  (a) WIRED — .claude/settings.json actually registers this script on UserPromptSubmit.
//  (b) SHAPE — the blocking output is TOP-LEVEL {"decision":"block","reason":…} and exit 0.
//      (hookSpecificOutput.permissionDecision is the PreToolUse shape; used here it is IGNORED and the gate
//      silently admits everything. This leg pins the correct shape so that mistake cannot be reintroduced.)
//  (c) NO EXIT 2 — the source must not contain a process.exit(2), because it would erase Russ's paste.
//  (d) RED-FIRST FIXTURES — one deliberately-broken paste per box; each MUST be blocked, naming its box.
//  (e) GREEN FIXTURE + PROPORTIONALITY — a compliant writing paste passes, and a read-only paste passes
//      WITHOUT research/adversary (Russ's ruling: rounds attach to consequence, not to question-shape).
//  (f) FAIL-CLOSED — malformed stdin and a missing prompt field must not admit anything they cannot grade.
//  (g) OVERRIDE BURN-DOWN — the log is monotonic against the baseline and its hash chain is intact.

import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { OVERRIDE_COUNT_BASELINE, RESOLUTIONS } from './protocol-gate.baseline.mjs'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SCRIPT = resolve(ROOT, 'scripts/protocol-gate.mjs')
const SETTINGS = resolve(ROOT, '.claude/settings.json')
const LOG = resolve(ROOT, 'docs/LORAMER_PROTOCOL_OVERRIDES.jsonl')
const findings = []
const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')

// Run the enforcer exactly as the hook does: JSON on stdin, JSON on stdout.
function runGate(payload) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, LORAMER_GATE_ROOT: ROOT },
  })
  let out = null
  if (r.stdout && r.stdout.trim()) { try { out = JSON.parse(r.stdout) } catch { out = { __unparsable: r.stdout.slice(0, 200) } } }
  return { status: r.status, out, stderr: r.stderr }
}

// ── (a) WIRED ─────────────────────────────────────────────────────────────────────────────────────────────
if (!existsSync(SCRIPT)) findings.push('(a) scripts/protocol-gate.mjs is MISSING — the enforcer does not exist.')
if (!existsSync(SETTINGS)) {
  findings.push('(a) .claude/settings.json is MISSING — the hook is not registered, so the enforcer never runs at paste-receipt.')
} else {
  let cfg = null
  try { cfg = JSON.parse(readFileSync(SETTINGS, 'utf8')) } catch (e) { findings.push(`(a) .claude/settings.json is not valid JSON (${e.message}) — Claude Code ignores a malformed settings file, so the hook silently does not run.`) }
  if (cfg) {
    const ups = cfg?.hooks?.UserPromptSubmit
    const wired = JSON.stringify(ups || '').includes('scripts/protocol-gate.mjs')
    if (!Array.isArray(ups) || !ups.length) findings.push('(a) .claude/settings.json has no hooks.UserPromptSubmit entry — the gate is not attached to paste-receipt.')
    else if (!wired) findings.push('(a) hooks.UserPromptSubmit exists but does not invoke scripts/protocol-gate.mjs — something else is wired where the gate should be.')
  }
}

// ── (c) NO EXIT 2 ─────────────────────────────────────────────────────────────────────────────────────────
if (existsSync(SCRIPT)) {
  const src = readFileSync(SCRIPT, 'utf8')
  if (/process\.exit\(\s*2\s*\)/.test(src)) findings.push('(c) scripts/protocol-gate.mjs contains process.exit(2). On UserPromptSubmit that ERASES the prompt — a phone-length paste would be destroyed by the gate meant to protect the work.')
  if (/["']?hookSpecificOutput["']?\s*:/.test(src)) findings.push('(c) scripts/protocol-gate.mjs references hookSpecificOutput. UserPromptSubmit blocks via a TOP-LEVEL {"decision":"block"}; the nested shape is the PreToolUse contract and is ignored here, which fails OPEN.')
}

// ── FIXTURES ──────────────────────────────────────────────────────────────────────────────────────────────
const PAD = '\n' + ('x. this line exists only to carry the paste past FLIGHT_MIN_CHARS so the gate treats it as a flight instruction rather than as conversation.\n'.repeat(3))
// ⛔ RFC 2606 RESERVED DOMAINS, AND THE REASON IS A DEFECT THIS GUARD CAUGHT IN ITSELF: the anti-rubber-stamp
// leg refuses hostnames already cited in LORAMER_DECISIONS.md, so a GREEN fixture built from REAL research
// URLs goes red the moment that research is banked — which is exactly what happened when this build's own
// DECISIONS entry cited open-policy-agent.github.io and danger.systems. example.com/.org can never be
// banked as a source, so the fixture is stable by construction. Do not "fix" this back to real URLs.
const GOOD_RESEARCH = 'RESEARCH: https://example.com/vendor-doc · https://example.org/prior-art'
const GOOD_ADVERSARY = 'ADVERSARY: mine=gate at paste-receipt | other=gate at commit time | collision=a commit-time gate cannot see paste-while-in-flight at all, so receipt wins'
const GOOD_CONSTANTS = 'CONSTANTS: FLIGHT_MIN_CHARS=400 ⇐ measured 2026-08-23 N=12'
const GOOD_QUESTION = 'QUESTION: where does the protocol gate have to live to fire every time?'

const fixtures = [
  { name: 'RED BLAST-UNDECLARED', box: 'BLAST-UNDECLARED', expect: 'block',
    text: `ROUND: SHAPE\n${GOOD_QUESTION}\n${GOOD_RESEARCH}\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED QUESTION-NEVER-FRAMED (statement, not a question)', box: 'QUESTION-NEVER-FRAMED', expect: 'block',
    text: `ROUND: SHAPE\nQUESTION: build the enforcer today.\nBLAST: backend-writer\n${GOOD_RESEARCH}\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED QUESTION-NEVER-FRAMED (absent entirely)', box: 'QUESTION-NEVER-FRAMED', expect: 'block',
    text: `ROUND: SHAPE\nBLAST: backend-writer\n${GOOD_RESEARCH}\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED QUESTION-NEVER-FRAMED (too short)', box: 'QUESTION-NEVER-FRAMED', expect: 'block',
    text: `ROUND: SHAPE\nQUESTION: why?\nBLAST: backend-writer\n${GOOD_RESEARCH}\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED RESEARCH-WITH-NO-URLS (one hostname only)', box: 'RESEARCH-WITH-NO-URLS', expect: 'block',
    text: `ROUND: SHAPE\n${GOOD_QUESTION}\nBLAST: backend-writer\nRESEARCH: https://danger.systems/js/ · https://danger.systems/js/plugins/\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED RESEARCH rubber-stamp (all hosts already in DECISIONS)', box: 'RESEARCH-WITH-NO-URLS', expect: 'block',
    text: `ROUND: SHAPE\n${GOOD_QUESTION}\nBLAST: backend-writer\nRESEARCH: https://nango.dev/docs/guides/primitives/auth · https://docs.airbyte.com/platform/cloud/\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED ADVERSARY-THAT-NEVER-COLLIDED (no collision named)', box: 'ADVERSARY-THAT-NEVER-COLLIDED', expect: 'block',
    text: `ROUND: SHAPE\n${GOOD_QUESTION}\nBLAST: live-path\n${GOOD_RESEARCH}\nADVERSARY: mine=ship it | other=ship it\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED ADVERSARY compression attempted on a writing blast', box: 'ADVERSARY-THAT-NEVER-COLLIDED', expect: 'block',
    text: `ROUND: SHAPE\n${GOOD_QUESTION}\nBLAST: backend-writer\n${GOOD_RESEARCH}\nADVERSARY: DECLARED-COMPRESSED: the change is small and obvious\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'RED CONSTANT-INHERITED-WITHOUT-DERIVATION (bare number)', box: 'CONSTANT-INHERITED-WITHOUT-DERIVATION', expect: 'block',
    text: `ROUND: SHAPE\n${GOOD_QUESTION}\nBLAST: backend-writer\n${GOOD_RESEARCH}\n${GOOD_ADVERSARY}\nCONSTANTS: FIRST_LAP_MS=90000${PAD}` },
  { name: 'RED writing paste with NO research and NO adversary at all', box: 'RESEARCH-WITH-NO-URLS', expect: 'block',
    text: `ROUND: RUN\n${GOOD_QUESTION}\nBLAST: live-path\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'GREEN compliant writing paste', expect: 'allow',
    text: `ROUND: SHAPE\n${GOOD_QUESTION}\nBLAST: backend-writer\nINFLIGHT: clear\n${GOOD_RESEARCH}\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'GREEN BLAST carrying a parenthetical qualifier (how Russ actually writes it)', expect: 'allow',
    text: `ROUND: RUN\n${GOOD_QUESTION}\nBLAST: backend-writer (repo tooling only \u2014 no app code, no schema, no live path)\nINFLIGHT: clear\n${GOOD_RESEARCH}\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}${PAD}` },
  { name: 'GREEN read-only paste needs NO rounds (proportionality)', expect: 'allow',
    text: `ROUND: ISSUE\n${GOOD_QUESTION}\nBLAST: read-only\nINFLIGHT: clear\nCONSTANTS: NONE${PAD}` },
  { name: 'GREEN short conversational paste is not a flight', expect: 'allow', text: 'go' },
  { name: 'GREEN override lifts exactly its own box', expect: 'allow',
    text: `ROUND: RUN\n${GOOD_QUESTION}\nBLAST: backend-writer\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}\nOVERRIDE RESEARCH-WITH-NO-URLS: the vendor documentation host is down right now and the walk read is time boxed${PAD}`,
    mutatesLog: true },
  { name: 'RED override with a too-short reason does NOT lift its box', box: 'RESEARCH-WITH-NO-URLS', expect: 'block',
    text: `ROUND: RUN\n${GOOD_QUESTION}\nBLAST: backend-writer\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}\nOVERRIDE RESEARCH-WITH-NO-URLS: docs down${PAD}` },
  { name: 'RED override of an unknown box name does NOT lift anything', box: 'RESEARCH-WITH-NO-URLS', expect: 'block',
    text: `ROUND: RUN\n${GOOD_QUESTION}\nBLAST: backend-writer\n${GOOD_ADVERSARY}\n${GOOD_CONSTANTS}\nOVERRIDE EVERYTHING: I would like to skip all of the boxes on this particular paste please${PAD}` },
]

// ── (b)(d)(e) DRIVE THE FIXTURES ──────────────────────────────────────────────────────────────────────────
// ⛔ The override fixture would APPEND to the real log every guard run, so it is driven against a scratch
// root: the enforcer resolves the log from LORAMER_GATE_ROOT. Never break-and-restore the real file
// (★GUARD-BREAK-AND-RESTORE-IS-UNSAFE): a crash mid-run would leave the repo's own audit log mutated.
if (existsSync(SCRIPT)) {
  for (const f of fixtures) {
    const r = f.mutatesLog
      ? (() => { const tmp = process.env.TMPDIR || '/tmp'; return spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ prompt: f.text, session_id: 'guard' }), encoding: 'utf8', env: { ...process.env, LORAMER_GATE_ROOT: tmp } }) })()
      : null
    const res = f.mutatesLog
      ? { status: r.status, out: r.stdout && r.stdout.trim() ? (() => { try { return JSON.parse(r.stdout) } catch { return { __unparsable: r.stdout } } })() : null }
      : runGate({ prompt: f.text, session_id: 'guard' })

    if (res.status !== 0) findings.push(`(b) fixture "${f.name}" exited ${res.status}; the gate must always exit 0 (exit 2 erases the paste, other codes fail open).`)
    const blocked = res.out?.decision === 'block'
    if (f.expect === 'block') {
      if (!blocked) findings.push(`(d) fixture "${f.name}" was ADMITTED. It must be blocked — this check is not load-bearing.`)
      else if (f.box && !String(res.out.reason || '').includes(f.box)) findings.push(`(d) fixture "${f.name}" was blocked but the refusal never names ${f.box}; Russ cannot act on a refusal that does not say which box failed.`)
      else if (!String(res.out.reason || '').includes('YOUR PASTE, VERBATIM')) findings.push(`(d) fixture "${f.name}" was blocked without echoing the paste back. decision:"block" is not documented to preserve the prompt, so the echo is the only guaranteed copy.`)
    } else if (blocked) {
      findings.push(`(e) fixture "${f.name}" was BLOCKED and must not be — reason: ${String(res.out.reason || '').slice(0, 220)}`)
    }
    if (res.out && res.out.__unparsable) findings.push(`(b) fixture "${f.name}" produced non-JSON stdout: ${res.out.__unparsable}`)
  }

  // ── (d2) THE IN-FLIGHT BOX, DRIVEN AGAINST A REAL TRANSCRIPT FILE ─────────────────────────────────────
  // ⛔ ADDED BECAUSE MUTATION TESTING EXPOSED IT: none of the fixtures above passes a transcript_path, so the
  // ONE box that reads reality rather than a claim was the one box with no coverage. A check nothing drives
  // is a check nobody knows is broken.
  {
    const tdir = mkdtempSync(join(tmpdir(), 'loramer-gate-'))
    const mk = (roles) => { const f = join(tdir, `t${roles.join('')}.jsonl`); writeFileSync(f, roles.map((r) => JSON.stringify({ type: r, message: { role: r } })).join('\n') + '\n'); return f }
    const flightText = `ROUND: RUN\n${GOOD_QUESTION}\nBLAST: read-only\nCONSTANTS: NONE${PAD}`
    const twoUsers = runGate({ prompt: flightText, session_id: 'guard', transcript_path: mk(['user', 'assistant', 'user', 'user']) })
    if (twoUsers.out?.decision !== 'block') findings.push('(d2) two consecutive user messages in the transcript did NOT trigger PASTE-WHILE-IN-FLIGHT — the only box that checks reality is not load-bearing.')
    else if (!String(twoUsers.out.reason).includes('PASTE-WHILE-IN-FLIGHT')) findings.push('(d2) blocked on a two-user transcript but the refusal does not name PASTE-WHILE-IN-FLIGHT.')
    const answered = runGate({ prompt: flightText, session_id: 'guard', transcript_path: mk(['user', 'assistant', 'user', 'assistant']) })
    if (answered.out?.decision === 'block') findings.push(`(d2) a transcript ending [user, assistant] was blocked as in-flight — the check fires on an answered turn: ${String(answered.out.reason).slice(0, 160)}`)
    const missing = runGate({ prompt: flightText, session_id: 'guard', transcript_path: join(tdir, 'does-not-exist.jsonl') })
    if (missing.out?.decision === 'block') findings.push('(d2) a MISSING transcript was treated as in-flight. The vendor writes the transcript asynchronously, so an absent or lagging file must degrade to "clear" — blocking on it would refuse every paste whenever the writer lags.')
  }

  // ── (f) FAIL-CLOSED ─────────────────────────────────────────────────────────────────────────────────────
  const bad = spawnSync(process.execPath, [SCRIPT], { input: 'this is not json', encoding: 'utf8', env: { ...process.env, LORAMER_GATE_ROOT: ROOT } })
  let badOut = null
  try { badOut = JSON.parse(bad.stdout || 'null') } catch { /* handled below */ }
  if (badOut?.decision !== 'block') findings.push('(f) malformed stdin did NOT produce decision:block. The vendor default is to proceed, so an enforcer that cannot parse its input and stays quiet has silently stopped gating.')
  if (bad.status !== 0) findings.push(`(f) malformed stdin exited ${bad.status}; must be 0.`)
}

// ── (g) OVERRIDE BURN-DOWN ────────────────────────────────────────────────────────────────────────────────
if (!existsSync(LOG)) {
  findings.push('(g) docs/LORAMER_PROTOCOL_OVERRIDES.jsonl is MISSING — the override audit trail must exist even when empty, or its absence is indistinguishable from "no overrides were ever taken".')
} else {
  const lines = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.trim())
  if (lines.length < OVERRIDE_COUNT_BASELINE) {
    findings.push(`(g) the override log holds ${lines.length} entr(ies), BELOW the baseline of ${OVERRIDE_COUNT_BASELINE}. An override was DELETED. The count may rise freely and may never fall except through a dated RESOLUTIONS entry in protocol-gate.baseline.mjs.`)
  }
  let prev = 'genesis'
  lines.forEach((l, i) => {
    let o = null
    try { o = JSON.parse(l) } catch { findings.push(`(g) override log line ${i + 1} is not valid JSON — the audit trail is corrupt.`); return }
    if (o.prev !== prev) findings.push(`(g) override log line ${i + 1} breaks the hash chain (prev=${String(o.prev).slice(0, 12)}…, expected ${String(prev).slice(0, 12)}…). A line was edited, reordered or removed — git diff alone is not tamper-evidence on a solo repo, which is why the chain exists.`)
    if (Object.prototype.hasOwnProperty.call(o, 'prompt')) findings.push(`(g) override log line ${i + 1} stores the PASTE. Only prompt_sha256 may be stored — a paste can carry a token or a customer name.`)
    prev = sha256(l)
  })
  if (lines.length > OVERRIDE_COUNT_BASELINE) {
    console.log(`[protocol-gate] ⇢ ${lines.length - OVERRIDE_COUNT_BASELINE} override(s) taken since the baseline was set. Raise OVERRIDE_COUNT_BASELINE to ${lines.length} in the commit that acknowledges them, and resolve each one.`)
  }
  if (RESOLUTIONS.length) console.log(`[protocol-gate] ⇢ ${RESOLUTIONS.length} resolution(s) recorded.`)
}

if (findings.length) {
  console.error(`✗ PROTOCOL-GATE FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[protocol-gate] PASS — ${fixtures.length} fixtures driven through the real stdin/stdout hook contract (${fixtures.filter((f) => f.expect === 'block').length} must-block, ${fixtures.filter((f) => f.expect === 'allow').length} must-allow), fail-closed on malformed input, wired on UserPromptSubmit, no exit(2), override log monotonic at ${OVERRIDE_COUNT_BASELINE}+ with an intact hash chain.`)
console.log(`[protocol-gate] LIMIT, stated so a green is not oversold: this is an ARTIFACT check. It proves the paste CARRIES the round's artifacts — never that a round happened, that the two positions were independent, that a URL was read, or that the QUESTION was the right one.`)
