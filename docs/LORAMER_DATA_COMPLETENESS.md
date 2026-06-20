# LoraMer — Data Completeness: Gap Matrix + Rollout Plan
AVAILABLE (official API docs, Jun 2026) vs HAVE (adapter inventory) vs GAP. Two gap types: DEPTH = a grain we capture forward but never backfilled (silent risk); BREADTH = a dimension the API offers we don't capture at all (future scope, not lost).

## GOOGLE ADS
Have: account(summed)+campaign+ad_group+ad spend/impr/clicks/conv/conv_value; search_term+keyword ~90d; QS/budget/bidding. Only segment captured = date (+conversion_action).
Gap: DEPTH — campaign/ad_group/ad no backfill (forward-only, being fixed); keyword/search_term ~90d only. BREADTH — device, ad_network_type, geo, age/gender, hour/day-of-week, impression-share family (budget/rank-lost, top%), video metrics, all_conversions, view-through, conversion lag, audiences/assets/asset_groups — none captured.

## GA4
Have: account daily totalRevenue + conversions (spend=0). DEEP BACKFILL EXISTS — mechanism built and run for multiple clients (years).
Gap: DEPTH — none structural; aggregated revenue/conversions backfills YEARS via Data API (the 2–14mo limit is granular user/event-scope ONLY, not aggregated date-scoped metrics). ACTION: confirm per-client coverage, run existing backfill for any shallow/recently-connected client. BREADTH — sessions/users/engagement, source/medium/campaign/channel, landing pages, device, geo, demographics, events, item-level ecommerce — not persisted (only revenue+conversions).

## META ADS
Have: account+campaign+adset+ad spend/clicks/impr/conv/conv_value + reach/frequency + funnel actions + extra. Placement (publisher_platform,platform_position) fetched live at campaign level but NOT persisted.
Gap: DEPTH — campaign/adset/ad forward-only (being fixed). BREADTH — placement dropped-on-write (HIGH, free win); age/gender, geo (country/region/dma), device, hourly not requested; ALL video metrics; ranking diagnostics; outbound/inline clicks; full cost_per_action_type set.

## SHOPIFY (best-covered)
Have: account NET revenue + orders + customer mix + refund stats + AOV; product rows (NET, ALL products, units); geo_country + geo_region.
Gap: shipping/tax components (totals only); discount codes as dimension; variant/SKU; customer LTV/email (id only — intentional); abandoned-checkout value (count only); fulfillment/inventory, tags, sales channel.

## WOOCOMMERCE
Have: account NET (sale-only) revenue + orders; topProducts TOP-N only (top-10 cap).
Gap: ACTIVE LOSS — product rows capped at top-10 → real loss on >10-product days (Shopify captures all). shipping/tax components not separated; NO geo; NO customer/new-vs-returning; variants/coupons/fulfillment ignored; WC Analytics reports unused.

## BOTTOM LINE — ACTION
Depth: (1) campaign Google+Meta — writers proven, scale all clients. (2) GA — run existing backfill for shallow clients (years deep).
Active loss: (3) Woo top-10 product cap — drop it, capture all.
Free win: (4) Meta placement — persist what's already fetched.
Breadth (future): device/geo/demographics/network/hour, Google impression-share, Meta video+ranking, GA dimensions.

## TOMORROW — COORDINATED COMPLETENESS ROLLOUT (single focus until done)
PHASE 1 DEPTH: (1) scale campaign writers (Google+Meta) across ALL clients, deepest the API serves; per-day spend reconcile-or-skip; Meta conversions=own grain; idempotent; resumable; per-client reconcile proof. (2) GA backfill for every shallow client; reconcile to account grain.
PHASE 2 FIXES: (3) Woo — remove top-10 cap, capture ALL products (forward+backfill). (4) Meta — persist placement breakdown.
PHASE 3 GUARANTEE: (5) completeness gate — audit every client×platform×grain; flag any grain shallower than account or any fetched-but-unpersisted field; pre-launch gate + repeatable.
PHASE 4 BREADTH: the breakdown/dimension capture project, prioritized by product value, after 1–3.
Every phase: approach gate on shared writers; Gate A reconcile before commit; freeze-safe; reconcile-or-don't-write; loud failures.

## ENFORCEMENT — onboarding = total capture (per the bedrock principle in LORAMER_HANDOFF.md)
PHASE 4 (breadth) is ELEVATED from "future/prioritized" to a CORE requirement: capture every available grain/dimension/metric in the matrix, forward + backfilled to platform floor.
Onboarding automation: every source connect auto-triggers full backfill across all grains (the backfill engine already reaches GA 2015 floor / campaign / stores — extend it to all breadth dimensions and fire it on connect).
Completeness gate: every client × platform × grain × dimension — flag anything missing, shallow, or fetched-but-unpersisted; gate "onboarded" on green; run continuously thereafter.
