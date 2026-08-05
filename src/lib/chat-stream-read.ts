// LORAMER_CHAT_STREAMING_V1 — ONE reader for BOTH modes. It branches on the RESPONSE's own content-type, never on
// a build-time constant, so the LORA_CHAT_STREAMING flag can be flipped or reverted server-side with no client
// redeploy — and with the flag off this function's behavior is byte-identical to the res.json() path it replaces.
// Returns the same shape the callers already consume, so no call site changes how it renders.
// TIMERS — REVISED 2026-07-26 against MEASURED production durations, not estimates.
// The 45s idle gap and the 120s total were both FALSIFIED in production on 2026-07-26: real turns on
// Veterinary mastermind ran 78.2s, 105.3s and 125.6s server-side (user row -> awaited spend row), and
// the 125.6s turn exceeded even the total cap. The 45s figure assumed a tool round-trip plus model
// thinking fits in 45s of silence; a 71,857-token multi-tool Opus 5 turn does not.
// ⛔ TOTAL RAISED 240s → 440s ON 2026-08-05 (LORAMER_CHAT_DEADLINE_GAP_CLOSED_V1), AND THE REASON IS A
// DESTINATION CHANGE, NOT A TUNING PASS. The old value's argument — 1.91× the worst measured turn, and
// deliberately UNDER the route so a slow turn fails at a KNOWN bound rather than an unknown gateway
// limit — was internally sound and is SUPERSEDED by LORAMER_NARRATED_LENGTH_BEATS_SILENT_SPEED_V1
// (Russ): a long turn is fine, and good, PROVIDED the screen narrates the work; silence is the defect,
// not length. **A turn that fails at a known bound is still a turn the user did not get.**
//
// ⛔ WHAT THE OLD NUMBER ACTUALLY COST, MEASURED, not argued: the 2026-08-05 20:01Z turn ran 281s
// server-side, COMPLETED, was persisted, and was paid for in full — 66,617 input + 32,523 cache-create
// + 65,046 cache-read + 9,547 output tokens — and the client threw it away at 240s. The gap was not a
// safety margin. It was waste. A longer leash adds ZERO tokens; it only stops us discarding answers we
// have already bought.
//
// ⛔ THE ONE INVARIANT THAT IS NOT NEGOTIABLE AND IS NOW GUARDED (one-working-indicator.guard.mjs's
// sibling, chat-deadline-margin.guard.mjs): **CHAT_TOTAL_MS MUST STAY STRICTLY BELOW THE ROUTE'S
// maxDuration.** If the client outlives the server it sits waiting on a lambda that is already dead,
// and — worse — the recovery poll has nothing to recover INTO, because the server never gets to write
// the answer the poll goes looking for. 440s client vs 500s route keeps the same 60s margin the old
// pair had, deliberately.
//
// IDLE 150s — UNCHANGED, and it is the timer that still does the real safety work now that the total is
// generous: with streaming ON (proven in production 2026-08-05, `streaming: true` in the route's own
// `[chat] cache:` log) every frame re-arms it, so a live turn never trips it while a genuinely dead
// connection is caught in 150s rather than 440s. Raising the total does NOT slow down failure detection
// on a dead socket; it only stops a HEALTHY long turn being killed.
export const CHAT_IDLE_GAP_MS = 150_000
export const CHAT_TOTAL_MS = 440_000

export type ChatRead = { ok: boolean; status: number; response?: string; error?: string; model?: string; onStatus?: never }

export async function readChatResponse(
  res: Response,
  onEvent?: (event: string, data: any, live: string) => void,
): Promise<ChatRead> {
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/event-stream')) {
    const d = await res.json().catch(() => ({} as any))
    return { ok: res.ok, status: res.status, response: d.response, error: d.error, model: d.model }
  }
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let answer: string | undefined
  let model: string | undefined
  let errored: string | undefined
  let live = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const frames = buf.split('\n\n')
    buf = frames.pop() || ''
    for (const f of frames) {
      const ev = /^event: (.+)$/m.exec(f)?.[1]
      const raw = /^data: (.*)$/m.exec(f)?.[1]
      if (!ev || raw == null) continue
      let data: any = {}
      try { data = JSON.parse(raw) } catch { continue }
      if (ev === 'answer') { answer = data.text; model = data.model }
      else if (ev === 'delta' && typeof data.text === 'string') live += data.text
      else if (ev === 'tool') live = '' // preamble was narration, not answer — drop it from the live buffer
      else if (ev === 'error') errored = data.error
      onEvent?.(ev, data, live)
    }
  }
  if (errored) return { ok: false, status: 200, error: errored }
  return { ok: true, status: 200, response: answer, model }
}
