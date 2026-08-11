// LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — THE RATE GOVERNOR. ALLOCATE BEFORE SPENDING.
//
// ⛔ THE BACKFILL MAY NEVER STARVE THE FORWARD SYNC OR THE DRAIN. Google Basic is 15,000 operations/day for
// the whole fleet, and this runner is the only lane that can publish work faster than a human can watch it.
// LORAMER_GOOGLE_OP_BUDGET_V1 already banked the principle — "a lane must know its share BEFORE it spends,
// not after the cap is gone" — after a reactive `holdGoogleWork` let one lane consume the cap and discover it
// afterwards. This governor is that principle applied to the queue: it decides whether to PUBLISH, which is
// the only moment the spend is still preventable.
//
// ⛔ THE RATIO IS SETTLED AT 1 AS OF 2026-08-03, FROM GOOGLE'S OWN RATE SHEET — ★GAQL-OP-METER IS CLOSED.
// "A single query or report counts as ONE operation", streamed via SearchStream or paged via Search; Google's
// worked example is a Search returning 53 ad groups = 1 operation. Paginated requests carrying a VALID
// next_page_token are not counted against the daily operation quota AT ALL, so ops <= requests once paging is
// involved. Requests rejected with a GoogleAdsFailure DO count; network-level failures do not.
//   https://developers.google.com/google-ads/api/docs/api-policy/rate-sheet
//   https://developers.google.com/google-ads/api/docs/best-practices/quotas
//
// ⚠ THE COMMENT THAT WAS HERE ASSERTED A MECHANISM THAT DOES NOT EXIST, and it is kept in mind rather than
// kept in place: it said the only source was "the API Center in the Google Ads UI, which is a human read".
// THAT SCREEN DOES NOT EXIST — the API Center shows the developer token, the access level and the API contact
// email, and Google's own support states remaining daily operations cannot be read and must be tracked
// client-side. The measurement was never programmatic OR human; it was a document, and the document existed
// the whole time. Banked as the fourth LORAMER_ESSENCE_LAW_9_V1 precedent on
// ★FLIGHT-REPORT-NAMES-ASSERTED-MECHANISMS.
// ⛔ THIS FILE NO LONGER DECLARES THE CAP OR THE ALLOCATIONS — IT RE-EXPORTS THEM. Until 2026-08-09 it held a
// SECOND, INCOMPATIBLE model of the same 15,000: this one reserved the drain 5,000 while google-op-budget
// authorised it 10,500, and both were live. `single-owner-vendor-facts.guard.mjs` froze that as a baseline
// violation on the day it was found; this is the burn-down. One fact, one home
// (LORAMER_GOOGLE_LANE_ALLOCATION_V1, and G1's whole reason for existing).
export { GOOGLE_DAILY_OP_CAP } from './google-op-budget'
import { GOOGLE_DAILY_OP_CAP as CAP, LANE_ALLOCATIONS, OPS_PER_REQUEST } from './google-op-budget'

/**
 * MEASURED-FROM-THE-VENDOR, not assumed: one GAQL request is one operation.
 * ⛔ The NAME is kept so nothing downstream silently changes shape, and because the value is still a stated
 * conversion rather than a per-response reading — the API returns no operation count, so this is the vendor's
 * documented rule applied to our request count, and it is a CEILING (pagination makes the true figure lower).
 * If Google ever publishes a different rule, this number moves and the two URLs above are where to check.
 */
export const ASSUMED_OPS_PER_REQUEST = OPS_PER_REQUEST

