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
export const COPY = {
  // VOICE: this is Lora talking, not the client narrating its own transport. No "panel" (there isn't
  // one on a page), no "connection dropped before I got an answer back", no invitation to re-ask.
  // Still bound by the same law: never claim an answer was lost — the client cannot know that.
  CHECKING: 'Still working on this one. Let me check whether the answer came through…',
  ABORTED_UNCONFIRMED: 'This one is taking longer than usual. If Lora finished, her answer will be here when you come back — I haven\u2019t re-sent your question.',
  NETWORK_UNCONFIRMED: 'I couldn\u2019t reach Lora just then. Your question wasn\u2019t re-sent, so nothing was charged twice.',
  AMBIGUOUS: 'There\u2019s more than one new answer on this client and I won\u2019t guess which is yours. Scroll up to see the full thread.',
  // THE 500 PATH. Added 2026-07-27: a definite server error was rendering as NETWORK_UNCONFIRMED — a
  // connection story for a turn where the connection was fine and the server answered with a 500.
  SERVER_ERROR: 'Something went wrong on my end — Lora never got to answer. Try again when you\u2019re ready.',
}
export const RECOVERY_WINDOW_MS = 90_000
export const RECOVERY_POLL_MS = 5_000
