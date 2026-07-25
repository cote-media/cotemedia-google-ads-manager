// LORAMER_CHAT_STREAMING_V1 — ONE reader for BOTH modes. It branches on the RESPONSE's own content-type, never on
// a build-time constant, so the LORA_CHAT_STREAMING flag can be flipped or reverted server-side with no client
// redeploy — and with the flag off this function's behavior is byte-identical to the res.json() path it replaces.
// Returns the same shape the callers already consume, so no call site changes how it renders.
// IDLE-GAP TIMEOUT, not total-duration: a streamed turn has no meaningful total bound (a legitimate multi-tool
// answer can run minutes), but a DEAD one stops producing bytes. 45s of silence is the failure signal — generous
// enough for a slow tool round-trip plus model thinking, short enough that a truly dropped connection is caught.
// The non-streaming path keeps the original 120s total cap, unchanged.
export const CHAT_IDLE_GAP_MS = 45_000
export const CHAT_TOTAL_MS = 120_000

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
