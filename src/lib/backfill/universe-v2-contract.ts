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
