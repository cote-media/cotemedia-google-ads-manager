// LORAMER_CAPTURE_SURFACE_MANIFEST_V1
//
// THE DECLARED VENDOR SURFACE per (platform, breakdown_type/family): the FULL grain set the vendor serves + the
// captured|gap|on-demand|deferred|removed tag + confidence. Seeded from docs/LORAMER_DATA_COMPLETENESS.md (the
// PLATFORM-SURFACE-AUDIT). This manifest is the FORCING FUNCTION: scripts/check-capture-completeness.mjs fails the
// build (via `npm run guard`, the pre-push gate) when a family tagged `captured` is captured at FEWER grains than
// declared here — docs mirror this manifest, never the reverse.
//
// `grains` = the vendor-complete entity-level set for that (platform, breakdown_type), in the platform's native
//   vocab: google = account|campaign|ad_group|ad|keyword ; meta = account|campaign|ad_set|ad ; ga/shopify/woo = account|product|variant.
//   An entity level the vendor genuinely does NOT serve is EXCLUDED (e.g. Meta creative-asset "account" returns
//   empty → 3 grains IS complete; Google hour ad/keyword are REJECTED → 2 grains IS complete). That honesty is what
//   keeps the gate from false-flagging a "slice" that is actually the full served surface.
// `status`: captured (built + should be complete) · gap (vendor serves it, not built) · on-demand · deferred · removed.
// The gate CHECKS `captured` families only; gap/on-demand/deferred/removed are the queue, never flagged.
//
// KNOWN SLICE (the seed example): Meta placement — vendor serves 4 grains, writer is campaign-only.
// KNOWN REMOVED: Meta `dma` — Meta removed the breakdown 2026 (→ comscore_market, forward-only; captured as geo_dma gap).

const G4 = ['account', 'campaign', 'ad_set', 'ad']         // Meta: all four ad grains
const GEO_CA = ['campaign', 'ad_group']                     // Google geo/hour: served at campaign + ad_group only (ad/keyword rejected)
const V = 'VERIFIED', D = 'DERIVED'
// Google geo family — 19 real breakdown_types, each served at campaign + ad_group (ad/keyword rejected). Complete.
const GOOGLE_GEO = [
  'geo_city', 'geo_country', 'geo_county', 'geo_district', 'geo_metro', 'geo_most_specific', 'geo_postal', 'geo_province', 'geo_region', 'geo_state',
  'user_geo_city', 'user_geo_county', 'user_geo_district', 'user_geo_metro', 'user_geo_most_specific', 'user_geo_postal', 'user_geo_province', 'user_geo_region', 'user_geo_state',
]
const GA_FAMILIES = ['ga_source_medium', 'ga_channel', 'ga_campaign', 'ga_landing_page', 'ga_device', 'ga_geo_country', 'ga_geo_region', 'ga_geo_city', 'ga_age', 'ga_gender', 'ga_event', 'ga_item']

