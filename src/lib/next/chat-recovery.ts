// LORAMER_CHAT_ANSWER_RECOVERY_V1 — pure decision logic, extracted so Gate-A drives the REAL
// functions rather than a port of them. No fetch, no React, no timers.

// WEB-FIRST (LORAMER_WEB_FIRST_DIAGNOSIS_V1, verified 2026-07-26): on iOS Safari an aborted fetch does
// NOT reliably reject with a DOMException named 'AbortError'. WebKit surfaces a generic
// `TypeError: Load failed` for aborts AND for real network failures, so the two are INDISTINGUISHABLE
// by the error object — which is exactly why Russ saw the "connection dropped" copy on a turn the
// server completed. The authoritative signal is the AbortSignal we own. Read it FIRST; the name checks
// are a fallback for a signal we somehow do not hold. NEVER string-match the message to decide this.
export function classifyTurnFailure(signalAborted: boolean | undefined, err: unknown): 'aborted' | 'network' {
  if (signalAborted === true) return 'aborted'
  const name = err && typeof err === 'object' ? (err as { name?: string }).name : undefined
  if (name === 'AbortError' || name === 'TimeoutError') return 'aborted'
  return 'network'
}

export type ConvRow = { id?: number; role?: string; content?: string }
export type Recovery =
  | { status: 'found'; text: string; maxId: number }
  | { status: 'none' | 'ambiguous' | 'unavailable'; maxId: number }

// There is NO turn id (that needs a schema change — out of scope). The discriminator is a MONOTONIC
// WATERMARK: the max conversation row id known before the turn was sent. Any assistant row with a
// HIGHER id was written after we asked, so an older turn can never be re-rendered as this one.
// HONEST LIMIT, stated rather than engineered around: a watermark is not a turn id. If a SECOND tab
// asked the same client a question in the same window, its answer would also clear the watermark.
// That case is DETECTABLE — more than one new assistant row — and it is REFUSED, never guessed.
export function pickRecoveredAnswer(rows: ConvRow[], sinceId: number): Recovery {
  if (!Array.isArray(rows) || typeof sinceId !== 'number') return { status: 'unavailable', maxId: sinceId }
  const ids = rows.map((r) => Number(r?.id)).filter((n) => Number.isFinite(n))
  const maxId = ids.length ? Math.max(...ids) : sinceId
  const fresh = rows.filter((r) => r?.role === 'assistant' && Number(r.id) > sinceId && typeof r.content === 'string' && r.content.trim())
  if (fresh.length === 1) return { status: 'found', text: fresh[0].content as string, maxId }
  if (fresh.length > 1) return { status: 'ambiguous', maxId }
  return { status: 'none', maxId }
}

