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
  /** The floor for THIS account. Undefined falls back to the documented wall via VENDOR_FLOOR_DATE. */
  floorDate?: string
}
