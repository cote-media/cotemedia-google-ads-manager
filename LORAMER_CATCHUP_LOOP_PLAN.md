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

---

## APPROVED APPROACH (gated by Russ 2026-06-15)

DECISIONS:
(a) Placement = SEPARATE route /api/cron/catchup (per-platform-gated via ?platform=), NOT inline. Rationale: full-fidelity repair stacked on the nightly yesterday-baseline would exceed maxDuration=300 (est. Google ~33s/client-day → first repair night ~460s). A separate route runs the repair in its own fresh 300s budget and leaves the just-stabilized forward cron BYTE-UNCHANGED (zero regression to fresh code). Self-healing-forever = schedule catchup on its own staggered nightly Vercel crons, offset AFTER the forward crons; steady-state gap=0 → no-op.
(b) Per-run day cap = 14 days per (client, platform), oldest-first contiguous. Advance last_forward_sync_date = max(current, last contiguously-filled day) — monotonic, never moves backward, so forward + catchup cannot corrupt each other; idempotent UPSERT (METRICS_DAILY_CONFLICT) makes overlap a harmless rewrite. 14 clears every current hole in one pass (largest = GA, 5 missing days); larger future gaps converge over successive nights.
(c) Woo = per-day replay loop now, NO new adapter. Every platform handled identically: catchup loops gap days and reuses the SAME capture body the nightly cron uses with (day, day). WS3 #7 (formal Woo backfill adapter for deep history) stays deferred/unbundled.

FIDELITY = FULL (not account-spine). Catchup re-runs the same intelligence fetch + builders the nightly cron uses per gap day, INCLUDING Google search-term/keyword dimensional rows and Shopify depth rows. Rationale: search terms are permanent-loss (Google purges them); account-spine-only would lose that history forever, breaking the "permanent system of record" promise.

DRY: row builders are the fidelity-critical part. Shopify + GA builders + dimensional/depth fetchers+builders are ALREADY shared. Only buildMetaMetricsRows / buildGoogleMetricsRows / buildWooMetricsRows are still inline in cron/sync/route.ts.

BUILD SEQUENCE (one change in flight each; tsc+grep → vercel --prod → verify on the Air → revert-ready):
- 2a: extract the 3 inline builders into shared modules; cron imports them. No behavior change. Verify forward-cron output byte-identical on the Air BEFORE anything depends on them.
- 2b: add /api/cron/catchup (reads sync_state.last_forward_sync_date per client+platform, computes gap [L+1..yesterday], fills oldest-first capped at 14, monotonic L, reuses ALL shared builders/fetchers per gap day = full fidelity) + staggered catchup crons in vercel.json + shared addDays (currently module-local in run-backfill.ts). Repair current holes via manual per-platform invocation on the Air; verify in metrics_daily (rows present for missing dates; idempotent re-run; L advanced); confirm real per-platform timing < 300s before trusting the schedule.

VERIFICATION is provable immediately by manual invocation — NOT gated on the nightly cron window. The ~33s/client-day Google estimate is confirmed by real Air timing before relying on the schedule.

---

## CORRECTION (2026-06-15) — decision (b) gap-detection SUPERSEDED: presence-based, NOT last_forward_sync_date

The (b) mechanism above ("read last_forward_sync_date L, fill [L+1..yesterday]") is WRONG and is hereby superseded. Reason: the OLD forward cron stamped L=yesterday UNCONDITIONALLY even on nights it skipped days — which is HOW the current holes formed. So L now sits at yesterday (06-14) for the hole-clients while the holes (GA 06-09->06-13, Woo 06-11->06-13, Google-tail 06-12->06-13) sit BELOW L. [L+1..yesterday] would be empty -> would repair NOTHING. (Gate-A Q5: nothing reads L anyway.)

CORRECTED MECHANISM — presence-based, per (client, platform, account):
1. Window = last 35 days ending yesterday: [yesterday-34 .. yesterday]. const CATCHUP_WINDOW_DAYS = 35.
2. Read metrics_daily for the dates that already have an account-level row (entity_level='account') for that (client_id, platform, account_id) in the window.
3. If ZERO present in the window -> SKIP this (client, platform, account). No recent baseline = forward cron / deep-backfill engine's job, not catchup's. (Runaway guard against pre-connection days.)
4. Else floor = earliest present date in window; ceiling = yesterday. Missing = every date in [floor..ceiling] with no account-level row.
5. Fill the OLDEST up-to-14 missing dates this run (const CATCHUP_DAY_CAP = 14), oldest-first, FULL fidelity (same fetch + shared builders + depth (shopify) / dimensional (google) sub-captures the forward cron runs, per day, with (day,day)). Idempotent UPSERT on METRICS_DAILY_CONFLICT.
6. Catchup NEVER reads or writes last_forward_sync_date — purely presence-driven. Backlogs larger than the cap converge over successive nights.

