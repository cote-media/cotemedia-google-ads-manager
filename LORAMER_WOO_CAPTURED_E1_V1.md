# LORAMER_WOO_CAPTURED_E1_V1

Make the WooCommerce dashboard tab read CAPTURED metrics_daily instead of live-fetching the merchant's self-hosted store on render (LIVE-SOURCE PRINCIPLE). Woo path only — Shopify is a managed platform and stays live, untouched.

## Decisions (locked 2026-06-17)
- New/returning customer = FIRST-EVER buyer, unified across Woo + Shopify (replaces Woo's window-local-repeat definition). [E2]
- Woo guest checkouts (no customer key) = separate "Guest" bucket, not folded into "new". [E2]
- Customer-mix engine is 0-PII-at-rest (no stored identifiers; classify at capture, persist only aggregates / probabilistic sketches). [E2]
- Ship E1 (aggregate metrics) now; New/Returning tiles show an honest empty state in the E1->E2 gap.

## E1 scope (this change)
- Chart (revenue/orders/AOV per day): read metrics_daily account rows (revenue=NET, orders=conversions, AOV=extra.avgOrderValue) — replaces the live /api/woocommerce/daily fetch which summed GROSS across all statuses (latent over-reporting bug; corrected here).
- Total Revenue / Orders / AOV cards: sum captured account rows over window.
- Top Products: aggregate captured product rows (entity_name, revenue, extra.units), re-rank top-10.
- New/Returning tiles: honest "coming soon" empty state (no fabricated zeros).
- Lora's Woo narrative: built from the captured object; mix commentary suppressed.
- Result: zero outbound calls to the merchant store on Woo-tab render.

## Edges
- Today/intraday: captured runs through yesterday; today-inclusive ranges (Today / This-Month / custom-ending-today) show through the latest captured day with an "as of <date>" note; never fabricate today as 0. 7/30/90d presets end yesterday — unaffected.
- Pre-capture gap: captured history may start later than the store's true first sale (Shelley = Dec 2018; 2016-2018 tail deferred, host 500s). Ranges reaching before earliest-captured must surface the gap explicitly ("captured from <date>; earlier not yet available") — never imply zero.
- Missing day INSIDE captured range = genuine no-sales day (show 0); only pre-capture + today are "unknown".
- Missing-day-inside-range = 0 rides on the metrics_daily contract (one row per sale-day); an unhealed capture gap would briefly read as 0 until the catchup loop heals it (35-day presence-based) — accepted, mitigated by catchup + the cron_runs sentinel.

## Verification
- Gate A (local, pre-deploy): tsc/build clean; /api/woocommerce/daily has no consumer besides the Woo chart; captured queries reconcile to Shelley 2025-11-28 = 31 orders / $2,246.34; Shopify intelligence path unchanged + unaffected.
- Gate B (prod, post-deploy): Woo tab renders from captured on NET basis; New/Returning tiles show honest empty state; NO outbound call to the store on render.

## Follow-ups (post-E1)
- E2: 0-PII first-ever new/returning engine (Bloom/HLL, full-history oldest->newest seeding pass, guest bucket).
- Deep-tail capture: Shelley 2016-2018 (host 500s) via the hardened breaker engine — remaining piece of full-history "everything".
- WOO INGESTION RESEARCH (larger scope): is there a materially better Woo mechanism we're missing — WC Analytics/Reports API (server-side aggregates), webhooks for forward capture, or a companion WP plugin — vs walking raw /orders? Self-hosted + variable host quality is partly structural; confirm we use the best available mechanism.
