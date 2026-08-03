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
export const GOOGLE_DAILY_OP_CAP = 15_000

/**
 * MEASURED-FROM-THE-VENDOR, not assumed: one GAQL request is one operation.
 * ⛔ The NAME is kept so nothing downstream silently changes shape, and because the value is still a stated
 * conversion rather than a per-response reading — the API returns no operation count, so this is the vendor's
 * documented rule applied to our request count, and it is a CEILING (pagination makes the true figure lower).
 * If Google ever publishes a different rule, this number moves and the two URLs above are where to check.
 */
export const ASSUMED_OPS_PER_REQUEST = 1

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
      ? `may publish ${allowance} of ${args.want} requested — ${remainingOps} ops remain in the backfill allowance (${ASSUMED_OPS_PER_REQUEST} op/request per Google's rate sheet, read 2026-08-03; a CEILING, since valid-next_page_token continuations are not counted)`
      : `one message costs ~${opsPerMessage} assumed ops and only ${remainingOps} remain — holding rather than overrunning`,
  }
}