Repairs the EXISTING holes (interior-to-window missing dates) AND self-heals any FUTURE skip incl. a missed yesterday, without trusting L and without touching the forward cron. Forward cron stays unchanged; L remains a harmless write-only vestige.

PRESENCE SIGNAL = entity_level='account' main row. CONFIRM at 2b first read that all 5 builders emit an entity_level='account' main row (meta/google/woo confirmed in 2a; shopify + ga to confirm) before relying on it.

UNCHANGED: (a) separate /api/cron/catchup route, per-platform-gated, own 300s budget; (c) Woo per-day replay, no new adapter; full fidelity; 14/run cap. Re-gated by Russ 2026-06-15.

---

## 2b FINDING (2026-06-15) — shared-builder NULL-numeric bug (root cause of a Meta hole) + fix + durable follow-up

DISCOVERED by catchup verification (caught a hole the manual hole-list missed). Meta upsert rejected by metrics_daily NOT-NULL constraint (Postgres 23502): buildMetaMetricsRows wrote `conversions: metrics.conversions` UN-coalesced; Meta returned null conversions for Glass Plus (client 7d90cce7, act_3769140430018695) on 06-11 — real spend 35.49, impressions 5437, clicks 230, conversions NULL — so the null hit the NOT-NULL column and the WHOLE row was rejected -> silent hole. buildGoogleMetricsRows shares the identical un-coalesced pattern (didn't trip this run only because Google emitted 0, not null). GA / Woo / Shopify builders coalesce (?? 0) and are immune.

NOT catchup-specific: the FORWARD cron uses the same shared builders, so this is what CREATED the Meta hole (the nightly write of 06-11 hit the same 23502). Catchup faithfully reproduced and exposed it.

LESSON (to be numbered at WS1c STEP 2 close-out): a platform may return null for a NOT-NULL numeric column; an un-coalesced builder field makes the upsert 23502-fail and SILENTLY drop the row (a hole). Every NOT-NULL numeric column must be coalesced.

IMMEDIATE FIX (gated by Russ 2026-06-15): coalesce the NOT-NULL numeric metric fields to `?? 0` in buildMetaMetricsRows + buildGoogleMetricsRows (matching GA/Woo/Shopify). Strictly-safe: no-op on any row that already has a number; only converts a crash into a stored 0. Chosen OVER making the column nullable (that would break the non-null numeric assumption across every reader — query_metrics, charts, Lora — for marginal semantic gain). To be verified by re-running meta catchup (Glass Plus 06-11 fills clean, no 23502) + a forward-meta regression check.

DURABLE FOLLOW-UP (QUEUED — approach-first, NOT bundled here): centralize numeric coalescing at the metrics_daily WRITE BOUNDARY — one normalize step / upsertMetricsDaily helper that ALL writers route through (cron/sync, catchup, run-backfill, google-dimensional-backfill, shopify-dimensional-backfill), so no builder can ever reintroduce a null-numeric hole. The per-builder coalesce is the same convention that already silently failed once; the chokepoint makes the class structurally impossible. Deferred to its own change-in-flight (touches ~9 builders / all writers incl. the just-stabilized forward path) to protect pre-launch stability. The inline coalesce stays as a harmless inner guard after the chokepoint lands — nothing gets undone.

ALSO OPEN after the fix: Google account 2102961791 is ~4 days short of full-window convergence (clears on one more google catchup pass); 2b-crons (staggered nightly catchup schedule) not yet wired.

SUPERSEDED 2026-06-15: the ?? 0 builder patch was INSUFFICIENT — the bad value is NaN, not null (NaN ?? 0 = NaN -> JSON null -> 23502). Fixed via finite-number write-boundary guard normalizeMetricsRows (LORAMER_METRICS_NORMALIZE_V1), scoped to forward cron + catchup now; backfill-route wrapping folded into the queued write-boundary chokepoint hardening.

---

## STATUS: WS1c STEP 2 COMPLETE & VERIFIED — 2026-06-15
Commits: 19a21b7 (2a builder extraction) / 513b980 (2b presence-based catchup route) / 9dee901 (decision-b corrected to presence-based) / a749660 (§A write-boundary finite guard) / 577ffb4 (2b nightly catchup crons). Catch-up route live + self-healing nightly (catchup 08:30–08:50 UTC, after forward 08:00–08:20). Original holes repaired; future skips self-heal within ~1 day. REMAINING QUEUED: extend normalizeMetricsRows to the backfill writers (run-backfill + google/shopify-dimensional-backfill) = full write-boundary chokepoint.