// LAW APPLIED (LORAMER_CHAT_SERVER_TURN_WRITE_V1): since the server persists the assistant turn from
// inside its own completion path, NO client string may assert the answer was lost — the client cannot
// know that, and since slice 1 it is false on every path where the server got far enough. None of
// these invite a re-ask: a re-ask costs a full turn (~$0.50 measured 2026-07-26) and the answer is
// very likely already saved.
// ⛔ D5 SWEEP, 2026-08-05 — WHAT MAY AND MAY NOT REACH A USER, decided one string at a time rather than
// as a rule nobody re-reads. THE TEST: does this sentence tell the user something about THEIR question,
// or about OUR machinery? The first is an answer; the second is a leak.
//   CHECKING             — RENDERABLE. About their turn, in Lora's voice, no jargon, no instruction.
//   ABORTED_UNCONFIRMED  — RENDERABLE. States what happened and what was NOT done (not re-sent), which is
//                          the thing a user actually needs to know.
//   NETWORK_UNCONFIRMED  — RENDERABLE. Same shape; names the billing consequence in their terms.
//   SERVER_ERROR         — RENDERABLE. Plain, owns the failure, invites nothing impossible.
//   AMBIGUOUS_*          — ⛔ NOT RENDERABLE. See the note on it below.
// ⚠ NOTHING ELSE IN THE CHAT PATH PUTS A CONSTANT ON SCREEN: the only other user-facing strings in
// use-lora-chat.ts are the four inline branches on `d.error` ('I can't access this client's data from
// here', the Anthropic-overloaded sentence, and the two above), all of which pass the same test.
export const COPY = {
  // VOICE: this is Lora talking, not the client narrating its own transport. No "panel" (there isn't
  // one on a page), no "connection dropped before I got an answer back", no invitation to re-ask.
  // Still bound by the same law: never claim an answer was lost — the client cannot know that.
  CHECKING: 'Still working on this one. Let me check whether the answer came through…',
  ABORTED_UNCONFIRMED: 'This one is taking longer than usual. If Lora finished, her answer will be here when you come back — I haven\u2019t re-sent your question.',
  NETWORK_UNCONFIRMED: 'I couldn\u2019t reach Lora just then. Your question wasn\u2019t re-sent, so nothing was charged twice.',
  // ⛔ RETIRED FROM THE RENDER PATH 2026-08-05 (LORAMER_CHAT_SCREEN_TRACKS_SERVER_V1, D5). It REACHED A
  // USER on 2026-08-05 and it should never have been renderable: it explains OUR machinery to someone who
  // did not ask about it, and then asks THEM to do the work of finding their own answer. On ambiguity the
  // surface now re-reads and RENDERS the thread — the answers are all present and in order, so showing
  // them is both more honest and more useful than narrating our uncertainty.
  // ⚠ KEPT AS A CONSTANT, NOT DELETED: `pickRecoveredAnswer` still RETURNS status 'ambiguous' and that is
  // correct — refusing to guess is the right decision, and this string is the record of why the branch
  // exists. A guard asserts it is never rendered. Deleting it would hide the reasoning; rendering it is
  // the defect.
  AMBIGUOUS_INTERNAL_DO_NOT_RENDER: 'More than one new answer exists on this client; the surface re-reads and renders the thread rather than guessing.',
  // THE 500 PATH. Added 2026-07-27: a definite server error was rendering as NETWORK_UNCONFIRMED — a
  // connection story for a turn where the connection was fine and the server answered with a 500.
  SERVER_ERROR: 'Something went wrong on my end — Lora never got to answer. Try again when you\u2019re ready.',
}
// ⛔ LORAMER_RECOVERY_WINDOW_COVERS_THE_SERVER_V1 — 90_000 → 500_000, AND THE NUMBER IS NOT THE ONE I WAS GIVEN.
// THE BRIEF SAID 450_000 AND SPOTTED ITS OWN PROBLEM: 450s exceeds CHAT_TOTAL_MS (440_000). But the fix is not
// to shave it under the client deadline — that reads the wrong bound. **THE RECOVERY POLL RUNS AFTER THE CLIENT
// HAS ALREADY GIVEN UP.** Its job is to find an answer the SERVER may still be writing, so the bound it must
// clear is the SERVER's ceiling — `maxDuration = 500` on /api/chat — not the client's own 440s abort.
// ⛔ AND THE WINDOW STARTS WHEN THE FETCH FAILED, WHICH IS NOT ALWAYS AT 440s. A network drop at t=10s enters
// recovery with ~490s of server work still ahead of it; a deadline abort enters at 440s with ~60s ahead. Sizing
// to the client deadline covers only the second case. 500_000 covers both by construction: it equals the longest
// the server can still be running, measured from the earliest moment recovery can begin.
// MEASURED THIS SESSION, 22 paired turns: p50 87s · p90 281s · max 365s. The old 90s window cleared p50 and
// missed p90 by 3.1× — the 2026-08-06 22:03 loss was a 234s turn, 144s past that window.
// ⚠ THE POLL COUNT IS THE COST AND IT IS STATED RATHER THAN DISCOVERED: 500_000 / 5_000 = **up to 100 reads of
// /api/conversations per recovered turn**, worst case. RECOVERY_POLL_MS IS DELIBERATELY UNCHANGED — the reads are
// cheap indexed queries on the recovery path only (not the happy path), the loop exits the moment the answer
// lands (a p90 turn stops at ~56 polls), and widening the interval would delay the answer the user is waiting
// for. Reported, not silently tuned.
export const RECOVERY_WINDOW_MS = 500_000
export const RECOVERY_POLL_MS = 5_000
