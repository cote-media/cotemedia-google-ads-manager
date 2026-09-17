// LORAMER_RUN_PROGRESS_SIGNAL_V1 — THE ONE PLACE A UNIVERSE'S NAME IS TRANSLATED INTO THE ATTEMPT LEDGER'S SPELLING.
//
// ⛔ THE TWO LEDGERS SPELL THE VENDOR DIFFERENTLY, AND THAT IS NOT A TYPO (google-op-budget.ts:586). The capture
// universe is named for the vendor API — `google_ads`, universe-window-log.ts — per
// LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1; the attempt ledger (universe_attempt_log) writes the v2 contract's
// VENDOR, `google`. A run is addressed by the universe's name (LORAMER_CONTINUOUS_RUN_V1) and read its progress by
// passing that name straight into the ledger, where it matched NOTHING — on every step — so a lane that was
// moving read as still and ended itself (Tri-Copy, 2026-09-16). The same spelling class the dimension paid for
// the night before (LORAMER_ENTITY_DIMENSION_V1 step 3).
//
// ⛔ IMPORTS, NEVER RE-DECLARES. Both spellings keep their single owner (single-owner-vendor-facts.guard); this
// module only joins them. It is deliberately its own file: universe-v2-contract.ts and universe-window-log.ts are
// each compiled standalone by guards, and a runtime import between them would break those harnesses.
import { VENDOR as UNIVERSE_VENDOR } from '@/lib/backfill/universe-window-log'
import { VENDOR as LEDGER_VENDOR } from '@/lib/backfill/universe-v2-contract'

/** The spelling `universe_attempt_log.vendor` carries for a run keyed by a universe's name. Unknown names pass through. */
export function ledgerVendorFor(universeVendor: string): string {
  return universeVendor === UNIVERSE_VENDOR ? LEDGER_VENDOR : universeVendor
}
