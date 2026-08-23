// LORAMER_SHOPIFY_CANCELLED_EXCLUDED_V1 — the order-aggregation SITE COUNT. Deliberate-change-only.
//
// ⛔ NOT A MUTE AND NOT A RATCHET IN EITHER DIRECTION. This number is the count of places in this codebase
// that page Shopify orders and count or sum them. It changes only when someone deliberately adds or removes
// such a place — and when they do, they must prove BOTH legs (requests `cancelledAt`, filters on it) for the
// new site in the same commit. The guard fails on a mismatch either way, because a site quietly disappearing
// is as interesting as one quietly appearing.
//
// MEASURED 2026-08-23:
//   src/app/api/shopify/daily/route.ts        — the LEGACY dashboard chart (orders · revenue · avgOrderValue)
//   src/lib/intelligence/shopify-intelligence.ts — the captured path (account totals, breakdowns, money)
// These two disagreed on order count for months: the captured path filtered cancelled orders from
// LORAMER_SHOPIFY_CANCELLED_ACCURACY_V1 onward, and the chart never asked the vendor for the field.
export const SITES_BASELINE = 2
