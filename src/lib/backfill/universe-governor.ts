// LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — THE RATE GOVERNOR. ALLOCATE BEFORE SPENDING.
//
// ⛔ THE BACKFILL MAY NEVER STARVE THE FORWARD SYNC OR THE DRAIN. Google Basic is 15,000 operations/day for
// the whole fleet, and this runner is the only lane that can publish work faster than a human can watch it.
// LORAMER_GOOGLE_OP_BUDGET_V1 already banked the principle — "a lane must know its share BEFORE it spends,
// not after the cap is gone" — after a reactive `holdGoogleWork` let one lane consume the cap and discover it
// afterwards. This governor is that principle applied to the queue: it decides whether to PUBLISH, which is
// the only moment the spend is still preventable.
//
// ⛔ OPS >= REQUESTS AND THE RATIO IS UNMEASURED (★GAQL-OP-METER). Every number here is therefore counted in
// REQUESTS and converted with an ASSUMED ratio that is stated in the data, never hidden in a constant. The
// assumption is deliberately PESSIMISTIC so the budget stops early: over-counting spend wastes headroom,
// under-counting causes the outage.
//
// ⚠ AND I COULD NOT MEASURE THE RATIO IN THIS FLIGHT. The Google Ads API does not return an operation count on
// a search response — there is no field on the response surface and no header the google-ads-api client
// exposes. The only source is the API Center in the Google Ads UI, which is a human read, not a programmatic
// one. ★GAQL-OP-METER stays open and this file states the assumption rather than pretending to a measurement.
export const GOOGLE_DAILY_OP_CAP = 15_000

/** PESSIMISTIC and STATED. If a request is later measured to cost fewer ops, this number goes DOWN, never up. */
export const ASSUMED_OPS_PER_REQUEST = 10

// ⛔ RESERVED HEADROOM — the share the backfill may NEVER touch. Forward sync runs 5 platforms × ~18
// connections on a 10-minute cadence in the 08-10 UTC hour; the google drain runs 4×/day at up to 34 steps.
// These are the lanes that keep TODAY's data arriving, and a backfill of 2022 must never be the reason a
// customer's yesterday is missing.
export const RESERVED_FOR_FORWARD_OPS = 4_000
export const RESERVED_FOR_DRAIN_OPS = 5_000
export const BACKFILL_OP_ALLOWANCE = GOOGLE_DAILY_OP_CAP - RESERVED_FOR_FORWARD_OPS - RESERVED_FOR_DRAIN_OPS // 6,000

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
    cap: GOOGLE_DAILY_OP_CAP,
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
      reason: `backfill allowance EXHAUSTED for today: ${spentOps} ops spent of ${BACKFILL_OP_ALLOWANCE} (cap ${GOOGLE_DAILY_OP_CAP} − ${RESERVED_FOR_FORWARD_OPS} forward − ${RESERVED_FOR_DRAIN_OPS} drain). Publishing stops BEFORE the cap, not at it.`,
    }
  }
  const opsPerMessage = requestsPerMessage * ASSUMED_OPS_PER_REQUEST
  const allowance = Math.max(0, Math.min(args.want, Math.floor(remainingOps / opsPerMessage)))
  return {
    mayPublish: allowance > 0, allowance, denominator,
    reason: allowance > 0
      ? `may publish ${allowance} of ${args.want} requested — ${remainingOps} ops remain in the backfill allowance (assumed ${ASSUMED_OPS_PER_REQUEST} ops/request, UNMEASURED; ★GAQL-OP-METER)`
      : `one message costs ~${opsPerMessage} assumed ops and only ${remainingOps} remain — holding rather than overrunning`,
  }
}
