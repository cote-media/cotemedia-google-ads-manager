#!/usr/bin/env node
// LORAMER_PROTOCOL_GATE_ENFORCER_V1 — LAYER 1, the MECHANICAL FLOOR, at PASTE-RECEIPT.
//
// ⛔ WHAT THIS IS. The enforcement mechanism for LORAMER_ROUNDS_AT_DECISION_POINTS_V1. It runs as a
// `UserPromptSubmit` hook — the ONE surface in Claude Code that sits between Russ's paste and the executor
// processing it — and REFUSES a paste whose protocol boxes are missing or empty. Every other protocol law in
// this repo (five-step-rounds, three-source-header, one-block-output, next-step-obeys-ranking) guards
// PLACEMENT in a document and says so on its own face. This is the first one that can stop an action.
//
// ⛔ WHAT IT IS NOT, AND THE LIMIT IS STRUCTURAL RATHER THAN A TODO: this is an ARTIFACT CHECK, NOT A PROCESS
// PROOF. The hook sees ONE STRING. It cannot know whether a round happened, whether two positions were formed
// independently, whether a cited URL was read, or whether the question was the RIGHT one. It verifies that the
// paste CARRIES the round's artifacts. A paste with five correctly-filled boxes around a bad flight PASSES.
// That is not a defect to be fixed later; it is the ceiling of what a deterministic reader of one string can
// reach, and it is written here so nobody mistakes a green for diligence.
//
// ⛔ VENDOR CONTRACT, READ FROM THE LIVE DOCS 2026-08-23, NOT FROM MEMORY:
//   · UserPromptSubmit fires "when you submit a prompt, before Claude processes it".
//   · BLOCKING SHAPE IS TOP-LEVEL: {"decision":"block","reason":"…"} with EXIT 0.
//     ⛔ NOT hookSpecificOutput.permissionDecision — that is the PreToolUse shape and it is IGNORED here,
//     which means the wrong shape fails SILENTLY OPEN. This exact mistake was caught before a line was written.
//   · ⛔ EXIT 2 IS FORBIDDEN IN THIS FILE. Vendor, verbatim: on UserPromptSubmit exit 2 "Blocks prompt
//     processing and ERASES THE PROMPT." Russ types phone-length instructions. Erasing one is worse than the
//     defect this gate exists to prevent. `emitBlock()` is the only exit path and it always exits 0.
//   · UserPromptSubmit has NO MATCHER SUPPORT — "always fires on every occurrence". It cannot be scoped away.
//   · UserPromptSubmit lowers the hook timeout to 30 SECONDS. Everything here is bounded: the transcript read
//     is a byte-capped tail, and there is no network call and no model call.
//
// ⛔ FAIL-CLOSED BY CONSTRUCTION, BECAUSE THE VENDOR DEFAULT IS FAIL-OPEN. Vendor: "Any other exit code
// doesn't block on its own … the action proceeds." So a crash here silently admits everything — the identical
// trap OPA Gatekeeper documents as `failurePolicy: Ignore`. Exit 2 (the documented hard-enforce path) is
// unavailable to us for the erase reason above, so the ONLY remaining defence is that this file cannot throw:
// the entire body is wrapped, and ANY internal fault emits decision:block carrying the error text.
// The second half of that defence is not in this file: tests/guards/protocol-gate.guard.mjs runs this script
// against fixtures inside `npm run guard`, so a broken enforcer FAILS THE BUILD instead of quietly ceasing
// to gate. A gate whose own failure is invisible is not a gate.
//
// ⛔ LAYER 2 (an isolated `type:"prompt"` judge for the hollow-but-filled case) IS NOT IN THIS BUILD, by
// Russ's instruction. L1 + the override burn-down only.

