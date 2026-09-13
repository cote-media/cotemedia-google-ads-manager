// LORAMER_MISSED_CURSOR_V1 — THE MISSED LANE'S DURABLE ENUMERATION CURSOR (migrations/091), the ONE reader/writer module.
//
// WHY: the lane's enumeration paged by the five-minute clock (missedPageFor). Measured 2026-09-13 01:10Z on Escential:
// page 7/22 was cut by MISSED_ALLOWANCE_MS at entry 103 and the next fire moved to page 8, so entries 103–111 were never
// enumerated that sweep — and a deterministic cut starves the same entries every sweep. Positional paging skips when the
// traversal is interrupted; a cursor resumes from the exact last item seen. Page boundaries stop mattering: each fire
// enumerates up to MISSED_SURFACES_PER_RUN entries from the cursor, and the cursor advances ONLY past entries actually
// enumerated (the enumerator's own nextEntry), wrapping to 0 at the catalogue end — one sweep = every entry, guaranteed.
//
// A missing row reads as cursor 0 / sweep 0. A failed READ throws — the lane must not enumerate from an invented position
// (it would silently restart the sweep). A failed WRITE is logged and swallowed: the fire already asked its windows; the
// worst case is one page re-enumerated next fire, never a skip.
import { supabaseAdmin } from '@/lib/supabase'

const TABLE = 'universe_missed_cursor'

export interface MissedCursor { cursor: number; sweep: number; updatedAt: string | null }

export async function readMissedCursor(clientId: string, vendor: string): Promise<MissedCursor> {
  const { data, error } = await supabaseAdmin
    .from(TABLE).select('cursor, sweep, updated_at')
    .eq('client_id', clientId).eq('vendor', vendor).maybeSingle()
  if (error) throw new Error(`[universe-missed-cursor] read failed for ${clientId}/${vendor}: ${error.message}. ⛔ The lane must not enumerate from an invented position.`)
  if (!data) return { cursor: 0, sweep: 0, updatedAt: null }
  const cursor = Number((data as { cursor: number }).cursor), sweep = Number((data as { sweep: number }).sweep)
  return {
    cursor: Number.isFinite(cursor) && cursor >= 0 ? cursor : 0,
    sweep: Number.isFinite(sweep) && sweep >= 0 ? sweep : 0,
    updatedAt: (data as { updated_at?: string }).updated_at ?? null,
  }
}

export async function writeMissedCursor(clientId: string, vendor: string, cursor: number, sweep: number): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .upsert({ client_id: clientId, vendor, cursor, sweep, updated_at: new Date().toISOString() }, { onConflict: 'client_id,vendor' })
  if (error) {
    console.error(`[universe-missed-cursor] write failed for ${clientId}/${vendor} (cursor ${cursor}, sweep ${sweep}): ${error.message} — the next fire re-enumerates this page; nothing is skipped.`)
    return error.message
  }
  return null
}
