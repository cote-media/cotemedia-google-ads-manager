// LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — the thread is MERGED, never replaced.
//
// ⛔ WHY THIS FILE EXISTS. `use-lora-chat` had THREE places that did
// `setMessages(rows.map((m) => ({ role: m.role, content: m.content })))` — mount hydration, the
// visibility/focus refresh, and the recovery "ambiguous" branch. Each one REPLACED the whole array,
// and each one threw the server row `id` away on the way in. A replace cannot preserve a message the
// server has not written yet, so a refresh landing between "the user pressed send" and "the server
// persisted the user turn" ERASED the message the user was looking at.
//
// ⚠ AND THE ID WAS ALWAYS ON THE WIRE. `/api/conversations` has always selected it
// (`.select('id, surface, scope, role, content, created_at, hidden_at')`). The client mapped it away
// at the door, which is what made merging impossible rather than merely unimplemented.
//
// PUBLISHED PRIOR ART — verified against the issues themselves before being cited here:
//   openclaw#67412 — sent message flashes blank, sometimes never returns. Published fix: keep the
//     optimistic message in local state until the server confirms it, rather than clearing and
//     re-fetching.
//   openclaw#37083 — same product, code level. Cause named as "completely replaces the chatMessages
//     array instead of merging incrementally. If there's any race condition or partial load, messages
//     can be lost." Fix: a Set of existing ids, filter to genuinely new, merge.
//   openclaw#66177 — the same symptom filed again as a regression. Corroboration only.
// ⚠ THEIR TRIGGER IS TOOL EXECUTION AND OURS IS NAVIGATE-AWAY. The MECHANISM is identical and the
// remedy transfers; the trigger does not, and nothing here claims it does.

export type Msg = {
  role: 'user' | 'assistant'
  content: string
  recoveryKey?: string
  // The server row id. Present iff this message exists in `client_conversations`. THIS IS THE MERGE
  // KEY — without it, "which local message is this server row?" has no answer and replace is the only
  // move available.
  id?: number
  // A stable LOCAL key, assigned once at creation and never reused. It is what React keys on before a
  // server id exists, and what lets a bubble keep its identity through the moment its id arrives.
  // ⛔ REQUIRED, DELIBERATELY: optional would let a construction site forget it and silently fall back
  // to an index key, which is the defect class this change exists to remove.
  lkey: string
}

// Monotonic within the tab. Date.now() alone collides when two messages are created in the same
// millisecond — which is exactly what an optimistic append plus an immediate status bubble does.
let lkeySeq = 0
export function newLocalKey(prefix: 'u' | 'a' | 'rec' | 'srv'): string {
  lkeySeq += 1
  return `${prefix}:${Date.now().toString(36)}:${lkeySeq}`
}

type ServerRow = { id?: number | string; role?: string; content?: string }

/**
 * Fold a server thread into local state. Server rows win for anything that has an id; local messages
 * the server has not written yet are PRESERVED; an optimistic message reconciles to its server row in
 * place rather than duplicating.
 *
 * ⚠ CALLERS: use `mergeThreadForClient`. This is exported for the guard and for tests; calling it
 * directly skips the client scoping, which is the leg that matters most.
 */
export function mergeThread(local: readonly Msg[], serverRows: readonly unknown[]): Msg[] {
  const rows = (serverRows as ServerRow[]).filter(
    (r) => !!r && (r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string',
  )

  // Local messages that already carry an id, so the matching server row can INHERIT the existing lkey
  // and keep its React identity instead of unmounting and remounting on every refresh.
  const byId = new Map<number, Msg>()
  for (const m of local) if (m.id != null) byId.set(m.id, m)

  // The optimistic tail — no id yet. These are precisely what a wholesale replace destroyed.
  const optimistic = local.filter((m) => m.id == null)
  const claimed = new Set<Msg>()

  const merged: Msg[] = rows.map((r) => {
    const rawId = Number(r.id)
    const id = Number.isFinite(rawId) ? rawId : undefined
    const role = r.role as 'user' | 'assistant'
    const content = r.content as string

    const known = id != null ? byId.get(id) : undefined
    if (known) return { ...known, id, role, content }

    // No id match. Does an unclaimed optimistic message correspond to this row? If so the row ADOPTS
    // its local key: the bubble the user is already looking at BECOMES the server row in place. It is
    // not unmounted and re-added, and — the part that matters — it is not shown twice.
    const twin = optimistic.find((m) => !claimed.has(m) && m.role === role && m.content === content)
    if (twin) {
      claimed.add(twin)
      return { ...twin, id, role, content }
    }

    return { role, content, id, lkey: id != null ? `srv:${id}` : newLocalKey('srv') }
  })

  // ⛔ THE HALF A REPLACE COULD NOT DO. Anything local the server has not written yet — the in-flight
  // user turn, the recovery placeholder, an assistant bubble whose row is still being persisted —
  // SURVIVES, appended after the server thread in its original relative order. This single loop is the
  // entire defect.
  // ⚠ Optimistic messages are the TAIL by construction (they are created by `send` and by the recovery
  // path, both of which append). Appending them after the server rows therefore preserves order rather
  // than imposing one. If that ever stops being true, this is the line that would reorder them.
  for (const m of optimistic) if (!claimed.has(m)) merged.push(m)

  return merged
}

/**
 * The only merge entry point callers should use.
 *
 * ⛔ CLIENT-SCOPED, AND THIS IS THE LEG THAT MATTERS MOST. Preserving "local messages the server has
 * not written yet" is exactly right WITHIN one client and catastrophic ACROSS two: the desktop shelf
 * stays MOUNTED through a client switch (d55f739 / LoraThread.tsx:17-19) while the -next page
 * remounts, so a naive merge would carry client A's optimistic turn into client B's thread. THAT
 * CONVERTS A DISPLAY BUG INTO A DATA-ATTRIBUTION BUG — strictly worse than the defect being fixed.
 * On a client change the local set is DROPPED, not merged.
 */
export function mergeThreadForClient(
  local: readonly Msg[],
  serverRows: readonly unknown[],
  { localClientId, serverClientId }: { localClientId: string | null; serverClientId: string },
): Msg[] {
  if (localClientId !== serverClientId) return mergeThread([], serverRows)
  return mergeThread(local, serverRows)
}
