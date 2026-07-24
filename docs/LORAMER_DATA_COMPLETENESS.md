# LoraMer — Data Completeness: Gap Matrix + Rollout Plan
GOVERNING RULE: retrieve ALL data from everywhere + store it FOREVER (until the customer cancels).

## CAPTURE STATE — 2026-07-19 (the number this doc's deltas roll up to)
The capture surface is GENERATED, not asserted: scripts/capture-surface.manifest.mjs declares it and
scripts/check-capture-completeness.mjs fails the build on drift. As of tonight the gate checks **91 captured
families** — google 27 · meta 25 · shopify 15 · woocommerce 12 · ga 12. Those five numbers are the honest
denominator for everything below; if a section here disagrees with the manifest, the manifest is right and
this doc is stale.

THREE PLATFORMS CLOSED THEIR NEVER-STARTED LIST TODAY. Shopify 7 → 0, Meta 8 → 3 (all three remaining are
recorded decisions, not unbuilt work), WooCommerce 7 → 0 from a standing start of ZERO breadth families and
an EMPTY manifest block — which meant the completeness gate had been checking literally nothing for an entire
platform. Per-platform detail is in the sections below; build ORDER and open items stay owned by
LORAMER_QUEUE_OF_RECORD.md.

## STATUS (2026-06-29)
- WAVE 0 audit DONE (read-only per-client × platform × grain map). Account-grain "barbell holes" (BusyBee/Glass Plus/skinregimen/Influential) DISMISSED — those accounts weren't running Google ads in the missing years (true zero, not loss); no account-range writer now, banked for future real gaps. search_term/keyword = BANKED-AND-GROWING (persist forever).
- WAVE 1 Fix-1a SHIPPED (8377b97): Woo product capture UNCAPPED via Shopify-shaped `productsCapture` — closes the >10-product/day data-loss. Display top-10 + frozen read-cap untouched.
- WAVE 1 Fix-1b SHIPPED (3e74e0b): Woo product grain REFUND-NETTED pro-rata to account net (o.total basis incl shipping/tax) — each product's netRevenue = its gross-share of wooNetOf(order); Σproduct ≡ account net, residual 0 PER CLIENT. extra.netBasis='account_net_incl_shipping_tax_prorata_by_gross_share'. Per-platform basis difference (Woo incl shipping/tax vs Shopify subtotal-excl) carried by tooltips (ROADMAP revenue-basis tooltips).
- BANKED FUTURE ADJUSTMENT (Path 1, NOT now): if a single client ever runs BOTH Shopify and Woo, re-base BOTH Woo grains (account + product) to subtotal-net excl shipping/tax to match Shopify exactly — requires an account-grain re-base + a throttled N+1 GET /orders/<id>/refunds (per refunded order only) to isolate the refunded line-subtotal, which Woo's /orders does not expose. Deferred: near-zero likelihood; per-platform tooltips cover the meantime.
- WAVE 1 STATUS: Woo all-products (1a) + Woo refund-net (1b) DONE forward. REMAINING Wave 1 = Meta placement persist (fetched-but-dropped; breakdown_type='placement'). Shelley history re-capture = Wave 2, post-1b, both grains (all-products + refund-netted) in ONE idempotent pass.

AVAILABLE (official API docs, Jun 2026) vs HAVE (adapter inventory) vs GAP. Two gap types: DEPTH = a grain we capture forward but never backfilled (silent risk); BREADTH = a dimension the API offers we don't capture at all (future scope, not lost).

## GOOGLE ADS — PLATFORM-SURFACE-AUDIT RESULT (vendor-sourced 2026-07-18)
This is the real ★ PLATFORM-SURFACE-AUDIT result for Google (LORAMER_QUEUE_OF_RECORD.md ★ PLATFORM-SURFACE-AUDIT). Reference = Google Ads API field reference, v22–v25, the VENDOR'S own docs — NOT our writers/inventory/registry. It REPLACES the prior hand-from-memory "AVAILABLE" line. OFFERED (vendor docs) vs CAPTURED (metrics_daily). Confidence tags are load-bearing: [VERIFIED] = confirmed against the field reference; [DERIVED] = inferred, NOT yet doc-confirmed — do not act as if proven.

