#!/usr/bin/env node
// LORAMER_CHAT_STREAM_THE_ANSWER_V1 — WHAT THE WAIT IS ALLOWED TO SAY, AND HOW FAST IT MAY CHANGE.
//
// ⛔ ALL THREE LEGS COME FROM ONE MEASURED TURN (2026-08-06, frame probe, 151 frames, 364.6s):
//   S1 — the last 88 seconds carried ~12,000 characters of REAL ANSWER TEXT, every ~717ms, and the
//        screen painted NONE of it. The answer was on the wire while the user watched a static line.
//   S2 — tool frames arrive in bursts 0-2ms apart (seq 11→12 was ONE millisecond) into a single-slot
//        status, so every subject but the last of each burst was displayed for about a millisecond.
//        Russ saw 3 subjects on a turn that emitted at least 5.
//   S3 — the 107-second composing gap carries NO frame of any kind, so there is nothing truthful to
//        report from the stream, and the standing rule forbids inventing something.
//
// ⛔ THE RULE THIS FILE EXISTS TO KEEP: EVERY VISIBLE THING REFLECTS REAL WORK THAT ACTUALLY HAPPENED.
// No timer, no spinner implying progress, no canned reassurance. A fake progress line is a lie that
// also destroys the trust the real one buys (★CHAT-STATUS-INDICATOR, standing).
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const findings = []

const HOOK = 'src/lib/next/use-lora-chat.ts'
const SUBJECT = 'src/lib/chat/tool-subject.ts'
const THREAD = 'src/components/redesign/LoraThread.tsx'
// ⛔ COMMENTS STRIPPED. All three files now carry prose quoting the defect — including the words
// "Working…" and the measured millisecond figures. A guard reading the quotation instead of the code
// would report the very defect it exists to prevent. Bitten four times in three days.
const strip = (s) => s.split('\n').filter((l) => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

// ── (S1) THE DELTA STREAM MUST REACH THE SCREEN ───────────────────────────────────────────────────
{
  const hook = strip(read(HOOK))
  const thread = strip(read(THREAD))
  if (!/setStreamingText\(live\)/.test(hook)) {
    findings.push(`(S1) ${HOOK} does not push the reader's accumulated delta text into state. MEASURED 2026-08-06: ~12,000 characters of the real answer arrived over the final 88 seconds of a 365-second turn and the screen painted none of it. The answer was already on the wire.`)
  }
  if (!/streamingText/.test(thread) || !/ReactMarkdown[\s\S]{0,80}streamingText/.test(thread)) {
    findings.push(`(S1) ${THREAD} never RENDERS the streaming text. Carrying it in state and not drawing it is the same dead screen with more machinery behind it.`)
  }
  // ⛔ IT MUST BE A PREVIEW, NOT A SECOND SOURCE OF TRUTH. The `answer` event stays authoritative and
  // the preview must be discarded when it lands — otherwise a partial render could outlive the real one.
  if (!/setStreamingText\(''\)/.test(hook)) {
    findings.push(`(S1) the streaming preview is never cleared. It must be discarded when the authoritative \`answer\` arrives and on every turn boundary, or a partial answer can outlive the real one — which would make the stream a second source of truth rather than a preview.`)
  }
  // ONE INDICATOR PER TURN still holds: the mark and the streaming bubble may never both render.
  if (/streamingText/.test(thread) && !/streamingText \?/.test(thread)) {
    findings.push(`(S1) the streaming bubble is not mutually exclusive with <LoraWorking>. One working indicator per turn (LORAMER_ONE_WORKING_INDICATOR_PER_TURN_V1) — a mark and a half-written answer on screen together is two.`)
  }
}

// ── (S2) CONCURRENT SUBJECTS AGGREGATE, AND NOTHING IS REPLACED UNREADABLY FAST ───────────────────
{
  const hook = strip(read(HOOK))
  const subj = strip(read(SUBJECT))
  if (!/export function aggregateSubjects/.test(subj)) {
    findings.push(`(S2) ${SUBJECT} exports no aggregateSubjects. Tool frames arrive 0-2ms apart and a single-slot status shows only the winner — measured, 3 subjects seen on a turn that emitted at least 5.`)
  }
  if (!/aggregateSubjects\(/.test(hook)) {
    findings.push(`(S2) ${HOOK} does not aggregate concurrent tool subjects; it still overwrites.`)
  }
  // ⛔ THE COUNT MUST BE THE REAL COUNT. A rounded or capped count is the same class of untruth as a
  // fake progress bar — it reports work that did not happen, or hides work that did.
  if (/export function aggregateSubjects/.test(subj) && !/rest\.length/.test(subj)) {
    findings.push(`(S2) the aggregate line does not derive its count from the actual number of active subjects. If five sources are being read it must say five — no rounding, no "several", no silent cap.`)
  }
  if (!/MIN_SUBJECT_MS/.test(subj) || !/MIN_SUBJECT_MS/.test(hook)) {
    findings.push(`(S2) there is no minimum readable interval. A subject replaced 1ms after it appears was never shown at all, which is what the probe recorded.`)
  }
  const m = /export const MIN_SUBJECT_MS = (\d+)/.exec(subj)
  if (m && Number(m[1]) < 800) {
    findings.push(`(S2) MIN_SUBJECT_MS is ${m[1]}ms — below a readable floor. The measured failure was 1ms; a floor that does not clear ~800ms does not fix it.`)
  }
}

// ── (S3) NOTHING ON SCREEN MAY BE INVENTED ────────────────────────────────────────────────────────
// Every status string must originate in an EMITTED FRAME (a `status` label, or a subject rendered from
// a real tool_use). A timer, an interval, or a hardcoded reassurance is the banned shape.
{
  const hook = strip(read(HOOK))
  // A setInterval anywhere in the hook is the fake-progress shape by construction.
  if (/setInterval\s*\(/.test(hook)) {
    findings.push(`(S3) ${HOOK} uses setInterval. A status driven by a clock rather than by an emitted frame is fake progress — banned by ★CHAT-STATUS-INDICATOR, and the 107-second composing gap MEASURED 2026-08-06 carries no frame precisely because there is nothing real to report there.`)
  }
  // Every setStreamStatus argument must be a frame-derived value, never a bare string literal.
  for (const mm of hook.matchAll(/setStreamStatus\(\s*(['"`])([^'"`]*)\1/g)) {
    findings.push(`(S3) ${HOOK} sets the status to the LITERAL "${mm[2]}". Every visible string must come from an emitted frame — a status label, or a subject rendered from a real tool invocation. A constant on screen is a claim nothing made.`)
  }
}

if (findings.length) {
  console.error(`[chat-status-truthful] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[chat-status-truthful] PASS — the delta stream renders as a discarded preview mutually exclusive with the working mark, concurrent subjects aggregate with a real count behind a readable floor, and no status string is invented from a clock or a literal. ⛔ NOT ASSERTED: that the wording is right — copy is Russ\'s. LORAMER_CHAT_STREAM_THE_ANSWER_V1')