import { readFileSync, appendFileSync, existsSync, openSync, readSync, fstatSync, closeSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { hostname } from 'node:os'

const ROOT = process.env.LORAMER_GATE_ROOT || process.cwd()
const LOG_REL = 'docs/LORAMER_PROTOCOL_OVERRIDES.jsonl'

// ── CONSTANTS, EACH WITH ITS DERIVATION (this file obeys its own CONSTANTS rule) ──────────────────────────
//
// FLIGHT_MIN_CHARS ⇐ measured 2026-08-23 over this session's real traffic. Russ's conversational replies
// ("go", "push", "stop") are under 20 chars; his flight instructions run 1,200–4,100 chars. 400 sits ~20×
// above the longest observed non-flight reply and ~3× below the shortest observed flight instruction, so the
// band it must discriminate is two orders of magnitude wide and the threshold is nowhere near either edge.
// A paste SHORTER than this and carrying no BLAST:/ROUND: line is treated as conversation and passes
// untouched — the gate must not demand a header on the word "go", or it gets turned off inside a day.
export const FLIGHT_MIN_CHARS = 400
// TRANSCRIPT_TAIL_BYTES ⇐ derived from the 30s UserPromptSubmit timeout, not guessed: a session transcript
// grows without bound, and the in-flight signal we need lives in the LAST few messages. 512 KiB holds far
// more than the last two turns at any realistic message size while keeping the read in single-digit ms.
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024
// MIN_QUESTION_WORDS / MIN_COLLISION_WORDS / MIN_DERIVATION_WORDS / MIN_OVERRIDE_WORDS ⇐ Russ's ruling,
// 2026-08-23, quoted into the brief as 6 / 8 / 8 / 10. Inherited from a human decision, which is a
// derivation: these are policy, not measurements, and pretending to measure them would be the fake.
export const MIN_QUESTION_WORDS = 6
export const MIN_COLLISION_WORDS = 8
export const MIN_DERIVATION_WORDS = 8
export const MIN_OVERRIDE_WORDS = 10
export const MIN_NONE_APPLICABLE_WORDS = 10
// QUOTE_CHARS ⇐ MEASURED 2026-08-23 over every legitimate CONSTANTS-shaped value available: the fixture set
// (47 · 15 · 26) and the two real values seen in this session — Russ's justified NONE at 84 and the longest
// genuinely-derived constant in LORAMER_DECISIONS.md, the walk's UNIT_RESERVATION_FLOOR_MS line, at 104.
// Longest legitimate value = 104, so the quote is 104: the smallest length that cannot truncate any value
// this repo has actually produced. The old 60 cut Russ's line mid-word at "a number w", hiding the part that
// was rejected — an error message that hides the evidence costs a round trip, and it cost two.
export const QUOTE_CHARS = 104

export const BOXES = [
  'BLAST-UNDECLARED',
  'QUESTION-NEVER-FRAMED',
  'PASTE-WHILE-IN-FLIGHT',
  'RESEARCH-WITH-NO-URLS',
  'ADVERSARY-THAT-NEVER-COLLIDED',
  'CONSTANT-INHERITED-WITHOUT-DERIVATION',
]

// ⛔ THE PROPORTIONALITY RULE — RUSS'S RULING 2026-08-23, and it is the schema's spine.
// ROUNDS ATTACH TO CONSEQUENCE, NOT TO QUESTION-SHAPE. BLAST decides:
//   read-only  → no rounds required; the gate does not demand RESEARCH or ADVERSARY.
//   anything that WRITES (backend-writer | -next-only | live-path) → BOTH rounds REQUIRED, and there is
//   NO compression and NO DECLARED-COMPRESSED escape. Ever.
// This AMENDS LORAMER_ROUNDS_AT_DECISION_POINTS_V1's "no proportionality carve-out" clause, which attached
// rounds to every decision point regardless of blast radius. Russ's amendment is banked in DECISIONS.
const BLAST_VALUES = new Map([
  ['read-only', 'read-only'], ['readonly', 'read-only'], ['lookup', 'read-only'], ['none', 'read-only'],
  ['backend-writer', 'backend-writer'], ['backend', 'backend-writer'],
  ['-next-only', '-next-only'], ['-next-ui', '-next-only'], ['next-only', '-next-only'], ['docs', 'backend-writer'],
  ['live-path', 'live-path'], ['livepath', 'live-path'],
])
const writesSomething = (blast) => blast !== null && blast !== 'read-only'

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length
const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')

// ── THE SCHEMA READER ─────────────────────────────────────────────────────────────────────────────────────
// Extends the ROUND: header the law already requires (LORAMER_ESSENCE.md § FIVE-STEP FRAMEWORK: "Every
// Claude Code instruction carries a `ROUND:` header naming its step"). Keys may appear anywhere in the
// paste, including inside a fence, because Russ pastes from a phone and a leading fence is normal. A value
// continues across lines until the next KEY: line, so a wrapped ADVERSARY line is not truncated.
export const KEYS = ['ROUND', 'QUESTION', 'BLAST', 'INFLIGHT', 'RESEARCH', 'ADVERSARY', 'CONSTANTS']
export function parseHeader(text) {
  const out = {}
  const lines = String(text || '').split('\n')
  const keyRe = new RegExp(`^\\s*(?:[·>*-]\\s*)?(${KEYS.join('|')})\\s*:\\s*(.*)$`)
  let cur = null
  for (const line of lines) {
    const m = line.match(keyRe)
    if (m) { cur = m[1]; out[cur] = (out[cur] ? out[cur] + '\n' : '') + m[2]; continue }
    if (cur !== null) {
      // ⛔ A CONTINUATION MUST BE INDENTED. Without this, the last key in the header swallows every following
      // line of the paste — caught red-first by the guard's own GREEN fixtures, which were blocked because
      // ordinary prose after CONSTANTS: was being read as an underived constant.
      if (/^\s+\S/.test(line)) { out[cur] += '\n' + line.trim(); continue }
      cur = null
    }
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim()
  return out
}

// ── OVERRIDES ─────────────────────────────────────────────────────────────────────────────────────────────
// PER-BOX, NEVER GLOBAL: `OVERRIDE <BOX-NAME>: <≥10-word reason>`. You cannot override the gate — only one
// named box, on one paste. The reason is the whole point: a bare magic word costs nothing and gets typed by
// reflex, and a reflexively-overridden gate is worse than no gate because it manufactures a compliance record.
export function parseOverrides(text) {
  const found = []
  const re = /^\s*(?:[·>*-]\s*)?OVERRIDE\s+([A-Z][A-Z-]+)\s*:\s*(.+)$/gm
  let m
  while ((m = re.exec(String(text || '')))) {
    const box = m[1].trim()
    const reason = m[2].trim()
    found.push({ box, reason, valid: BOXES.includes(box) && words(reason) >= MIN_OVERRIDE_WORDS })
  }
  return found
}

// ── CHECK 1 — PASTE-WHILE-IN-FLIGHT ───────────────────────────────────────────────────────────────────────
// ⛔ THE ONLY BOX THAT CHECKS REALITY RATHER THAN A CLAIM. The other five read what the paste asserts about
// itself; this one reads the transcript. The paste's honesty is irrelevant to it.
//
// ⛔ THE VENDOR CAVEAT, DESIGNED FOR RATHER THAN DISCOVERED LATER — docs, verbatim: the transcript "is
// written asynchronously and may lag the in-memory conversation, so it may not yet include the current
// turn's most recent messages when a hook fires." A naive backward walk therefore FAILS OPEN on the exact
// rule that is broken most often.
// THE LAG-TOLERANT SIGNAL: two CONSECUTIVE user messages at the tail. That is the paste-while-in-flight
// signature itself, and it degrades in the safe direction — if the transcript lags and has not yet recorded
// this paste, the tail reads [… assistant], no consecutive pair exists, and the box passes.
// ⚠ RESIDUAL, STATED RATHER THAN PAPERED OVER: this is a FLOOR, not a proof. A flight that started inside
// the current turn and produced no transcript record yet is INVISIBLE here, and this check will pass it.
// It catches the shape that actually recurred on 2026-08-04 and 2026-08-22 (a second instruction arriving on
// top of an unanswered one) and makes no wider claim.
export function inFlightVerdict(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return { outstanding: false, why: 'no transcript available (indeterminate — treated as clear)' }
  let fd
  try {
    fd = openSync(transcriptPath, 'r')
    const size = fstatSync(fd).size
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES)
    const len = size - start
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, start)
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift() // a byte-offset tail can slice a line in half; drop the fragment
    const roles = []
    for (const l of lines) {
      const t = l.trim()
      if (!t) continue
      let o
      try { o = JSON.parse(t) } catch { continue }
      const role = o?.type === 'user' || o?.message?.role === 'user' ? 'user'
        : o?.type === 'assistant' || o?.message?.role === 'assistant' ? 'assistant' : null
      if (role) roles.push(role)
    }
    if (roles.length < 2) return { outstanding: false, why: `only ${roles.length} message(s) in the tail (indeterminate — treated as clear)` }
    const [a, b] = [roles[roles.length - 2], roles[roles.length - 1]]
    if (a === 'user' && b === 'user') {
      return { outstanding: true, why: 'the two most recent transcript messages are BOTH from you — the previous paste has no report' }
    }
    return { outstanding: false, why: `tail ends [${a}, ${b}]` }
  } catch (e) {
    return { outstanding: false, why: `transcript unreadable: ${e.message} (indeterminate — treated as clear)` }
  } finally { if (fd !== undefined) { try { closeSync(fd) } catch { /* already closed */ } } }
}

