# LoraMer — DEFINITIVE CAPTURE INVENTORY (master surface map)
<!-- LORAMER_DEFINITIVE_CAPTURE_INVENTORY_V1 -->

STATUS: ACTIVE master map of EVERYTHING each connected platform exposes — the source of the cross-platform gap list
+ value-ordered writer queue. Governing law: capture EVERYTHING from EVERYWHERE, store FOREVER, full grain WITH history.
SEQUENCING (settled): map ALL FIVE platforms FIRST → ONE master gap list + value-ordered build queue → THEN build. Do
NOT build writer-by-writer ahead of the complete map. (Mixed-state note: meta_device + meta_age_gender shipped before
inventory mode — correct, keep.) Per-platform companion: docs/LORAMER_BREAKDOWN_REGISTRY.md (per-dimension encoding).
DONE: Meta ✅, Shopify ✅, GA4 ✅, WooCommerce ✅, GOOGLE ✅ (desk-map §5; EMPIRICAL per-client field-return probe DEFERRED to ≥2026-06-30T08:03Z quota window).
REMAINING: cross-platform MASTER GAP LIST + value-ordered BUILD QUEUE (the next step). Tags: [CAPTURED ←writer] / [GAP].

═══════════════════════════════════════════════════════════════════
## 1. META (Marketing/Insights API v21.0) — live-probed 2026-06-28 (Veterinary/Foam OH/Glass Plus)
═══════════════════════════════════════════════════════════════════
### A. METRICS
- Core: spend, impressions, clicks, reach, frequency, cpc, cpm, cpp, ctr.  [CAPTURED: spend/clicks/impr/ctr/reach/freq + extra{cpc,cpm} ←meta-campaign/adset-ad/forward. GAP: cpp]
- Click variants: inline_link_clicks, inline_link_click_ctr, cost_per_inline_link_click, outbound_clicks(_ctr), unique_clicks, unique_ctr, unique_inline_link_clicks.  [GAP: all]
- Conversions: actions[] (taxonomy), action_values[] (per-type revenue), cost_per_action_type[], conversions, conversion_values, cost_per_conversion, purchase_roas, website_purchase_roas.
  ★ ACTION TAXONOMY is large + objective-dependent — Veterinary returned 36 types (lead, link_click, landing_page_view,
    add_to_cart, complete_registration, comment, like, post_*, page_engagement, video_view, offsite_conversion.fb_pixel_*,
    omni_*, onsite_conversion.*, onsite_web_*, …). E-commerce adds purchase/omni_purchase/initiate_checkout/add_payment_info
    + action_values=revenue.  [CAPTURED: only ~5 extracted into one 'conversions' number (lead/fb_pixel_lead/fb_pixel_purchase
    + add_to_cart/initiate_checkout/view_content into extra) + purchase action_value ←all meta writers. ~31/36 types FETCHED-but-DROPPED. GAP: the full taxonomy + per-type values/cost/ROAS]
- VIDEO FAMILY (all served; deep on Foam OH — thruplay 193k@21mo, 229k@33mo): video_play_actions, video_thruplay_watched_actions,
  video_p25/p50/p75/p95/p100_watched_actions, video_avg_time_watched_actions, video_30_sec_watched_actions, cost_per_thruplay.  [GAP: entire family]
- Quality (ad level): quality_ranking, engagement_rate_ranking, conversion_rate_ranking ("UNKNOWN" below threshold). Brand: estimated_ad_recallers, estimated_ad_recall_rate.  [GAP: all]

### B. BREAKDOWNS + #100 COMBINATION RULES
- Served single: country, region; impression_device, device_platform; publisher_platform; age, gender; hourly_stats_aggregated_by_advertiser_time_zone;
  product_id (catalog); frequency_value; image_asset/video_asset/title_asset/body_asset/description_asset/call_to_action_asset/link_url_asset.
