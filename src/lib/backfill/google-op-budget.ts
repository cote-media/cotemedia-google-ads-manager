// LORAMER_GOOGLE_OP_BUDGET_V1 — ALLOCATE BEFORE SPENDING (★GOOGLE-QUOTA-PRIORITY-INVERSION).
// LORAMER_GOOGLE_OP_BUDGET_LANE_ACCOUNTING_V2 — 2026-07-31: BILL EACH LANE ITS OWN SPEND.
//
// ⛔ WHAT WE HAD WAS STOP-WHEN-DEAD. `holdGoogleWork` (google-quota-store.ts) is REACTIVE: it reads a sentinel
// that Google itself set after the 15k Basic-Access cap was already gone. It cannot stop the lane that spent it.
//
// ⛔ AND THEN V1 REPRODUCED THE INVERSION INSIDE THE BUDGET ITSELF. MEASURED 2026-07-31: the v1 reader summed
// `cron_runs` across ALL google modes into ONE total and billed it against whichever single lane happened to
// ask. `mode` was SELECTED and never read. On 2026-07-31 that charged the DRAIN ~44,120 estimated ops against
// its 10,500 allocation — of which catchup had spent 42,311 (96%) and forward 1,809 (4%), and the drain itself
// had spent NOTHING, because the drain wrote no cron_runs rows at all and was structurally invisible to the
// counter. The ranked geo lap was declined every five minutes from ~09:05Z while two golden clients (Foam OH,
// Veterinary mastermind) kept bleeding a day of recoverable Google geo per day. The lane that spent nothing was
// the lane that got stopped — which is the exact defect this file exists to prevent, one layer in.
//
// THE FIX IS THE HEADER COMMENT V1 ALREADY CARRIED AND THE CODE NEVER IMPLEMENTED:
//   forward → units = connections_attempted, from rows where mode='forward'
//   drain   → units = connections_attempted, from rows where mode='drain'
//   catchup → units = days_filled,           from rows where mode='catchup'   (it fans out per GAP-DAY)
// ⛔ NO `Math.max(conns, days)` ANYWHERE. That expression was v1's hedge against under-counting and it is what
// made catchup's 421 connection-units (the same ~18 connections re-counted across 24 runs) outrank its real
// 207 gap-days. A hedge that picks the larger of two units is not conservative, it is wrong in a direction
// nobody can audit.
//
// ⛔ A LANE THAT CAN REQUEST BUDGET BUT CANNOT RECORD SPEND MUST NOT EXIST. `mode='drain'` rows are written by
// cron/drain as of this change (cron_runs.mode is plain text with NO check constraint — verified against the
// live schema 2026-07-31, so this needed no migration; the banked "avoid an enum migration" reason was false).
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
// ⚠ BUT GOOGLE BILLS **OPERATIONS**, NOT REQUESTS, and the operations-per-request ratio is NOT derivable from
// our code — it depends on Google's own accounting (★GAQL-OP-METER). So 67 is a LOWER BOUND in the unit that
// actually binds the cap. THAT IS PRECISELY WHY THE FLEET-TOTAL CHECK BELOW SURVIVES the per-lane fix: the
// per-lane numbers are now correct, but correct-per-lane against an unknown unit ratio still needs a backstop
// against the real 15,000 ceiling. Two checks, either can block.

import { supabaseAdmin } from '@/lib/supabase'
import type { GoogleQuotaReadState } from './google-quota-store'

// Basic Access, developer-scope, shared across ALL google clients on ONE dev token (HANDOFF:727).
export const GOOGLE_DAILY_OP_CAP = 15_000
// Requests per client-connection per DAY of google fan-out. Counted from code above, not recalled.
export const GAQL_REQUESTS_PER_CONNECTION_DAY = 67
// Operations >= requests and the ratio is unknown. Over-count spending so the budget stops EARLY.
export const SAFETY_MULTIPLIER = 1.5
// Catchup is the DEEP-HISTORY lane and the lowest-priority spender: it gets a minority share and may never
// spend into the remainder. 30% of 15k ≈ 4,500 ops.
export const CATCHUP_SHARE = 0.30
export const CATCHUP_ALLOCATION = Math.floor(GOOGLE_DAILY_OP_CAP * CATCHUP_SHARE)
// Everything else — forward, the ranked geo lap, scoped recovery — lives here and catchup may not touch it.
export const RANKED_RESERVE = GOOGLE_DAILY_OP_CAP - CATCHUP_ALLOCATION

