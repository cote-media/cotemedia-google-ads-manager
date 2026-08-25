// LORAMER_GOOGLE_RESTATE_PRUNE_V1 — THE ONE DESTRUCTIVE WRITE IN THE GOOGLE CAPTURE PATH.
//
// ⛔ THE DEFECT IT CLOSES. `upsertMetricsChunked` conflicts on the 7-column natural key and never deletes, so
// "REPLACE" only replaces keys that RECUR. The dimensional writer caps per day — WINDOW_DAY_ST_CAP=300 /
// WINDOW_DAY_KW_CAP=200 in `google-dimensional.ts`, applied after a per-day sort by spend — and
// LORAMER_GOOGLE_FORWARD_RESTATE_V1 now re-pulls the last 30 days every night. The moment restatement moves
// that boundary, the term that fell out keeps the row the FIRST pull wrote, at its old value, forever: the
// day reads as old ∪ new. QUEUE ★SHOPIFY-TIER2 gap (1) banked this class ("STALE KEYS SURVIVE — a pure
// .upsert(onConflict) with NO delete") and warned it bites harder on a restatement lane, because you visit a
// day precisely BECAUSE something changed. That is now the Google forward lane, nightly.
//
// ⛔ UPSERT-THEN-PRUNE, NOT DELETE-THEN-INSERT, AND THE RULING IS ALREADY MADE.
// DECISIONS LORAMER_SHOPIFY_ORDER_GRAIN_WRITER_V1 (2026-07-26) faced this exact fork for order line items
// and chose upsert-then-prune, verbatim: "one of the two intermediate states is unavoidable and
// delete-then-insert would briefly leave an order with NO lines — a false zero, the worst failure class in
// this repo — while upsert-then-prune can only briefly leave an EXTRA stale line". PostgREST offers no
// cross-statement transaction, so there is no third option. The rows are written FIRST; only then is
// anything removed. A crash between the two leaves a superset, never a hole.
//
// ⛔ SCOPE IS THE WHOLE SAFETY ARGUMENT, so every predicate is pinned and a build guard holds each one
// (`tests/guards/google-restate-prune-capped.guard.mjs`, five legs):
//   · client_id      — one client, passed in; never a cross-client delete
//   · platform       — 'google' only
//   · entity_level   — 'ad_group' only, which is where both capped families live
//   · breakdown_type — EXACTLY search_term + keyword. Not device/hour/geo/demographic: those fetch every
//                      value the vendor serves, so a missing key means the vendor WITHDREW the fact, which is
//                      a different question with a different answer. Not account/campaign/ad: their key set
//                      is the entity list, which does not churn against a cap.
//   · date           — only the days actually handed in, so partition pruning applies and the statement
//                      cannot reach a day nobody re-pulled.
//
// ⛔ AND THE ONE DELIBERATE CONSERVATISM, because the false-zero direction is the dangerous one: A DAY WITH
// NO FRESH ROWS IS NEVER PRUNED. The caller passes only days that produced at least one row this pass. A day
// the vendor answered with nothing keeps everything it holds — that costs us a stale row in the rare case
// where a day genuinely went to zero, and it buys immunity from the case where a short or throttled vendor
// answer would otherwise wipe real captured history. Same trade, same direction, as the ruling above.
import { supabaseAdmin } from '@/lib/supabase'

/** The two families that carry a per-day top-N and can therefore lose a key between pulls. */
export const CAPPED_BREAKDOWN_TYPES = ['search_term', 'keyword']

/** The grain both capped families are written at (`google-dimensional.ts` buildGoogleDimensionalRows). */
const CAPPED_ENTITY_LEVEL = 'ad_group'

/** `${date}|${breakdown_type}|${entity_id}|${breakdown_value}` — the identity of a capped row inside its day. */
export function cappedRowKey(r: { date: unknown; breakdown_type: unknown; entity_id: unknown; breakdown_value: unknown }): string {
  return `${String(r.date)}|${String(r.breakdown_type)}|${String(r.entity_id)}|${String(r.breakdown_value)}`
}

export interface PruneResult {
  /** rows read in scope across the days examined */
  examined: number
  /** rows deleted because the fresh pull no longer carries their key */
  pruned: number
  /** days examined — only days that produced fresh rows */
  days: number
}

/**
 * Remove capped rows the fresh re-pull no longer carries, inside the exact
 * (client, platform='google', entity_level='ad_group', breakdown_type ∈ capped, date ∈ dates) scope.
 *
 * MUST be called AFTER the fresh payload has been upserted — it is the PRUNE half of upsert-then-prune, and
 * calling it first would open the false-zero window the shape exists to avoid.
 */
export async function pruneCappedDimensionalRows(args: {
  clientId: string
  /** ONLY days that produced at least one fresh row this pass. An empty set is a no-op, never a wide delete. */
  dates: string[]
  /** Every fresh row's cappedRowKey, across all the days in `dates`. */
  freshKeys: Set<string>
}): Promise<PruneResult> {
  const dates = Array.from(new Set(args.dates)).filter(Boolean)
  if (dates.length === 0) return { examined: 0, pruned: 0, days: 0 }

  // Read the day's capped rows in scope. `id` is the surrogate key (migrations/052: PRIMARY KEY (id, date)),
  // which is what lets the delete name exactly the rows that are stale rather than re-describing them.
  const { data, error } = await supabaseAdmin
    .from('metrics_daily')
    .select('id, date, breakdown_type, entity_id, breakdown_value')
    .eq('client_id', args.clientId)
    .eq('platform', 'google')
    .eq('entity_level', CAPPED_ENTITY_LEVEL)
    .in('breakdown_type', CAPPED_BREAKDOWN_TYPES)
    .in('date', dates)
  // ⛔ A FAILED READ IS NOT AN EMPTY SCOPE. Returning here with 0 would read as "nothing to prune" and hide a
  // broken instrument; throwing hands it to the caller's own try/catch, which logs LOUD and keeps the rows.
  if (error) throw new Error(`[google-dimensional-prune] scope read failed: ${error.message}`)

  const rows = data || []
  const stale = rows.filter((r) => !args.freshKeys.has(cappedRowKey(r as any)))
  if (stale.length === 0) return { examined: rows.length, pruned: 0, days: dates.length }

  // Chunked, and EVERY scope predicate is repeated on the delete itself. The id list alone would be
  // sufficient; the predicates are belt-and-braces so that a wrong id can still only ever remove a row that
  // was already inside the scope this function is allowed to touch.
  const CHUNK = 500
  let pruned = 0
  for (let i = 0; i < stale.length; i += CHUNK) {
    const ids = stale.slice(i, i + CHUNK).map((r) => r.id)
    const { error: delErr, count } = await supabaseAdmin
      .from('metrics_daily')
      .delete({ count: 'exact' })
      .in('id', ids)
      .eq('client_id', args.clientId)
      .eq('platform', 'google')
      .eq('entity_level', CAPPED_ENTITY_LEVEL)
      .in('breakdown_type', CAPPED_BREAKDOWN_TYPES)
      .in('date', dates)
    if (delErr) throw new Error(`[google-dimensional-prune] prune delete failed: ${delErr.message}`)
    pruned += count ?? ids.length
  }
  return { examined: rows.length, pruned, days: dates.length }
}
