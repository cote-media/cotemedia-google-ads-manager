# LoraMer — DEFINITIVE CAPTURE INVENTORY (master surface map)
<!-- LORAMER_DEFINITIVE_CAPTURE_INVENTORY_V1 -->

STATUS: ACTIVE master map of EVERYTHING each connected platform exposes — the source of the cross-platform gap list
+ value-ordered writer queue. Governing law: capture EVERYTHING from EVERYWHERE, store FOREVER, full grain WITH history.
SEQUENCING (settled): map ALL FIVE platforms FIRST → ONE master gap list + value-ordered build queue → THEN build. Do
NOT build writer-by-writer ahead of the complete map. (Mixed-state note: meta_device + meta_age_gender shipped before
inventory mode — correct, keep.) Per-platform companion: docs/LORAMER_BREAKDOWN_REGISTRY.md (per-dimension encoding).
DONE: Meta ✅, Shopify ✅. REMAINING: GA4 (next, not gated), Woo (not gated), Google (after the ~08:03Z quota reset;
docs readable anytime). Tags: [CAPTURED ←writer] / [GAP].

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
## 3. COMMERCE-vs-ADS DIFFERENCES (platform-onboarding-playbook input)
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
## 4. STORAGE MODEL (settled 2026-06-28; see DECISIONS) — two-layer + RAG
═══════════════════════════════════════════════════════════════════
- LAYER 1 = dedicated COLUMNS on metrics_daily for Lora's HIGH-VALUE query/ranking axes: per-type conversions + revenue, video quartiles/ThruPlays. (Sortable/aggregatable by the query layer.)
- LAYER 2 = JSONB (extra) for the long tail + per-platform anomalies — ALSO the anomaly-absorber that lets future platforms onboard with NO migration (governing-law extensibility).
- LAYER 3 = SEPARATE semantic/RAG store for unstructured context (website/docs/industry baselines), later.
Rule: a value Lora ranks/aggregates on → a column; everything else → jsonb; unstructured → RAG. Adding a platform never forces a schema change (jsonb absorbs the new shape).

(Companion: docs/LORAMER_BREAKDOWN_REGISTRY.md = per-dimension encoding. Pending inventories: GA4, Woo, Google → then the cross-platform master gap list + value-ordered build queue.)
