# LORAMER_CATCHUP_LOOP_PLAN.md

## WS1c STEP 2 — CATCH-UP LOOP (design inputs captured; approach pending Russ's gate)

Status: Gate-A read DONE (2026-06-15, this doc). Approach NOT chosen. Build NOT started. This is the highest-risk cron change of WS1 (touches all 5 capture paths) → do it approach-first in a fresh session: write the approach, Russ gates it, then build.

---

## Problem
The forward-capture cron (`src/app/api/cron/sync/route.ts`) only ever writes ONE day — `captureDate = resolveDateWindow('YESTERDAY')` — and stamps `sync_state.last_forward_sync_date = captureDate` unconditionally. It NEVER reads `last_forward_sync_date`, so it has no notion of "how far behind am I." Any day a platform is skipped (starvation, outage, token blip) becomes a PERMANENT HOLE — the next successful run jumps straight to yesterday and the gap is never refilled.

Holes to repair (as of 2026-06-15, after the WS1c step-1 split landed yesterday=06-14 for everyone):
- GA: 06-09 → 06-13 (4 clients: Foam OH, My Vacation Network, The Escential Group, Veterinary mastermind)
- Woo: 06-11 → 06-13 (Advar Test Store 1)
- Google-tail: 06-12 → 06-13 (BusyBee Bookkeeping, Influential Drones, The Escential Group, skinregimen.com 06-14-only)

---

## GATE-A FINDINGS (READ-ONLY, 2026-06-15)

### Q1+Q2 — Intelligence fetchers: range support / granularity / call pattern
All 5 accept `(dateRange, customStart, customEnd)` via `resolveDateWindow`; all 5 return a SINGLE AGGREGATED object for the whole range — NONE emit per-day rows.

- **fetchShopifyIntelligence** — `src/lib/intelligence/shopify-intelligence.ts:136`. Range YES (GraphQL `created_at:>=startT00 AND created_at:<=endT23:59`). AGGREGATED (orders reduced to totals, no date dim). ONE query + cursor pagination over the range → per-day needs one call per day.
- **fetchMetaIntelligence** — `src/lib/intelligence/meta-intelligence.ts:80`. Range YES (`time_range={since,until}`). AGGREGATED (one insight per entity, NO `time_increment=1`). ONE call per entity-level + paging. Per-day from this fetcher = N calls.
- **fetchGoogleIntelligence** — `src/lib/intelligence/google-intelligence.ts:113`. Range YES (`segments.date BETWEEN ...`). AGGREGATED (NO `segments.date` in row grain). ONE GAQL query per entity. Per-day from this fetcher = N calls.
- **fetchGaIntelligence** — `src/lib/intelligence/ga-intelligence.ts:391`. Range YES (`dateRanges:[{startDate,endDate}]`). AGGREGATED (totals, no `date` dimension; 7 parallel reports). ONE call per bucket.
- **fetchWooCommerceIntelligence** — `src/lib/intelligence/woocommerce-intelligence.ts:12`. Range YES (REST `&after=...&before=...`). AGGREGATED (one total). ONE date range across ≤10 paginated pages → per-day needs one call per day.

KEY: the cron forward-capture already produces a correct SINGLE-DAY row from each aggregated fetcher by passing `(captureDate, captureDate)`. So any of these fills one specific day by calling it with `start=end=that day`.

### Q3 — Backfill routes / engine / reusable per-day fetchers / Woo
Routes under `src/app/api/backfill/`: ga, google, google-dimensional, meta, probe, probe-ga, run, shopify-dimensional, status. (NO account-level shopify route; NO woo route.)

Shared engine: `runBackfill(clientId, adapter)` — `src/lib/backfill/run-backfill.ts:99`. Loops in chunks via `adapter.fetchDaily(token, accountId, windowStart, windowEnd)` (returns PER-DAY slices) → `adapter.buildRows` → metrics_daily upsert. Produces correct per-day rows. **NOTE:** it walks BACKWARD from yesterday toward `backfill_earliest_date` (historical extension), keyed off `backfill_earliest_date` — it does NOT read `last_forward_sync_date` and is NOT a forward gap-filler as written.