// ── CHECK 2 — RESEARCH-WITH-NO-URLS ───────────────────────────────────────────────────────────────────────
// ⛔ THE ANTI-RUBBER-STAMP LEG IS THE THIRD ONE, and it is the reason this is not merely a presence check:
// at least one hostname must NOT already appear in LORAMER_DECISIONS.md. Re-citing URLs this repo has already
// banked is the cheapest possible fake research, and a bare "≥2 URLs" test rewards it. The ADR-enforcement
// literature's warning is precisely this — a rubber-stamped record that a later agent then cites as prior art.
export function researchVerdict(value, decisionsText) {
  const raw = String(value || '').trim()
  if (!raw) return { ok: false, why: 'RESEARCH: is absent' }
  const na = raw.match(/^NONE-APPLICABLE\s*:\s*(.+)$/is)
  if (na) {
    const n = words(na[1])
    return n >= MIN_NONE_APPLICABLE_WORDS
      ? { ok: true, why: `NONE-APPLICABLE with a ${n}-word reason`, noneApplicable: true }
      : { ok: false, why: `NONE-APPLICABLE carries only ${n} word(s); ${MIN_NONE_APPLICABLE_WORDS} are required — say why no external fact is load-bearing` }
  }
  const urls = [...raw.matchAll(/https?:\/\/[^\s<>()\[\]"']+/g)].map((m) => m[0])
  if (urls.length < 2) return { ok: false, why: `only ${urls.length} URL(s) present; 2 distinct sources are required` }
  const hosts = [...new Set(urls.map((u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }).filter(Boolean))]
  if (hosts.length < 2) return { ok: false, why: `${urls.length} URLs but only ${hosts.length} distinct hostname(s) — two pages of one vendor is one source` }
  const fresh = hosts.filter((h) => !decisionsText.includes(h))
  if (fresh.length === 0) return { ok: false, why: `every hostname (${hosts.join(', ')}) is already cited in LORAMER_DECISIONS.md — re-citing our own record is not research` }
  return { ok: true, why: `${urls.length} URL(s), ${hosts.length} hostname(s), ${fresh.length} not previously banked` }
}

// ── CHECK 3 — ADVERSARY-THAT-NEVER-COLLIDED ───────────────────────────────────────────────────────────────
// ⛔ STATED PLAINLY IN THE CODE BECAUSE IT MUST NOT BE FORGOTTEN AT THE CALL SITE: INDEPENDENCE IS NOT
// MACHINE-CHECKABLE AND NEVER WILL BE. Whether the two positions were formed separately and withheld until
// both existed is a fact about two conversations; this function sees one string. What it CAN establish is
// that both positions and a named collision are PRESENT and that the two positions are not the same text.
// A filled box here means "the artifact exists", never "the round happened".
export function adversaryVerdict(value) {
  const raw = String(value || '').trim()
  if (!raw) return { ok: false, why: 'ADVERSARY: is absent' }
  if (/DECLARED-COMPRESSED/i.test(raw)) {
    return { ok: false, why: 'DECLARED-COMPRESSED is not available on a writing blast radius — Russ, 2026-08-23: both rounds required, no compression, ever' }
  }
  const grab = (k) => { const m = raw.match(new RegExp(`${k}\\s*=\\s*([\\s\\S]*?)(?=(?:\\|\\s*(?:mine|other|collision)\\s*=)|$)`, 'i')); return m ? m[1].trim() : '' }
  const mine = grab('mine'), other = grab('other'), collision = grab('collision')
  const missing = [['mine', mine], ['other', other], ['collision', collision]].filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) return { ok: false, why: `missing ${missing.join(', ')} — the shape is mine=… | other=… | collision=…` }
  if (mine === other) return { ok: false, why: 'mine= and other= are the same text — that is one position stated twice, not a collision' }
  const n = words(collision)
  if (n < MIN_COLLISION_WORDS) return { ok: false, why: `collision= carries only ${n} word(s); ${MIN_COLLISION_WORDS} are required — name what actually changed` }
  return { ok: true, why: `both positions present and distinct, collision named in ${n} words` }
}

// ── CHECK 4 — CONSTANT-INHERITED-WITHOUT-DERIVATION ───────────────────────────────────────────────────────
// Every number must be followed by `⇐` and a real derivation, or `⇐ measured <date> N=<n>`. A bare number
// fails. This is the box that would have caught FIRST_LAP_MS = 90_000, "~67s fits in one cron fire", and the
// "~08-25 / ~08-30" Meta clock retired on 2026-08-23 — three constants that entered briefs as facts.
// ⛔ THE NONE FORMS. `/^NONE$/i` ALONE ACCEPTED THE HOLLOWEST ANSWER AND REFUSED A JUSTIFIED ONE — measured
// 2026-08-23 17:56:09Z and again at 17:57:13Z, when `CONSTANTS: NONE — skip-cache deliberately introduces no
// TTL; a number would have no derivation.` was refused while a bare `NONE` sailed through. That is the
// hollow-box-passes / substantive-box-fails inversion this whole enforcer exists to prevent, shipped inside
// the enforcer. ⛔ THE FIX ADDS AN ACCEPTED FORM; IT DOES NOT RELAX ANYTHING. The bare-number rule below is
// byte-identical, and a fixture proves a bare number still fails IN THE SAME RUN as a justified NONE passing.
// The separator must be real punctuation or a dash — `NONETHELESS we set RETRY=3` must NOT parse as a NONE,
// which is why \b and an explicit separator class are both required rather than a bare prefix test.
const NONE_RE = /^NONE\b\s*(?:[—–\-:,.]\s*(?<reason>.*))?$/is
export function constantsVerdict(value) {
  const raw = String(value || '').trim()
  if (!raw) return { ok: false, why: 'CONSTANTS: is absent — write NONE if the paste carries no numbers' }
  const none = raw.match(NONE_RE)
  if (none) {
    const reason = (none.groups?.reason || '').trim()
    // The justification is EVIDENCE, not decoration: it is returned so the caller can LOG it. A gate that
    // accepts a reason and discards it learns nothing from the pastes it lets through.
    return reason
      ? { ok: true, why: `declared NONE with a ${words(reason)}-word reason`, noneReason: reason }
      : { ok: true, why: 'declared NONE' }
  }
  const entries = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  const bad = []
  for (const e of entries) {
    const parts = e.split(/⇐|<=/)
    if (parts.length < 2) { bad.push(`"${e.slice(0, QUOTE_CHARS)}" has no ⇐ derivation`); continue }
    const derivation = parts.slice(1).join(' ').trim()
    if (/^measured\s+\d{4}-\d{2}-\d{2}\s+N=\d+/i.test(derivation)) continue
    const n = words(derivation)
    if (n < MIN_DERIVATION_WORDS) bad.push(`"${e.slice(0, QUOTE_CHARS)}" derivation is ${n} word(s); ${MIN_DERIVATION_WORDS} are required (or "measured <YYYY-MM-DD> N=<n>")`)
  }
  return bad.length ? { ok: false, why: bad.join(' · ') } : { ok: true, why: `${entries.length} constant(s), each derived` }
}

// ── THE EVALUATOR ─────────────────────────────────────────────────────────────────────────────────────────
export function evaluate({ text, transcriptPath, decisionsText }) {
  const h = parseHeader(text)
  const overrides = parseOverrides(text)
  const failures = []

  // ⛔ TAKE THE FIRST TOKEN. Russ declares blast radius the way ESSENCE's own PRE-ACTION GATE writes it —
  // `BLAST: backend-writer (repo tooling only — no app code, no schema)` — and matching the WHOLE value
  // rejects every real paste he has ever written. Caught by a dry-run against his actual instruction text,
  // not by review. The qualifier is kept as prose and only the declared radius is matched.
  const blastRaw = (h.BLAST || '').trim().toLowerCase().replace(/\(.*$/s, '').split(/[\s,;:]+/)[0] || ''
  const blast = BLAST_VALUES.get(blastRaw) ?? null
  const isFlight = String(text || '').length >= FLIGHT_MIN_CHARS || 'BLAST' in h || 'ROUND' in h

  // A short paste carrying no schema is conversation ("go", "push", "stop") and the gate has no opinion on it.
  if (!isFlight) return { verdict: 'allow', reason: '', failures: [], overrides, exempt: 'short conversational paste, no schema declared' }

  if (!blast) {
    failures.push({ box: 'BLAST-UNDECLARED', why: h.BLAST ? `BLAST: "${h.BLAST}" is not one of read-only | backend-writer | -next-only | live-path` : 'BLAST: is absent', fix: 'the FIRST word of the line must be exactly one of: read-only · backend-writer · -next-only · live-path. A parenthetical after it is fine — `BLAST: backend-writer (repo tooling only)` passes.' })
  }

  const q = (h.QUESTION || '').trim()
  const QFIX = `one line, at least ${MIN_QUESTION_WORDS} words, ending in a question mark — e.g. \`QUESTION: Does the fix hold across all six sites?\``
  if (!q) failures.push({ box: 'QUESTION-NEVER-FRAMED', why: 'QUESTION: is absent', fix: QFIX })
  else if (!q.endsWith('?')) failures.push({ box: 'QUESTION-NEVER-FRAMED', why: 'QUESTION: does not end in "?" — a statement is not a question', fix: QFIX })
  else if (words(q) < MIN_QUESTION_WORDS) failures.push({ box: 'QUESTION-NEVER-FRAMED', why: `QUESTION: is ${words(q)} word(s); ${MIN_QUESTION_WORDS} are required`, fix: QFIX })

  const inf = inFlightVerdict(transcriptPath)
  if (inf.outstanding) failures.push({ box: 'PASTE-WHILE-IN-FLIGHT', why: inf.why, fix: 'nothing to type — let the outstanding flight report, then re-send this paste unchanged. This is the ONE box that reads the transcript rather than your paste, so re-wording will not clear it.' })

  const c = constantsVerdict(h.CONSTANTS)
  if (!c.ok) failures.push({ box: 'CONSTANT-INHERITED-WITHOUT-DERIVATION', why: c.why, fix: `THREE accepted forms: (1) \`CONSTANTS: NAME=value ⇐ <at least ${MIN_DERIVATION_WORDS} words of derivation>\` · (2) \`CONSTANTS: NAME=value ⇐ measured YYYY-MM-DD N=<n>\` · (3) \`CONSTANTS: NONE\` alone OR with a reason after a dash, colon or comma — \`CONSTANTS: NONE — this flight asserts no numbers\` passes.` })

  // THE PROPORTIONALITY RULE. Both rounds are demanded by CONSEQUENCE, never by question-shape.
  if (writesSomething(blast)) {
    const r = researchVerdict(h.RESEARCH, decisionsText)
    if (!r.ok) failures.push({ box: 'RESEARCH-WITH-NO-URLS', why: r.why, fix: `TWO accepted forms: (1) \`RESEARCH: <url> · <url>\` — at least 2 URLs on at least 2 DIFFERENT hostnames, at least one hostname not already cited in LORAMER_DECISIONS.md · (2) \`RESEARCH: NONE-APPLICABLE: <at least ${MIN_NONE_APPLICABLE_WORDS} words saying why no external fact is load-bearing>\`` })
    const a = adversaryVerdict(h.ADVERSARY)
    if (!a.ok) failures.push({ box: 'ADVERSARY-THAT-NEVER-COLLIDED', why: a.why, fix: `ONE accepted form, all three parts on one line: \`ADVERSARY: mine=<your position> | other=<the opposing position> | collision=<what actually changed, ${MIN_COLLISION_WORDS}+ words>\`. mine= and other= must differ. There is NO compressed form on a writing blast radius.` })
  }

  // Apply per-box overrides. An INVALID override (unknown box or a short reason) does not lift anything.
  const applied = []
  const surviving = failures.filter((f) => {
    const ov = overrides.find((o) => o.box === f.box && o.valid)
    if (ov) { applied.push({ ...ov, was: f.why }); return false }
    return true
  })

  return { verdict: surviving.length ? 'block' : 'allow', failures: surviving, overrides, applied, blast, header: h, inFlight: inf, noneReason: c.noneReason || null }
}

// ── THE REFUSAL, IN ENGLISH ───────────────────────────────────────────────────────────────────────────────
// One line per failed box · one line saying what would satisfy it · one line with the exact override phrase.
// ⛔ THE ECHO IS GONE, AND IT WAS REMOVED ON A MEASUREMENT RATHER THAN A PREFERENCE. It was added because the
// docs say EXIT 2 erases the prompt and say NOTHING about decision:"block" — an unproven preservation is not
// a preservation, so it failed safe. OBSERVED 2026-08-23 17:56:09Z on a real refusal: Claude Code's own block
// notice appends `Original prompt: <full text>` after the hook's reason. **The harness preserves the paste
// itself.** The echo therefore doubled a phone-length instruction — that refusal ran to 8,891 characters,
// most of it Russ's paste twice — which buries the one thing he needed to read. A one-line pointer replaces it.
export function renderRefusal(res, meta) {
  const L = []
  L.push('⛔ PROTOCOL GATE — REFUSED. Nothing ran. Your paste is echoed at the bottom; copy it back up.')
  L.push('')
  L.push(`FAILED ${res.failures.length} BOX(ES):`)
  for (const f of res.failures) {
    L.push(`· ${f.box} — ${f.why}`)
    L.push(`  TO SATISFY: ${f.fix}`)
    L.push(`  TO OVERRIDE: OVERRIDE ${f.box}: <at least ${MIN_OVERRIDE_WORDS} words saying why this one is skipped>`)
  }
  if (res.applied?.length) {
    L.push('')
    L.push(`ACCEPTED OVERRIDES (logged): ${res.applied.map((a) => a.box).join(', ')}`)
  }
  const bad = (res.overrides || []).filter((o) => !o.valid)
  if (bad.length) {
    L.push('')
    for (const o of bad) L.push(`⚠ OVERRIDE ${o.box} NOT ACCEPTED — ${BOXES.includes(o.box) ? `the reason is ${words(o.reason)} word(s); ${MIN_OVERRIDE_WORDS} are required` : 'that is not one of the box names'}`)
  }
  L.push('')
  L.push(`THE SCHEMA (top of the paste): ${KEYS.join(' · ')}`)
  L.push('RESEARCH and ADVERSARY are required only when BLAST is not read-only — rounds attach to consequence.')
  if (meta?.promptKey) L.push(`[gate: read the paste from the "${meta.promptKey}" field]`)
  L.push('')
  L.push('YOUR PASTE IS NOT LOST — it is reproduced under "Original prompt:" directly below this refusal.')
  return L.join('\n')
}

// ── THE APPEND-ONLY OVERRIDE LOG ──────────────────────────────────────────────────────────────────────────
// ⛔ prompt_sha256, NEVER THE PASTE. A paste can carry a token, a connection string, a customer's name. The
// hash proves WHICH paste an override belonged to without storing any of it.
// ⛔ `prev` CHAINS EACH LINE TO THE ONE BEFORE IT. Git diff alone is not tamper-evidence on a solo repo —
// a rewritten line is just a diff. The chain makes an edited or removed line arithmetically detectable, and
// the guard's monotonic baseline makes a deletion fail the build. Break-glass practice, verbatim: log the
// activation, the actions and the reason in a tamper-evident store, and review every event afterwards.
// ⛔ IT LOGS REFUSALS NOW, NOT ONLY OVERRIDES — AND THAT WAS THE BLIND SPOT, NOT A NICETY. On 2026-08-23 the
// gate refused Russ twice, 64 seconds apart, for a justified NONE it should have accepted, and left NO REPO
// ARTIFACT AT ALL: the log was 0 lines because it recorded only ACCEPTED overrides. The only surviving trace
// was the session transcript, which is not in the repo and dies with the session. **A gate that refuses
// invisibly cannot report its own false-positive rate**, so the one number that would say whether it is
// helping — refusals it should not have made — was structurally unmeasurable. Three record kinds now:
//   'refused'        — every block, with the boxes that failed. THE FALSE-POSITIVE DENOMINATOR.
//   'override'       — as before: a box skipped on purpose, with the reason that cost something to type.
//   'none_justified' — an ACCEPTED paste whose CONSTANTS carried a reason. Evidence, kept rather than binned.
// ⛔ prompt_sha256 ON ALL THREE, NEVER THE PASTE — a paste can carry a token or a customer's name.
export function appendLog({ records, sessionId, text, root }) {
  if (!records?.length) return 0
  const p = resolve(root, LOG_REL)
  try { mkdirSync(dirname(p), { recursive: true }) } catch { /* already there */ }
  let prev = 'genesis'
  try {
    if (existsSync(p)) {
      const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim())
      if (lines.length) prev = sha256(lines[lines.length - 1])
    }
  } catch { /* an unreadable log must not stop the gate; the guard reports on the log itself */ }
  let n = 0
  for (const r of records) {
    const rec = {
      ts: new Date().toISOString(),
      session_id: sessionId || null,
      machine: hostname(),
      prompt_sha256: sha256(text),
      ...r,
      prev,
    }
    const line = JSON.stringify(rec)
    appendFileSync(p, line + '\n', 'utf8')
    prev = sha256(line)
    n += 1
  }
  return n
}

// ── ENTRY POINT — TOTAL FUNCTION ──────────────────────────────────────────────────────────────────────────
function emitBlock(reason) { process.stdout.write(JSON.stringify({ decision: 'block', reason })); process.exit(0) }
function emitAllow() { process.exit(0) }

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let input = {}
  try { input = JSON.parse(raw || '{}') } catch (e) { return emitBlock(`⛔ PROTOCOL GATE — internal fault, refusing rather than admitting: hook stdin was not JSON (${e.message}). Fail-closed by design.`) }

  // ⛔ THE VENDOR DOCS NAME THIS FIELD BOTH WAYS ("prompt" in the guide, "user_input" in the reference) and
  // the two pages disagree. Reading both is not defensive padding — it is the only correct response to a
  // contract that is ambiguous in its own documentation, and the resolved key is reported in the refusal so
  // the first real refusal settles it from observation instead of from a doc.
  let promptKey = null
  for (const k of ['prompt', 'user_input', 'userInput', 'message']) {
    if (typeof input[k] === 'string' && input[k].length) { promptKey = k; break }
  }
  const text = promptKey ? input[promptKey] : ''
  if (!text) return emitAllow() // nothing to grade

  let decisionsText = ''
  try { decisionsText = readFileSync(resolve(ROOT, 'LORAMER_DECISIONS.md'), 'utf8') } catch { decisionsText = '' }

  const res = evaluate({ text, transcriptPath: input.transcript_path, decisionsText })

  const common = { round: res.header?.ROUND || null, question: res.header?.QUESTION || null, blast: res.header?.BLAST || null }
  const records = []
  for (const a of res.applied || []) records.push({ verdict: 'override', box: a.box, reason: a.reason, ...common })
  if (res.noneReason) records.push({ verdict: 'none_justified', reason: res.noneReason, ...common })
  if (res.verdict === 'block') records.push({ verdict: 'refused', boxes_failed: res.failures.map((f) => f.box), ...common })

  // ⛔ THE TWO FAILURE MODES ARE NOT THE SAME AND ARE NOT TREATED THE SAME. An unloggable OVERRIDE must refuse
  // — an override nobody can audit is the thing this gate exists to prevent. An unloggable REFUSAL must NOT
  // change the verdict: the paste is already being refused, and turning a logging fault into a second refusal
  // would tell Russ his paste was wrong when it was the disk that failed.
  try { appendLog({ records, sessionId: input.session_id, text, root: ROOT }) }
  catch (e) {
    if ((res.applied || []).length) return emitBlock(`⛔ PROTOCOL GATE — an override was accepted but COULD NOT BE LOGGED (${e.message}). An unlogged override is exactly the thing this gate exists to prevent, so it refuses instead.`)
    console.error(`[protocol-gate] log write failed (verdict unchanged): ${e.message}`)
  }

  if (res.verdict === 'block') return emitBlock(renderRefusal(res, { text, promptKey }))
  return emitAllow()
}

// Only run as a hook when executed directly; the guard imports this file for its fixtures.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('protocol-gate.mjs')
if (invokedDirectly) {
  main().catch((e) => {
    // ⛔ THE LAST LINE OF FAIL-CLOSED DEFENCE. Anything that escaped every inner catch lands here and still
    // refuses. The vendor default for an unhandled non-zero exit is to PROCEED, so throwing is admitting.
    try { process.stdout.write(JSON.stringify({ decision: 'block', reason: `⛔ PROTOCOL GATE — internal fault, refusing rather than admitting: ${e?.stack || e}. Fail-closed by design; fix scripts/protocol-gate.mjs.` })) } catch { /* stdout is gone; nothing further is possible */ }
    process.exit(0)
  })
}