// ⛔ 'backfill' IS DECLARED BUT NOT YET COUNTED — FLIGHT 1 OF 2, DELIBERATE AND STATED.
// The universe walk spends Google operations and writes NO cron_runs row, so `readGoogleSpendToday` reports 0
// for it and every arithmetic below treats it as zero. Wiring the ORDERING now and the COUNTING later is not
// tidiness: counting it today would take the fleet estimate past the cap immediately and block forward,
// catchup and drain in the same commit that was supposed to protect them. The ordering is inert until the
// number arrives; the number arrives in flight 2 (★GOOGLE-QUOTA-PRIORITY-INVERSION).
export type BudgetLane = 'catchup' | 'drain' | 'forward' | 'backfill'
export const BUDGET_LANES: readonly BudgetLane[] = ['forward', 'catchup', 'drain', 'backfill'] as const

// ⛔ LORAMER_FLEET_CEILING_HAS_A_PRIORITY_ORDER_V1 — WHO GETS REFUSED WHEN THE CEILING BINDS.
// HIGHEST priority first. The refusal falls on the LOWEST-priority lane holding spend in the window, never on
// whoever happens to ask next — which on a normal morning is forward at 08:00Z, the lane that must never lose.
//
// THE MIDDLE TWO ARE DERIVED, NOT ASSUMED, and the derivation is the whole ranking:
//   · CATCHUP repairs interior holes inside a 35-DAY window (CATCHUP_WINDOW_DAYS = 35, cron/catchup:48), 14
//     days per run. 35 days sits deep inside Google's ~37-month granular retention, so a day catchup defers
//     is still fetchable months later. Deferring catchup costs FRESHNESS. Nothing expires.
//   · DRAIN walks deep history toward floor36() — "the 36-month granular floor (safety margin under the ~37mo
//     Google/Meta granular cap)", drain-registry.ts:74. THAT WALL MOVES ONE DAY EVERY DAY. A day the drain
//     defers can cross it and become unrecoverable at any price. ★GOOGLE-CLICK-VIEW-90-DAY-WALL is the same
//     shape and sharper: it is the one surface "losing history while we wait".
//   ⇒ DRAIN OUTRANKS CATCHUP, because only the drain's work EXPIRES.
// LORAMER_RESTATEMENT_WINDOW_LAW_V1 was checked and does NOT reverse this: a day captured once and never
// re-walked is permanently WRONG, not permanently GONE — it stays repairable anywhere inside retention. A lost
// day is not repairable at any price. Wrong-and-fixable ranks below gone-forever.
export const LANE_PRIORITY: readonly BudgetLane[] = ['forward', 'drain', 'catchup', 'backfill'] as const

/**
 * Rank of a lane, 0 = highest. ⛔ FAIL-CLOSED ON AN UNKNOWN LANE: anything not in the table sorts LAST, so a
 * typo, a renamed lane or a future lane is refused FIRST rather than inheriting forward's protection. An
 * unrecognised identity must never resolve to top priority — that is the fail-open this ordering exists to
 * prevent, and it is the direction that silently gives an unaudited spender the highest-priority lane's seat.
 */
export function priorityOf(lane: string): number {
  const i = (LANE_PRIORITY as readonly string[]).indexOf(lane)
  return i === -1 ? LANE_PRIORITY.length : i
}

// Raw GAQL REQUESTS attributed to each lane today, plus anything we could not attribute.
export type GoogleSpendToday = {
  byLane: Record<BudgetLane, number>
  // ⛔ A cron_runs row whose mode we do not recognise still SPENT. It is counted against the FLEET total and
  // against no lane — under-counting the fleet is the direction that causes the outage.
  unattributedRaw: number
}

// WHICH CHECK DECIDED. Surfaced so a decline never has to be inferred from the numbers.
export type BudgetBlockedBy = 'none' | 'lane_allocation' | 'fleet_cap' | 'unreadable'

