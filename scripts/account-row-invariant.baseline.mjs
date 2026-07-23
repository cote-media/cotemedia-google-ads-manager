// LORAMER_ACCOUNT_ROW_INVARIANT_V1 — BASELINE (data, NOT a code exemption).
//
// Known, accepted account-row-per-day violations, recorded as EXACT (client_id, platform, [from..to]) windows —
// the same shape-as-data idea as capture-surface.manifest.mjs's KNOWN_INCOMPLETE (the completion queue), but for a
// live-DB integrity condition rather than a code/manifest parity finding.
//
// EXACT, NOT A BLANKET MUTE: a violation is baselined ONLY when its (client_id, platform) matches AND its date falls
// within [from, to] inclusive. A NEW violation for the SAME client+platform OUTSIDE the range still FAILS the guard.
// This is a bounded grandfather of a KNOWN historical hole, never a "stop checking woocommerce for Shelley".
//
// THE ONE ENTRY (verified 2026-07-23, node scripts/check-capture-landing.mjs --invariant-only): 733 days, all
// Shelley Kyle (23c697bb) / woocommerce, 2016-10-22 .. 2018-12-10 — pre-2019 deep-backfill order/product rows written
// without a daily account-grain total. The range ENDS exactly at the 2018-12-10 host-500 deep-backfill wall
// (LORAMER_QUEUE_OF_RECORD.md — WOO SHELLEY RE-CAPTURE STALL / QUEUE #7). This baseline CLEARS when QUEUE #7 is
// addressed and those days are re-captured with their account rows; at that point the guard's stale-baseline notice
// fires and THIS ENTRY should be removed (the queue can only shrink).
export const KNOWN_ACCOUNT_ROW_VIOLATIONS = [
  {
    clientId: '23c697bb-5255-4289-9329-659544ba8e6e',
    platform: 'woocommerce',
    from: '2016-10-22',
    to: '2018-12-10',
    note: 'pre-2019 Shelley woo deep backfill; ends at the 2018-12-10 host-500 wall (QUEUE #7)',
  },
]
