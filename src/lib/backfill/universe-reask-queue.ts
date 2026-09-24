// LORAMER_IMPLICIT_PRESENCE_REASK_V1 (2026-09-24, round 50) — THE RE-ASK QUEUE: named surface-windows the FIRE asks.
//
// ⛔ WHY A QUEUE AND NOT A SCRIPT THAT ASKS. Everything that makes a vendor ask safe lives in the fire: the per-client claim, the
// lane and fleet quota holds, the op budget, UNIT_CONCURRENCY, the time cap, and the ledger's attempt_started/finished through
// universe_attempt_open. A side script asking through a compiled copy of the writer has none of it and can collide with the
// pump on the same surface-window. So a script only INSERTS rows here (scripts/enqueue-reask.mjs), and the fire consumes them
// inside the missed slot — after the lookback lane, for at most REASK_REQUESTS_PER_RUN of the missed lane's bound, oldest first,
// chunked exactly like a hole (route.ts). A row is DONE when its whole range is answered (ok|zero|nongrain) — settled from the unit's
// outcome, or lazily from the ledger at the next read; an error terminal adds tries+1 (REASK_MAX_TRIES then held visible to
// check:data's reask-queue-exhausted leg); a deferred unit leaves the row untouched. Table: migrations/105.
import { supabaseAdmin } from '@/lib/supabase'
import { REASK_MAX_TRIES } from '@/lib/backfill/universe-resumer'

export interface ReaskRow {
  id: number; client_id: string; vendor: string; resource: string; segment: string
  window_start: string; window_end: string; reason: string; tries: number; enqueued_at: string
}

/** Pending rows for one client, oldest window first: done_at null and tries below the cap. */
export async function readReaskQueue(clientId: string, vendor: string, limit = 60): Promise<ReaskRow[]> {
  const { data, error } = await supabaseAdmin.from('universe_reask_queue')
    .select('id, client_id, vendor, resource, segment, window_start, window_end, reason, tries, enqueued_at')
    .eq('client_id', clientId).eq('vendor', vendor)
    .is('done_at', null).lt('tries', REASK_MAX_TRIES)
    .order('window_start', { ascending: true }).limit(limit)
  if (error) throw new Error(`[reask-queue] read failed: ${error.message}`)
  return (data ?? []) as ReaskRow[]
}

/** Terminal ranges (ok|zero|nongrain) on the row's surface recorded since it was enqueued — what the ledger already answered. */
export async function answeredSince(row: ReaskRow): Promise<Array<{ start: string; end: string }>> {
  const { data, error } = await supabaseAdmin.from('universe_attempt_log')
    .select('window_start, window_end')
    .eq('client_id', row.client_id).eq('vendor', row.vendor).eq('resource', row.resource).eq('segment', row.segment)
    .eq('phase', 'attempt_finished').in('outcome', ['ok', 'zero', 'nongrain'])
    .gte('recorded_at', row.enqueued_at)
    .lte('window_start', row.window_end).gte('window_end', row.window_start)
  if (error) throw new Error(`[reask-queue] answered read failed: ${error.message}`)
  return (data ?? []).map((r: any) => ({ start: String(r.window_start).slice(0, 10), end: String(r.window_end).slice(0, 10) }))
}

/** The chunks of a row not yet inside an answered range. Pure. */
export function chunksStillOwed(chunks: Array<{ start: string; end: string; days: number }>, answered: Array<{ start: string; end: string }>) {
  return chunks.filter((c) => !answered.some((a) => a.start <= c.start && a.end >= c.end))
}

/** The ledger's newest terminal outcome for a message key — how a unit that THREW is settled (its terminal is already written). */
export async function terminalOutcomeFor(messageKey: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('universe_attempt_log')
    .select('outcome').eq('message_key', messageKey).eq('phase', 'attempt_finished')
    .order('recorded_at', { ascending: false }).limit(1)
  if (error) return null
  return (data?.[0] as any)?.outcome ?? null
}

/** done → done_at now; error → tries+1 and last_error; partial → claimed_at only (the next read settles from the ledger). */
export async function settleReaskRow(id: number, how: { kind: 'done' } | { kind: 'error'; error: string } | { kind: 'partial' }): Promise<void> {
  const now = new Date().toISOString()
  if (how.kind === 'done') {
    const { error } = await supabaseAdmin.from('universe_reask_queue').update({ done_at: now, claimed_at: now, last_error: null }).eq('id', id)
    if (error) console.error(`[reask-queue] settle done failed for ${id}: ${error.message}`)
  } else if (how.kind === 'error') {
    const { data } = await supabaseAdmin.from('universe_reask_queue').select('tries').eq('id', id).maybeSingle()
    const tries = Number((data as any)?.tries ?? 0) + 1
    const { error } = await supabaseAdmin.from('universe_reask_queue').update({ tries, claimed_at: now, last_error: how.error.slice(0, 500) }).eq('id', id)
    if (error) console.error(`[reask-queue] settle error failed for ${id}: ${error.message}`)
  } else {
    await supabaseAdmin.from('universe_reask_queue').update({ claimed_at: now }).eq('id', id)
  }
}