export type GoogleOpBudget = {
  // THE BANKED THREE-STATE VOCABULARY, reused verbatim from google-quota-store.ts — not a fourth dialect.
  state: GoogleQuotaReadState // 'blocked' | 'not_blocked' | 'unknown'
  lane: BudgetLane
  blockedBy: BudgetBlockedBy
  // ── THIS LANE. Both names kept from v1; their MEANING is now lane-scoped rather than fleet-wide. ──
  rawRequestsToday: number        // this lane's raw requests, BEFORE the multiplier
  estimatedOpsSpentToday: number  // this lane's estimate, AFTER it
  allocation: number              // what THIS lane may spend
  remaining: number               // the BINDING headroom = min(lane headroom, fleet headroom), floored at 0
  laneRemaining: number
  // ── THE FLEET. The backstop, because the ops-per-request ratio is unknown. ──
  fleetRawRequestsToday: number
  fleetEstimatedOpsToday: number
  fleetRemaining: number
  byLaneRawRequests: Record<BudgetLane, number>
  unattributedRaw: number
  // ── THE FRAME ──
  cap: number
  reserve: number
  catchupAllocation: number
  safetyMultiplier: number
  isLowerBound: true              // ops >= requests, always. Stated in the data per the instruction.
  reason: string
}

// ⛔ HOLD ON UNKNOWN. Identical rule to holdGoogleWork, and for the identical reason: a budget we cannot READ
// must never read as headroom. LORAMER_QUOTA_READ_SPLIT_STATE_V1 — a failed read returning "fine" is exactly how
// 178 gap-days of fan-out went out against an exhausted quota on 2026-07-28.
export function holdForBudget(b: GoogleOpBudget): boolean {
  return b.state === 'blocked' || b.state === 'unknown'
}

export function allocationFor(lane: BudgetLane, cap: number = GOOGLE_DAILY_OP_CAP): number {
  const catchupAllocation = Math.floor(cap * CATCHUP_SHARE)
  return lane === 'catchup' ? catchupAllocation : cap - catchupAllocation
}

// LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1 — the decline (and the ALLOW) states what it examined: the lane, the
// lane's own units, the fleet total, and BOTH allocations. A reader never has to reconstruct the denominator.
function denominator(b: {
  lane: BudgetLane; laneOps: number; allocation: number; fleetOps: number; cap: number
  catchupAllocation: number; reserve: number; byLane: Record<BudgetLane, number>; unattributedRaw: number
  mult: number
}): string {
  const per = BUDGET_LANES.map((l) => `${l} ${b.byLane[l]}`).join(' · ')
  const un = b.unattributedRaw ? ` · unattributed ${b.unattributedRaw}` : ''
  return (
    `lane=${b.lane} lane_ops~${b.laneOps}/${b.allocation} · fleet_ops~${b.fleetOps}/${b.cap} · ` +
    `allocations: catchup ${b.catchupAllocation} / ranked ${b.reserve} · ` +
    `raw requests today by lane: ${per}${un} · estimate is a LOWER BOUND ×${b.mult}`
  )
}

