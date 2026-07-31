// LORAMER_GOOGLE_OP_BUDGET_V1 — ALLOCATE BEFORE SPENDING (★GOOGLE-QUOTA-PRIORITY-INVERSION).
//
// ⛔ WHAT WE HAD WAS STOP-WHEN-DEAD. `holdGoogleWork` (google-quota-store.ts) is REACTIVE: it reads a sentinel
// that Google itself set after the 15k Basic-Access cap was already gone. It cannot stop the lane that spent it.
// MEASURED: the developer-scope quota was exhausted before the ranked geo lap could run on 2026-07-29, 07-30 AND
// 07-31 — three consecutive days — and catchup is the only lane with NO allocation of any kind
// (cron/catchup:269 reads holdGoogleWork and nothing else; cron/drain:82 reads it AND
// googleForwardReserveDecision at :94, inside `if (!onlyClientId)`).
//
// ADAPTED, NOT INVENTED (WEB-FIRST, already run): Airbyte ships a declarative API Budget — max calls per time
// interval — so a connector cannot drain a third party's limit. Fivetran prioritises recent incremental data
// over historical backfill. This is both: a per-day ceiling, and a RESERVE the low-priority lane may not touch.
//
// ⛔ THE UNIT PROBLEM, RESOLVED HALFWAY AND THE OTHER HALF SAID OUT LOUD IN THE DATA.
// ★GAQL-OP-COUNT-DISCREPANCY carried two unreconciled figures, 67 vs 58 requests per gap-day. RESOLVED FROM
// CODE 2026-07-31 — 67 is correct, counted from the declarations rather than recalled:
//     fetchGoogleIntelligence          19  (safeQuery call sites)
//     fetchGoogleDimensional            2  (search_term + keyword)
//     DEVICE_GRAINS                     4
//     GEOGRAPHIC_GRAINS 10 × GEO_ENTITIES 2 = 20   (SEGMENTS is 9 pairs, + geo_country)
//     USER_GRAINS        9 × GEO_ENTITIES 2 = 18
//     HOUR_GRAINS                       2
//     DEMO_DIMENSIONS                   2  (does NOT multiply by DEMO_GRAINS — one view fetch per dimension
//                                           serves both grains; verified at cron/catchup:696-698)
//                                     ─────
//                                       67
// The 58 in the 2026-07-27 recon predates a widen. ⚠ BUT GOOGLE BILLS **OPERATIONS**, NOT REQUESTS, and the
// operations-per-request ratio is NOT derivable from our code — it depends on Google's own accounting. So 67 is
// a LOWER BOUND in the unit that actually binds the cap. Rather than guess a ratio, the budget applies an
// explicit SAFETY_MULTIPLIER and RECORDS both the raw estimate and the multiplier in its result, so a reader can
// see the assumption instead of inheriting it. Being wrong in this direction stops early; the other direction is
// the outage we have had three days running.

import { supabaseAdmin } from '@/lib/supabase'
import type { GoogleQuotaReadState } from './google-quota-store'

// Basic Access, developer-scope, shared across ALL google clients on ONE dev token (HANDOFF:727).
export const GOOGLE_DAILY_OP_CAP = 15_000
// Requests per client-connection per DAY of google fan-out. Counted from code above, not recalled.
export const GAQL_REQUESTS_PER_CONNECTION_DAY = 67
// Operations >= requests and the ratio is unknown. Over-count spending so the budget stops EARLY.
export const SAFETY_MULTIPLIER = 1.5
// Catchup is the DEEP-HISTORY lane and the lowest-priority spender: it gets a minority share and may never
// spend into the remainder. 30% of 15k ≈ 4,500 ops ≈ 67 gap-days/day at the measured rate — ample for genuine
// interior gaps, nowhere near the 178-gap-day fan-out that emptied the cap.
export const CATCHUP_SHARE = 0.30
export const CATCHUP_ALLOCATION = Math.floor(GOOGLE_DAILY_OP_CAP * CATCHUP_SHARE)
// Everything else — forward, the ranked geo lap, scoped recovery — lives here and catchup may not touch it.
export const RANKED_RESERVE = GOOGLE_DAILY_OP_CAP - CATCHUP_ALLOCATION

export type BudgetLane = 'catchup' | 'drain' | 'forward'

export type GoogleOpBudget = {
  // THE BANKED THREE-STATE VOCABULARY, reused verbatim from google-quota-store.ts — not a fourth dialect.
  state: GoogleQuotaReadState // 'blocked' | 'not_blocked' | 'unknown'
  lane: BudgetLane
  estimatedOpsSpentToday: number // AFTER the safety multiplier
  rawRequestsToday: number       // BEFORE it — so the assumption is visible, not inherited
  safetyMultiplier: number
  allocation: number             // what THIS lane may spend
  remaining: number              // allocation - spent, floored at 0
  cap: number
  reserve: number
  isLowerBound: true             // ops >= requests, always. Stated in the data per the instruction.
  reason: string
}

