# Data Completeness Matrix — Historical Data Engine

**EVERYTHING GETS EVERYTHING.** Data completeness is a CORRECTNESS requirement, not a nicety. Every
known gap must be surfaced EXPLICITLY (in the UI, in Lora's answers, and here) — never silent. Any
accepted cap (retention floor, scope wall, API limit) is a LOGGED, DOCUMENTED, DELIBERATE decision,
recorded in this file. A silent empty (a missing platform, a truncated window, a dropped grain) is a
bug until proven to be a documented limit.

Ground truth below is from live `metrics_daily` + the code, audited **2026-06-12**
(LORAMER_COMPLETENESS_AUDIT_V1). Keep current — this is the authoritative coverage artifact.

## Coverage matrix (live metrics_daily, 2026-06-12)

| Platform | Forward capture (cron) | Backfill: adapter? RUN+PROVEN? depth | Captured span (live) | Known limits |
|---|---|---|---|---|
| **Google Ads** | base: account/campaign/ad_group/ad; dimensional: search_term, keyword. Verified live this session. | V2 account adapter — RUN (account rows back to **2016-04-20**). google-dimensional — RUN+PROVEN (cohort 16/16, 2026-06-12; ~49.5k search_term/keyword rows, 90d). | 2016-04-20 → 2026-06-11; 18 clients; 102,354 rows; levels account/ad/ad_group/campaign + breakdowns keyword/search_term | Google account retention ~11yr (132mo, engine floor). Search-term/keyword report retention is SHORTER than account data. **Deep backfill is ACCOUNT-LEVEL only** — campaign/ad_group/ad rows exist only from forward capture (connect date forward), NOT backfilled. |
| **Meta** | base: account/campaign/ad_set/ad. NO breakdowns persisted. | V2 account adapter — RUN (account rows back to **2023-06-21** ≈ 37-mo floor). NO meta-dimensional. | 2023-06-21 → 2026-06-11; 7 clients; 1,809 rows; levels account/ad/ad_set/campaign; NO breakdown_types | Meta Insights ~**37-month** retention purge (2023-06 floor). **publisher_platform/age/gender breakdowns are fetched LIVE but NEVER persisted** → query_breakdown meta grains have no data. Deep backfill account-only. |
| **GA (Analytics)** | account only. | V2 ga adapter (resolveContext) — RUN (rows back to **2022-02-02**; engine floor 2015-08-14). NO ga-dimensional. | 2022-02-02 → 2026-06-10; 4 clients; 3,150 rows; account only | GA Data API floor 2015-08-14. **Account-grain ONLY** — no source/medium/channel/landing-page dimensional capture or backfill. |
| **Shopify** | base: account + product (NET); dimensional: geo_country, geo_region. Customer-mix in account extra. Verified live this session. | shopify-dimensional — RUN+PROVEN (Influential Drones + Escential + Foam OH, 2026-06-12) BUT **truncated to ~60 days** by the scope wall. | 2026-03-14 → 2026-06-11; 6 clients; 519 rows; account/product + geo_country/geo_region | **60-DAY SCOPE WALL** — without `read_all_orders` the app sees only the trailing ~60 days of orders (proven: earliest VISIBLE order 2026-04-14 vs 12,689 admin orders to 2022). Shopify itself retains FULL history (no purge). Sell-through (read_inventory) + ATC funnel (Web Pixels) not captured. |
| **WooCommerce** | account only (started 2026-06-02). | **NO backfill adapter.** | 2026-06-02 → 2026-06-10; 1 client; 9 rows; account only | No backfill at all — history begins at forward-capture start. Account-grain only, no product/geo depth. |

## Gaps, ranked by severity

1. **[HIGH] Shopify 60-day scope wall** — no `read_all_orders`, so the entire commerce history beyond ~60 days is invisible. The 3 backfilled stores' pre-60-day rows are FALSE-EMPTY (earliest non-empty day clusters at 2026-04-13/14). Closing it: batch `read_all_orders` + `read_inventory` into one scope expansion → Shopify app review → re-auth → deep re-backfill (to the store's first order, e.g. FoamOh 2022). POST-Meta-decision (consent-screen change). This is the biggest violation of "everything gets everything" for commerce — and Shopify is the one platform with full retention once scoped.
2. **[HIGH] Meta breakdowns not persisted** — publisher_platform/age/gender are fetched live for the dashboard but never written to metrics_daily, so query_breakdown's meta grains return nothing and there's no historical placement/demographic series. Needs a meta-dimensional capture + backfill (mirror google-dimensional).
3. **[MEDIUM] Google/Meta entity-depth not backfilled** — deep history is ACCOUNT-LEVEL only; campaign/ad_group/ad/ad_set rows exist only since each client's connect date (forward capture). Deep period-over-period at campaign/ad grain is impossible for pre-connect history. Needs a deeper buildRows in the V2 engine or a per-level dimensional backfill.
4. **[MEDIUM] WooCommerce has NO backfill adapter + account-only** — Woo clients have zero history before forward-capture start and no product/geo depth. Structural (only 1 Woo client today, but the gap is total). Needs a Woo backfill adapter + depth parity with Shopify.
5. **[MEDIUM-LOW] GA account-grain only** — no source/medium/channel/landing-page dimensional capture or backfill; GA is the shallowest grain.
6. **[LOW / roadmap] Shopify funnel + sell-through** — add-to-cart/checkout (Web Pixels, not a scope add) + sell-through (read_inventory) not captured. Post-freeze (Shopify Depth 2b/Phase 3).

## Accepted/documented caps (deliberate, not bugs)
- Google search-term/keyword deep history is bounded by Google's search-term report retention (shorter than account data) — the search-terms backfill is intentionally ~90 days.
- Engine retention floors: Google 132mo, GA 2015-08-14 — platform-imposed, honored.
- Shopify 60-day wall is a CURRENT cap pending read_all_orders — tracked as gap #1, NOT accepted long-term.
- Forward-capture row caps (top-N campaigns/keywords/search terms/products) are deliberate noise controls, logged on truncation.

## Maintenance rule
Any change to what a platform captures (a new grain, a new backfill adapter, a closed scope wall) updates THIS matrix in the SAME commit. New platforms are added as a row. This file is the EVERYTHING-GETS-EVERYTHING scorecard.
