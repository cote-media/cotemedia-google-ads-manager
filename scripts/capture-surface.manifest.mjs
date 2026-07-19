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
    // LORAMER_META_BATCH_MB_V1 (M-FILL#1b) — four MORE individual asset dims, probed before adding.
    ad_format_asset: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'M-FILL#1b, probed-then-added 2026-07-19. WRITE-ONLY non-additive asset dim; account served-empty → 3 grains complete (LORAMER_META_BATCH_MB_V1).' },
    creative_relaxation_asset_type: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'M-FILL#1b, probed-then-added 2026-07-19. WRITE-ONLY non-additive asset dim; account served-empty → 3 grains complete (LORAMER_META_BATCH_MB_V1).' },
    flexible_format_asset_type: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'M-FILL#1b, probed-then-added 2026-07-19. WRITE-ONLY non-additive asset dim; account served-empty → 3 grains complete (LORAMER_META_BATCH_MB_V1).' },
    gen_ai_asset_type: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'M-FILL#1b, probed-then-added 2026-07-19. WRITE-ONLY non-additive asset dim; account served-empty → 3 grains complete (LORAMER_META_BATCH_MB_V1).' },
    // NOT ADDED and recorded so they are not re-proposed: media_type_asset is NOT a valid breakdown name
    // (Meta's 89-value list does not contain it — the audit's name was wrong); media_type / media_format are
    // ACTION breakdowns Meta rejects in this combination; creative_automation_asset_id is valid but returned
    // ZERO rows on both probe clients.
    creative_automation_asset_id: { grains: ['campaign', 'ad_set', 'ad'], status: 'on-demand', confidence: V, note: 'valid breakdown, ZERO rows on both probe clients 2026-07-19 — not worth a report/level/lap until a client populates it (same posture as SKAN).' },
    // ── gaps (vendor serves, not built) — never flagged ──
    comscore_market: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'M-FILL#3 SHIPPED — the forward-only replacement for the REMOVED `dma`. Empty = account not comScore-measured, NOT a gap (LORAMER_META_BATCH_MG_V1).' },
    frequency_value: { grains: G4, status: 'on-demand', confidence: V, note: 'NOT BUILT — deliberately. MEASURED 2026-07-19: zero rows on every probe account — Meta serves it only for reach/frequency-optimised buys, which no cohort client runs. A writer WAS written and then REMOVED: the meta-breadth-forward guard correctly refuses a writer that exists without forward wiring (a backfill-only dim freezes at its ship date — the G1 lesson), and weakening that guard to house dead code would be the wrong trade. The shared engine (meta-simple-breakdown-core.ts) is shipped, so re-adding this is a ~6-line FieldCfg plus its forward+drain entries when a client with reach/frequency buys arrives (same posture as SKAN).' },
    ranking: { grains: ['ad'], status: 'removed', confidence: V, note: 'CAPTURED as base-row extra at ad grain (LORAMER_META_BATCH_MA_V1) — quality/engagement_rate/conversion_rate_ranking are metric FIELDS, not a breakdown, so there is no breakdown_type and nothing for the grain gate to check. Marked removed (not gap) so it is neither flagged nor re-proposed.' },
    product_id: { grains: ['campaign', 'ad_set', 'ad'], status: 'captured', confidence: V, note: 'M-FILL#4 SHIPPED. WRITE-ONLY (measured: does not partition even within catalog campaigns); account derive-not-capture → 3 grains complete (LORAMER_META_BATCH_MG_V1).' },
  },
  google: {
    search_term: { grains: ['ad_group'], status: 'captured', confidence: V },
    keyword: { grains: ['ad_group'], status: 'captured', confidence: V },
    device: { grains: ['campaign', 'ad_group', 'ad', 'keyword'], status: 'captured', confidence: V },
    hour: { grains: GEO_CA, status: 'captured', confidence: V, note: 'ad/keyword REJECTED by Google → campaign+ad_group is complete.' },
    conversion_action: { grains: ['campaign', 'ad_group', 'keyword'], status: 'captured', confidence: V, note: 'G-FILL#9 DEEPENED (LORAMER_GOOGLE_CONV_ACTION_DEEP_V1) — was campaign-only; writer now covers the ad_group + keyword grains the vendor serves. Grain parity proven by this gate; landed rows are check-capture-landing.mjs.' },
    impression_share: { grains: ['campaign', 'ad_group'], status: 'captured', confidence: V, note: 'G-FILL#9 DEEPENED (LORAMER_GOOGLE_IS_DEEP_V1) — was campaign-only; writer now covers ad_group. NON-ADDITIVE point-in-time ratios (see breakdown-registry).' },
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
    // BATCH W-A (LORAMER_WOO_BATCH_WA_V1) — NINE families, all read off the /wc/v3/orders payload we ALREADY
    // download (measured 8,935 bytes/order on the probe store, of which we previously read ~six fields). ZERO
    // new vendor requests, so no additional load on the merchant's self-hosted WordPress server.
    //
    // THIS BLOCK USED TO BE EMPTY, WHICH MEANT THE COMPLETENESS GATE CHECKED **ZERO** FAMILIES FOR AN ENTIRE
    // PLATFORM — and not only because nothing was listed: check-capture-completeness.mjs:54 grain-checks
    // `captured` families ONLY, so listing the gaps would not have helped either. Shipping these nine as
    // `captured` is what actually switches the gate on for WooCommerce.
    //
    // GRAIN COMPLETENESS: `account` IS the full served surface for every one of these. An order is an
    // account-level event; product and variant are LINE grains and carry no billing address, no payment
    // method, no order status and no coupon. Declaring them would over-declare a surface the vendor does not
    // serve — the honesty this manifest's header calls out as what keeps the gate from false-flagging.
    geo_country: { grains: ['account'], status: 'captured', confidence: V, note: 'BILLING-address country (billing, not ship-to: Woo shipping is empty for digital/pickup). Partitions day net on the wooNetOf basis (incl shipping+tax, refund-netted) — NOT the Shopify net basis (LORAMER_WOO_BATCH_WA_V1).' },
    geo_region: { grains: ['account'], status: 'captured', confidence: V, note: 'BILLING state/province, composite "<cc>-<state>"; partitions day net (LORAMER_WOO_BATCH_WA_V1).' },
    geo_city: { grains: ['account'], status: 'captured', confidence: V, note: 'BILLING city, composite "<cc>-<state>-<city>" (bare city is ambiguous); partitions day net; high cardinality. PII: country/state/city only — never postcode/street/email/phone/name (LORAMER_WOO_BATCH_WA_V1).' },
    payment_method: { grains: ['account'], status: 'captured', confidence: V, note: 'one gateway per order → partitions day net; value = editable title, stable slug in extra (LORAMER_WOO_BATCH_WA_V1).' },
    order_status: { grains: ['account'], status: 'captured', confidence: V, note: 'ALL statuses incl. failed/cancelled/pending — previously fetched then DISCARDED. WRITE-ONLY: a SUPERSET of account net, not a partition of it; only the isSale subset {completed,processing,refunded} ties to net (LORAMER_WOO_BATCH_WA_V1).' },
    shipping_method: { grains: ['account'], status: 'captured', confidence: V, note: 'WRITE-ONLY — shipping_lines is an ARRAY (split shipments), so money is the shipping CHARGE in conversionValue and revenue is forced 0; orders counted once PER METHOD (LORAMER_WOO_BATCH_WA_V1).' },
    coupon_code: { grains: ['account'], status: 'captured', confidence: V, note: 'per-code applied discount from order.coupon_lines. WRITE-ONLY subset of discounting, never net sales. NOT /reports/coupons/totals — that endpoint is date-less, type-not-code, counts definitions not redemptions, cached a year (LORAMER_WOO_BATCH_WA_V1).' },
    coupon_type: { grains: ['account'], status: 'captured', confidence: V, note: 'coupon_lines.discount_type. OPEN value set, not a 3-value enum — falsified at Gate-A: a real store returned the plugin type "wbte_sc_bogo" beside core "fixed_cart" (wc_get_coupon_types is a filter). BOGO coupons report $0 discount (benefit is a free product) — a real use, not a missing value. Same WRITE-ONLY posture as coupon_code (LORAMER_WOO_BATCH_WA_V1).' },
    order_time: { grains: ['account'], status: 'captured', confidence: V, note: 'RAW timestamps, unbucketed, one row per order (entity_id = order id). WOO-SPECIFIC: date_created carries NO offset, so the value is date_created_gmt normalized to UTC with both verbatim strings in extra. Row date stays the SITE-LOCAL capture day — the day key is deliberately unchanged (LORAMER_WOO_BATCH_WA_V1).' },
    // ── STILL GAP (the W-FILL queue; never grain-checked) ──
    // Category/tag is the only remaining family needing a SECOND endpoint (/wc/v3/products, id-batched with
    // _fields — measured 341 bytes/product trimmed vs 10,130 untrimmed) and must route through the backfill's
    // countedFetch so it stays inside the throttle + outbound budget + breaker. Cohort is blocked on a
    // decision, not on engineering: customer_id is 0 for GUEST checkout (measured on a real order), so
    // identity would have to come from the billing email — a new PII call that is Russ's to make.
    // BATCH W-B — the ONE Woo family needing a second endpoint. Id-batched (<=100), _fields-trimmed (measured
    // 321 bytes/product vs 10,130 untrimmed), fetched ONCE PER LAP not per day, and routed through the
    // backfill's counted+throttled wrapper so it sits inside MAX_OUTBOUND_FETCHES, THROTTLE_MS, the CAS claim
    // and the circuit-breaker. Gate-A lap: 11 sale-days cost 2 product requests, 4 outbound total of 500.
    product_category: { grains: ['account'], status: 'captured', confidence: V, note: 'separate id-batched /wc/v3/products call (line_items carry NO category). NON-ADDITIVE over-count — measured 4.43× net on a real window, up to 11 categories on one product. CAPTURE-TIME SNAPSHOT (LORAMER_WOO_BATCH_WB_V1).' },
    product_tag: { grains: ['account'], status: 'captured', confidence: V, note: 'rides the SAME batched call as product_category (no extra request). Measured 0/71 products tagged on the probe store — an EMPTY family means this store does not tag, NOT a capture gap. Same non-additive + snapshot semantics (LORAMER_WOO_BATCH_WB_V1).' },
    // LORAMER_WOO_COHORT_V1 — one-shot full-history sweep with its OWN drain step: a lifetime question cannot
    // be answered from a 21-day chunk. Email identity, hashed in memory, never stored. Ceiling 20,000 orders;
    // over it the family emits NOTHING loudly rather than a partial sweep carrying wrong lifetime counts.
    customer_cohort: { grains: ['account'], status: 'captured', confidence: V, note: 'TRUE-lifetime buckets 1/2-3/4-9/10+ via EMAIL identity (registered AND guest — customer_id is 0 for guests, who are 86% of orders on the real store). Identity = in-memory sha256, NEVER stored; only bucket + money land. UNKNOWN = no email on the order, kept IN the partition. Partitions day net. Store-size ceiling 20,000 orders (LORAMER_WOO_COHORT_V1).' },
  },
}