// ⛔ HOLD ON UNKNOWN. Identical rule to holdGoogleWork, and for the identical reason: a budget we cannot READ
// must never read as headroom. LORAMER_QUOTA_READ_SPLIT_STATE_V1 — a failed read returning "fine" is exactly how
// 178 gap-days of fan-out went out against an exhausted quota on 2026-07-28.
export function holdForBudget(b: GoogleOpBudget): boolean {
  return b.state === 'blocked' || b.state === 'unknown'
}

// PURE — the decision, extracted so it is provable without a DB.
export function decideBudget(
  lane: BudgetLane, rawRequestsToday: number | null, opts: { cap?: number; multiplier?: number } = {},
): GoogleOpBudget {
  const cap = opts.cap ?? GOOGLE_DAILY_OP_CAP
  const mult = opts.multiplier ?? SAFETY_MULTIPLIER
  const allocation = lane === 'catchup' ? Math.floor(cap * CATCHUP_SHARE) : cap - Math.floor(cap * CATCHUP_SHARE)
  const base = { lane, allocation, cap, reserve: cap - Math.floor(cap * CATCHUP_SHARE), safetyMultiplier: mult, isLowerBound: true as const }
  // UNREADABLE → unknown → hold. Never 'not_blocked'.
  if (rawRequestsToday === null || !Number.isFinite(rawRequestsToday)) {
    return { ...base, state: 'unknown', estimatedOpsSpentToday: 0, rawRequestsToday: 0, remaining: 0,
      reason: 'could not read today\'s google spend — HOLDING (an unreadable budget is not headroom)' }
  }
  const spent = Math.ceil(rawRequestsToday * mult)
  const remaining = Math.max(0, allocation - spent)
  if (remaining <= 0) {
    return { ...base, state: 'blocked', estimatedOpsSpentToday: spent, rawRequestsToday, remaining: 0,
      reason: `${lane} allocation exhausted: ~${spent} ops estimated spent today against an allocation of ${allocation} (cap ${cap}, ranked reserve ${base.reserve}). Estimate is a LOWER BOUND ×${mult}.` }
  }
  return { ...base, state: 'not_blocked', estimatedOpsSpentToday: spent, rawRequestsToday, remaining,
    reason: `${lane} may spend ~${remaining} more ops today (est. ${spent}/${allocation}; lower bound ×${mult})` }
}

// Reads TODAY's google spend from `cron_runs`, which already records it durably — no new table, and no
// second source of truth to drift. forward/drain bill per CONNECTION-day, catchup per GAP-day (days_filled),
// both at GAQL_REQUESTS_PER_CONNECTION_DAY. A read failure returns null → decideBudget yields 'unknown' → hold.
export async function readGoogleRequestsToday(): Promise<number | null> {
  try {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0)
    const { data, error } = await supabaseAdmin
      .from('cron_runs')
      .select('mode, connections_attempted, days_filled')
      .eq('platform', 'google')
      .gte('started_at', since.toISOString())
    if (error) {
      console.error('[google-op-budget] cron_runs READ FAILURE — this is a DB error, NOT headroom. Lanes HOLD. detail:', error.message)
      return null
    }
    let units = 0
    for (const r of data || []) {
      const conns = Number((r as any).connections_attempted || 0)
      const days = Number((r as any).days_filled || 0)
      // catchup fans out per gap-DAY; forward/drain per connection. Use the larger of the two so a run that
      // recorded both is never under-counted — under-counting is the direction that causes the outage.
      units += Math.max(conns, days)
    }
    return units * GAQL_REQUESTS_PER_CONNECTION_DAY
  } catch (e: any) {
    console.error('[google-op-budget] cron_runs read THREW — lanes HOLD. detail:', e?.message ?? e)
    return null
  }
}

export async function getGoogleOpBudget(lane: BudgetLane): Promise<GoogleOpBudget> {
  return decideBudget(lane, await readGoogleRequestsToday())
}

// ⛔ DENOMINATOR LAW (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1). A lane that DECLINES to run must record that
// it ran and why it declined. A lane that no-ops silently is indistinguishable from a lane that never fired —
// the ambiguity removed on 2026-07-31, and it would walk straight back in through this door.
export async function recordLaneDeclined(args: {
  lane: BudgetLane; platform: string; budget: GoogleOpBudget; observationDate?: string
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('capture_pass_log').insert({
      pass_marker: `google_op_budget_${args.lane}`,
      mode: args.lane, platform: args.platform, client_id: null, account_id: null,
      observation_date: args.observationDate ?? null,
      entities_examined: 0,
      facts_examined: args.budget.rawRequestsToday, // the DENOMINATOR: what today's spend looked like
      rows_opened: 0, rows_closed: 0, rows_touched: 0,
      outcome: 'skipped',
      detail: `${args.budget.state}: ${args.budget.reason}`,
    })
    if (error) console.warn(`[google-op-budget] DECLINE NOT RECORDED (${error.message}) — a silent no-op is indistinguishable from a lane that never ran`)
  } catch (e: any) {
    console.warn(`[google-op-budget] DECLINE RECORD THREW (${e?.message ?? e})`)
  }
}
