// LORAMER_LOOKBACK_LANE_V1 — THE RESTATEMENT BOUNDARY IS READ FROM THE STORE, PER ACCOUNT, NEVER TYPED.
//
// DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (i): boundary(account) = max(max click-through lookback, max
// view-through lookback, COST_HORIZON_DAYS), read from `conversion_action`, stored, guarded, re-read every forward
// fire. The STORE is entity_state_history: cron/sync persists each enabled conversion action's
// click_through_lookback_window_days / view_through_lookback_window_days as SCD2 state (entity-state-history.ts —
// the capture ★CONVERSION-ACTION-CAPTURE-DARK named as dark). This module READS the open rows and hands them to
// the PURE derivation in universe-resumer.ts. One derivation, one reader; the guard `lookback-boundary-is-measured`
// pins that this file imports the store and that the derivation carries no day literal.
// ⛔ AN ABSENT ROW IS UNKNOWN, AND UNKNOWN REFUSES. An account with no conversion_action lookback row gets NO
// boundary — the lookback lane does not run for it — never a default. That is the inception posture
// (LORAMER_INCEPTION_STOP_V1) applied at the top of the calendar.
import { supabaseAdmin } from '@/lib/supabase'
import { deriveBoundaryDays, type BoundaryFacts } from '@/lib/backfill/universe-resumer'

export const LOOKBACK_STATE_KEYS = {
  clickThrough: 'click_through_lookback_window_days',
  viewThrough: 'view_through_lookback_window_days',
} as const

export type BoundaryVerdict =
  | { known: true; days: number; basis: string; facts: BoundaryFacts }
  | { known: false; reason: string; facts: BoundaryFacts | null }

/** The open (valid_to IS NULL) lookback-window facts for one google account, reduced to their maxima. */
export async function readBoundaryFacts(clientId: string, accountId: string): Promise<BoundaryFacts | null> {
  const { data, error } = await supabaseAdmin
    .from('entity_state_history')
    .select('state_key, state_value')
    .eq('client_id', clientId).eq('platform', 'google').eq('account_id', accountId)
    .eq('entity_level', 'conversion_action')
    .in('state_key', [LOOKBACK_STATE_KEYS.clickThrough, LOOKBACK_STATE_KEYS.viewThrough])
    .is('valid_to', null)
  if (error) throw new Error(`[lookback-boundary] entity_state_history read failed for ${clientId}/${accountId}: ${error.message}. ⛔ A BOUNDARY MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
  const rows = (data ?? []) as Array<{ state_key: string; state_value: string }>
  if (rows.length === 0) return null
  let click: number | null = null, view: number | null = null
  for (const r of rows) {
    const n = Number(r.state_value)
    if (!Number.isFinite(n) || n <= 0) continue
    if (r.state_key === LOOKBACK_STATE_KEYS.clickThrough) click = click === null ? n : Math.max(click, n)
    else if (r.state_key === LOOKBACK_STATE_KEYS.viewThrough) view = view === null ? n : Math.max(view, n)
  }
  return { clickThroughMaxDays: click, viewThroughMaxDays: view, rowsRead: rows.length }
}

/** The account's boundary, or a refusal that says why — the reason is what the observe-only slot logs. */
export async function boundaryDaysFor(clientId: string, accountId: string): Promise<BoundaryVerdict> {
  const facts = await readBoundaryFacts(clientId, accountId)
  if (facts === null) {
    return { known: false, facts: null, reason: `no conversion_action lookback-window row for ${clientId}/${accountId} in entity_state_history — UNKNOWN refuses; the capture lands on the next forward fire (cron/sync), never a default` }
  }
  const d = deriveBoundaryDays(facts)
  if (d === null) {
    return { known: false, facts, reason: `derivation refused over ${facts.rowsRead} row(s): click-through ${facts.clickThroughMaxDays ?? 'none'}, view-through ${facts.viewThroughMaxDays ?? 'none'} — no usable value, or below the fleet floor` }
  }
  return { known: true, days: d.days, basis: d.basis, facts }
}
