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

═══════════════════════════════════════════════════════════════════════════════════════════════════
# T2 CAPTURE-COMPLETENESS MATRIX — THE THREE-STATE DELIVERABLE (2026-07-27). T2 CLOSES HERE.
═══════════════════════════════════════════════════════════════════════════════════════════════════
<!-- LORAMER_T2_CAPTURE_MATRIX_V1 -->
THE THIRD STATE IS THE WHOLE POINT. "We don't capture it" and "the vendor won't serve it" have been the same
blank in every prior audit, and only one of them is a defect. Every NOT-OFFERED cell below now carries a vendor
citation or is demoted to DERIVED and says so.
CONFIDENCE: **VERIFIED** = current vendor documentation, cited · **DERIVED** = our own live probe, no current doc
found either way · **UNVERIFIED** = neither. Row counts are VERIFIED live reads of metrics_daily (2026-07-27).
WHAT THIS SUPERSEDES: the 2026-06-20 five-platform matrix (grains, no dimensions), the 2026-07-18 surface audit
(vendor docs vs our WRITERS — could not see whether rows landed), and the 2026-07-15 master audit (tuple existence
via skip-scan — no volume, no dates). This is the first pass that carries row counts, date ranges AND vendor
citations in the same table.

## §T2.0 — VERSION POSTURE. READ THIS FIRST; IT REFRAMES EVERY CELL BELOW.
Three of five platforms are pinned to a version older than the vendor's current one, and on two of them the pin is
probably fiction — the vendor silently serves something newer. We have already been burned by exactly this once
(Shopify: we asked 2025-01, Shopify served 2025-10, OBSERVED — LORAMER_SHOPIFY_VERSION_PIN_2026_07_V1).
- **GOOGLE ADS — we are on v23** (`google-ads-api` npm ^23.0.0, whose major tracks the API version). Vendor current
  is **v25** (released 21-22 July 2026); v26 lands October 2026. v23 shipped 28 January 2026 and sunsets ~Jan/Feb
  2027 on the 12-month lifecycle. Google moved to monthly releases in January 2026. **We are two majors behind with
  ~6 months of runway.** [VERIFIED — Google versioning docs + release notes]
- **META — we send v21.0** (`src/lib/meta-ads.ts:102`). **All Marketing API versions prior to v24.0 were deprecated
  on 9 June 2026**; v23.0 expired that day; vendor current is v25.0 (18 Feb 2026). Our Meta capture is still
  returning data, which means Meta is almost certainly serving a newer version than the one we ask for. **We do not
  actually know which version our Meta numbers come from.** [VERIFIED for the deprecation dates; **DERIVED** for the
  silent-upgrade inference — it is the only explanation consistent with v21 calls still succeeding, and it is the
  identical failure shape as the Shopify pin.] ⚠ THIS IS THE HIGHEST-PRIORITY VERSION FINDING IN THIS DOCUMENT.
- **SHOPIFY — pinned 2026-07**, which is current. [VERIFIED]
- **GA4 Data API — v1beta**, no version pin to drift. [VERIFIED]
- **WOOCOMMERCE — wc/v3**, the current and only production REST version. [VERIFIED]

## §T2.1 — GOOGLE ADS
CAPTURED [VERIFIED, live counts]
- base '' — account 14,254 (2016-04-20→2026-07-26) · campaign 30,717 · ad_group 39,277 · ad 43,528 (all three
  2023-06-24/28→2026-07-26) · 18 clients. THE DEPTH ASYMMETRY IS REAL: the account row reaches 2016; nothing below
  it starts before 2023-06.