export const VENDOR_SURFACE = {
  meta: {
    // ── ad breakdowns, vendor-complete = 4 grains ──
    placement: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'publisher_platform×platform_position at campaign+ad_set+ad (LORAMER_META_PLACEMENT_ADSET_AD_V1). account is DERIVE-NOT-CAPTURE — the clean rollup of campaign (Σ placement == account spend to the cent), so complete = 3 grains, not 4.' },
    device: { grains: G4, status: 'captured', confidence: V },
    device_platform: { grains: G4, status: 'captured', confidence: V },
    age: { grains: G4, status: 'captured', confidence: V },
    gender: { grains: G4, status: 'captured', confidence: V },
    age_gender: { grains: G4, status: 'captured', confidence: V },
    hour: { grains: G4, status: 'captured', confidence: V },
    action_type: { grains: G4, status: 'captured', confidence: V },
    video: { grains: G4, status: 'captured', confidence: V },
    geo_country: { grains: G4, status: 'captured', confidence: V },
    geo_region: { grains: G4, status: 'captured', confidence: V },
    attribution_window: { grains: G4, status: 'captured', confidence: V, note: 'M-FILL#2 (per action_type × window). Captured; verify wired into breakdown-registry.ts.' },
    // creative-asset family — vendor serves campaign/ad_set/ad ONLY (account returns empty → 3 grains IS complete)
    image_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'M-FILL#1. account served-empty per probe → 3 grains complete.' },
    video_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V },
    title_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V },
    body_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V },
    call_to_action_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V },
    description_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V },
    link_url_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V },
    // LORAMER_META_BATCH_MA_V1 — M1 click variants (outbound/inline_link/unique) and M2 ranking (quality/
    // engagement_rate/conversion_rate, AD LEVEL ONLY) are INSIGHTS METRIC FIELDS that ride the base row's
    // extra. They are NOT breakdown families: no breakdown_type, no rows of their own, nothing for the
    // grain gate to check. Recorded here so nobody re-proposes them as missing families.
    // ranking's 'gap' entry below is therefore RETIRED — it is captured, just not as a breakdown.
    // ── gaps (vendor serves, not built) — never flagged ──
    geo_dma: { grains: G4, status: 'gap', confidence: V, note: 'M-FILL#3. `dma` REMOVED by Meta 2026 → comscore_market (market/DMA), FORWARD-ONLY (~2026-06+), only comScore-measured campaigns populate. Not built.' },
    ranking: { grains: ['ad'], status: 'removed', confidence: V, note: 'CAPTURED as base-row extra at ad grain (LORAMER_META_BATCH_MA_V1) — quality/engagement_rate/conversion_rate_ranking are metric FIELDS, not a breakdown, so there is no breakdown_type and nothing for the grain gate to check. Marked removed (not gap) so it is neither flagged nor re-proposed.' },
    product_id: { grains: G4, status: 'gap', confidence: V, note: 'catalog product_id grain — M-FILL#4.' },
  },
  google: {
    search_term: { grains: ['ad_group'], status: 'captured', confidence: V },
    keyword: { grains: ['ad_group'], status: 'captured', confidence: V },
    device: { grains: ['campaign', 'ad_group', 'ad', 'keyword'], status: 'captured', confidence: V },
    hour: { grains: GEO_CA, status: 'captured', confidence: V, note: 'ad/keyword REJECTED by Google → campaign+ad_group is complete.' },
    conversion_action: { grains: ['campaign', 'ad_group', 'keyword'], status: 'captured', confidence: V, note: 'vendor serves conv-action at ad_group + keyword too; writer is campaign-only → SLICE (queue G-FILL#9).' },
    impression_share: { grains: ['campaign', 'ad_group'], status: 'captured', confidence: V, note: 'vendor serves IS at ad_group too; writer is campaign-only → SLICE (queue G-FILL#9).' },
    age: { grains: GEO_CA, status: 'captured', confidence: V, note: 'G-FILL#3. age_range_view served at campaign+ad_group (ad/keyword not served). Captured; verify wired into breakdown-registry.ts.' },
    gender: { grains: GEO_CA, status: 'captured', confidence: V, note: 'G-FILL#3. gender_view campaign+ad_group. Captured; verify wired into breakdown-registry.ts.' },
    // gaps
    ad_network_type: { grains: ['campaign'], status: 'gap', confidence: V, note: 'G-FILL#4.' },
    video: { grains: ['campaign'], status: 'gap', confidence: V, note: 'G-FILL#5 (video metrics).' },
    ...Object.fromEntries(GOOGLE_GEO.map((bt) => [bt, { grains: GEO_CA, status: 'captured', confidence: V }])),
  },
  ga: Object.fromEntries(GA_FAMILIES.map((bt) => [bt, { grains: ['account'], status: 'captured', confidence: V }])),
  shopify: {
    geo_country: { grains: ['account'], status: 'captured', confidence: V },
    geo_region: { grains: ['account'], status: 'captured', confidence: V },
    // S-FILL#2 — abandoned-checkout POTENTIAL/LOST revenue (Σ totalPriceSet) + count, account-day, WRITE-ONLY
    // (never summed into net sales). Shopify retains abandoned checkouts only ~90 days → forward-first + shallow
    // backfill; the completion-gate must NOT expect orders-depth full history here. Complete at account grain.
    abandoned_checkout: { grains: ['account'], status: 'captured', confidence: V, note: 'value+count, WRITE-ONLY (potential/lost, never net sales); ~90-day retention floor, forward-first, NOT full history (LORAMER_SHOPIFY_ABANDONED_VALUE_V1).' },
    // S-FILL#3 — per discount-code applied amount (line-item allocations) + orders-using, account-day, WRITE-ONLY
    // (a SUBSET of total discounting; never summed into net sales or the order discount total).
    discount_code: { grains: ['account'], status: 'captured', confidence: V, note: 'per-code applied amount + orders-using, account-day, WRITE-ONLY (subset of total discounting; never net sales / order discount total) (LORAMER_SHOPIFY_DISCOUNT_CODE_V1).' },
    // S-FILL#7 — order time-of-day, RAW. One row per order; breakdown_value = verbatim Shopify UTC timestamp to the
    // second, NEVER bucketed at write time (a later client-timezone model re-buckets history with zero recapture).
    // Vendor serves Order.createdAt on the SAME OrdersInRange call — a field-widen, not a second request. Account grain
    // is the full served surface here (an order is an account-level event; product/variant are line grains, not orders).
    // BATCH B — collection membership via a SEPARATE id-batched call (the orders-query widen is rejected
    // by Shopify at 1,036 pts). Non-additive + capture-time snapshot.
    product_collection: { grains: ['account'], status: 'captured', confidence: V, note: 'separate batched call (widen rejected at 1036 pts); NON-ADDITIVE over-count like product_tag; CAPTURE-TIME SNAPSHOT membership (LORAMER_SHOPIFY_BATCH_B_V1).' },
    // BATCH C — customer cohort. Rides the EXISTING customer nodes(ids:) call (two scalars widened, no
    // new request). LTV is carried in extra as a labelled LIFETIME attribute, never a summable column.
    customer_cohort: { grains: ['account'], status: 'captured', confidence: V, note: 'lifetime-order-count buckets 1/2-3/4-9/10+; partitions day net; extra.avgLifetimeSpent is LIFETIME, not windowed, never summed; non-PII (LORAMER_SHOPIFY_BATCH_C_V1).' },
    // BATCH A3 — order status. CAPTURE-TIME SNAPSHOT families: mutable, so a re-walk of the same day can
    // return different values and backfilled history reads as more settled than recent days. That is an
    // artifact of WHEN we captured, not a trend; the caveat is surfaced to Lora in metrics-query.ts.
    financial_status: { grains: ['account'], status: 'captured', confidence: V, note: 'partitions day net; CAPTURE-TIME SNAPSHOT, mutable, re-walk-unstable (LORAMER_SHOPIFY_BATCH_A3_V1).' },
    fulfillment_status: { grains: ['account'], status: 'captured', confidence: V, note: 'partitions day net; CAPTURE-TIME SNAPSHOT, same semantics as financial_status (LORAMER_SHOPIFY_BATCH_A3_V1).' },
    // BATCH A2 — product grouping, widened off lineItems.product (scalars + tags list, same single call).
    product_type: { grains: ['account'], status: 'captured', confidence: V, note: 'partitions day net (one type per product), same per-line net basis as the product grain (LORAMER_SHOPIFY_BATCH_A2_V1).' },
    product_vendor: { grains: ['account'], status: 'captured', confidence: V, note: 'partitions day net (one vendor per product) (LORAMER_SHOPIFY_BATCH_A2_V1).' },
    product_tag: { grains: ['account'], status: 'captured', confidence: V, note: 'NON-ADDITIVE by construction — many tags per product, so Σ tag EXCEEDS day net; never sum or reconcile. High cardinality (LORAMER_SHOPIFY_BATCH_A2_V1).' },
    // BATCH A1 — three families off the SAME widened OrdersInRange call (no second request, no migration).
    geo_city: { grains: ['account'], status: 'captured', confidence: V, note: 'ship-to CITY, composite "<country>-<province>-<city>"; partitions day net like country/region; high cardinality (LORAMER_SHOPIFY_BATCH_A1_V1).' },
    sales_channel: { grains: ['account'], status: 'captured', confidence: V, note: 'order attribution by channelDefinition.handle; PARTITIONS day net (one channel per order), FLAG-NOT-BLOCK vs the account anchor (S-FILL#1, LORAMER_SHOPIFY_BATCH_A1_V1).' },
    discount_type: { grains: ['account'], status: 'captured', confidence: V, note: 'TYPE axis of discounting (code/manual/automatic/script), sibling to discount_code. WRITE-ONLY, non-additive, overlapping subset — never net sales (LORAMER_SHOPIFY_BATCH_A1_V1).' },
    order_time: { grains: ['account'], status: 'captured', confidence: V, note: 'RAW UTC order timestamps to the second, unbucketed; entity_id = order id so same-second orders cannot collide; additive to account net (LORAMER_SHOPIFY_ORDER_TIME_V1).' },
  },
  woocommerce: {
    // ZERO breadth today — every dimension is a gap (coupons/category/geo/customer-mix/status/time-of-day). Nothing
    // `captured` to grain-check; the W-FILL queue owns these.
  },
}