- NOT served: dma (#100 deprecated); platform_position ALONE (#100 — needs publisher_platform).
- COMBINATION RULES (Meta #100 "Current combination of data breakdown columns…"): WORKS = publisher_platform,platform_position ·
  publisher_platform,platform_position,impression_device (3-way) · country,region. FAILS = age,gender,country · publisher_platform,age ·
  image_asset,body_asset (ANY two asset breakdowns). → combos allowed WITHIN a family, forbidden across families + across assets.
  [CAPTURED: placement ←meta-placement · device+device_platform ←meta-device · age+gender+age_gender ←meta-age-gender.
   GAP: country, region (geo) · hour · product_id · frequency_value · ALL 7 asset breakdowns]

### C. ENTITY GRAINS
Metrics + non-asset breakdowns served at account/campaign/ad_set/ad (proven all 4). Asset breakdowns: AD level. Rankings: AD level.  [CAPTURED: account/campaign/ad_set/ad depth + captured breakdowns at all 4]

### D. ASSETS — creative content layer (attribution target)
Path: /act_X/ads?fields=creative{id,object_story_spec,asset_feed_spec,image_hash,image_url,video_id,thumbnail_url,title,body,call_to_action_type,link_url}.
DYNAMIC CREATIVE (Advantage+/DCA) → asset_feed_spec{ bodies[{text}], titles[{text}], descriptions[{text}], images[{hash,url}],
videos[{video_id,thumbnail_url}], link_urls[{website_url}], call_to_action_types[], optimization_type }. Each asset carries a STABLE id +
content.  [CAPTURED: NOTHING persisted (forward reads creative{title,body,cta,image_url,video_id} for the LIVE PROMPT only). GAP: entire asset/creative layer]

### E. ASSET-PERFORMANCE CEILING (the critical finding — proven by bytes)
PER-INDIVIDUAL-ASSET: YES — every asset breakdown returns per-asset spend + actions[] (conversions) + content + stable id
(image{hash,url,name,id}, video{video_id,url,thumbnail,video_name,id}, title{text,id}, body{text,id}, description{id}, call_to_action{name,id}, link_url{website_url,id}).
PER-COMBINATION: NO — image_asset,body_asset → #100. Meta does NOT serve the joint asset distribution. CEILING: per-asset attribution is the
maximum; per-combination (which image+headline+CTA combo drove which conversions) is IMPOSSIBLE via Insights → must be MODELED (tabled per Russ).
asset_feed_spec (D) enumerates the combinatorial SPACE; each asset's marginal perf is queryable; the joint is not.  [CAPTURED: NOTHING. GAP]

### F. RETENTION FLOOR
UNIFORM 37-month #3018 ("start date cannot be beyond 37 months") across ALL Insights data — metrics, VIDEO (Foam OH deep, served to 2023-09/~33mo,
#3018 at 2023-05), breakdowns (device/age/gender exact at 2023-06/~36mo), asset perf. No family shorter. Account-structure objects (campaigns/adsets/ads/creatives) have NO time limit.

### G. QUOTA / RATE
Business Use Case (BUC) rate limits. Header X-Business-Use-Case-Usage: {call_count, total_cputime, total_time (% of limit), estimated_time_to_regain_access,
ads_api_access_tier}. ★ OUR TIER = "development_access" (tightest) — promote to Standard/Advanced (Meta analog of Google Standard). ads_insights throttles on
CPU/time → async jobs for heavy pulls. metaFetchAllPaged retries {1,2,4,17,32,341,613,80000,80004}+429 (exp backoff); #100/1487534 = query-too-heavy → narrow window. No pause-marker (resets hourly; 6h drain gentle).

### META GAP → WRITER QUEUE (value-ordered)
SHIPPED: depth (account/campaign/ad_set/ad) · placement · device · device_platform · age · gender · age_gender.
GAP: (1) VIDEO METRIC FAMILY [HIGH]; (2) FULL ACTION/CONVERSION TAXONOMY + per-type value/cost/ROAS [HIGH]; (3) GEO geo_country+geo_region [MED];
(4) HOUR [MED]; (5) ASSET CONTENT LAYER (creative store, not metrics_daily) [HIGH]; (6) ASSET-PERFORMANCE per-asset breakdowns (per-combination IMPOSSIBLE → model) [HIGH];
(7) CLICK VARIANTS + rankings + estimated_ad_recall + cpp [LOW-MED]; (8) product_id + frequency_value [LOW].

═══════════════════════════════════════════════════════════════════
## 2. SHOPIFY (Admin GraphQL API 2025-01) — repo's proven query + Shopify docs + captured depth (NOT a live byte-probe, by design — token-refresh safety, see DECISIONS)
═══════════════════════════════════════════════════════════════════
### A. METRICS / MEASURES (Order + LineItem MoneyBag {shopMoney, presentmentMoney})
ORDER: totalPriceSet (gross) [GAP] · subtotalPriceSet [GAP] · currentSubtotalPriceSet (NET basis) [CAPTURED ←shopify-intelligence] · currentTotalPriceSet [GAP] ·
totalDiscountsSet/currentTotalDiscountsSet [GAP] · totalTaxSet/currentTotalTaxSet [GAP] · totalShippingPriceSet [GAP] · totalRefundedSet [CAPTURED] ·
totalTipReceivedSet/netPaymentSet/totalOutstandingSet [GAP].
LINE: originalUnitPriceSet, discountedUnitPriceSet, originalTotalSet, discountedTotalSet, totalDiscountSet, quantity, currentQuantity, unfulfilledQuantity.  [CAPTURED: quantity + per-line refunded subtotal. GAP: rest]
COGS/MARGIN: variant.inventoryItem.unitCost → margin = revenue − unitCost×qty.  [GAP — SCOPE-BLOCKED: needs read_inventory; only advarteststore1 test store has it]

### B. DIMENSIONS (Shopify has NO breakdown-query model — pivot the ORDER record client-side; NO combination limits)
product/variant/SKU [CAPTURED: product ←metrics-row. GAP: variant/SKU] · collection [GAP] · geo ship/bill {countryCodeV2,provinceCode,city,zip}
[CAPTURED: ship country+region ←geo_country/geo_region. GAP: billing/city/zip] · customer new-vs-returning [CAPTURED: classification (live). GAP: LTV] ·
sales channel/source [GAP] · discount code [GAP] · order tags [GAP] · payment method [GAP] · fulfillment status [GAP] · financial status [CAPTURED: excl cancelled] · time/day [CAPTURED].
★ NO COMBINATION CEILING — each order carries product×geo×customer×channel×discount×tag at once → any pivot client-side (Meta's #100/asset-combo ceiling has no Shopify analog).

### C. ENTITY GRAINS
account [CAPTURED] · order (source grain, not persisted; aggregated to day) [GAP] · line-item (deepest) [partial] · product [CAPTURED] · variant/SKU [GAP].
Shopify's natural grain is the ORDER (event), aggregated to (day, product, geo).

### D. CATALOG / CONTENT LAYER (Shopify analog of the creative layer)
PRODUCT: id, title, handle, descriptionHtml, productType, vendor, tags, status, totalInventory, images/media, seo. VARIANT: id, sku, title, price, compareAtPrice,
inventoryQuantity, selectedOptions, barcode, inventoryItem{unitCost,tracked}. COLLECTION: id, title, products.  [CAPTURED: NOTHING (product REVENUE keyed by product.id, but NOT content). GAP: catalog content layer]

### E. CUSTOMER / LTV LAYER (NO ad-platform equivalent)
Customer: id, numberOfOrders (Frequency), amountSpent (LTV/Monetary), createdAt, first/last order (Recency cohort), orders, email/smsMarketingConsent, defaultAddress, tags, state →
RFM + cohort derivable.  [CAPTURED: new-vs-returning classification only (live E1). GAP: LTV/RFM/cohort — PRIVACY-GATED, 0-PII-AT-REST design (classify at capture, persist only aggregates/sketches — Bloom/HLL; E2 engine)]

### F. RETENTION FLOOR — SCOPE-dependent, NOT a time cap
WITH read_all_orders: FULL history (floor = store's first order — proven: Influential→2019-04-13, Foam OH→2022-01-24). WITHOUT read_all_orders (read_orders only): 60-DAY wall (L46/L54).
→ scope decision, not a rolling cap (vs Meta/Google fixed 37mo).

### G. QUOTA / RATE — GraphQL calculated-query-cost + leaky bucket (3rd distinct model)
extensions.cost{requestedQueryCost, actualQueryCost, throttleStatus{maximumAvailable, currentlyAvailable, restoreRate}}. Standard plan 1000pts/50-per-s (Plus 2000/100). Empty bucket → THROTTLED
(429-equiv).  [CAPTURED handling: shopify-dimensional-backfill is throttle-budget-aware (throttleDeadline; THROTTLED wait that blows the lap budget → stop+resume). Maps to the leaky bucket.]

### SHOPIFY GAP → WRITER QUEUE (value-ordered)
SHIPPED: account NET revenue + refunds · product-grain NET (all products) · geo_country + geo_region.
GAP: (1) FULL ORDER MONEY SURFACE — gross/discounts/taxes/shipping/tips/net [HIGH]; (2) VARIANT/SKU grain [HIGH]; (3) CATALOG CONTENT LAYER [HIGH];
(4) COGS/MARGIN — read_inventory-gated [HIGH, scope-blocked]; (5) CUSTOMER/LTV/RFM/cohort — privacy-first 0-PII [MED-HIGH]; (6) SALES CHANNEL/SOURCE [MED];
(7) DISCOUNT CODE + order TAGS + payment + fulfillment status [MED]; (8) BILLING geo + city/zip [LOW-MED]; (9) per-order/per-line grain persistence [LOW].

═══════════════════════════════════════════════════════════════════
## 3. GA4 (Data API v1beta runReport) — CAPTURED surface only (Realtime = Phase-3, noted not mapped). Source: repo's proven 7-bucket runReport + ga-metrics-row.ts persist + DB depth + GA4 docs (live probe blocked: GOOGLE_ANALYTICS_CLIENT_ID absent on this machine)
═══════════════════════════════════════════════════════════════════
★ PERSIST (ga-metrics-row.ts): ONE row per (client, property, date), entity_level='account'. conversions→conversions COLUMN; totalRevenue→revenue COLUMN; sessions/totalUsers/newUsers/engagementRate/transactions/rates→extra-JSONB. NO dimensions persisted. → GA session/user metrics are STORED but NOT QUERYABLE (queryMetrics aggregates only the columns — see §7 + the OPEN columns-vs-jsonb decision).
A. METRICS: [CAPTURED: sessions, totalUsers, newUsers, engagementRate, conversions(col), totalRevenue(col→revenue), transactions, addToCarts, purchaserConversionRate, cartToPurchaseRate, refundAmount ←fetchGaDailyMetrics; only conversions+revenue queryable]. [GAP: activeUsers, engagedSessions, averageSessionDuration, bounceRate, screenPageViews, eventCount/eventValue, keyEvents/keyEventRate, userEngagementDuration, ARPU, purchaseRevenue, ecommercePurchases, itemsViewed/Purchased, itemRevenue, checkouts, cart/purchaseToViewRate, totalPurchasers; ADS-LINKED advertiserAdCost/Clicks/Impressions/returnOnAdSpend (only if Google Ads↔GA4 linked); custom metrics.]
B. DIMENSIONS [CAPTURED: NONE persisted (date=grain); LIVE-ONLY for prompt: sessionSource/Medium, sessionCampaignName, landingPagePlusQueryString, eventName, country, deviceCategory, itemName]. GAP (persist): time(hour/dayOfWeek) · GEO(country/region/city) · TECH(deviceCategory/browser/OS/platform) · ACQUISITION session-scope + firstUser-scope(Source/Medium/Campaign/DefaultChannelGroup) · CONTENT(pagePath/Title/landingPage) · EVENT(eventName/isKeyEvent) · ITEMS(itemName/Id/Category/Brand/Variant) · audiences · custom. ★ COMPATIBILITY MATRIX (GA's #100-analog): metrics+dims have SCOPES (user/session/event/item); cross-scope combos often INCOMPATIBLE (item metrics ✗ session dims; bounceRate/avgSessionDuration ✗ item dims) → HTTP 400; canonical enumerator = the Data API properties:checkCompatibility method.
C. GRAINS: property(=account; entity_id=propertyId)/date/dimension-combination. [CAPTURED: property+date ONLY. dim-combination=GAP.]
D. CONTENT/"ASSET" analog: site + measurement model — landing pages/pagePath+Title · EVENT taxonomy(eventName/isKeyEvent) · ecommerce ITEM catalog(itemName/Id/Category/Brand). [CAPTURED: NONE (live-only). GAP.]
E. ACQUISITION/ATTRIBUTION (GA's distinct value): source/medium/campaign/channel at SESSION + firstUser scope; defaultChannelGroup = cross-channel grouping NO ad platform self-reports; Ads-linked cost/ROAS if linked. ATTRIBUTION-MODEL CAVEAT: GA conv/rev are GA-attributed (DDA+lookback) → NOT 1:1 with Meta/Google in-platform or Shopify orders → a THIRD lens, LABEL never fuse/equality-reconcile. [CAPTURED: GA conv+rev (account/date, GA-attributed); the source/channel SPLIT is LIVE-ONLY=GAP.]
F. RETENTION FLOOR: AGGREGATED standard reports = property-LIFETIME, NO rolling cap (DISTINCT from the 2/14-mo "data retention" setting, which is Explorations/user-event-scope ONLY). ★ CORRECTION: NOT "2015/~11yr" (that was Universal Analytics, a separate product, sunset 2023 + deleted). GA4 (App+Web) launched Oct 2020 → floor = property-CREATION date (≥2020); deepest captured = Foam OH 2022-02-02 (~4.4yr). The adapter's 2015-08-14 constant is a clamp, not actual GA4 retention. REALTIME (last-30-min, runRealtimeReport) = separate EPHEMERAL API, never in the Data API store → Phase-3 boundary (noted, NOT mapped).
G. QUOTA/RATE: TOKEN BUCKET PER PROPERTY (returnPropertyQuota → tokensPerDay/Hour/concurrent...; ~25k/day standard). ★ PER-PROPERTY (not a shared dev token like Google Ads) → cohort naturally sharded, NO shared-exhaustion. [Handling: runGaReport throws on error — minimal; the QUEUED GA 429-classifier hardening folds in before scale.]
GA4 GAP→QUEUE: (1) MAKE SESSION/USER METRICS QUERYABLE (core metric COLUMNS + teach queryMetrics) [HIGH, foundational — see §7 OPEN decision]; (2) ACQUISITION breadth (source/medium/channelGroup/campaign + firstUser) [HIGH]; (3) GEO [MED]; (4) DEVICE/TECH [MED]; (5) CONTENT [MED]; (6) EVENT taxonomy [MED]; (7) ITEM breadth [MED]; (8) ADS-LINKED cost/ROAS [LOW-MED]; (9) metric tail→jsonb [LOW].
GA4 PLAYBOOK DIFFERENCES: ROLE = analytics/ATTRIBUTION platform (not spend/revenue SOURCE; metrics behavioral) · NO reconcile twin (GA-attributed → label, never equality-reconcile) · COMPATIBILITY MATRIX = 3rd slice-constraint model (Meta #100 / GA4 scope-compat / Shopify none) · GRAIN = property · STORAGE DIVERGENCE = first platform whose core metrics don't fit the spend/clicks columns → forces the columns-vs-jsonb decision (§7 OPEN) · RATE = per-property token bucket (sharded; no shared exhaustion) + separate realtime pool · RETENTION = property-lifetime (floor=creation ≥2020).

═══════════════════════════════════════════════════════════════════
## 4. WOOCOMMERCE (REST API wc/v3) — self-hosted, gentle-citizen. Source: repo code + captured DB + Woo docs; ZERO live calls (merchant-server respect)
═══════════════════════════════════════════════════════════════════
★ PERSIST (woocommerce-metrics-row.ts): platform='woocommerce'. account → revenue=NET(wooNetOf=o.total[incl shipping+tax] + refunds[].total[negative]), conversions=totalOrders. product(ALL) → revenue=product NET(pro-rata by gross line share), conversions=units. NO breakdowns. Sale statuses={completed,processing,refunded}. Depth: Shelley Kyle 2018-12-13→now (8911 rows, account+product).
A. METRICS (Woo order): total(gross incl tax+ship−disc) · total_tax · shipping_total/tax · discount_total/tax · cart_tax · fee_lines · refunds[](negative; NO total_refunded field) · line_items{subtotal,subtotal_tax,total,total_tax,quantity,price,sku}. [CAPTURED: NET(o.total+refunds)→revenue, order count, product NET pro-rata, units. GAP: gross-separately, total_tax, shipping_total, discount_total, fees, per-line detail.] NET-BASIS = RESOLVED, NOT an open caveat: Woo net INCLUDES shipping+tax (reconciles to the Woo account), Shopify net EXCLUDES them; handled by per-platform tooltips + the honest netBasis tag; full subtotal re-base is a banked someday-item (Lessons 58/59 — do not reopen).
B. DIMENSIONS (raw orders → client-side pivot; NO combination ceiling): product[CAPTURED] · variation(line_items.variation_id)[GAP] · category/tags(product join)[GAP] · customer new/returning[GAP, customerMixComingSoon] · geo billing/shipping{country,state,city}[GAP] · coupon(coupon_lines)[GAP] · payment method[GAP] · order status(used to filter, not stored) · time[CAPTURED]. Reports endpoints (/wc/v3/reports/*, /wc-analytics/reports/*) exist but the repo aggregates RAW /orders (reliable across configs).
C. GRAINS: account[CAPTURED] · order(source, not persisted)[GAP] · line-item[partial→product] · product[CAPTURED] · variation[GAP].
D. CATALOG (/wc/v3/products + /products/{id}/variations): id,name,type,sku,status,description,categories,tags,attributes,price/regular/sale,images,stock,variations; VARIATION{sku,attributes,price,stock}. [CAPTURED: NOTHING (product revenue keyed by product_id+name, not content). GAP.]
E. CUSTOMER/LTV (/wc/v3/customers): id,email,geo,date_created,orders_count,total_spent → RFM/new-returning derivable. [CAPTURED: NONE (customerMixComingSoon, LIVE-SOURCE). GAP — PRIVACY-FIRST 0-PII-at-rest, same as Shopify.]
F. RETENTION: self-hosted, NO platform cap → floor = store's FIRST order (Shelley 2018-12-13, ~7.5yr). Limiter = gentle-citizen pacing, not an API window. No read_all_orders equivalent (merchant's own DB).
G. QUOTA/RATE: NO platform quota (merchant's server). Constraint = LIVE-SOURCE gentle-citizen hardening — woo-adaptive.ts SUBCHUNK_LADDER[21→7→1] + circuit-breaker; woocommerce-backfill.ts CHUNK_DAYS=21, MAX_PAGES=30, TIME_BUDGET 90s, THROTTLE_MS=300 (pages+windows), BLOCK_THRESHOLD=2, MAX_OUTBOUND 500, atomic CAS claim, graceful-200. Dashboard reads CAPTURED only, NEVER live-fetches on render (LIVE-SOURCE; sharpest for the fragile Woo source).
WOO GAP→QUEUE: (1) FULL ORDER MONEY SURFACE (gross/tax/shipping/discount/fees) [HIGH]; (2) VARIATION grain [HIGH]; (3) CATALOG CONTENT [HIGH]; (4) CUSTOMER/LTV privacy-first [MED-HIGH]; (5) GEO [MED]; (6) COUPON [MED]; (7) PAYMENT+status [MED]; (8) CATEGORY/TAG [MED]; (9) per-order/line grain [LOW].
WOO PLAYBOOK DIFFERENCES: SELF-HOSTED (only one) — no quota → constraint flips to "don't crash the merchant's fragile server" = gentle-citizen hardening (most defensive of the 5) · MERCHANT-SERVER RISK (timeout/5xx = soft signal → narrow/back-off/breaker) · REST not GraphQL (Basic auth consumer_key/secret) · NET BASIS differs (incl shipping+tax; no total_refunded → pro-rata product net) · OTHERWISE commerce-shaped like Shopify (catalog + customer-LTV-privacy-first + order grain + free pivot + no combo ceiling + account-lifetime).

═══════════════════════════════════════════════════════════════════
## 5. GOOGLE ADS — DEFINITIVE CAPTURE SURFACE (desk-map layer; API v24.2 as of 2026-06-29; v25 ~Jul 2026)
═══════════════════════════════════════════════════════════════════
### 5.0 Sourcing & status
- Surface below = what the API CAN serve (mapped from the v24 field reference; desk-knowable; zero quota). SOURCING NOTE: the v24 web field reference is JS-rendered (not statically fetchable), so the EXACT field identifiers below are enumerated VERBATIM from our INSTALLED client lib (google-ads-api 23.0.0 → googleads.v23; node_modules/google-ads-api/build/src/protos/autogen/fields.d.ts) — the authoritative list of what we can actually SELECT today. v23→v24 field-name deltas flagged inline.
- CAPTURED/PARTIAL/GAP = reconciled vs current capture (adapter SELECTs + metrics_daily distinct entity_level/breakdown_type, platform='google'). Zero Google API.
- EMPIRICAL per-client field validation (does field X return non-null for our active clients) = DEFERRED to ≥2026-06-30T08:03Z quota window. Visible-floor ≠ real-return; probe the API, never assume from docs. (CONTEXT: the 06-29 dev-token quota reset at 08:03Z, then the geo drain re-exhausted it by 13:21Z → re-paused until ~2026-06-30T08:03Z; the guard auto-resumes.)

### 5.1 Reporting model
- GAQL over GoogleAdsService.SearchStream. Each report = one FROM resource × chosen segments × chosen metrics.
- Every report is implicitly segmented by the FROM resource's resource_name (the grain).
- Segments are not all mutually compatible — obey each field's selectable_with list; each added segment multiplies rows.
- DATE GRAIN CEILING (CITE, do not relitigate — accepted-caps table): granular date/week/hour capped at 37-month lookback as of 2026-06-01 (DateRangeError beyond); monthly/quarter/year ≈ 11yr. Daily floor target = 36mo.

### 5.2 Entity-level spine (depth grain; depth status tracked elsewhere)
customer · campaign · ad_group · ad_group_ad (ad) · ad_group_criterion / keyword_view (keyword)
[CAPTURED: account/campaign/ad_group/ad depth at the 36-mo floor cohort-wide; keyword via ad_group_criterion CAPTURED (breakdown_type='keyword')]
Breadth view resources: geographic_view [CAPTURED ←geo_*], user_location_view [CAPTURED ←user_geo_*], performance_max_placement_view [GAP], asset / asset_group / asset_group_asset [GAP — creative/asset layer], campaign_audience_view, ad_group_audience_view [GAP], search_term_view [CAPTURED ←search_term], click_view (GCLID) [GAP].

### 5.3 Breadth segment families  (exact segments.* from the v23 lib; CAPTURED/PARTIAL/GAP vs persistence)
- Time: segments.date, segments.hour, segments.day_of_week, segments.week, segments.month, segments.month_of_year, segments.quarter, segments.year  — PARTIAL [CAPTURED: date (day grain on all depth rows) + hour (breakdown_type='hour', campaign+ad_group). GAP: day_of_week/week/month/month_of_year/quarter/year — not persisted as breakdowns (day_of_week requested live, not stored)]
- Device: segments.device  — CAPTURED (shipped; breakdown_type='device' at campaign/ad_group/ad/keyword)
- Geo: geographic_view → segments.geo_target_{country,region,state,province,county,district,metro,city,postal_code,most_specific_location,canton,airport}; user_location_view → same set minus geo_target_country  — CAPTURED (geo + user_geo, shipped; campaign+ad_group). PARTIAL on grain (campaign+ad_group only, not ad/keyword); geo_target_canton/airport not emitted by our (US) clients.
- Network: segments.ad_network_type, segments.ad_sub_network_type  — GAP / QUEUED WRITER (no breakdown_type='network'). NB v24.2 (2026-06-24) newly segments performance_max_placement_view by ad_network_type → PMax network visibility (prior FLAG-NOT-BLOCK structural gap). [CC CONFIRMED: pinned lib = google-ads-api 23.0.0 → googleads.v23; the v24.2 performance_max_placement_view × ad_network_type combination is NOT exposed until the lib is bumped to v24. segments.ad_network_type itself exists in v23 for standard resources.]
- Click type / slot: segments.click_type, segments.slot, segments.ad_destination_type, segments.ad_format_type  — GAP
- Conversion segmentation: segments.conversion_action, .conversion_action_name, .conversion_action_category, .conversion_lag_bucket, .conversion_or_adjustment_lag_bucket, .conversion_attribution_event_type, .external_conversion_source  — GAP (persistence). [conversion_action/name/category ARE requested in the live-intelligence GAQL but NOT persisted to metrics_daily — fetched-live-only; QUEUED WRITER for per-conversion-action rows, pairs with the all_conversions writer in 5.4]
- Keyword: segments.keyword.info.text, .keyword.info.match_type, .keyword.ad_group_criterion; segments.search_term, .search_term_match_type, .match_type  — CAPTURED (breakdown_type='keyword' + 'search_term', ad_group grain). ⚠ FALSE-ZERO TRAP: co-selecting ANY keyword segment silently excludes all non-Search-keyword rows (PMax, Shopping, DSA, Display). Isolate in its own keyword-grain query; never co-select with account/campaign totals. (Law: false zeros worse than absence.)
- Product/Shopping: segments.product_item_id, .product_title, .product_brand, .product_condition, .product_channel, .product_channel_exclusivity, .product_category_level1–5, .product_type_l1–5, .product_custom_attribute0–4, .product_country, .product_language, .product_feed_label, .product_merchant_id, .product_store_id, .product_aggregator_id  — GAP
- Vertical (per client, if present): segments.hotel_{check_in_date,check_in_day_of_week,length_of_stay,booking_window_days,class,price_bucket,rate_type,rate_rule_id,date_selection_type,center_id,city,state,country}, .partner_hotel_id, .travel_destination_{city,region,country}  — GAP (no hotel/travel clients)
- Customer: segments.new_versus_returning_customers  — GAP
- Audience: via campaign_audience_view / ad_group_audience_view resources (not a segment field)  — GAP

### 5.4 Metric families  (exact metrics.* from the v23 lib; CAPTURED/PARTIAL/GAP vs persistence)
- Core delivery: metrics.impressions, .clicks, .ctr, .average_cpc, .average_cpm, .cost_micros  — CAPTURED [impressions/clicks → columns; cost_micros → spend column; ctr/average_cpc → extra/derived. GAP: average_cpm (derivable)]
- Conversions (primary): metrics.conversions, .conversions_value, .cost_per_conversion, .value_per_conversion, .conversions_from_interactions_rate  — CAPTURED [conversions + conversions_value → columns; cost_per/value_per/rate derivable]. ⚠ captures the PRIMARY `conversions` metric only — non-primary conversion actions are omitted (see ALL conversions).
- ALL conversions: metrics.all_conversions, .all_conversions_value, .view_through_conversions, .cross_device_conversions, .all_conversions_from_interactions_rate  — GAP / QUEUED WRITER (captures the non-primary conversion actions the default `conversions` omits)
- Impression share: metrics.search_impression_share, .content_impression_share, .search_budget_lost_impression_share, .content_budget_lost_impression_share, .search_rank_lost_impression_share, .content_rank_lost_impression_share, .search_top_impression_share, .search_absolute_top_impression_share, .search_budget_lost_top_impression_share, .search_rank_lost_top_impression_share, .search_exact_match_impression_share, .search_click_share, .absolute_top_impression_percentage, .top_impression_percentage  — GAP / QUEUED WRITER (persistence). NB the search_* IS family IS already requested in the live-intelligence GAQL but NOT persisted (no IS column/breakdown) — fetched-live-only. [CC CONFIRMED: IS metrics are GRAIN-LIMITED — served at campaign / ad_group / keyword(criterion), NOT ad (ad_group_ad) grain — and carry tight segment-compatibility (not combinable with most segments). The writer must self-clamp to compatible grains; per-client return validation deferred to the quota window.]
- Video: metrics.video_trueview_views, .video_trueview_view_rate, .video_quartile_p25_rate, .video_quartile_p50_rate, .video_quartile_p75_rate, .video_quartile_p100_rate, .video_watch_time_duration_millis, .trueview_average_cpv  — GAP / QUEUED WRITER (video/YouTube). ⚠ NAME DELTA: v23 renamed the legacy video_views / video_view_rate / average_cpv → video_trueview_views / video_trueview_view_rate / trueview_average_cpv (the older identifiers no longer resolve on v23+; use these).
- Engagement/interaction: metrics.engagements, .engagement_rate, .interactions, .interaction_rate, .interaction_event_types, .average_cpe  — GAP
- Quality (keyword grain): metrics.historical_quality_score, .historical_creative_quality_score, .historical_landing_page_quality_score, .historical_search_predicted_ctr  — GAP

### 5.5 Build-order note (route, not destination)
The 4 named breadth writers map to: network (5.3), all_conversions (5.4), impression_share (5.4), video (5.4). Value-order + Gate-A sequencing decided AFTER the MASTER GAP LIST is assembled from the 5.3/5.4 reconcile. Gate-A live-API validation for any of these needs the quota window (deferred).

### 5.6 Operational risk
- API cadence is now MONTHLY (v23 Jan 2026 →): pinned version drifts / unpinned auto-upgrades into breaking changes. Pinned google-ads-api version: ^23.0.0 (installed 23.0.0 → targets Google Ads API v23). ⚠ VERSION GAP: the surface above is mapped to v24.2 but our client runs v23 — v24/v24.2-only capabilities (notably performance_max_placement_view × ad_network_type, the PMax-network gap-closer) are UNAVAILABLE until the lib is bumped to v24. v25 ≈ Jul 2026. The bump is a deliberate, Gate-A-validated, breaking-change review — never an auto-upgrade.

═══════════════════════════════════════════════════════════════════
## 6. COMMERCE/ANALYTICS-vs-ADS DIFFERENCES (platform-onboarding-playbook input; GA4/Woo specifics in §3/§4)
═══════════════════════════════════════════════════════════════════
The (client, platform, account) key + 7-col metrics_daily + drain/registry/reconcile spine abstract the CAPTURE mechanics. The playbook layers over these SEMANTIC differences:
1. METRIC POLARITY — revenue/refunds (money IN) vs ad spend (OUT). Reconcile anchor = account NET revenue, not spend.
2. CONTENT LAYER — CATALOG (products/variants; shared, stable IDs, slow-changing) vs CREATIVE (per-ad, ephemeral).
3. CUSTOMER/LTV LAYER — commerce has a first-class CUSTOMER (LTV/RFM/cohort) that ads LACK; and it's PII → privacy-first capture (aggregates/sketches).
4. SLICE MODEL — Shopify = one rich ORDER record, free client-side pivot by ANY combination (no #100, no combo ceiling) vs ads = constrained breakdown matrix + strict rules.
5. RETENTION — scope-dependent account-LIFETIME (read_all_orders) vs fixed rolling 37mo. Floor = first order, not a window.
6. RATE MODEL — GraphQL calculated-query-cost + leaky bucket vs Google daily-ops (15k) vs Meta BUC-CPU. The rate abstraction must cover all THREE.
7. GRAIN SHAPE — event-shaped (orders → day) vs inherently-daily ad metric rows.
8. SOURCE TYPE — managed/live-fetchable (Shopify) vs self-hosted/gentle-citizen (Woo) — already abstracted (LIVE-SOURCE principle).

═══════════════════════════════════════════════════════════════════
## 7. STORAGE MODEL (settled 2026-06-28; see DECISIONS) — two-layer + RAG
═══════════════════════════════════════════════════════════════════
- LAYER 1 = dedicated COLUMNS on metrics_daily for Lora's HIGH-VALUE query/ranking axes: per-type conversions + revenue, video quartiles/ThruPlays. (Sortable/aggregatable by the query layer.)
- LAYER 2 = JSONB (extra) for the long tail + per-platform anomalies — ALSO the anomaly-absorber that lets future platforms onboard with NO migration (governing-law extensibility).
- LAYER 3 = SEPARATE semantic/RAG store for unstructured context (website/docs/industry baselines), later.
Rule: a value Lora ranks/aggregates on → a column; everything else → jsonb; unstructured → RAG. Adding a platform never forces a schema change (jsonb absorbs the new shape).
★ OPEN (NOT decided — for the master build queue): the columns-vs-jsonb call for GA's session/user metrics. Today queryMetrics aggregates ONLY columns (spend/clicks/impressions/conversions/conversion_value/revenue); GA sessions/users/engagement sit in extra-JSONB → NOT queryable. RECOMMENDATION (to decide at build, not yet locked): HYBRID — add ~8 core GA session/user metric COLUMNS (the high-value query/ranking axes) + keep the tail in jsonb; dimensional breakdowns ride the existing 7-col key. Decide at build.

(Companion: docs/LORAMER_BREAKDOWN_REGISTRY.md = per-dimension encoding. ALL FIVE PLATFORMS MAPPED — Meta §1 · Shopify §2 · GA4 §3 · Woo §4 · Google §5. Google EMPIRICAL per-client field-return probe DEFERRED to ≥2026-06-30T08:03Z quota window (desk-map complete). NEXT: cross-platform MASTER GAP LIST + value-ordered BUILD QUEUE.)