- device — campaign 53,690 · ad_group 71,361 · ad 72,433 · keyword 178,768 · 2023-06-28→2026-07-26 · 16 clients
- hour — campaign 331,549 · ad_group 406,567 · 2023-06-28→2026-07-26 · 16
- age — campaign 98,879 · ad_group 172,584 · gender — campaign 46,027 · ad_group 83,313 · 2023-07-19→2026-07-26 · 16
- search_term — ad_group 109,641 · keyword — ad_group 19,179 · 2026-03-14→2026-07-26 · 12
- conversion_action — campaign 515 · impression_share — campaign 6,072 · **both 2026-06-27→2026-07-26 only** · 11/18
- geo family, 19 types × 2 entity levels (campaign + ad_group), all 2023-07-02→2026-07-26 except where noted:
  geo_country 55,751 · geo_region 266,335 · geo_state 251,861 · geo_metro 545,446 · user_geo_region 367,419 ·
  user_geo_state 264,387 · user_geo_metro 524,984 · user_geo_province 45,130 · user_geo_district 60,937 ·
  **geo_district 11,527 — STALE, max 2026-04-09** · **geo_province 4,503 — STALE, max 2024-07-01**
  · geo_city ≈4.03M · user_geo_city ≈4.07M · geo_postal ≈4.01M · user_geo_postal ≈4.07M · geo_county ≈1.77M ·
  user_geo_county ≈1.68M · geo_most_specific ≈4.34M · user_geo_most_specific ≈4.46M — those eight are [DERIVED]
  counts (pg_stats × reltuples); their tuple existence, date range and client count are VERIFIED by index seek.
NOT CAPTURED — offered, we don't take it
- all_conversions · all_conversions_value · view_through_conversions — **the columns EXIST and are 100% NULL**
  (0 non-null in 245,652 rows counted; null_frac 1.0 fleet-wide). Migration applied, writer never populated. [VERIFIED]
