// LORAMER_NEXT_CONV_WRITE_V1 — the -next client-side conversation writer. Closes the -next WRITE ISLAND: the
// redesign chat (ChatLauncher) held its turns only in React state and never persisted them, so a -next
// conversation reached no other surface and never entered Lora's cross-surface memory recap. This POSTs each
// turn to the EXISTING /api/conversations endpoint — the SAME write path the legacy surfaces use. NO new table,
// NO new endpoint, NO second write path; the server attaches user_email + validates role.
//
// FAILURE POSTURE — mirrors the L2 instrument (src/lib/lora-tool-log.ts) EXACTLY: fire-and-forget. Never awaited
// by the chat turn, wrapped in try/catch, the fetch's rejection swallowed, never throws. A failed conversation
// log MUST NEVER break a chat turn. (Legacy AWAITED these writes; this is strictly safer.)

// The single -next chat surface value. -next mounts ONE ChatLauncher (Shell.tsx) with ONE message thread,
// opened by the "Ask Lora" pill, the mobile Lora tab, and the platform drill-row ✦ — all the SAME conversation.
// So it is ONE surface, distinct from every legacy value (ask-claude-tab / right-panel / insight-chat). A
// drill-focused turn is marked on `scope`, NOT a second surface, so one visible thread stays one surface (the
// per-surface Clear/DELETE and the surface:scope recap keying both depend on that).
export const NEXT_CHAT_SURFACE = 'next-ask-lora'

export type NextConvTurn = {
  clientId?: string
  role: 'user' | 'assistant'
  content: string
  scope?: string | null   // 'drill' when the turn carried a platform drill-row rowContext; null otherwise
}

// fetchImpl is injectable ONLY so Gate-A can drive the real function with a capturing / failing fetch; it
// defaults to the global fetch in the browser. Returns void — nothing to await, nothing to surface.
export function logNextConversationTurn(turn: NextConvTurn, fetchImpl?: typeof fetch): void {
  try {
    if (!turn.clientId || !turn.content) return   // no client to attach to (portfolio Shell), or empty — skip
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined)
    if (!f) return
    void f('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: turn.clientId,
        surface: NEXT_CHAT_SURFACE,
        scope: turn.scope ?? null,
        role: turn.role,
        content: turn.content,
      }),
    }).catch(() => { /* swallow — a failed log must never surface to the user or block the turn */ })
  } catch { /* never throw into the chat turn */ }
}