Reusable per-day fetchers (one call covers a multi-day gap with per-day rows → fits 300s easily):
- **getDailyMetrics** (google) — `src/lib/google-ads.ts`, via `googleBackfillAdapter`.
- **fetchMetaDailyMetrics** (meta) — `src/lib/meta-ads.ts`, via `metaBackfillAdapter` (uses `time_increment=1`).
- **fetchGaDailyMetrics** (ga) — `src/lib/intelligence/ga-intelligence.ts:458` + `buildGaMetricsRows`, via `gaBackfillAdapter` (chunkDays 365; floorDate 2015-08-14).

`backfillAdapters` registry (`adapters.ts:115`) = `{ google, meta, ga }` ONLY.

⚠️ **WOO: NO backfill route and NO backfill adapter anywhere** ("NO woo references in backfill" confirmed by grep). No Woo daily-metrics fn exists. Woo can be caught up WITHOUT a new adapter by looping day-by-day calling `fetchWooCommerceIntelligence(storeUrl,...,'CUSTOM', day, day)` → yields exactly that day's account+product rows (identical to what the cron's woo loop already does). A formal Woo backfill adapter (a `fetchDaily` returning per-day slices in one call) is OPTIONAL efficiency — not required (Woo = 1 client, ~11s). Same applies to account-level Shopify (no daily fetcher; per-day loop over the aggregated fetcher).

### Q4 — metrics_daily UPSERT conflict key
`METRICS_DAILY_CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'` — defined IDENTICALLY in all 4 writers: `cron/sync/route.ts:25`, `run-backfill.ts:82`, `google-dimensional-backfill.ts:24`, `shopify-dimensional-backfill.ts:21`.
Idempotent: YES. Multi-account is keyed via `entity_id` (the account row's `entity_id` = `account_id`), so re-writing one `(client, platform, account, date, entity, breakdown)` UPSERTs in place — re-running catch-up over the same day overwrites, never duplicates (Lesson 39 safe). Caveat: `account_id` is NOT itself in the key, but `entity_id` carries it for account-grain rows, so distinct accounts don't collide.

### Q5 — Gap helper?
NONE EXISTS. `last_forward_sync_date` appears at exactly 5 sites — all WRITES inside `cron/sync/route.ts` (the 5 per-platform sync_state upserts). Never READ anywhere; no gap/missing-range helper. Catch-up must: (a) read `sync_state.last_forward_sync_date` per (client, platform); (b) compute range = `last_forward_sync_date + 1 .. yesterday`; (c) fill it. `addDays(iso, n)` — `run-backfill.ts:93` — is reusable for the date math.

---

## DESIGN IMPLICATION
- **google / meta / ga = efficient:** read sync_state gap → ONE call to the daily fetcher (`getDailyMetrics` / `fetchMetaDailyMetrics` / `fetchGaDailyMetrics`) over the whole gap → buildRows (`buildGaMetricsRows` etc.) → upsert. A multi-day gap fits 300s in a single call.
- **shopify / woo = per-day loop** over the aggregated intelligence fetcher with `(day, day)`, reusing the cron's existing `buildShopify*` / `buildWooMetricsRows` builders. Small/cheap clients.
- The idempotent conflict key means catch-up and the nightly forward run can overlap safely (same day re-written = no dup).

---

## OPEN DECISIONS (NOT decided — to settle in the approach)
- **(a) Placement:** catch-up inside each per-platform cron loop (self-healing every night) vs a separate one-shot route/run.
- **(b) Per-run day cap:** bound the days filled per invocation so the FIRST catch-up over a large gap can't blow the 300s budget (then converge over successive nights).
- **(c) Woo:** handle by the per-day loop now (no new code path) vs build the WS3 #7 Woo backfill adapter and reuse it here.

---

## EXECUTION NOTE
WS1c step 1 (per-platform split) is DONE & VERIFIED (commit c5180b5, LORAMER_CRON_PLATFORM_SPLIT_V1). It stopped the ongoing bleed (every platform now lands yesterday in its own 300s budget). This catch-up loop repairs the EXISTING holes left by the earlier starvation. WS1b (cron_runs completion sentinel) is independent and can land before or after.