HAVE (CAPTURED): base grains account→ad + keyword; breakdowns search_term, keyword, device (4-grain), geo (19 grains, both families), hour (campaign+ad_group), conversion_action (campaign-only), impression_share (campaign-only).

GAP — OFFERED, NOT CAPTURED:
A. FETCHED-THEN-DROPPED: age_range_view, gender_view — pulled live, 0 rows persisted (defect G3). [VERIFIED] → ✅ RESOLVED 2026-07-18 (G-FILL#3 SHIPPED, LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 + _BACKFILL_V1): now persisted at campaign + ad_group as canonical enum values (AGE_RANGE_* / MALE / FEMALE / UNDETERMINED). Moved from GAP to HAVE.
B. METRICS: all_conversions + all_conversions_value [VERIFIED]; view_through_conversions [VERIFIED]; video views/view_rate/quartile_p25/p50/p75/p100_rate [VERIFIED]; interactions/interaction_rate/engagements [VERIFIED]; cross_device_conversions [DERIVED]; phone-call metrics [DERIVED].
C. SEGMENTS: ad_network_type (Search/Display/YouTube/Partners) [VERIFIED]; product_* family = Google Shopping product grain (product_item_id/brand/type/channel) [VERIFIED]; click_type [VERIFIED]; slot [VERIFIED]; conversion_or_adjustment_lag_bucket [VERIFIED]; niche: SKAdNetwork, hotel_* [DERIVED, on-demand].
D. REPORT VIEWS: assets/asset_group/asset_group_top_combination_view = PMax asset-combination attribution, LAW-CORE [DERIVED-strong, we have queried this view before]; Google Display/YouTube placements group_placement_view/detail_placement_view [DERIVED]; audiences ad_group_audience_view/campaign_audience_view [VERIFIED reportable]; landing_page_view/expanded_landing_page_view [DERIVED]; distance_view/store-visits [DERIVED, niche].
E. GRAIN TOO SHALLOW: conversion_action campaign-only → offered at ad_group+keyword; impression_share campaign-only → offered at ad_group.
EXCLUDED (Russ, deferred not dropped): click_view / GCLID / click-level identifiers — PII line, revisit later.
COST: each fill = more rows + more Google Ads API ops/client/day against the Basic 15k/day cap (already starved the cron once). Filling raises ops → Standard Access application is now a real dependency, start regardless of build order.

RANKED FILL QUEUE (G-FILL#1..#10 + ON-DEMAND + DEFERRED) lives in LORAMER_QUEUE_OF_RECORD.md under ★ PLATFORM-SURFACE-AUDIT — that queue owns the build ORDER; this section owns the offered-vs-captured DELTA. DEPTH status (owned by LORAMER_DECISIONS / the QUEUE, pointer only): campaign backfill WIRED+SCALED cohort-wide; ad_group/ad + keyword/search_term ~90d unchanged.

## META ADS — PLATFORM-SURFACE-AUDIT RESULT (vendor-sourced 2026-07-18)
Reference = Meta Marketing / Insights API field reference, the VENDOR'S own docs — NOT our writers/inventory. OFFERED (vendor docs) vs CAPTURED (metrics_daily). [VERIFIED] = doc-confirmed; [DERIVED] = inferred, not yet doc-confirmed.

HAVE (CAPTURED): base 4-grain (acct/campaign/adset/ad); breakdowns placement (campaign+ad_set+ad — grain-complete 2026-07-18, LORAMER_META_PLACEMENT_ADSET_AD_V1; account = derive-not-capture, clean rollup of campaign; publisher_platform = facebook/instagram/messenger/audience_network, WhatsApp is NOT a placement [click-to-WhatsApp delivers on FB/IG, measured as messaging action_types], platform_position complete by raw-composite), device, device_platform, age, gender, age_gender, geo_country, geo_region, hour, action_type (full taxonomy), video (10 dedicated cols).

GAP — OFFERED, NOT CAPTURED:
A. [LAW-CORE] creative-asset breakdowns: image_asset / video_asset / title_asset / body_asset / call_to_action_asset / description_asset / link_url_asset [VERIFIED] — the Meta analog of Google asset-combination attribution. → 🔄 IN PROGRESS 2026-07-18 (M-FILL#1 SHIPPED, LORAMER_META_ASSET_CAPTURE_V1): all 7 now FORWARD-WIRED + drain-registered at campaign/adset/ad (NOT account — served-empty), WRITE-ONLY, real labels. More asset dims (ad_format/media_type/creative_relaxation/flexible_format/gen_ai) = M-FILL#1b; account media-library structure = M-FILL asset-inventory.
B. attribution-window dimension — we store 7d_click only; 1d_click / 7d_click / 1d_view are served [VERIFIED]. → ✅ FORWARD-WIRED 2026-07-18 (M-FILL#2 SHIPPED, LORAMER_META_ATTRIBUTION_WINDOW_V1): breakdown_type='attribution_window' captures per (action_type × window) at all 4 grains, full populated set incl 28d_click (probe: 28d NOT deprecated), write-only. Moved from GAP to HAVE.
C. DMA / metro geo grain (below region) [VERIFIED]. → ⛔ REMOVED BY THE VENDOR + ✅ REPLACED 2026-07-19 (M4, LORAMER_META_BATCH_MG_V1): Meta deleted `dma` API-wide, so historical DMA is permanently unrecoverable — a platform purge, not a gap of ours. `comscore_market` is the forward-only successor (~2026-06+), FLAG-NOT-BLOCK, high-cardinality. It populates ONLY for comScore-MEASURED accounts: an empty or $0 result means the account is not comScore-measured, NOT missing data.
D. product_id catalog grain [VERIFIED]. → ✅ SHIPPED 2026-07-19 (M3, LORAMER_META_BATCH_MG_V1) at campaign+ad_set+ad. WRITE-ONLY / additive:false, and the posture is the finding: the brief said it would partition catalog spend, but it carries $7,128.70 against $13,889.16 on the very campaigns it appears in — a 49% shortfall, because catalog delivery is not attributable to single products. Anchoring it would flag every catalog day forever (the keyword-grain trap).
E. click variants: outbound_clicks / inline_link_clicks / unique_clicks [VERIFIED]. → ✅ SHIPPED 2026-07-19 (M1, LORAMER_META_BATCH_MA_V1) — field widens onto the existing base rows, zero new rows. NULL is preserved as NULL below Meta's impression threshold, never coerced to 0. At ACCOUNT grain unique_clicks is summed from campaigns and is therefore an UPPER BOUND, labelled as such in extra.
F. quality / engagement-rate / conversion-rate ranking [DERIVED]. → ✅ SHIPPED 2026-07-19 (M2, LORAMER_META_BATCH_MA_V1) — carried through to forward capture, not backfill-only (the G1 lesson).
G. frequency_value, SKAN / coarse_conversion_value [LOW / on-demand]. → MEASURED 2026-07-19 and DELIBERATELY NOT SHIPPED: frequency_value returns ZERO rows on both probe accounts even on days with real delivery, because Meta serves it only for reach/frequency-optimised buys and no cohort client runs them. Same evidence deferred SKAN. Trigger to build: a client with reach/frequency buys. The writer was authored and then DELETED — the breadth-forward guard refuses a writer without forward wiring, and housing dead code would have been worse than the six lines it costs to re-add.
H. creative-asset SHAPE dims: ad_format_asset / creative_relaxation_asset_type / flexible_format_asset_type / gen_ai_asset_type [VERIFIED] → ✅ SHIPPED 2026-07-19 (M-FILL#1b, LORAMER_META_BATCH_MB_V1). NOTE media_type_asset is a PHANTOM — it is not among Meta's valid breakdowns; media_type/media_format are ACTION breakdowns, a different axis.
I. account-level asset MEDIA LIBRARY (M8) — still open and DECISION-REQUIRED, not unbuilt: it has no date, no spend and no metric, so it does not belong in metrics_daily at all. Needs a storage decision first.

## SHOPIFY — PLATFORM-SURFACE-AUDIT RESULT (vendor-sourced 2026-07-18)
> **STATUS CORRECTED 2026-07-24: OPEN, not closed.** The daily-aggregate FAMILIES below are captured, but TWO grains
> below them are NOT, so Shopify is NOT complete: (1) NO ORDER-LEVEL storage — orders are fetched, summed in memory,
> and DISCARDED; only daily aggregates persist (★ORDER-LEVEL-STORAGE). An order is the store's true grain — the thing
> that gets refunded/edited/cancelled. (2) NO RESTATEMENT — the forward writer filters on order CREATED date
> (created_at) and never re-fetches, so a refund/edit/cancel AFTER a day was captured leaves that day's aggregate
> permanently wrong (★RESTATEMENT-SWEEP-FLEET; DECISIONS LORAMER_RESTATEMENT_WINDOW_LAW_V1 — Shopify/Woo want
> change-based updated_at sync). WOO CARRIES THE SAME TWO GAPS (filters date_created_gmt, no order grain). The
> capture-completeness gate read GREEN because it checks families at the daily-AGGREGATE grain only — a missing grain
> BELOW that is invisible to it.
Reference = Shopify Admin GraphQL/REST API docs, the VENDOR'S own docs — NOT our writers. OFFERED vs CAPTURED. [VERIFIED] doc-confirmed; [DERIVED] inferred.

HAVE (CAPTURED): acct / product / variant grains; net revenue, orders, full money-split, new-vs-returning, AOV; geo country/region (account grain); abandoned-checkout VALUE + count (S-FILL#2, breakdown_type='abandoned_checkout', account-day, WRITE-ONLY potential/lost revenue, ~90d retention floor); discount-code performance (S-FILL#3, breakdown_type='discount_code', account-day, WRITE-ONLY per-code applied amount from line-item allocations + orders-using, subset of total discounting never net sales).

NEVER-STARTED: 7 → **0** (2026-07-19). Fifteen captured families.

GAP — OFFERED, NOT CAPTURED:
A. sales channel / order attribution (online store / POS / Meta / Google) [VERIFIED]. → ✅ SHIPPED 2026-07-19 (S-FILL#1, LORAMER_SHOPIFY_BATCH_A1_V1): breakdown_type='sales_channel', PARTITIONS the day net (one channel per order), reconciles FLAG-NOT-BLOCK; no-channel orders bucket UNKNOWN and stay IN the partition.
B. abandoned checkouts — ✅ VALUE + count FORWARD-WIRED 2026-07-18 (S-FILL#2, LORAMER_SHOPIFY_ABANDONED_VALUE_V1): Σ totalPriceSet + count, account-day, write-only (potential/LOST revenue, NEVER net sales), forward-first with a shallow ~90-day Shopify retention floor (NOT full history like orders). Contents (line-item detail) stay UNCAPTURED by design — PII lock (id + money + timestamp only). [VERIFIED]
C. discount-code performance — ✅ FORWARD-WIRED 2026-07-18 (S-FILL#3, LORAMER_SHOPIFY_DISCOUNT_CODE_V1): per-code applied amount (EXACT, from line-item allocations — not top-level discountApplications.value) + orders-using, account-day, breakdown_type='discount_code', write-only. A SUBSET of total discounting (manual/automatic non-code discounts excluded) — never summed into net sales or the order discount total. Manual/automatic non-code discounts remain a GAP (future 'discount_type' fill). [VERIFIED]
D. product type / vendor / collection / tags grouping [VERIFIED]. → ✅ ALL FOUR SHIPPED 2026-07-19 (S-FILL#4). type + vendor PARTITION the day net (one of each per product) — BATCH A2. tag does NOT: a product carries many tags so the same net lands under every one, MEASURED 7.3× over net on a real day — additive:false, never summed. collection is the same many-to-one shape, shipped via a SEPARATE id-batched call in BATCH B because the orders-query widen was MEASURED at 1,036 points and REJECTED by Shopify before execution (see the query-cost ceiling in CLAUDE.md — that measurement now bounds every future Shopify capture family).
E. fulfillment + financial + chargeback status [VERIFIED]. → ✅ financial_status + fulfillment_status SHIPPED 2026-07-19 (BATCH A3). Both PARTITION the day net, and the LABEL is the deliverable: status is MUTABLE, so each row records what was true WHEN THE DAY WAS CAPTURED. Older history is systematically more settled than recent days, which means a rising "% paid" toward the past is an artifact of capture timing and never a business trend. Chargeback remains uncaptured.
F. customer cohorts / LTV / order-count (aggregate, non-PII) [DERIVED]. → ✅ SHIPPED 2026-07-19 (BATCH C, LORAMER_SHOPIFY_BATCH_C_V1): lifetime-order-count buckets 1/2-3/4-9/10+, riding the customer call that already ran. PARTITIONS the day net. LTV is deliberately NOT a row — avgLifetimeSpent rides extra as a LABELLED lifetime attribute because summing a lifetime figure per day counts a repeat customer's whole value once per day they order. PII lock: buckets, counts and money only; never a per-customer row.
G. order time-of-day — the writer discards timestamps [VERIFIED]. → ✅ SHIPPED 2026-07-19 (S-FILL#7, LORAMER_SHOPIFY_ORDER_TIME_V1): RAW UTC timestamp to the second, one row per order, entity_id = order id so same-second orders cannot collide. NEVER bucketed at write time — bucketing would bake a timezone into history and re-answering "what sold at 3am THEIR time" would need a full recapture.
H. city-grain + product-grain geo [DERIVED]. → ✅ geo_city SHIPPED 2026-07-19 (BATCH A1), composite '<country>-<province>-<city>' because a bare city name is ambiguous. Product-grain geo remains uncaptured.
CONSTRAINT: read_all_orders scope gates >60-day history — the 2019 backfill implies we hold it; VERIFY before Shopify backfill work [DERIVED].

## WOOCOMMERCE — PLATFORM-SURFACE-AUDIT RESULT (vendor-sourced 2026-07-18)
> **STATUS CORRECTED 2026-07-24: OPEN, not closed — SAME TWO GAPS as Shopify.** The twelve daily-aggregate breadth
> families below are captured, but the two grains BELOW them are NOT: (1) NO ORDER-LEVEL storage — Woo orders are
> fetched, summed in memory, and DISCARDED; only daily aggregates persist (★ORDER-LEVEL-STORAGE). (2) NO RESTATEMENT
> — the forward writer filters on order created date (date_created_gmt) and never re-fetches, so a refund/edit/cancel
> AFTER a day was captured leaves that day's aggregate permanently wrong (★RESTATEMENT-SWEEP-FLEET; DECISIONS
> LORAMER_RESTATEMENT_WINDOW_LAW_V1 — Shopify/Woo want change-based updated_at sync). The capture-completeness gate
> reads GREEN because it checks families at the daily-AGGREGATE grain only — a missing grain BELOW that is invisible.
Reference = WooCommerce REST API v3 + WC-Analytics reports docs, the VENDOR'S own docs — NOT our writers. OFFERED vs CAPTURED. [VERIFIED] doc-confirmed; [DERIVED] inferred.

HAVE (CAPTURED): acct / product / variant grains; net revenue, orders, full money-split; and — as of 2026-07-19
— **TWELVE breadth families**: geo_country · geo_region · geo_city · payment_method · order_status ·
shipping_method · coupon_code · coupon_type · order_time · product_category · product_tag · customer_cohort.

NEVER-STARTED: 7 → **0** (2026-07-19). This section previously read "ZERO breadth", and the manifest's
woocommerce block was literally empty — so the completeness gate checked NOTHING for this platform and could
never fail on it. It now checks all twelve.

THE FINDING THAT MADE IT CHEAP: nine of the twelve were already sitting in bytes we download. A Woo order
payload is ~8,935 bytes and the writer was reading about six fields of it — status, date_created +
date_created_gmt, payment_method(+_title), billing{country,state,city}, coupon_lines[], shipping_lines[] were
all present and discarded. Only category/tag needed a second endpoint, and only cohort needed its own pass.

THE LOAD RULE THIS PLATFORM FORCED (applies to every future Woo family): Woo runs on the MERCHANT'S OWN
self-hosted WordPress box — the same server serving their storefront — and a cursor namespace is a full
history re-walk of it. The Meta/Shopify one-namespace-per-family convention is therefore WRONG here: all nine
free families ride ONE namespace ('woocommerce_breadth') so the store is walked ONCE, not nine times.
Cross-ref Lesson 51 / the 2026-06-16 Shelley over-request incident.

GAP — OFFERED, NOT CAPTURED (all seven CLOSED 2026-07-19):
A. coupons / discount codes [VERIFIED]. → ✅ coupon_code + coupon_type SHIPPED (LORAMER_WOO_BATCH_WA_V1), both WRITE-ONLY: a coupon's discount is discount MONEY, not a share of net, and non-coupon orders are absent entirely — a subset, not a partition. NOT from reports/coupons/totals: verified in the WC controller source, that endpoint takes NO date parameter, breaks down by TYPE not CODE, counts coupon DEFINITIONS rather than redemptions, and is transient-cached for a YEAR. coupon_type is an OPEN, plugin-extensible set — the 3-value enum assumption was falsified live by "wbte_sc_bogo" beside core "fixed_cart"; a $0 BOGO coupon is a real use, not a missing value.
B. product category + tag grain [VERIFIED]. → ✅ SHIPPED (LORAMER_WOO_BATCH_WB_V1) via a SEPARATE id-batched /wc/v3/products call — line_items carry NO category, confirmed on a real payload. NON-ADDITIVE: measured up to 11 categories on ONE product and Σ category at 4.43× net over a real window. CAPTURE-TIME SNAPSHOT membership. The four load mitigations are mandatory and measured: once per LAP not per day (11 sale-days cost 2 requests), _fields trim 10,130 → 321 bytes/product, include= batched ≤100, and routed through the engine's counted+throttled fetch so it cannot bypass the request budget. product_tag is honestly EMPTY on the probe store (0 of 71 products tagged, vs 70 of 71 categorised) — an empty result means this store does not tag, NOT a capture gap.
C. geo [DERIVED]. → ✅ geo_country + geo_region + geo_city SHIPPED, all FLAG-NOT-BLOCK. BASIS = BILLING address, not ship-to: Woo shipping is legitimately empty for digital/virtual/local-pickup orders and a ship-to basis would dump those into UNKNOWN for nothing. PII: country/state/city only — never postcode, street, email, phone or name.
D. customer new-vs-returning / cohorts [VERIFIED]. → ✅ SHIPPED (LORAMER_WOO_COHORT_V1) and the IDENTITY choice is the whole story. reports/customers is a dead end: /wc/v3/customers returns NO orders_count and NO total_spent on an HPOS store (measured — the published docs still list them). And customer_id is 0 for GUEST checkout, which is 86% of orders on the real store, so a registered-only cohort would have been 86% UNKNOWN. Matching on EMAIL instead — as Triple Whale does — put UNKNOWN at 0.00% and showed repeat customers are 55.0% of that merchant's net revenue. TRUE lifetime, from a ONE-SHOT full-history sweep with its own drain step, because a 21-day chunk cannot answer a lifetime question. PII POSTURE: sha256 of the email, computed IN MEMORY and discarded; nested field trimming means name/phone/address never cross the wire; nothing identifying is written.
E. order-status dimension [DERIVED]. → ✅ SHIPPED, ALL statuses. We already fetched status=any and DISCARDED every non-sale order, so failed/cancelled/pending demand had never been written anywhere. WRITE-ONLY, not flag-not-block, for a precise reason: the sale subset {completed,processing,refunded} partitions net exactly and WOULD reconcile, but all-statuses is a SUPERSET of the anchor and the law tests for a PARTITION. extra.isSale marks the subset that ties.
F. payment / shipping method [DERIVED]. → ✅ BOTH SHIPPED, and they diverge: payment_method PARTITIONS (one gateway per order, FLAG-NOT-BLOCK); shipping_method does NOT, because shipping_lines is an ARRAY and a split shipment puts one order under several methods — so it carries the shipping CHARGE with revenue forced to 0, WRITE-ONLY.
G. order time-of-day [VERIFIED]. → ✅ SHIPPED, RAW and unbucketed. WOO-SPECIFIC vs Shopify: Shopify's createdAt carries its offset, Woo's date_created does NOT, so the value is date_created_gmt normalised to an unambiguous UTC instant with BOTH verbatim vendor strings in extra. THE DAY KEY IS UNCHANGED — the row date stays the SITE-LOCAL capture day (verified on every row), because re-keying to GMT would shift rows across midnight and break byte-identity with forward capture plus the idempotency of 7.5 years of history.

## GA4 — PLATFORM-SURFACE-AUDIT RESULT (vendor-sourced 2026-07-18)
Reference = GA4 Data API (dimensions & metrics) docs, the VENDOR'S own docs — NOT our writers. OFFERED vs CAPTURED. [VERIFIED] doc-confirmed; [DERIVED] inferred.

HAVE (CAPTURED): property grain; base sessions / users / conversions / revenue; breakdown families A–I (source_medium, channel, campaign, landing_page, device, geo country/region/city, age, gender, event, item).

GAP — OFFERED, NOT CAPTURED:
A. ecommerce funnel steps view_item / add_to_cart / begin_checkout + purchase-to-view rate + AOV + refunds [VERIFIED].
B. Google-Ads-linkage dims (googleAdsCampaignName / network / query — the GA-vs-Google cross-check layer) [DERIVED].
C. first-user acquisition scope (vs the session scope we have) [VERIFIED].
D. item category / brand / variant (we have name/id) [VERIFIED].
E. engagement / retention (bounce, avg session duration, active / returning / N-day actives) [VERIFIED].
F. full page-path perf (landing page only today) [DERIVED].
CONSTRAINTS [all VERIFIED]: scope compatibility (event / user / session / item dimensions cannot be freely mixed in one report); high-cardinality bucketing + thresholding can silently drop rows (a capture-completeness risk); custom dimensions are forward-only, no backfill.

## CROSS-PLATFORM PATTERNS (the surface audit's meta-findings, 2026-07-18)
(a) CREATIVE / ASSET ATTRIBUTION missing on BOTH ad platforms [LAW-CORE] — Google assets/asset_group (G-FILL#2) AND Meta creative-asset breakdowns (M-FILL#1). The single highest-value cross-platform gap.
(b) DISCOUNT / COUPON performance missing on BOTH stores — ✅ CLOSED 2026-07-19 on both: Shopify discount_code + discount_type, Woo coupon_code + coupon_type. All four landed on the SAME posture independently — WRITE-ONLY, non-additive, because discount money is not a share of net and non-discounted orders are unrepresented. When two platforms' analogous families derive the same posture from the same law, that is the law working.
(c) PRODUCT-GROUPING (category/type/vendor/collection/tag) — ✅ CLOSED on both stores 2026-07-19 (Shopify product_type/vendor/tag/collection; Woo product_category/product_tag). STILL OPEN on GA4 item-category/brand (GA-FILL#4). The cross-platform lesson: 1:1 attributes PARTITION (Shopify type/vendor), many-to-many attributes DO NOT (tags, collections, Woo categories) — measured over-counts 7.3× (Shopify tag), 3.14× (Shopify collection), 4.43× (Woo category).
(d) FUNNEL / ABANDONED-CHECKOUT uncaptured on Shopify (S-FILL#2) + GA4 (GA-FILL#1) — the pre-purchase journey is invisible.
(e) STORES CAPTURED UNEVENLY — ✅ LARGELY CLOSED 2026-07-19: Shopify 15 families, Woo 12, and the same commerce questions are now answerable on both. THE RESIDUAL ASYMMETRY IS SEMANTIC, NOT COVERAGE, and it matters more than the old gap did: Woo net INCLUDES shipping + tax while Shopify net EXCLUDES them, and Woo geo is the BILLING address while Shopify geo is SHIP-TO. Same family name, different quantity — never compare or add them as like-for-like. Every affected registry note says so explicitly.
(f) TIME-OF-DAY DISCARDED on all 3 commerce sources — ✅ CLOSED on Shopify + Woo 2026-07-19 (order_time, RAW and unbucketed on both). STILL OPEN on GA4 (the third writer; GA4 exposes an hour dimension). The shared rule both stores now encode: store the RAW instant and bucket at READ time against the CLIENT's timezone — bucketing at write time bakes a timezone into history and makes "what sold at 3am THEIR time" a full-recapture question.

## BOTTOM LINE — ACTION
Depth: (1) campaign Google+Meta — writers proven, scale all clients. (2) GA — run existing backfill for shallow clients (years deep).
Active loss: (3) Woo top-10 product cap — ✅ 1a SHIPPED (write path uncapped, 8377b97); refund-net the product grain in 1b so it reconciles.
Free win: (4) Meta placement — persist what's already fetched.
Breadth (future): device/geo/demographics/network/hour, Google impression-share, Meta video+ranking, GA dimensions.

## ROLLOUT STATUS (updated 2026-06-29) — DEPTH + FIXES + GATE SHIPPED; BREADTH relocated
- PHASE 1 DEPTH ✅ SHIPPED: Google+Meta campaign/ad_group/ad/adset backfill writers + drain steps, floored cohort-wide to the 36-mo floor; GA backfill drains shallow clients automatically.
- PHASE 2 FIXES ✅ SHIPPED: Woo 1a (8377b97) + 1b refund-net (3e74e0b); Meta placement persisted (breakdown_type='placement', c06d1c7 + 9cb038a). (Shelley Wave-2 re-capture = QUEUE carry.)
- PHASE 3 GUARANTEE ✅ onboarding auto-backfill drain SHIPPED (LORAMER_ONBOARD_DRAIN_V1); the completeness-gate audit is ongoing.
- PHASE 4 BREADTH is now OWNED by docs/LORAMER_DEFINITIVE_CAPTURE_INVENTORY.md §6 (the cross-platform MASTER GAP LIST) + the value-ordered BUILD QUEUE in LORAMER_QUEUE_OF_RECORD.md (the single source for build order). Do not duplicate the breadth order here.

## ENFORCEMENT — onboarding = total capture (per the bedrock principle in LORAMER_HANDOFF.md)
PHASE 4 (breadth) is ELEVATED from "future/prioritized" to a CORE requirement: capture every available grain/dimension/metric in the matrix, forward + backfilled to platform floor.
Onboarding automation: ✅ SHIPPED 2026-06-25 (LORAMER_ONBOARD_DRAIN_V1) — every new platform_connections row defaults onboard_steps_done='[]' (ZERO connect-route code) + a staggered per-platform drain cron (/api/cron/drain) runs the writer-registry deepest-first, PER-STEP-INDEPENDENT (a stuck early step never starves a later one), self-healing already-backfilled steps + filling real gaps; claim-leased (anti-double-fire) + N-map capped (throughput knob), reconcile-or-HALT, NEVER-mark-on-error. granularMonths clamp (meta=36) stops at the retention floor as an empty-success, not a boundary throw. Breadth dimensions plug in as ONE registry entry (back-drains the cohort). Gate proof: Influential meta lap wrote 608 reconciled placement rows (daysFlagged 0) + multi-lap resume.
Completeness gate: every client × platform × grain × dimension — flag anything missing, shallow, or fetched-but-unpersisted; gate "onboarded" on green; run continuously thereafter.
