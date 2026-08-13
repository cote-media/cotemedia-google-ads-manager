// LORAMER_CHAT_TURN_FAILED_DURABLE_V1 — the client half of the durable failed-turn instrument.
//
// Mirrors log-conversation-turn.ts EXACTLY in posture: fire-and-forget, never awaited by the turn,
// wrapped in try/catch, the fetch's rejection swallowed, never throws. A failed telemetry POST must
// never break — or delay — a chat turn; and on a dead network the report route is unreachable exactly
// when turns are failing, so the swallow IS the design: one shot, no retry, no queue, no backlog.
//
// ⛔ NO QUESTION TEXT, NO ANSWER TEXT. The record is failure METADATA (branch, error name/message,
// timings, correlation key). Guard leg 7b drives this module through `fetchImpl` and fails the build
// if a text field ever rides along.
//
// THREE CALLERS in use-lora-chat, correlated by `correlationKey`:
//   turn-failed       — the catch: what threw, whether our own abort fired (beside the console line,
//                       which stays for local dev)
//   recovery-verdict  — what the 90s in-turn poll concluded: found / ambiguous / nothing
//   mount-recovery    — the died-browser class's only witness: what the next mount found
// recovered='nothing' IS "asked and got nothing" — the exact question the pair-write trade deferred here.

export type TurnFailureReport = {
  clientId?: string | null
  surface: string
  phase: 'turn-failed' | 'recovery-verdict' | 'mount-recovery'
  branch?: string | null
  errName?: string | null
  errMessage?: string | null
  signalAborted?: boolean
  elapsedMs?: number
  correlationKey: string
  recovered?: 'found' | 'ambiguous' | 'nothing' | null
}

// fetchImpl is injectable ONLY so the guard can drive the real function with a capturing / throwing
// fetch; it defaults to the global fetch in the browser. Returns void — nothing to await.
export function reportTurnFailure(r: TurnFailureReport, fetchImpl?: typeof fetch): void {
  try {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined)
    if (!f) return
    void f('/api/debug/turn-failed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: 'chat-turn-failed', ...r }),
    }).catch(() => { /* swallow — telemetry must never surface to the user or block the turn */ })
  } catch { /* never throw into the chat turn */ }
}
