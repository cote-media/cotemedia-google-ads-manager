// LORAMER_CHAT_STREAMING_V1 — ONE reader for BOTH modes. It branches on the RESPONSE's own content-type, never on
// a build-time constant, so the LORA_CHAT_STREAMING flag can be flipped or reverted server-side with no client
// redeploy — and with the flag off this function's behavior is byte-identical to the res.json() path it replaces.
// Returns the same shape the callers already consume, so no call site changes how it renders.
// TIMERS — REVISED 2026-07-26 against MEASURED production durations, not estimates.
// The 45s idle gap and the 120s total were both FALSIFIED in production on 2026-07-26: real turns on
// Veterinary mastermind ran 78.2s, 105.3s and 125.6s server-side (user row -> awaited spend row), and
// the 125.6s turn exceeded even the total cap. The 45s figure assumed a tool round-trip plus model
// thinking fits in 45s of silence; a 71,857-token multi-tool Opus 5 turn does not.
// TOTAL 240s: 1.91x the worst measured turn (125.6s), and deliberately UNDER the route's
// maxDuration of 300s so the SERVER stays the limiter and the client never sits waiting on a lambda
// that has already been killed.
// IDLE 150s: we have NO per-event gap instrumentation, so the only defensible bound is that a silent
// stretch cannot exceed the whole turn — hence idle >= the longest turn measured (125.6s), rounded up.
// Stated plainly rather than implied: 150 is DERIVED from the total-turn bound, not measured directly.
export const CHAT_IDLE_GAP_MS = 150_000
export const CHAT_TOTAL_MS = 240_000

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
