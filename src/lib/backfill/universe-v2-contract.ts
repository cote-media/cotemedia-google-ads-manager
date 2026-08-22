// LORAMER_UNIVERSE_CONSUMER_V2_V1 — the v2 walk contract: topic, message shape, and the two bounds.
//
// ⛔ IT LIVES OUTSIDE THE ROUTE FOR TWO REASONS, AND THE FIRST ONE IS A BUILD FACT THAT `tsc` CANNOT SEE.
// Next.js validates the export surface of an App Router route file and rejects anything that is not a
// recognised Route export: `Type error: Route "…/route.ts" does not match the required types of a Next.js
// Route. "TOPIC" is not a valid Route export field.` **`npx tsc --noEmit` passes that file clean.** This is
// exactly the case CLAUDE.md warns about — a full `npm run build` is the gate, and a type check is not a
// substitute for it.
//
// ⛔ AND THE DESIGN REASON, which would justify the move on its own: a PUBLISHER needs the topic and the
// message shape. Importing a route module to get them would drag a handler, its `maxDuration`, and its whole
// dependency tree into the publisher — which is how the v1 starter ended up importing from the v1 consumer.
import type { UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'

export const TOPIC = 'google-ads-universe-v2'
export const VENDOR = 'google'

/**
 * ⛔ THE BOUND THAT SEPARATES **BROKEN** FROM **MIS-SIZED**, AND IT IS EVALUATED AT THE MINIMUM SPAN.
 *
 * v1 ships `MAX_OPEN_ATTEMPTS = 3` counted at ANY span, and the 2026-08-08 poison loops hit three attempts
 * at THIRTY DAYS. That is mis-sized, not broken — and a product that says "broken" there is lying to a
 * customer about their own data. Three failures at ONE DAY is a different fact entirely: one day of one
 * entry cannot complete in 300 seconds, there is nothing left to narrow, and a human needs to know.
 */
export const MAX_ATTEMPTS_AT_MIN_SPAN = 3

/** Above the minimum span, a repeated failure means NARROW AND RETRY, never stop. */
export const NARROW_AFTER_ATTEMPTS = 2

/**
 * ⛔ EMPTY-STRETCH VISIBILITY, NOT A STOP — LORAMER_EMPTY_STRETCH_VISIBILITY_V1, 2026-08-10.
 * After this many CONSECUTIVE all-empty windows on one chain, the consumer writes ONE
 * `abandoned_owed`-class attempt record for the operator and KEEPS WALKING. Nothing is parked, nothing is
 * sealed, no new status word exists — a row's absence proves nothing (LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1),
 * so the only lawful output of a long empty stretch is VISIBILITY.
 *
 * ⛔ WHY 400, ARGUED FROM DATA AND NOT FROM TASTE: the longest dormancy gap measured anywhere in the
 * roster's held history is BusyBee Bookkeeping's **2,267 days (~6.2 years, data on BOTH sides of it)** —
 * ≈324 consecutive 7-day windows, ≈76 at 30 days. 400 windows sits ABOVE the worst dormancy ever observed
 * at ANY window size the sizer can produce, so the record fires only on something we have genuinely never
 * seen — never on a real client's real quiet years. A small N here is the park-the-surface design that was
 * adversarially killed on 2026-08-10: at N=10-20 it would have stopped BusyBee's walk mid-gap and refused
 * the 2019 history on the far side.
 */
export const EMPTY_STRETCH_REPORT_AFTER = 400

/**
 * ⛔ THE CONSUMER'S DECLARED DURATION CONTRACT — LORAMER_COMPLETION_SIGNAL_V1, and it lives HERE rather than
 * in the route because an OBSERVER needs it and must not import a handler to get it.
 *
 * ⛔ WHY THIS IS A CONTRACT AND NOT AN OBSERVATION, WHICH IS THE WHOLE POINT. Vercel's own documentation
 * (vercel.com/docs/functions/configuring-functions/duration, page last_updated 2026-07-01): *"If a function
 * runs for longer than its set maximum duration, Vercel will terminate it."* That is a PLATFORM GUARANTEE
 * enforced by someone other than the observer — the bar Temporal's Start-To-Close and SQS's visibility
 * timeout both meet, and the bar `QUIET_MS = 10_000` never met, because 10s came from a measured 1-4s
 * inter-range GAP rather than from any contract. An invocation cannot be alive past this value.
 *
 * ⛔ AND 300 IS OUR CHOICE, NOT THE PLATFORM'S CEILING. The same page gives Pro a maximum of 800s and an
 * extended maximum of 1800s. Raising this is legal and plausible; anything that hard-codes 300 elsewhere
 * becomes silently wrong the day it moves. `drive-ceiling-pin.guard.mjs` pins the route's export and the
 * drive's ceiling to THIS constant for exactly that reason.
 */
export const CONSUMER_MAX_DURATION_S = 300

/**
 * ⛔ THE FIRE-LEASE TTL — LORAMER_INLINE_FIRE_LEASE_V1, and it lives HERE, beside the ceiling it is
 * derived from, so the two can never drift apart in separate files. A lease holder cannot live past the
 * platform kill at CONSUMER_MAX_DURATION_S, so ceiling + grace covers every possible holder lifetime.
 * The 30s is a NAMED GRACE for the acquisition write landing after process start (argued ≪ 30s at pdx1;
 * not measured). THE INVARIANT (pinned by the C2 interval guard): LEASE_TTL_S > CONSUMER_MAX_DURATION_S —
 * raising the ceiling without this moving must fail the build, never silently invert the lease.
 * All TTL COMPARISON happens in DB time inside migrations/085's CAS function; this constant is passed
 * on every call and the DB default is only a fallback.
 */
export const LEASE_TTL_S = CONSUMER_MAX_DURATION_S + 30

/**
 * ⛔ THE INLINE FIRE'S TIME BUDGET — LORAMER_QUEUE_REMOVED_INLINE_WALK_V1. Three constants, one
 * identity, pinned by `inline-fire-fits-the-ceiling.guard.mjs`:
 *   SCAN_ALLOWANCE_MS + CAPTURE_BUDGET_MS + UNIT_RESERVATION_FLOOR_MS ≤ CONSUMER_MAX_DURATION_S × 1000
 *
 * SCAN_ALLOWANCE_MS — what the selection scan may take before capture begins. DERIVED from the live
 * pdx1 ledger 2026-08-22 (universe_fire_log, scanned=60, N=25): mean 47,489 · p50 47,410 · p99 50,434 ·
 * max 50,692. 55,000 covers the observed max +8.5%. ⚠ Re-derive if the scan's shape changes (more
 * clients per fire, coverage batching).
 *
 * CAPTURE_BUDGET_MS — what the unit loop may consume. (300 − 55)s minus ONE reservation floor: the
 * floor IS the kill-margin — after the loop stops admitting, one worst-case unit plus the post-loop
 * writes (heartbeat + lease release, measured ≤82ms at pdx1) still fit under the platform kill.
 *
 * UNIT_RESERVATION_FLOOR_MS — the reservation for a unit not yet measured this fire. DERIVED: all-time
 * per-range p99 6,768ms (N=14,154) × 1.48 ≈ 10,000. ⚠ The ×1.48 is a DECLARED SAFETY FACTOR, not a
 * measurement: the post-pin regime (N=277, max 2,221ms) is one afternoon old and the all-time tail
 * spans the slow-write iad1 regime. Re-derive from pdx1-only data after ~7 days (≈2026-08-29).
 */
export const SCAN_ALLOWANCE_MS = 55_000
export const UNIT_RESERVATION_FLOOR_MS = 10_000
export const CAPTURE_BUDGET_MS = (CONSUMER_MAX_DURATION_S * 1000) - SCAN_ALLOWANCE_MS - UNIT_RESERVATION_FLOOR_MS


export interface UniverseMessageV2 {
  clientId: string
  userEmail: string
  customerId: string
  entry: UniverseEntry
  /** Inclusive window this message must capture. It rides on the MESSAGE — nothing is inferred from order. */
  startDate: string
  endDate: string
  /** How many windows this chain may still walk, including this one. UNDEFINED = unbounded. */
  windowsRemaining?: number
  /**
   * ⛔ WHICH LANE PUBLISHED THIS — LORAMER_TOP_EDGE_LANE_V1, 2026-08-19. `'descend'` (or absent) is the walk
   * marching toward inception; `'top-edge'` holds the strip between the descent's top window and the newest
   * servable day. It rides the MESSAGE for the same reason `windowsRemaining` does — the chain is the only
   * writer and the only reader — and it decides exactly two things in the consumer:
   *   1. the lane stamped on `attempt_started`, which the rotation (migrations/084) filters on so a top-edge
   *      attempt cannot drag the descending anchor to the top of the calendar; and
   *   2. ⛔ WHETHER `advance()` RUNS AT ALL. A top-edge message MUST NOT self-chain: `advance` derives its
   *      successor as `startDate − 1`, so a strip message would publish a window ending the day below the
   *      strip and start a SECOND descent through ground the walk has already covered.
   * ⛔ ABSENT MEANS `'descend'`, so every in-flight message published before this field existed consumes
   * with byte-identical behaviour.
   */
  lane?: 'descend' | 'top-edge'
  /**
   * ⛔ THE PRODUCER-ASSIGNED MESSAGE IDENTIFIER — LORAMER_COMPLETION_SIGNAL_V1, and it is REQUIRED prior art
   * rather than a convenience. Enterprise Integration Patterns: *"Use a producer-assigned message identifier
   * or a business-level idempotency key that identifies the specific logical operation."* We already MINT one
   * — it is the idempotency key every publisher hands the queue — and until now we threw it away, so no
   * durable row could say WHICH PUBLISHER caused it. That is what let a scheduled fire's requests be
   * attributed to a drive's pass, and the earlier design banked that as "an acceptable counting error"; the
   * pattern does not offer that option. Optional on the type so a legacy in-flight message still consumes.
   */
  messageKey?: string
  /**
   * ⛔ DEAD FIELD — the consumer NEVER reads it (universe-floor-execute-time.guard.mjs fails the build if it
   * does). The floor is resolved at EXECUTE time from universe_account_floor. The field survives only
   * because the resumer still writes it; removing it rides with ★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR.
   */
  floorDate?: string
  /**
   * CONSECUTIVE all-empty windows on this chain, INCLUSIVE of none-yet (undefined = 0). Chain-local pacing
   * state in `windowsRemaining`'s exact shape — it may ride the message because no second owner exists: the
   * chain is the only writer and the only reader. (A FLOOR may not ride the message — that has two owners
   * and a 24h TTL against a moving boundary. The distinction is the whole design.)
   */
  emptyStretch?: number
  /**
   * ⛔ EXPLICIT OPERATOR CHOICE ONLY — LORAMER_INCEPTION_STOP_V1. When the account's inception is UNKNOWN
   * (discovery failed, no row stored) an UNBOUNDED walk REFUSES to run. Setting this true is the operator
   * saying "walk to epoch anyway, eyes open". It is never set by code; no default ever supplies it.
   */
  walkToEpoch?: boolean
}
