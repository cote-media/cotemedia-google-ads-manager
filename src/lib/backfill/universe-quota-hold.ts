// LORAMER_V2_QUOTA_HOLD_IS_DURABLE_V1 — A HELD LANE MUST LEAVE A RECORD, OR IT IS INDISTINGUISHABLE FROM A
// LANE THAT NEVER FIRED.
//
// ⛔ THIS CLOSES A GAP IN MY OWN FIX, FOUND BEFORE IT WAS TESTED RATHER THAN AFTER. LORAMER_V2_QUOTA_SENTINEL_
// WIRED_V1 gave both v2 entry points a sentinel gate — and both of them held by returning JSON and writing
// NOTHING. That is exactly ★TWO-OF-THREE-RESUMER-REFUSALS-ARE-NOT-DURABLE (sweep C6) reproduced in the change
// that was supposed to be learning from it: "A lane that no-ops silently is indistinguishable from a lane that
// never fired" (google-op-budget.ts:365-368). Vercel runtime logs expire in an hour; a console.warn is not a
// record.
//
// ⛔ THE SHAPE IS BORROWED, NOT INVENTED. `recordLaneDeclined` already writes a `capture_pass_log` row with
// `outcome:'skipped'` for exactly this situation on the op-budget path. It is not called directly here because
// its signature takes a GoogleOpBudget — a budget-shaped decline, which this is not — and because reaching into
// google-op-budget.ts from the walk would widen a v2 change onto a shared live-path module. Same table, same
// outcome vocabulary, same denominator discipline.
//
// ⛔ THREE STATES, NOT TWO (sweep C4). `outcome` distinguishes a HOLD ('skipped' — we did not look) from a
// completed pass ('ok') and from a failure ('error'). A hold is not an error and must never be counted as one:
// nothing was attempted, nothing failed, and nothing is owed differently afterwards.
//
// ⛔ BEST-EFFORT, LOUD ON FAILURE, NEVER THROWS. A recording problem must not convert a correct hold into a
// 500 — but it must not be silent either, or the missing record becomes invisible twice over.
import { supabaseAdmin } from '@/lib/supabase'
import type { GoogleQuotaPause } from './google-quota-store'

export const QUOTA_HOLD_MARKER = 'universe_v2_quota_hold'

/**
 * Record that a v2 lane DECLINED TO RUN because the vendor's sentinel said Google work is blocked (or because
 * the sentinel could not be read, which holds for the same reason).
 *
 * `lane` is the entry point that held — 'consumer' or 'resumer' — so the record says WHICH gate stopped, not
 * merely that something did.
 */
export async function recordQuotaHold(args: {
  lane: 'consumer' | 'resumer'
  clientId: string
  qp: GoogleQuotaPause
  /** What the lane was about to do, so the record is readable without reconstructing the caller. */
  wouldHaveDone: string
}): Promise<void> {
  const { lane, clientId, qp, wouldHaveDone } = args
  try {
    const { error } = await supabaseAdmin.from('capture_pass_log').insert({
      pass_marker: QUOTA_HOLD_MARKER,
      mode: lane,
      platform: 'google',
      client_id: clientId,
      account_id: null,
      observation_date: null,
      // THE DENOMINATOR (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1): a hold examined NOTHING, and says so
      // explicitly rather than leaving a reader to infer it from absence.
      entities_examined: 0,
      facts_examined: 0,
      rows_opened: 0,
      rows_closed: 0,
      rows_touched: 0,
      outcome: 'skipped',
      detail:
        `QUOTA HOLD (${lane}): ${qp.state === 'unknown'
          ? `sentinel UNREADABLE — holding, NOT a confirmed pause: ${qp.reason}`
          : `google quota paused until ${qp.until}`} · would have: ${wouldHaveDone} · ` +
        `NOTHING was asked of the vendor and NO cursor moved. Owed-ness is DERIVED, so no state is lost by holding.`,
    })
    if (error) {
      console.error(`[universe-v2] QUOTA HOLD NOT RECORDED (${error.message}) — the hold is correct but it is now invisible, which is the defect this record exists to prevent.`)
    }
  } catch (e: any) {
    console.error(`[universe-v2] QUOTA HOLD RECORD THREW (${e?.message ?? e}) — hold stands, record lost.`)
  }
}