// ⛔ RESERVED HEADROOM — the share the backfill may NEVER touch. Forward sync runs 5 platforms × ~18
// connections on a 10-minute cadence in the 08-10 UTC hour; the google drain runs 4×/day at up to 34 steps.
// These are the lanes that keep TODAY's data arriving, and a backfill of 2022 must never be the reason a
// customer's yesterday is missing.
// ⛔ DERIVED FROM THE ONE TABLE, 2026-08-09. These were 4,000 / 5,000 declared HERE, in a second model.
// The names survive because guards and the v1 path read them; the VALUES now come from
// LORAMER_GOOGLE_LANE_ALLOCATION_V1 and moved with it (forward 4,000→2,000, drain 5,000→3,000).
export const RESERVED_FOR_FORWARD_OPS = LANE_ALLOCATIONS.forward
export const RESERVED_FOR_DRAIN_OPS = LANE_ALLOCATIONS.drain
// ⛔ 13,500 AS OF 2026-08-11 (LORAMER_WALK_TAKES_THE_LANE_V1) — was 6,000. The value is DERIVED from the one
// table and moved on its own; this line has never held a literal and must not start.
export const BACKFILL_OP_ALLOWANCE = LANE_ALLOCATIONS.backfill

// ── LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1, 2026-08-04 ─────────────────────────────────────────────────────
// ⛔ WHAT WAS WRONG, AND IT WAS THE OPPOSITE OF THE INTENT. `decidePublish` below reads ONLY the backfill's
// own spend — the header says so proudly ("never a fleet number"). That guarantees the backfill never exceeds
// its 6,000 allowance. It guarantees NOTHING about the other 9,000. On a heavy drain day the fleet reaches
// 4,000 forward + 8,000 drain + 6,000 backfill = 18,000 against a 15,000 cap, and the backfill spends its
// full allowance regardless BECAUSE IT CANNOT SEE THE OVERRUN. The lane that hits the wall is the DRAIN and
// FORWARD — live product data — while a backfill of 2022 runs undisturbed.
//
// ⛔ THE GOVERNING LAW DECIDES WHO YIELDS, AND IT IS NOT A PREFERENCE: stale data presented as current is
// worse than a false zero. Today's numbers being wrong is a customer-visible failure; 2022's history arriving
// three days later is not. THE WALK YIELDS. THE PRODUCT NEVER DOES.
//
// ⛔ NO DEADLOCK IS POSSIBLE, AND THE REASON IS STRUCTURAL RATHER THAN LUCKY: THE YIELD IS ONE-WAY. Only the
// backfill consults the fleet and only the backfill stands down. Forward, catchup and drain never look at the
// backfill and never wait for it, so there is no cycle to deadlock on. If every lane yielded to every other
// lane nothing would run — which is exactly why only ONE lane is allowed to.
//
// ⛔ FAIL CLOSED. An unreadable fleet reading is NOT headroom. It returns hold, matching google-op-budget's
// own posture ("A read failure returns null → every lane holds"). A governor that treats "I don't know" as
// "go ahead" is worse than no governor, because it looks like one.

/** The product lanes' reserve. The backfill may never eat into what is LEFT of this. */
// ⛔ NOW forward + drain + CATCHUP, and the third term is the correction. It read forward+drain because
// catchup did not exist in this model at all — yet catchup is the DOMINANT spender (~82% of mean fleet
// volume), so a "product reserve" that omitted it was reserving for the two smallest lanes and calling it
// the product. Expressed as cap − backfill so it cannot drift from the table.
// ⛔ IT IS NOW 1,500, NOT 9,000 (LORAMER_WALK_TAKES_THE_LANE_V1, 2026-08-11), AND THE MEANING NARROWED WITH IT.
// Drain and catchup are ZERO by decision, so there is nothing to reserve for them; what remains is the slice
// held back from the walk for FORWARD, which this table cannot gate (cron/sync consults no budget) and whose
// spend the walk's own meter cannot see. So the "product reserve" is now precisely the un-gated-forward
// reserve — a smaller claim, and the only one still true.
export const PRODUCT_RESERVE_OPS = CAP - LANE_ALLOCATIONS.backfill

/** Shape of google-op-budget's reading, restated structurally so this module stays drivable with no DB. */
export interface FleetReading {
  byLane: { forward: number; catchup: number; drain: number }
  unattributedRaw: number
}