- ad_network_type · click_type · slot · conversion_or_adjustment_lag_bucket — registry says VERIFY-AT-WRITER, unbuilt
- product_* Shopping family · assets / asset_group / asset_group_top_combination_view (**LAW-CORE**, G-FILL#2) ·
  group_placement_view / detail_placement_view · ad_group_audience_view / campaign_audience_view ·
  landing_page_view / expanded_landing_page_view · distance_view
- conversion_action and impression_share at ad_group/keyword — offered deeper than we take them (T2.3, quota-gated)
- **CartDataSalesView** (item-level product-sold reporting) — added in v24, we cannot reach it on v23 [VERIFIED]
NOT OFFERED — the third state, re-checked against current docs
- **device OS / OS-version / device-model as performance segments — CONFIRMED STILL NOT OFFERED.** "There isn't a
  reporting option that will break impressions and clicks down by device operating system"; device segmentation is
  limited to the Device enum (DESKTOP / HIGH_END_MOBILE / TABLET). Our 2026-06-24 probe stands. [VERIFIED]
  ⚠ **BUT THE ANSWER CHANGED UNDER US:** v24.1 (13 May 2026) ADDED `segments.mobile_device_platform` (IOS/ANDROID)
  for campaign and customer-level reports. That is a NEW iOS-vs-Android split we do not know about and **cannot use
  on v23**. The "not offered" claim is now only half true. [VERIFIED]
- `user_geo_country` on user_location_view — **NOT RE-CONFIRMED.** Docs confirm `country_criterion_id` exists on
  geographic_view (selectable/filterable/sortable) and that `segments.geo_target_country` is not selectable from
  every resource, but no current doc states the user_location_view case either way. Our probe stands. [DERIVED]
- ad × geo and keyword × geo — no current doc found either way; per-resource field-reference pages are the
  authority and were not machine-checked here. Our 2026-06-27 probe stands. [DERIVED — was asserted as fact]
- hour at ad and keyword grain — same: no current doc confirming or denying. Our probe stands. [DERIVED]
DEPRECATED / SCHEDULED
- **v23 sunsets ~January-February 2027.** Upgrade is mandatory, not optional. [VERIFIED]
- **From 1 June 2026, granular date segments (segments.date, segments.week, hourly) support only a 37-month
  lookback.** That is a vendor-imposed ceiling on FOREVER for hour-grain history and it is already in force. [VERIFIED]
ADDED SINCE OUR WRITERS — the half a self-comparison can never see
- v24 (Apr 2026): CartDataSalesView, nine new lead-gen conversion enums, VTC optimization for Demand Gen/App
- v24.1 (May 2026): `segments.mobile_device_platform`, passkey field detection, expanded Experiments framework
- v24.2 (Jun 2026): SyntheticContentInfo / SyntheticContentAttestation — **AI-generated creative is now
  programmatically identifiable**, which is directly relevant to the asset-attribution law core
- v25 (Jul 2026): new YouTube reporting segments, Shorts social metrics, loyalty-retention goal; **removes both
  legacy lifecycle-goal resources** [VERIFIED]

## §T2.2 — META MARKETING API
CAPTURED [VERIFIED, live counts] — 13 clients, ≈3,939,514 rows, every family scanned
- base 40,099 (account 5,035 · campaign 10,473 · ad_set 11,209 · ad 13,382) · 2023-06-21→2026-07-26
- action_type 659,799 · geo_region 1,088,001 · age_gender 519,536 · hour 303,313 · attribution_window 283,455 ·
  placement 228,109 (campaign/ad_set/ad; account is derive-not-capture) · age 214,231 · device 191,824 ·
  gender 110,312 · device_platform 86,083 · product_id 63,604 · geo_country 32,497 · video 18,974
- creative-asset family, campaign/ad_set/ad: body_asset 35,424 · title_asset 19,283 · image_asset 8,598 ·
  call_to_action_asset 7,332 · video_asset 6,776 · description_asset 5,796 · link_url_asset 2,825 ·
  gen_ai_asset_type 3,889 · creative_relaxation_asset_type 3,855 · flexible_format_asset_type 3,846 ·
  ad_format_asset 1,951 — all 2026-02-02/03-27→2026-07-26
- comscore_market 102 (1 client, 2026-06-24→2026-07-26)
NOT CAPTURED — offered, we don't take it
- account-level asset MEDIA LIBRARY (M8) — open and DECISION-REQUIRED, not unbuilt: no date, no spend, no metric,
  so it does not belong in metrics_daily at all. Needs a storage decision first.
- the v25 Ads Insights **Async** error fields (error_code / error_message / error_subcode / error_user_title /
  error_user_msg) — added specifically to improve failure diagnostics, which is exactly the class of blindness
  ★GOOGLE-ERRORS-UNREADABLE names on the other platform. [VERIFIED]
NOT OFFERED / VENDOR-REMOVED
- ⛔ **`7d_view` AND `28d_view` ATTRIBUTION WINDOWS — REMOVED 2026-01-12. RECLASSIFIED 2026-07-27 from NOT CAPTURED to NOT OFFERED, because the earlier classification blamed us for a vendor purge.** Removed, not deprecated: a request returns EMPTY DATA, not an error. **We DO request them and always have** — `meta-attribution-window-backfill.ts:36` sends all seven windows (1d_click, 7d_click, 28d_click, 1d_view, 7d_view, 28d_view, dda) on every call at all four grains, on forward, backfill and restatement alike. They were gone six months before that writer shipped on 2026-07-18, so there was never a moment we could have captured them, and no backfill can recover them for any past date. Permanently unrecoverable — same class as `dma`. WHAT REMAINS on v25: 1d_click · 7d_click · 28d_click · 1d_view · plus a 1-day engage-through. No long view window exists for anyone, on any plan, via any API. `dda` is requested on every call and has never returned a row — status UNVERIFIED (removed vs never generally available vs gated). ⚠ The writer's own header still explains the emptiness as "account-attribution-setting dependent"; that is FALSE and queued for correction (★META-ATTRIBUTION-COMMENT-FIX). Full record: DECISIONS LORAMER_META_ATTRIBUTION_2026_CHANGES_V1. [VERIFIED]
- ⛔ **ENGAGE-THROUGH — OFFERED AND NOT CAPTURED, and it is the one that should worry us.** On 2026-03-03 Meta moved social clicks (likes, shares, saves, comments) out of click-through into a new engage-through bucket, which also absorbed engaged-view and now covers every ad format. We do not capture a single row of it: our base path pins `action_attribution_windows=7d_click,1d_view` and the attribution_window family's seven do not include it. Those conversions are ABSENT from our totals and absent looks exactly like "fewer conversions." Tracked as ★META-ENGAGE-THROUGH-UNCAPTURED. [VERIFIED]
- **`dma` — CONFIRMED REMOVED, and the date is now exact: 22 June 2026**, replaced by `comscore_market`; the
  targeting-side `dma_codes` gave way to `comscore_market_codes`. Applies to ALL API versions immediately, out of
  cycle. Historical DMA is permanently unrecoverable — a platform purge, not a gap of ours. [VERIFIED]
- asset families at ACCOUNT grain — served-empty; 3 grains IS complete. Probe-based, doc-silent. [DERIVED]
- **per-COMBINATION asset attribution (joint asset breakdowns) returning #100** — vendor docs do NOT document this
  restriction either way; error 100 is the generic "invalid parameter" and the breakdown-compatibility matrix does
  not enumerate the joint case. Our probe stands and the LAW-CORE consequence stands with it, but this is
  **[DERIVED], not VERIFIED** — and it is the single most valuable thing in this document to re-probe, because
  ASSET-COMBINATION CONVERSION ATTRIBUTION is a named core capability. [DERIVED]
- `frequency_value` — vendor docs confirm it is **used with reach only**, i.e. scoped to reach-and-frequency buys,
  which matches our 2026-07-19 measurement of zero rows on both probe accounts. [VERIFIED]
- SKAdNetwork / coarse_conversion_value — SKAN reports through its own conversion-value mapping (1-63) and does not
  compose with standard insights breakdowns; no doc found on frequency_value × SKAN specifically. [DERIVED]
DEPRECATED / SCHEDULED — **and we are inside it**
- **All Marketing API versions before v24.0 deprecated 9 June 2026. We send v21.0.** [VERIFIED]
- Advantage+ Shopping / App campaigns can no longer be created or updated via the API from v25.0; phase-out of ASC
  and AAC completes by September 2026. Read-only reporting is unaffected. [VERIFIED]
- legacy reach / viewer metrics retired by June 2026 in favour of Media Views (Page-side, not ads insights); the
  `metadata=1` query parameter is ignored from v25 and removed by May 2026. [VERIFIED]

## §T2.3 — GA4 (Data API v1beta) + THE REALTIME BOUNDARY
CAPTURED [VERIFIED, live counts] — 11 clients (10 with dimensional), ≈1,681,645 rows, account/property grain only
- ga_landing_page 642,468 · ga_geo_city 599,646 · ga_geo_region 178,037 · ga_event 57,449 · ga_geo_country 51,965 ·
  ga_source_medium 42,685 · ga_campaign 34,942 · ga_channel 31,384 · ga_device 17,635 · base 9,040 · ga_age 6,677 ·
  ga_gender 6,659 · ga_item 3,058 — mostly 2023-01-01→2026-07-26
- DEPTH NOTE: GA's own floor is 2015-08-14; our deepest row is 2022-02-02. That gap is unbackfilled history, not a
  platform limit.
NOT CAPTURED — offered by the Data API, we don't take it
- ecommerce funnel steps (view_item / add_to_cart / begin_checkout), purchase-to-view rate, AOV, refunds
- Google-Ads-linkage dimensions (googleAdsCampaignName / network / query) — the GA-vs-Google cross-check layer
- first-user acquisition scope (we hold session scope only)
- item category / brand / variant (we hold name/id)
- engagement + retention (bounce, avg session duration, active / returning / N-day actives)
- full page-path performance (we hold landing page only)
- **predictive metrics** (purchaseProbability, churnProbability et al.) — now exposed through the Data API rather
  than only via BigQuery export. New surface, never evaluated. [VERIFIED]
- **`isKeyEvent`** — the replacement for the deprecated `isConversionEvent` dimension. [VERIFIED]
- Comparisons (side-by-side subset evaluation) and the `EmptyFilter` dimension-filter type. [VERIFIED]
⛔ **NOT OFFERED BY THE DATA API — REALTIME-ONLY, AND THEREFORE PERMANENTLY UNBACKFILLABLE. THIS IS A CAPTURE
BOUNDARY UNDER ALL-MEANS-ALL AND IT IS STATED HERE EXPLICITLY RATHER THAN IMPLIED.** The Realtime API supports a
DIFFERENT and much smaller schema than core reporting. Dimensions: appVersion, audienceId/Name/ResourceName,
city, cityId, country, countryId, deviceCategory, eventName, **minutesAgo**, platform, streamId/Name,
unifiedScreenName. Metrics: **activeUsers**, eventCount, keyEvents, screenPageViews. The `minuteRanges` /
`minutesAgo` axis exists ONLY in the Realtime API and covers only the last 30-60 minutes. [VERIFIED]
CONSEQUENCE, stated plainly: **"active users right now" is not a thing we can ever backfill.** If we want it, it
must be captured as it happens, into a separate as-of-keyed store — which is precisely the SEPARATE LIVE STORE that
docs/LORAMER_LIVE_BREADTH_UNIFIED_DESIGN.md Direction B already specifies. It is not a metrics_daily row and never
will be. Event-scoped custom dimensions are also unsupported in Realtime; user-scoped ones are. [VERIFIED]

## §T2.4 — SHOPIFY (Admin GraphQL, pinned 2026-07)
CAPTURED [VERIFIED, live counts 2026-07-27, re-read after the depth fix] — 7 clients, 44,122 rows
- base — account 7,700 (2018-06-04→2026-07-26) · product 7,801 · variant 13,328 (both →2026-07-16)
- geo_region 12,112 · geo_country 2,935 (→2026-07-16) · order_time 246 (→2026-07-14, 5 clients)
⛔ **TWELVE FAMILIES AT ZERO ROWS — CAUSE FOUND AND FIXED 2026-07-27, NOT YET PROVEN:** sales_channel ·
discount_code · discount_type · abandoned_checkout · product_type · product_vendor · product_tag ·
product_collection · financial_status · fulfillment_status · geo_city · customer_cohort. They are OFFERED and our
writers are CORRECT; every depth upsert 23502-rejected from 2026-07-19 because a key omitted on two row shapes is
sent by PostgREST as an explicit NULL rather than the column default (DECISIONS LORAMER_SHOPIFY_DEPTH_NOTNULL_FIX_V1,
deployed d86b718). **STATE: UNBLOCKED, UNPROVEN.** Counts above are pre-proof; the first forward run that attempts
healthy connections is 08:04 UTC 2026-07-28. Re-count then — per LORAMER_LANDING_IS_THE_ONLY_SHIPPED_V1 these stay
NOT-CAPTURED until a row count says otherwise.
NOT CAPTURED — offered, we don't take it
- ORDER GRAIN at scale — store_orders/store_order_line_items exist (migration 045 IS applied, contrary to that
  file's own header) but hold 64 orders / 101 line items for ONE client, Shopify only (★ORDER-GRAIN-STEP-2-BACKFILL)
- chargeback status · product-grain geo · manual/automatic non-code discount detail beyond discount_type
- `LineItem.weight` — newly public in the GraphQL Admin API at **2026-07**, the exact version we are pinned to, and
  we do not select it. [VERIFIED]
NOT OFFERED — or rather, foreclosed by cost, which is the more useful framing
- **The 1,000-point single-query ceiling is confirmed as a hard cap across ALL plan tiers, Plus included.** A bigger
  plan buys a deeper bucket, not a larger individual query. Our OrdersInRange runs at 651 requested / 134 actual, so
  ~349 points of headroom remain; scalars cost 0, a connection costs 2 + 1/item and MULTIPLIES through nesting.
  WHAT IT FORECLOSES AT THE 2026-07 PIN: any nested connection on the orders query — measured at 1,036 points and
  rejected BEFORE execution. **Shopify's own documented answer is Bulk Operations, which have no max-cost limit and
  do not consume the standard bucket** — which is exactly why ★ORDER-LEVEL-STORAGE was escalated to route through
  them rather than through a fatter query. [VERIFIED]
DEPRECATED / SCHEDULED
- `Order.channelInformation` (with ChannelDefinition) is deprecated in favour of `Order.attribution`; it still
  resolves at 2026-07 and our sales_channel writer depends on it (★SHOPIFY-CHANNELINFORMATION-MIGRATION)
- `Collection.Set` deprecated in favour of `Collection.sources` at 2026-07; deprecated members stay queryable so
  migration can be incremental. Shopify no longer publishes traditional release notes — the developer changelog is
  the source, which makes a periodic sweep a standing obligation rather than a one-off. [VERIFIED]

## §T2.5 — WOOCOMMERCE (REST wc/v3)
CAPTURED [VERIFIED, live counts] — 2 clients, 21,882 rows
- base — account 2,050 (2016-10-22→2026-07-26) · product 7,686 · variant 7,686 (→2026-07-16)
- customer_cohort 4,459 (→2026-07-16) · order_status 1 row (2026-07-18 only)
⛔ **TEN FAMILIES AT ZERO ROWS** — geo_country · geo_region · geo_city · payment_method · shipping_method ·
coupon_code · coupon_type · order_time · product_category · product_tag. TWO causes, both now known and neither a
writer defect: (1) NO OPPORTUNITY — the only Woo store with orders last sold 2026-07-16, three days before the
writer shipped, and its history re-walk is blocked by the merchant's own server returning HTTP 500; (2) a LATENT
23502 of the same class as Shopify's, which would have taken the ACCOUNT row down with it because Woo upserts
everything in ONE statement — CLOSED 2026-07-27 by the same normalize fix, with zero edits to the Woo builder.
NOT OFFERED — what the REST API structurally cannot serve
- **NO `modified_after` / `modified_before` on /orders. `after`/`before` filter DATE_CREATED only.** Filtering by
  modification date has been an open feature request since 2017 (woocommerce#15444, woocommerce-rest-api#37) and is
  supplied today only by third-party merchant-installed plugins we neither control nor can require. **This is the
  structural blocker behind ★WOO-TIER2-BLOCKED-BY-PLATFORM, and it is now vendor-confirmed rather than
  probe-asserted.** Consequence, unsoftened: Woo restatement coverage is bounded by whatever created-date window we
  pick, and a refund on an order created outside it is never caught. The only exact fix is storing the order grain
  and re-fetching BY ID. [VERIFIED]
- default pagination is 10 items/page (per_page raises it) — a load characteristic on the merchant's own box, not a
  data gap, and the reason the one-namespace load rule exists [VERIFIED]
- reports/coupons/totals takes no date parameter, breaks down by TYPE not CODE, counts definitions not redemptions,
  and is cached for a year — verified in the WC controller source, unchanged [VERIFIED, prior]

## §T2.6 — RANKED: WHAT THE NOT-CAPTURED CELLS WOULD UNLOCK
Ranked by what they buy Lora and the 2026-09-30 demo. Not everything here is worth taking, and the bottom of this
list says so.
1. **PROVE THE 22 STORE FAMILIES LANDED** (Shopify 12 + Woo 10). Zero build cost — the fix is deployed. It converts
   the entire commerce dimensional layer from asserted to real, and until it is counted, every eval question about
   channel, discount, product type, fulfilment or cohort is scored against data we do not have.
2. **META VERSION PIN — establish which version we are actually being served.** Not a feature; a correctness
   precondition. Every Meta number in the product currently comes from an unknown API version.
3. **GOOGLE all_conversions / all_conversions_value / view_through_conversions.** Columns exist, migration applied,
   100% NULL. This is the cheapest real capture win on the board and it closes a conversion-completeness gap Lora
   is asked about directly.
4. **GOOGLE ASSETS / asset_group / asset_group_top_combination_view (G-FILL#2)** and **META joint-asset re-probe.**
   LAW-CORE: asset-combination conversion attribution is a named core capability, and the Meta half currently rests
   on a DERIVED-not-VERIFIED restriction. Re-probing the #100 is cheap and could reopen the whole capability.
5. **GA4 funnel steps + Google-Ads-linkage dimensions.** The pre-purchase journey is invisible today, and the
   linkage dimensions are what let Lora explain why GA and Google Ads disagree — which is the multi-source
   provenance promise, not a nice-to-have.
6. **GOOGLE conversion_action + impression_share HISTORY** (both hold 30 days). Forward-only families make
   trend questions unanswerable.
7. **ORDER GRAIN at scale via Bulk Operations.** Prerequisite for exact restatement on both stores; the mechanism
   is settled, the cost is a sustained vendor load.
8. **GOOGLE v25 upgrade** — unlocks mobile_device_platform (iOS/Android), CartDataSalesView, SyntheticContentInfo
   (AI-creative labelling), YouTube/Shorts segments. Mandatory before ~Feb 2027 regardless.
9. GA4 predictive metrics, engagement/retention, first-user scope, item category/brand — real but second-order.
NOT WORTH TAKING, and saying so is the point of ranking:
- **GA4 Realtime-only metrics** are not a capture target for metrics_daily at all — they are ephemeral by
  construction and belong to the live store or nowhere.
- **Meta SKAN / frequency_value** — measured zero on every cohort account; no client runs reach-and-frequency or
  app-install buys. Build when a client does, not before.
- **Google click_view / GCLID** — Russ's PII line, deferred not dropped.
- **Meta M8 account-level media library** — has no date, no spend and no metric; forcing it into metrics_daily
  would be the wrong shape. It needs a storage decision first, not a writer.

## §T2.7 — WHAT THIS AUDIT STILL CANNOT SEE
Stated so the next reader does not mistake this for completeness: (a) four NOT-OFFERED claims are still DERIVED, not
VERIFIED — Google user_geo_country / ad×geo / keyword×geo / hour-at-ad-and-keyword — because the authority is the
per-resource field-reference page and those were not machine-checked; (b) the Meta joint-asset #100 restriction is
probe-only and doc-silent; (c) eight Google geo row counts are estimates, exact only to ±pg_stats; (d) no vendor API
was called in this step by design, so nothing here re-probes a live account.
═══════════════════════════════════════════════════════════════════════════════════════════════════

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

> **ACCOUNT-GRAIN PARITY RESTORED 2026-07-24 (LORAMER_META_ACCOUNT_FIELD_PARITY_V1).** The base-restatement account
> row (fetchMetaDailyMetrics, bumped v18.0→v21.0) now carries the FULL field set account-NATIVE: reach/frequency +
> outbound/inline/unique clicks (+ unique_inline/unique_outbound) — unique_* is Meta's DE-DUPLICATED account figure,
> NOT a campaign sum (proven live: account unique_clicks ≠ Σ campaign) — plus purchases/add_to_cart/initiate_checkout/
> view_content + cost-per DERIVED from actions[] (no new call), cpp, and attribution_setting (PROVENANCE: the base
> conversion number is normalized to an explicit 7d_click,1d_view attribution window). Ad-account reach is NOT
> affected by the 2026-06 ORGANIC reach-metric retirement (that targets Post/Page/story reach, not act_/insights).

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
> ⛔ **THE ✅ MARKS BELOW ARE TRUE ABOUT THE CODE AND FALSE ABOUT THE DATABASE. Current state and row counts live in
> §T2.4 above — read that, not these marks.** Twelve families hold zero rows; the cause is found, fixed and
> deployed, and unproven until the 08:04 UTC re-count. Why the marks were wrong at all is banked as law:
> LORAMER_LANDING_IS_THE_ONLY_SHIPPED_V1. The per-family notes below remain useful for their SEMANTICS (what each
> family means, what it partitions, what it must never be summed into) — that is what they are now for.
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
> ⛔ **SAME SHAPE AS SHOPIFY: the ✅ marks below describe the code, not the database. Current state, row counts and
> both causes are in §T2.5 above — read that.** Ten of twelve families hold zero rows; neither cause is a writer
> defect (no order-day since the writer shipped + a merchant-side HTTP 500 on the history re-walk), and the latent
> 23502 that would have taken the account row down with them is closed. The notes below remain the reference for
> each family's SEMANTICS and for the Woo-vs-Shopify basis differences, which have not changed.
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