// PURE — the decision, extracted so it is provable without a DB.
// ⛔ TWO CHECKS, EITHER CAN BLOCK:
//   (a) this lane's spend vs this lane's allocation
//   (b) the FLEET total vs the 15,000 cap — the backstop that survives the per-lane fix, because the
//       operations-per-request ratio is still unknown (★GAQL-OP-METER).
export function decideBudget(
  lane: BudgetLane,
  spend: GoogleSpendToday | null,
  opts: { cap?: number; multiplier?: number } = {},
): GoogleOpBudget {
  const cap = opts.cap ?? GOOGLE_DAILY_OP_CAP
  const mult = opts.multiplier ?? SAFETY_MULTIPLIER
  const catchupAllocation = Math.floor(cap * CATCHUP_SHARE)
  const reserve = cap - catchupAllocation
  const allocation = lane === 'catchup' ? catchupAllocation : reserve
  const zero: Record<BudgetLane, number> = { forward: 0, catchup: 0, drain: 0, backfill: 0 }
  const base = {
    lane, allocation, cap, reserve, catchupAllocation,
    safetyMultiplier: mult, isLowerBound: true as const,
  }

  // UNREADABLE → unknown → hold. Never 'not_blocked'.
  if (spend === null) {
    return {
      ...base, state: 'unknown', blockedBy: 'unreadable',
      rawRequestsToday: 0, estimatedOpsSpentToday: 0, remaining: 0, laneRemaining: 0,
      fleetRawRequestsToday: 0, fleetEstimatedOpsToday: 0, fleetRemaining: 0,
      byLaneRawRequests: zero, unattributedRaw: 0,
      reason: "could not read today's google spend — HOLDING (an unreadable budget is not headroom)",
    }
  }

  const byLane = spend.byLane
  const laneRaw = Number(byLane[lane] ?? 0)
  const fleetRaw = BUDGET_LANES.reduce((s, l) => s + Number(byLane[l] ?? 0), 0) + Number(spend.unattributedRaw || 0)
  const laneOps = Math.ceil(laneRaw * mult)
  const fleetOps = Math.ceil(fleetRaw * mult)
  const laneRemaining = Math.max(0, allocation - laneOps)
  const fleetRemaining = Math.max(0, cap - fleetOps)
  const remaining = Math.min(laneRemaining, fleetRemaining)
  const denom = denominator({
    lane, laneOps, allocation, fleetOps, cap, catchupAllocation, reserve,
    byLane, unattributedRaw: spend.unattributedRaw, mult,
  })
  const common = {
    ...base,
    rawRequestsToday: laneRaw, estimatedOpsSpentToday: laneOps,
    fleetRawRequestsToday: fleetRaw, fleetEstimatedOpsToday: fleetOps,
    laneRemaining, fleetRemaining,
    byLaneRawRequests: { ...byLane }, unattributedRaw: spend.unattributedRaw,
  }

  // CHECK (a) — this lane has spent its own allocation.
  if (laneRemaining <= 0) {
    return { ...common, state: 'blocked', blockedBy: 'lane_allocation', remaining: 0,
      reason: `LANE ALLOCATION exhausted — ${denom}` }
  }
  // CHECK (b) — the fleet has spent the cap.
  // ⛔ LORAMER_FLEET_CEILING_HAS_A_PRIORITY_ORDER_V1. THE DEFECT THIS REPLACES: this check read ONLY
  // `fleetRemaining` and ignored `laneRemaining` entirely, so once the ceiling was gone EVERY lane was refused
  // — and the one refused in practice was whichever asked NEXT. On a normal morning that is forward at 08:00Z,
  // the highest-priority lane in the system, refused because a lower-priority lane had already spent the
  // ceiling. The reserve was expressed only in the per-lane allocations of check (a); the ceiling itself had no
  // priority order at all, which made "the walk yields; the product does not" unenforceable at exactly the
  // moment it mattered (LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1).
  //
  // THE RULE: a lane INSIDE its own allocation is not refused on the ceiling while any LOWER-priority lane is
  // holding spend in the window. That lower lane is the one that must yield, and it will be refused here on
  // its own next ask.
  //
  // ⛔ WHAT THIS DOES NOT DO, said plainly so nobody reads it as headroom: IT CREATES NO QUOTA. If the vendor's
  // 15,000 is genuinely gone, Google returns RESOURCE_EXHAUSTED whatever this function says. All this decides
  // is WHO ABSORBS a refusal that is coming anyway — and the answer must never be the lane carrying today's
  // customer data.
  if (fleetRemaining <= 0) {
    const lowerWithSpend = BUDGET_LANES.filter(
      (l) => priorityOf(l) > priorityOf(lane) && Number(byLane[l] ?? 0) > 0
    )
    // ⛔ UNATTRIBUTED SPEND IS NOT A LANE AND CANNOT BE BLAMED. If the ceiling was consumed by spend we could
    // not attribute, there is no lower-priority lane to yield, so this lane IS refused — fail-closed.
    if (laneRemaining > 0 && lowerWithSpend.length > 0) {
      return { ...common, state: 'not_blocked', blockedBy: 'none', remaining: laneRemaining,
        reason:
          `FLEET CEILING REACHED, AND THIS LANE IS NOT THE ONE THAT YIELDS — ${lane} is inside its own ` +
          `allocation (${laneOps}/${allocation}) and lower-priority lane(s) [${lowerWithSpend.join(', ')}] hold ` +
          `spend in this window. Priority: ${LANE_PRIORITY.join(' > ')}. ⛔ This is not headroom — if Google's ` +
          `cap is truly gone the vendor refuses regardless; it decides only WHO absorbs the refusal. — ${denom}`,
      }
    }
    return { ...common, state: 'blocked', blockedBy: 'fleet_cap', remaining: 0,
      reason:
        `FLEET CAP exhausted — ${lane} yields` +
        (laneRemaining > 0
          ? ` even though it is inside its own allocation: no LOWER-priority lane holds spend in this window, so there is nobody below it to refuse first`
          : ` and is also past its own allocation`) +
        `. Priority: ${LANE_PRIORITY.join(' > ')} — ${denom}` }
  }
  return { ...common, state: 'not_blocked', blockedBy: 'none', remaining,
    reason: `may spend ~${remaining} more ops (binding: ${laneRemaining <= fleetRemaining ? 'lane allocation' : 'fleet cap'}) — ${denom}` }
}

