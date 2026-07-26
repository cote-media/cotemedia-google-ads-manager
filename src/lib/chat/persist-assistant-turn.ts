// LORAMER_CHAT_SERVER_TURN_WRITE_V1 — the SERVER owns the assistant turn.
// WHY: the assistant turn was written only by ChatLauncher.tsx:237, inside the try, only if the
// browser survived the read. On 2026-07-26 two of three turns were lost exactly that way while
// logSpend landed all three. A cost row without its answer is the wrong asymmetry.
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

export type PersistOutcome =
  | 'written' | 'skipped-duplicate' | 'skipped-no-target' | 'skipped-empty' | 'failed'

export function makeAssistantTurnWriter(args: {
  clientId?: string
  userEmail: string
  target: PersistTarget | null
  insert?: (row: Record<string, unknown>) => Promise<{ error: unknown }>
}): (content: string) => Promise<PersistOutcome> {
  // ONE-SHOT LATCH, flipped BEFORE the await so two concurrent callers cannot both pass.
  // CEILING, stated: this is PER-INVOCATION. It cannot dedupe across two separate HTTP requests —
  // that needs a turn id and a unique index, i.e. a migration, which is out of scope for this slice.
  let claimed = false
  return async function persistAssistantTurn(content: string): Promise<PersistOutcome> {
    if (claimed) return 'skipped-duplicate'
    if (!args.target || !args.clientId) return 'skipped-no-target'
    if (!content || !content.trim()) return 'skipped-empty'
    claimed = true
    try {
      const insert = args.insert ?? (async (row: Record<string, unknown>) => {
        const { error } = await supabaseAdmin.from('client_conversations').insert(row as any)
        return { error }
      })
      const { error } = await insert({
        client_id: args.clientId,
        user_email: args.userEmail,
        surface: args.target.surface,
        scope: args.target.scope,
        role: 'assistant',
        content,
      })
      if (error) { console.error('[chat] assistant-turn persist FAILED:', error); return 'failed' }
      return 'written'
    } catch (e) {
      // NEVER throw into the turn — a persistence failure must not destroy an answer in flight.
      console.error('[chat] assistant-turn persist THREW:', e)
      return 'failed'
    }
  }
}