// KNOWN_INCOMPLETE — the accepted baseline = THE ORDERED COMPLETION QUEUE. Each "<platform>.<breakdown_type>" here is
// a `captured` family the gate has ALREADY flagged as a slice/unwired; listing it grandfathers it (the gate does not
// re-fail on it) so the build isn't bricked. A NEW slice not listed here FAILS the push. When a family is completed
// (full vendor grains + wired into breakdown-registry.ts), REMOVE it here — the gate's stale-baseline check enforces that.
// Populated from the first discovery run (2026-07-18). DO NOT auto-fix the underlying slices; work them off deliberately.
export const KNOWN_INCOMPLETE = [
  // THE QUEUE IS EMPTY — every discovered slice/unwired family is resolved:
  //   (2026-07-18) meta.placement → campaign+ad_set+ad (LORAMER_META_PLACEMENT_ADSET_AD_V1);
  //   (2026-07-18) the 10 UNWIRED (7 Meta assets + meta.attribution_window + google.age/gender) → wired into
  //     src/lib/breakdown-registry.ts (LORAMER_ASSET_ATTRWINDOW_WIRE_V1);
  //   (2026-07-20) google.conversion_action → +ad_group+keyword, google.impression_share → +ad_group
  //     (G-FILL#9, LORAMER_GOOGLE_CONV_ACTION_DEEP_V1 / _IS_DEEP_V1) — the two entries baselined here on main as
  //     HELD-FOR-4AM are removed BECAUSE the deepened writers now exist on main (rebased off
  //     wip/google-gfill1-9-held-4am); leaving them listed would trip the gate's own stale-baseline check.
  // Code-parity (registry↔manifest) is COMPLETE. CODE-PARITY IS NOT LANDED ROWS: G-FILL#9's live GAQL Gate-A runs
  // against the 2026-07-20 quota window, and live-DB reachability is scripts/check-capture-landing.mjs's question,
  // never this manifest's (this file gates GRAIN PARITY and says so on its own face).
]

export default VENDOR_SURFACE
