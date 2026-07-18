# LoraMer — Data Completeness: Gap Matrix + Rollout Plan
GOVERNING RULE: retrieve ALL data from everywhere + store it FOREVER (until the customer cancels).

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
C. DMA / metro geo grain (below region) [VERIFIED].
D. product_id catalog grain [VERIFIED].
E. click variants: outbound_clicks / inline_link_clicks / unique_clicks [VERIFIED].
F. quality / engagement-rate / conversion-rate ranking [DERIVED].
G. frequency_value, SKAN / coarse_conversion_value [LOW / on-demand].

## SHOPIFY — PLATFORM-SURFACE-AUDIT RESULT (vendor-sourced 2026-07-18)
Reference = Shopify Admin GraphQL/REST API docs, the VENDOR'S own docs — NOT our writers. OFFERED vs CAPTURED. [VERIFIED] doc-confirmed; [DERIVED] inferred.

HAVE (CAPTURED): acct / product / variant grains; net revenue, orders, full money-split, new-vs-returning, AOV; geo country/region (account grain).

GAP — OFFERED, NOT CAPTURED:
A. sales channel / order attribution (online store / POS / Meta / Google) [VERIFIED].
B. abandoned checkouts — value + contents + timestamps [VERIFIED]. (Note: loramer.com advertises this analysis; the data is uncaptured.)
C. discount-code performance [VERIFIED].
D. product type / vendor / collection / tags grouping [VERIFIED].
E. fulfillment + financial + chargeback status [VERIFIED].
F. customer cohorts / LTV / order-count (aggregate, non-PII) [DERIVED].
G. order time-of-day — the writer discards timestamps [VERIFIED].
H. city-grain + product-grain geo [DERIVED].
CONSTRAINT: read_all_orders scope gates >60-day history — the 2019 backfill implies we hold it; VERIFY before Shopify backfill work [DERIVED].

## WOOCOMMERCE — PLATFORM-SURFACE-AUDIT RESULT (vendor-sourced 2026-07-18)
Reference = WooCommerce REST API v3 + WC-Analytics reports docs, the VENDOR'S own docs — NOT our writers. OFFERED vs CAPTURED. [VERIFIED] doc-confirmed; [DERIVED] inferred.

HAVE (CAPTURED): acct / product / variant grains; net revenue, orders, full money-split. ZERO breadth.

GAP — OFFERED, NOT CAPTURED:
A. coupons / discount codes (coupons API + reports/coupons/totals) [VERIFIED].
B. product category + tag grain (native Sales-by-category report) [VERIFIED].
C. geo — zero today, vs Shopify's country/region [DERIVED].
D. customer new-vs-returning / cohorts (reports/customers) [VERIFIED].
E. order-status dimension [DERIVED].
F. payment / shipping method [DERIVED].
G. order time-of-day — the writer discards timestamps [VERIFIED].

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
(b) DISCOUNT / COUPON performance missing on BOTH stores — Shopify discount-code (S-FILL#3) + Woo coupons (W-FILL#1).
(c) PRODUCT-GROUPING (category/type/vendor/collection/tag) missing across Shopify (S-FILL#4) + Woo (W-FILL#2) + GA4 item-cat/brand (GA-FILL#4).
(d) FUNNEL / ABANDONED-CHECKOUT uncaptured on Shopify (S-FILL#2) + GA4 (GA-FILL#1) — the pre-purchase journey is invisible.
(e) STORES CAPTURED UNEVENLY — Shopify has geo + money-split + customer-mix; Woo has ZERO breadth. Same commerce questions, different answerable-ness by platform.
(f) TIME-OF-DAY DISCARDED on all 3 commerce sources (Shopify + Woo + GA4) — the writers aggregate to a daily row and drop the timestamp (cross-ref ★ HOUR-GRAIN-CAPTURE-HOLE). "Someone ordered at 3am" is unanswerable by choice, not by API limit.

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
