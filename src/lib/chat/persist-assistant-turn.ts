// LORAMER_CHAT_SERVER_TURN_WRITE_V1 — the SERVER owns the assistant turn.
// WHY: the assistant turn was written only by ChatLauncher.tsx:237, inside the try, only if the
// browser survived the read. On 2026-07-26 two of three turns were lost exactly that way while
// logSpend landed all three. A cost row without its answer is the wrong asymmetry.
//
// LORAMER_CHAT_TURN_PAIR_WRITE_V1 (★CHAT-USER-TURN-ORPHAN fork a2, Russ's call 2026-08-12) — the SERVER
// now owns BOTH turns, written as ONE atomic pair, user first. The client's pre-fetch user write was the
// orphan generator: 66 orphaned user turns (18.3% of all user turns) rendered into Lora's
// PREVIOUS-CONVERSATIONS block as questions she apparently ignored, plus 34 INVERSE orphans where the
// fire-and-forget POST died while the answer succeeded. A turn that produces NO answer now leaves NO
// durable trace — no orphan, no false signal (the durable failed-turn record is
// ★CHAT-TURN-FAILED-TELEMETRY-INVISIBLE's job, deliberately not folded in here).
// ⛔ USER ROW FIRST IS LOAD-BEARING: for equal created_at (same-statement now()) the recap renders INPUT
// order — driven 2026-08-12 on the real compiled builder — and bigserial assigns ids in VALUES order, so
// the insert array IS the render order. chat-turn-pair-write.guard.mjs pins it, proven red-first.
// ⛔ STALE-TAB COMPAT: the pair is written ONLY when the caller declares `userTurn: true` on persistTurn.
// An old open tab (stale JS) still writes its own user turn client-side and declares nothing — it gets
// the assistant-only behavior, byte-identical, so the transition produces zero duplicates.
import { supabaseAdmin } from '@/lib/supabase'

export type PersistTarget = { surface: string; scope: string | null }

// The caller DECLARES its conversation target. No inference from `location` — legacy surfaces use
// different surface values and a wrong guess writes the turn into the wrong thread.
export function parsePersistTarget(raw: unknown): PersistTarget | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const surface = typeof r.surface === 'string' ? r.surface.trim() : ''
  if (!surface) return null
  const scope = typeof r.scope === 'string' && r.scope.trim() ? r.scope.trim() : null
  return { surface, scope }
}

// The stale-tab compat flag, parsed BESIDE the target (parsePersistTarget's output is pinned by the
// 2026-08-12 ADVERSARY drive: identical for flagged and flagless bodies; unknown fields drop).
export function parseUserTurnFlag(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).userTurn === true
}

export type PersistOutcome =
  | 'written' | 'skipped-duplicate' | 'skipped-no-target' | 'skipped-empty' | 'failed'

export function makeAssistantTurnWriter(args: {
  clientId?: string
  userEmail: string
  target: PersistTarget | null
  /** The user's message, present ONLY when the caller declared `userTurn: true` (parseUserTurnFlag).
   *  Present ⇒ the pair [user, assistant] lands in ONE insert; absent ⇒ assistant-only, exactly the
   *  pre-pair behavior (stale-tab compat). */
  userMessage?: string | null
  insert?: (rows: Record<string, unknown>[]) => Promise<{ error: unknown }>
}): (content: string) => Promise<PersistOutcome> {
  // ONE-SHOT LATCH, flipped BEFORE the await so two concurrent callers cannot both pass.
  // CEILING, stated: this is PER-INVOCATION. It cannot dedupe across two separate HTTP requests —
  // that needs a turn id and a unique index, i.e. a migration, which is out of scope for this slice.
  let claimed = false
  return async function persistAssistantTurn(content: string): Promise<PersistOutcome> {
    if (claimed) return 'skipped-duplicate'
    if (!args.target || !args.clientId) return 'skipped-no-target'
    // ⛔ AN EMPTY ANSWER WRITES NOTHING — including the user row. A lone user row here would be the
    // orphan class reborn server-side (guard leg 3, proven red-first).
    if (!content || !content.trim()) return 'skipped-empty'
    claimed = true
    try {
      const insert = args.insert ?? (async (rows: Record<string, unknown>[]) => {
        // ONE insert = ONE statement = atomic; bigserial assigns ids in VALUES order, which is the
        // render order for the pair's shared created_at. Never split into two inserts (guard leg 2).
        const { error } = await supabaseAdmin.from('client_conversations').insert(rows as any)
        return { error }
      })
      const base = {
        client_id: args.clientId,
        user_email: args.userEmail, // viewer-keyed, both rows — ADVERSARY attack 6 pinned today's behavior
        surface: args.target.surface,
        scope: args.target.scope,
      }
      const rows: Record<string, unknown>[] = []
      if (args.userMessage && args.userMessage.trim()) {
        rows.push({ ...base, role: 'user', content: args.userMessage }) // USER FIRST — load-bearing, see header
      }
      rows.push({ ...base, role: 'assistant', content })
      const { error } = await insert(rows)
      if (error) { console.error('[chat] turn persist FAILED:', error); return 'failed' }
      return 'written'
    } catch (e) {
      // NEVER throw into the turn — a persistence failure must not destroy an answer in flight.
      console.error('[chat] turn persist THREW:', e)
      return 'failed'
    }
  }
}