export interface GovernorDecision {
  mayPublish: boolean
  /** How many MESSAGES may be published right now. Zero is a valid, expected answer. */
  allowance: number
  reason: string
  /** Everything the decision was made from, so the reason can be audited rather than believed. */
  denominator: {
    cap: number
    reservedForward: number
    reservedDrain: number
    backfillAllowanceOps: number
    spentOpsToday: number
    assumedOpsPerRequest: number
    requestsPerMessage: number
  }
}

/**
 * ⛔ THE ONLY FUNCTION THAT MAY AUTHORISE A PUBLISH.
 * `spentRequestsToday` is the backfill lane's OWN spend, read from universe_run_state — not a fleet number,
 * because billing the backfill for the drain's requests would stop it for the wrong reason.
 *
 * There is no clock in here beyond the caller's own "today" boundary, and no floor: this governs SPEND, not
 * completion. Completion is the vendor's word alone (LORAMER_GOOGLE_ADS_UNIVERSE_WRITER_V1).
 */
export function decidePublish(args: {
  spentRequestsToday: number
  /** Requests one message costs. One message = one entry × one window = one GAQL call, plus a retry margin. */
  requestsPerMessage?: number
  /** Messages the caller WANTS to publish. The governor returns min(want, allowance). */
  want: number
}): GovernorDecision {
  const requestsPerMessage = Math.max(1, args.requestsPerMessage ?? 1)
  const spentOps = Math.max(0, args.spentRequestsToday) * ASSUMED_OPS_PER_REQUEST
  const denominator = {
    cap: CAP,
    reservedForward: RESERVED_FOR_FORWARD_OPS,
    reservedDrain: RESERVED_FOR_DRAIN_OPS,
    backfillAllowanceOps: BACKFILL_OP_ALLOWANCE,
    spentOpsToday: spentOps,
    assumedOpsPerRequest: ASSUMED_OPS_PER_REQUEST,
    requestsPerMessage,
  }
  const remainingOps = BACKFILL_OP_ALLOWANCE - spentOps
  if (remainingOps <= 0) {
    return {
      mayPublish: false, allowance: 0, denominator,
      reason: `backfill allowance EXHAUSTED for today: ${spentOps} ops spent of ${BACKFILL_OP_ALLOWANCE} (cap ${CAP} − ${RESERVED_FOR_FORWARD_OPS} forward − ${RESERVED_FOR_DRAIN_OPS} drain). Publishing stops BEFORE the cap, not at it.`,
    }
  }
  const opsPerMessage = requestsPerMessage * ASSUMED_OPS_PER_REQUEST
  const allowance = Math.max(0, Math.min(args.want, Math.floor(remainingOps / opsPerMessage)))
  return {
    mayPublish: allowance > 0, allowance, denominator,
    reason: allowance > 0
      ? `may publish ${allowance} of ${args.want} requested — ${remainingOps} ops remain in the backfill allowance (${ASSUMED_OPS_PER_REQUEST} op/request per Google's rate sheet, read 2026-08-03; a CEILING, since valid-next_page_token continuations are not counted)`
      : `one message costs ~${opsPerMessage} assumed ops and only ${remainingOps} remain — holding rather than overrunning`,
  }
}

/**
 * ⛔ THE ONLY FUNCTION THAT MAY AUTHORISE A PUBLISH ONCE THE FLEET IS VISIBLE.
 * PURE — the fleet reading is passed IN, so a guard can execute every branch with no database and no
 * network. (`decidePublish` above is kept: it still answers the narrower "has the backfill overspent its own
 * allowance" question, and this function calls it first. A lane that has blown its OWN budget must hold even
 * if the fleet looks quiet.)
 *
 * THE ARITHMETIC, stated so a decision can be audited rather than believed:
 *   productSpent    = forward + catchup + drain + unattributed        (from cron_runs, an ESTIMATE)
 *   reserveLeft     = max(0, PRODUCT_RESERVE_OPS - productSpent)      what the product lanes may still need
 *   fleetRemaining  = CAP - (productSpent + backfillSpent)            real headroom under the cap
 *   publishable     = fleetRemaining - reserveLeft                    what is left AFTER the product is safe
 * The backfill may publish only out of `publishable`. When the product lanes have spent little, their reserve
 * is nearly intact and the backfill gets almost nothing — which is correct: the reserve exists to be there
 * when they need it, not to be lent out because they have not needed it yet today.
 */