// KNOWN_INCOMPLETE — the accepted baseline = THE ORDERED COMPLETION QUEUE. Each "<platform>.<breakdown_type>" here is
// a `captured` family the gate has ALREADY flagged as a slice/unwired; listing it grandfathers it (the gate does not
// re-fail on it) so the build isn't bricked. A NEW slice not listed here FAILS the push. When a family is completed
// (full vendor grains + wired into breakdown-registry.ts), REMOVE it here — the gate's stale-baseline check enforces that.
// Populated from the first discovery run (2026-07-18). DO NOT auto-fix the underlying slices; work them off deliberately.
export const KNOWN_INCOMPLETE = [
  // SLICE — captured at fewer grains than the vendor serves (deepen the writer to full grain):
  // (2026-07-18) meta.placement COMPLETED to campaign+ad_set+ad (LORAMER_META_PLACEMENT_ADSET_AD_V1) — removed here.
  // HELD-FOR-4AM: the deepened writers ARE authored (G-FILL#9) but live on branch wip/google-gfill1-9-held-4am,
  // NOT on main — their Gate-A (live GAQL validation) is blocked on the 2026-07-19 ~04:03 ET Google quota reset.
  // These two stay baselined on main (NOT silently passing) until that branch proves + merges. Do NOT hand-remove.
  'google.conversion_action',    // campaign-only on main → +ad_group,keyword on wip (G-FILL#9, HELD-FOR-4AM)
  'google.impression_share',     // campaign-only on main → +ad_group on wip (G-FILL#9, HELD-FOR-4AM)
  // (2026-07-18) The 10 UNWIRED families — the 7 Meta assets, meta.attribution_window, google.age, google.gender —
  // were WIRED into src/lib/breakdown-registry.ts (LORAMER_ASSET_ATTRWINDOW_WIRE_V1) and REMOVED here; the gate's
  // stale-baseline check now confirms they are complete (captured + query-readable).
]

export default VENDOR_SURFACE