// Reads TODAY's google spend from `cron_runs`, which already records it durably — no new table, and no second
// source of truth to drift. ⛔ ATTRIBUTED PER LANE BY `mode`, which v1 selected and threw away:
//   forward/drain bill per CONNECTION-day (connections_attempted); catchup per GAP-day (days_filled).
// A read failure returns null → decideBudget yields 'unknown' → every lane holds.
export async function readGoogleSpendToday(): Promise<GoogleSpendToday | null> {
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
    // ⛔ `backfill` IS PRESENT AND ALWAYS ZERO HERE, AND THAT IS THE POINT OF FLIGHT 1. The universe walk
    // writes no cron_runs row, so this reader cannot see it — the key exists so the ORDERING is wired and the
    // absence is VISIBLE in every denominator string, rather than the lane simply not existing.
    const units: Record<BudgetLane, number> = { forward: 0, catchup: 0, drain: 0, backfill: 0 }
    let unattributedUnits = 0
    for (const r of data || []) {
      const mode = String((r as any).mode ?? '')
      const conns = Number((r as any).connections_attempted || 0)
      const days = Number((r as any).days_filled || 0)
      if (mode === 'catchup') {
        // The DEEP-HISTORY lane fans out per GAP-DAY, not per connection. This is the header's stated intent
        // and the half v1 never implemented: on 2026-07-31 it is 207 gap-days, not 421 connection-units.
        units.catchup += days
      } else if (mode === 'forward') {
        units.forward += conns
      } else if (mode === 'drain') {
        units.drain += conns
      } else {
        // ⛔ An unrecognised mode still SPENT. Count it against the FLEET and against no lane, and say so —
        // silently dropping it would under-count the cap, which is the direction that causes the outage.
        unattributedUnits += Math.max(conns, days)
        console.warn(`[google-op-budget] cron_runs row with UNRECOGNISED mode='${mode}' — counted against the fleet cap, attributed to no lane`)
      }
    }
    return {
      byLane: {
        forward: units.forward * GAQL_REQUESTS_PER_CONNECTION_DAY,
        catchup: units.catchup * GAQL_REQUESTS_PER_CONNECTION_DAY,
        drain: units.drain * GAQL_REQUESTS_PER_CONNECTION_DAY,
        // ⛔ NOT MEASURED YET — flight 2 sources this from universe_window_log. It reads 0 today, which
        // UNDER-counts the fleet by the largest single spender; that is a known, dated, deliberate gap and
        // not a claim that the walk spends nothing.
        backfill: units.backfill * GAQL_REQUESTS_PER_CONNECTION_DAY,
      },
      unattributedRaw: unattributedUnits * GAQL_REQUESTS_PER_CONNECTION_DAY,
    }
  } catch (e: any) {
    console.error('[google-op-budget] cron_runs read THREW — lanes HOLD. detail:', e?.message ?? e)
    return null
  }
}

export async function getGoogleOpBudget(lane: BudgetLane): Promise<GoogleOpBudget> {
  return decideBudget(lane, await readGoogleSpendToday())
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
      // THE DENOMINATOR: this LANE's own raw requests today (v1 recorded the fleet-wide total here, which is
      // what made a decline unreadable — it described work the lane had not done).
      facts_examined: args.budget.rawRequestsToday,
      rows_opened: 0, rows_closed: 0, rows_touched: 0,
      outcome: 'skipped',
      detail: `${args.budget.state}/${args.budget.blockedBy}: ${args.budget.reason}`,
    })
    if (error) console.warn(`[google-op-budget] DECLINE NOT RECORDED (${error.message}) — a silent no-op is indistinguishable from a lane that never ran`)
  } catch (e: any) {
    console.warn(`[google-op-budget] DECLINE RECORD THREW (${e?.message ?? e})`)
  }
}