export function decidePublishFleetAware(args: {
  spentRequestsToday: number
  fleet: FleetReading | null
  requestsPerMessage?: number
  want: number
}): GovernorDecision {
  const own = decidePublish({
    spentRequestsToday: args.spentRequestsToday,
    requestsPerMessage: args.requestsPerMessage,
    want: args.want,
  })
  // The backfill's own allowance still binds first. If it is exhausted, nothing else matters.
  if (!own.mayPublish) return own

  if (args.fleet === null) {
    return {
      mayPublish: false, allowance: 0, denominator: own.denominator,
      reason: 'FLEET SPEND UNREADABLE — holding. An unreadable counter is not headroom, and treating "I do not know" as "go ahead" is the failure mode a governor exists to prevent. (google-op-budget takes the same posture: a null reading holds every lane.)',
    }
  }

  const f = args.fleet
  const productSpent = f.byLane.forward + f.byLane.catchup + f.byLane.drain + f.unattributedRaw
  const backfillSpent = Math.max(0, args.spentRequestsToday) * ASSUMED_OPS_PER_REQUEST
  // ⛔ THE RESERVE IS HELD IN FULL, ALWAYS — IT IS NOT DRAWN DOWN AS THE PRODUCT SPENDS.
  // The first version of this line computed `reserveLeft = RESERVE − productSpent` and let the backfill
  // publish out of the difference. That is backwards in BOTH directions and the guard caught both:
  //   · on a QUIET day it lent the backfill the untouched reserve — but the reserve exists to be there
  //     WHEN forward and drain need it, not to be handed out because they have not needed it yet today;
  //   · on a HEAVY day (product past its reserve) `reserveLeft` clamped to 0 and the backfill was
  //     offered the ENTIRE remaining headroom — the most over-subscribed day producing the most
  //     generous answer, which is the exact overrun this fix exists to prevent.
  // Holding the full reserve makes the walk's ceiling shrink monotonically as the product gets busier,
  // which is the only shape consistent with "the walk yields; the product does not".
  const publishable = CAP - PRODUCT_RESERVE_OPS - productSpent - backfillSpent
  const opsPerMessage = Math.max(1, args.requestsPerMessage ?? 1) * ASSUMED_OPS_PER_REQUEST
  const audit = `fleet ${productSpent} product + ${backfillSpent} backfill of ${CAP} cap · ${PRODUCT_RESERVE_OPS} held for forward+drain+catchup · publishable ${publishable}`

  if (publishable < opsPerMessage) {
    return {
      mayPublish: false, allowance: 0, denominator: own.denominator,
      reason: `WALK STANDS DOWN — ${audit}. One message costs ~${opsPerMessage} ops and only ${Math.max(0, publishable)} may be spent without eating the reserve that forward and drain may still need today. ⛔ THE WALK YIELDS; THE PRODUCT DOES NOT — stale data presented as current is worse than history arriving late.`,
    }
  }
  const allowance = Math.max(0, Math.min(own.allowance, Math.floor(publishable / opsPerMessage)))
  return {
    mayPublish: allowance > 0, allowance, denominator: own.denominator,
    reason: allowance > 0
      ? `may publish ${allowance} of ${args.want} — ${audit} (binding: ${allowance < own.allowance ? 'FLEET headroom' : 'the backfill’s own allowance'})`
      : `WALK STANDS DOWN — ${audit}. Nothing publishable after the product reserve.`,
  }
}
