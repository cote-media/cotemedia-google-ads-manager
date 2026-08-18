# LORAMER_WALK_REBUILD_ARCHITECTURE.md — THE FROZEN ARCHITECTURE + THE PRINCIPLES
⛔ **MANDATORY READING BEFORE ANY WORK ON THE UNIVERSE WALK, THE CAPTURE ADAPTERS, OR THE RESUMER.**

⛔ **WHY THIS FILE EXISTS IN THE REPO AND NOT WHERE IT WAS WRITTEN.** All of this was authored into a plan
file at `~/.claude/plans/` — **OUTSIDE the repository**. It was therefore not committed, not in
`docs/HANDOFF_MANIFEST.json`, and **INVISIBLE TO THE FRESHNESS GATE THAT EXISTS TO CATCH EXACTLY THIS**.
970 lines of frozen architecture, six banked principles and four falsifications were one lost file from
gone, and nothing in the repo would have noticed.
**THE GENERAL FIX, STATED AS A RULE RATHER THAN AS THIS ONE REPAIR: ANYTHING LOAD-BEARING THAT LIVES
OUTSIDE THE REPO IS INVISIBLE TO THE GATE. If a future session finds itself authoring governance content
into a scratch path, a plan file, or a chat message that is never committed, that content DOES NOT EXIST as
far as tomorrow is concerned.** The laws go to `LORAMER_ESSENCE.md`, settled decisions to
`LORAMER_DECISIONS.md`, open items to `LORAMER_QUEUE_OF_RECORD.md`, and architecture here.

**OWNERSHIP, per the DOC-OWNERSHIP GATES:** this file owns the walk rebuild's ARCHITECTURE and its
PRINCIPLES. It does NOT own status (DECISIONS), open items (QUEUE), the session narrative (CONTINUE_HERE),
or law (ESSENCE) — it POINTS at those.

<!-- QUEUE-KEY: WALK-REBUILD-STEPS-8-16 -->
⛔ **STEPS 0-7 OF 16 ARE BUILT AND PUSHED; STEPS 8-16 ARE NOT.** The unbuilt half is owned by
`LORAMER_QUEUE_OF_RECORD.md` ★WALK-REBUILD-STEPS-8-16 — this doc holds the DESIGN, the queue holds the
STATUS. (`docs-queue-coverage.guard.mjs` failed the build the moment this file landed without that entry,
which is the guard doing exactly its job: a design doc for unbuilt work with no queue entry is a plan
nobody is tracking.)

**PROVENANCE:** authored 2026-08-08/09 across five adversarial planning rounds plus seven build steps.
Section numbers are preserved from the original plan file so cross-references in commit messages and queue
entries still resolve.

---

## 22 · ⛔ STEP 4 RESULT — THE TWO-FACTOR DENSITY MODEL IS FALSIFIED. §2(a) IS WITHDRAWN.

Run 2026-08-08 against the live log: **17,892 rows, 16,810 usable after exclusions, 35 resources, ONE client
(Foam OH — every row in `universe_window_log` is one account, which is its own limit and is stated below).**

### 22.1 · The falsifier fired on ALL 35 resources, and the ablation says why
`predicted = base_rows_per_day(resource) × days × activity_ratio(window) × distinctValues(segment)`
scored **MdAPE 87.2 %** on a held-out time split. Falsifier was > 50 %. **PASS 0 · FAIL 29 · NO MODEL 6.**

That alone would be a weak finding — a bad fit can mean a bad estimator. **The ablation is what makes it a
real one: EVERY COVARIATE MAKES THE MODEL WORSE THAN THE CONSTANT IT WAS SUPPOSED TO IMPROVE ON.**

| model | MdAPE, time split | MdAPE, random split |
|---|---|---|
| A · constant per resource | **77.5 %** | **73.0 %** |
| B · × days | 77.5 % (identical to A) | 73.0 % |
| C · × days × distinctValues | 81.3 % | 69.8 % |
| D · × days × activity_ratio | **88.1 % — WORSE** | **93.7 % — MUCH WORSE** |
| E · the full specified model | 87.2 % | 92.3 % |
| F · constant per ENTRY (no covariates at all) | **67.6 %** | **50.0 %** |

- **`days` IS UNIDENTIFIABLE FROM THIS DATA AND B PROVES IT** — A and B are the same number to the decimal,
  because 17,874 of 17,892 windows are exactly 30 days. The log cannot say anything about window length.
  ⚠ This is a property of the DATA, not a refutation of `days`. Rows plainly scale with days; we have simply
  never varied it, so it cannot be *validated* here. Do not read B as "days doesn't matter".
- **`activity_ratio` IS ACTIVELY HARMFUL, and that is the most surprising result.** Account impressions were
  the one covariate that felt obviously right. They cost 10 points on the time split and 21 on the random
  one. Impressions measure how much the account SPENT; row count measures how many ENTITIES existed. A
  dormant month still has campaigns, ad groups, assets and landing pages, and still writes their rows.
- **`distinctValues` is noise-level**: −3.8 points one way, +3.2 the other.

### 22.2 · distinctValues is NOT stable enough to be a multiplier — measured, not asserted
Russ asked directly. **Test: implied cardinality = rows(segmented entry) ÷ rows(base entry), on every window
where both delivered. Falsifier declared before running: a p90/p10 spread over 3× is a random variable being
used as a constant.** 273 entries had ≥ 8 co-delivering windows.
- **spread median 2.61× · p75 11.63× · p90 40.19×. 126 of 273 (46 %) exceed the 3× falsifier.**
- **The artifact's value misses the observed median by 3.55× (median). Only 23 % land within 2×.**
- ⛔ **AND A SPECIFICATION ERROR THE SPREAD EXPOSED: FOR MANY SEGMENTS THE SEGMENT IS A FILTER, NOT A
  FAN-OUT.** `campaign_search_term_view × segments.conversion_action` carries artifact `distinctValues = 1`
  and an OBSERVED ratio of **0.00** — the segmented entry writes far FEWER rows than the base, because
  conversion_action only exists on rows that converted. Multiplying by it is wrong in DIRECTION, not just
  in magnitude. Same for every `geo_target_*` on `user_location_view` and every `keyword.*` on
  `search_term_view`.
- ⛔ **A SECOND DEFECT, FOUND WHILE IMPLEMENTING: `segments.date` CARRIES `distinctValues = 31` BECAUSE THE
  PROBE WINDOW WAS 31 DAYS.** For the time-derived segments the artifact recorded the probe's own shape, not
  a property of the account. Using 31 as a constant while also multiplying by `days` double-counts the date
  axis outright. The fit compensates for these by computing time-derived cardinality from the window; a naive
  implementation would not have.
- **WHAT WOULD FALSIFY THE FALSIFICATION:** re-probe cardinality on a second, quieter window (the artifact's
  was 2026-03-01..03-31, the account's LAST ACTIVE MONTH before `accountDarkAfter 2026-04-05`) and find the
  values agree within 2×. That is one cheap probe pass and it is the only thing that would rehabilitate the
  measurement. Nothing in the current data supports it.

### 22.3 · WHAT DOES PREDICT — and it needs no model, no artifact and no covariates
Evaluated STRICTLY CAUSALLY: predicting window N uses only windows already walked, in the order the walk
actually visits them (newest → oldest). 10,198 scored predictions.

| predictor | MdAPE | ≤50 % | under-predicts | under by >2× |
|---|---|---|---|---|
| **PREV — the last walked window's row count** | **42.7 %** | 55 % | 30 % | 15 % |
| MED3 — median of the last three | 46.2 % | 53 % | 32 % | 16 % |
| MEDALL — median of all prior | 63.0 % | 43 % | 30 % | 17 % |
| P90ALL | 166.7 % | 26 % | **7 %** | 2 % |
| MAXALL | 292.9 % | 19 % | **3 %** | **1 %** |

⇒ **THE MODEL IS: "this entry wrote N rows last window; assume N again."** It halves the specified model's
error, and it is one column read.
⛔ **AND FOR SIZING SPECIFICALLY, MdAPE IS THE WRONG LOSS AND THE TABLE SHOWS IT.** Over-predicting costs a
window that finishes early. Under-predicting costs a re-streamed request. **`MAXALL` has the worst MdAPE in
the table and the best behaviour for the job** — it under-predicts 3 % of the time versus PREV's 30 %.
With `day_committed` in place a wrong guess costs one request, so the right sizing rule is the *asymmetric*
one, not the accurate one. **Recommendation: size on `max(prior windows)`, and report `PREV` as the estimate.**

### 22.4 · PER RESOURCE — the partial model that knows its own scope
Using PREV, applying Russ's > 50 % falsifier per resource: **PASS 14 · FAIL 21 of 35.**
**PASSES** (MdAPE): customer 7.6 · shopping_performance_view 11.5 · asset_group 17.9 ·
asset_group_product_group_view 24.5 · geographic_view 30.4 · campaign_budget 34.4 · asset_group_asset 35.2 ·
campaign 37.5 · campaign_asset 41.3 · landing_page_view 42.3 · location_view 42.9 · asset_field_type_view
44.7 · keyword_view 46.3 · customer_asset 46.4
**FAILS**: user_location_view 52.0 · expanded_landing_page_view 52.5 · gender_view 54.6 · ad_group 55.0 ·
ad_group_ad 55.7 · age_range_view 65.1 · ad_group_ad_asset_view 67.2 · campaign_search_term_view 71.3 ·
product_group_view 72.2 · parental_status_view 78.1 · ad_group_asset 80.1 · income_range_view 81.1 ·
ad_group_audience_view 81.7 · group_placement_view 91.3 · paid_organic_search_term_view 93.3 ·
search_term_view 93.6 · performance_max_placement_view 94.9 · detail_placement_view 97.4 ·
ad_group_ad_asset_combination_view 98.6 · video 100.0 · video_enhancement 100.0

⛔ **THE TAIL AT EXACTLY 100.0 % IS A DIFFERENT FAILURE AND MUST NOT BE READ AS "VERY INACCURATE".** An APE
of exactly 100 % is the predictor saying ZERO when the window delivered something. `video` and
`video_enhancement` predict zero on 60 % of their scored windows; `ad_group_asset` 45 %,
`ad_group_audience_view` 40 %. **These series are INTERMITTENT — mostly empty with occasional bursts — and
the median of an intermittent series is zero by construction.** That is a known forecasting class (Croston's
method exists precisely for it) and it is NOT a magnitude problem. **They fall back to the fixed conservative
size, which is the correct outcome and costs nothing.**

### 22.5 · Exclusions, stated with their test
- **1,066 of 17,892 rows (6.0 %) EXCLUDED.** Test: a row is excluded if its `[window_start, window_end]`
  overlaps ANY other row of the same `(client, resource, segment)` — `daterange(...) &&` — or if
  `attempts > 1`. `rows_written` counts UPSERTS, so an overlapped day is counted twice.
  The 2 rows with `attempts > 1` are inside the overlap set; the overlap test does all the work.
- **16,810 usable.** Held-out split: **TIME**, cut at 2024-02-16 — fit on the newer half, predict the older
  half, because the walk runs newest → oldest and that IS the production shape. A random split is reported
  alongside only to separate model error from era change.
- **3,210 held-out rows have actual = 0**, where APE is undefined. Excluded from MdAPE and reported
  separately rather than silently dropped.

### 22.6 · The limits of this result, stated so nobody over-reads it
1. ⛔ **n = 1 ACCOUNT.** Every one of the 16,810 windows is Foam OH. This is the Round-4 finding all over
   again, and it applies to the falsification exactly as it applied to the model. **What it DOES support:
   the specified model does not work here and must not ship as universal.** What it does NOT support: that
   activity never predicts row count on any account.
2. **556 rows carry `outcome='ok'` with `rows_written = 0`** — a contradiction with `zero`, worth a look, not
   material to this result (both are terminal and both were kept).
3. `days` could not be tested at all (see 22.1).

⇒ **BUILD-ORDER CONSEQUENCE: step 4 is DONE and its answer is NO.** Delete the density model from the plan.
Sizing keeps the §14 cold-start fixed conservative window for run one, then `max(prior windows)` per entry
from window two, with intermittent entries staying on the fixed size. **This is CHEAPER than what was
planned** — no model, no validation harness, no artifact dependency — and per §10 sizing was already
demoted to an optimisation, so nothing downstream is blocked.

---

## 23 · ⛔ PRINCIPLE, BANKED BY RUSS 2026-08-08 — OPTIMISE FOR THE COST, NOT THE ACCURACY

> **When a wrong guess has ASYMMETRIC cost, optimise for the COST, not the ACCURACY.**

Russ's own words on specifying step 4: *"MdAPE was the wrong loss and I specified it."* Recorded here because
the mistake is the interesting part — the metric was chosen before anyone asked what a wrong answer COSTS.

**THE EVIDENCE THAT FORCED IT.** Sizing the next window: over-predicting costs a window that finishes early;
under-predicting costs one re-streamed vendor request. Those are not the same price, so the estimator with
the best average error is not the estimator to use.
- `PREV` — **MdAPE 42.7 %**, the best accuracy in the table — **under-predicts 30 % of the time.**
- `MAXALL` — **MdAPE 292.9 %, the WORST accuracy in the table** — **under-predicts 3 % of the time.**
**The metric ranked them exactly backwards for the job.**

**WHERE ELSE THIS APPLIES IN THIS REBUILD, so it is a principle and not an anecdote:**
- **Coverage:** claiming covered-when-not is catastrophic (silence); claiming owed-when-covered costs one
  probe. ⇒ Every ambiguous case resolves to OWED. Already the design, now with its reason named.
- **Exhaustion:** concluding exhausted-when-dormant loses history permanently
  (`LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1`); walking a dormant window costs one operation. ⇒ Keep walking.
- **The three-outcome split (§16.3):** telling a customer BROKEN when the truth is MIS-SIZED costs trust;
  retrying a genuinely broken entry costs one request. ⇒ The bound sits at the MINIMUM window size.
- **Deferral (§16.7):** a deferred entry that is silently dropped is the failure class; one that writes a
  record and appears in the owed report costs a row.

**THE GENERAL FORM:** name the cost of each error DIRECTION before choosing the metric. If they differ, the
metric is a constraint to satisfy, not an objective to minimise — and the summary statistic (mean, median,
MdAPE) is the thing most likely to hide the asymmetry, because it averages the two directions together.

---

## 24 · ⛔ PRINCIPLE, BANKED BY RUSS 2026-08-08 — A BROKEN INSTRUMENT IS WORSE THAN NONE

> **A broken instrument is worse than no instrument, because it looks like evidence.**

Sibling of §23. Both say the same thing about MEASUREMENT: §23 is about choosing the wrong metric, this is
about trusting a right-looking one that is not working.

**WHERE IT CAME FROM, 2026-08-08:** `universe-attempt-append-only.guard.mjs` had two defects found only by
running it against its own evidence —
1. it read the migration's **PROSE** as code. The `comment on table … is '…so no ON CONFLICT can arbitrate
   an overwrite…'` body tripped the ON-CONFLICT leg. The documentation describing the property was reported
   as a violation of it.
2. its `--db` leg did not load `.env.local`, so inside a `check:data` run it reported
   `SUPABASE_DB_URL is missing` **while the guard beside it read the database fine.**
Neither would have surfaced from a green run. Both were found by deliberately breaking things and watching
what the instrument said.

**THE PRECEDENT THIS REPO ALREADY HAD, and why it needed restating:** `run-guards.mjs`'s own header records
that `npm run guard` was 24 segments joined by `&&`, so a failure at segment 13 silently skipped 11 guards —
and *"a green tail that never executed is indistinguishable, in the output, from a green tail that passed."*
Found only because a human ran the rest by hand. **Same class, one year of hard-won structure later, in a
guard written the same night.** That is the argument for making it a principle rather than a lesson.

**WHAT IT OBLIGES, concretely:**
- **RED-FIRST IS NOT A FORMALITY.** A guard that has never been seen to fail has not been shown to work.
- **MUTATION-PROVE EVERY LEG SEPARATELY.** One red proof demonstrates one leg. `universe-surface-labels`
  has seven legs and needed seven proofs; `universe-attempt-append-only` has six and needed six.
- **A GUARD THAT CANNOT READ ITS EVIDENCE MUST FAIL, NEVER SKIP.** Already the house idiom
  (`REFUSING TO PASS QUIETLY`); this is its reason.
- **RUN THE GUARD AGAINST ITS OWN ARTEFACT.** Both defects above were self-inflicted and both were invisible
  until the instrument was pointed at the thing it documents.

---

# 25 · ⛔ THE FOUR-PLATFORM QUESTION — ONE ENGINE OR FOUR? (2026-08-08, Russ's destination)

**RUSS'S DESTINATION:** every platform needs this — GA4, Meta, Shopify, eventually WooCommerce — because all
of them need the one-click UI to work perfectly, before 9/30.

## 25.0 · THE ANSWER, FIRST

**ONE CORE, FOUR ADAPTERS — and the seam is not a preference, it is a MEASURED PROPERTY OF THE WAREHOUSE.**

Read live 2026-08-08 from `metrics_daily_p_2026_07` (one pruned partition; the unpruned `count(*)` timed
out, which is finding A6 for the third time this session):

| platform | entity_levels | breakdown_types | clients | rows in that month |
|---|---|---|---|---|
| google | 5 | 26 | 18 | 2,084,839 |
| meta | 4 | 26 | 13 | 209,884 |
| ga | 1 | 13 | 11 | 157,217 |
| shopify | 3 | 16 | 7 | 849 |
| woocommerce | 3 | 12 | 2 | 530 |

**ALL FIVE PLATFORMS ALREADY WRITE `(client_id, platform, entity_level, breakdown_type, date)` INTO ONE
TABLE.** Coverage is derived from the WAREHOUSE, not from the vendor — so the coverage half of the engine is
platform-neutral **by construction, not by design intent**, and it is neutral *today*, before any adapter is
written. The `.eq('entity_level').eq('breakdown_type').eq('date').limit(1)` probe in
`universe-coverage.ts:106` does not contain the word "google" and would not change to add one.

**AND THE FETCH HALF IS NEUTRAL TOO, FOR A REASON I CHECKED RATHER THAN ASSUMED: ALL FIVE VENDORS FILTER BY
DATE RANGE.** Verified in the repo, not inferred:
- Google — `segments.date BETWEEN '…' AND '…'` (`google-ads-universe-writer.ts:316`)
- GA4 — `dateRanges: [{startDate, endDate}]` (`ga-intelligence.ts:88`)
- Meta — `time_range` + `time_increment` on the Insights edge
- Shopify — `created_at:>=${startDate}T00:00:00Z AND created_at:<=${endDate}T23:59:59Z`
  (`shopify-intelligence.ts:387`)
- WooCommerce — `?after=&before=` on `/orders` (`woocommerce-intelligence.ts:366-367`)

## 25.1 · ⛔ THE LOAD-BEARING QUESTION, ANSWERED FIRST: IS THE DAY THE RESUMABLE UNIT?

**YES FOR ALL FIVE — BUT THE REASON IS NOT THE ONE THE GOOGLE DESIGN USED, AND THE DIFFERENCE MATTERS.**

The v2 design derives day-resumability from *"GAQL filters `segments.date BETWEEN`"*. That is a statement
about **the vendor's fetch API**. It happens to be true everywhere, but leaning on it is fragile. **The
durable reason is that `metrics_daily` IS KEYED BY DATE**, so "which days do I still owe" is answerable for
any platform whose rows land in that table — which is all of them, today, measured above.

⇒ **RESTATE THE LAW: THE RESUMABLE UNIT IS THE DAY BECAUSE THE WAREHOUSE IS KEYED BY DAY.** The vendor's
fetch unit is an adapter concern. Per platform:

| platform | vendor fetch unit | day-resumable? | why |
|---|---|---|---|
| **Google Ads** | streamed rows, `segments.date` | **YES** | date filter + date-ordered stream |
| **GA4** | `limit`/`offset` pages, no cursor | **YES** | `dateRanges` is a first-class request field |
| **Meta** | async `report_run` job, cursor pages | **YES** | `time_range` + `time_increment=1` returns day rows |
| **Shopify** | **cursor over ORDERS**, not over days | **YES, and this is the one that had to be checked** | see below |
| **WooCommerce** | `page`/`per_page` over ORDERS | **YES** | `after`/`before` are ISO8601 date filters |

⛔ **SHOPIFY WAS THE REAL RISK IN THE QUESTION AND IT RESOLVES — BUT NOT FOR FREE.** Its natural object is
an ORDER, paged by an opaque GraphQL cursor (`pageInfo { hasNextPage endCursor }`,
`shopify-intelligence.ts:449`), not a day. Two facts rescue it, and both are already in this repo:
1. **The query is already date-filtered** on `created_at` (`:387`), so narrowing to owed days is expressible.
2. **The repo ALREADY buckets Shopify by `created_at` day and fires a per-day callback** —
   `fetchShopifyIntelligenceByDay` with `onDay(day, intel)` (`shopify-intelligence.ts:372`). **The day
   boundary exists in Shopify's path today.** It was built for the restatement sweep, and it is exactly the
   commit boundary the streaming consumer needs.
⚠ **THE PART THAT DOES NOT TRANSFER:** Google's day boundary is proven by ORDER (`ORDER BY segments.date`,
checked at runtime — `universe-stream-capture.ts:58`). **Shopify's `orders(first: 250, query:…)` connection
has no ordering guarantee I could verify**, so `coveredDaysStrict`'s rule (a) — "a later day has rows,
therefore the earlier one is closed" — **IS NOT SOUND FOR SHOPIFY**. Its adapter must either sort by
`created_at` explicitly or fall back to rule (b), the explicit `day_committed` record, which is already
built and already optional (`universe-coverage.ts:64`). **The predicate needs NO change; the adapter
declares which rule it is entitled to.** That is the seam doing its job.

## 25.2 · CLASSIFICATION — SHARED CORE vs PLATFORM ADAPTER, with file:line

### SHARED CORE — genuinely neutral, and the evidence for each
| element | file:line | why it is neutral |
|---|---|---|
| append-only attempt log + 3 phases | `migrations/061`, `universe-attempt-log.ts:68,100,126` | The schema's identity is `(client, **vendor**, resource, segment, window_start, window_end)` — `vendor` is ALREADY a column and already carries `'google'` as data, not as a name in code. Nothing is Google-shaped. |
| `coveredDaysStrict` | `universe-coverage.ts:64` | Pure. Takes `string[]`, returns `string[]`. No vendor, no platform, no I/O. |
| day-existence probe + `windowCoverage` | `universe-coverage.ts:106` | `platform` is a parameter. Measured neutral above: all five write the same grain. |
| owed = declared − covered, `toRanges` | `universe-coverage.ts:179,203` | Pure set arithmetic over dates. |
| day-granular resume | consumer `:124` | Follows from the warehouse key, not from GAQL (§25.1). |
| BROKEN-vs-MIS-SIZED bound | `universe-v2-contract.ts:26,29`; consumer `:145,:160` | "attempts at the minimum span" is a statement about OUR retry behaviour. Vendor-free. |
| spend charged at `attempt_started` | `universe-attempt-log.ts:68` | The ORDERING is the invariant and it is universal. The UNIT is not (see below). |
| the resumer cron (step 7) | not built | Reads derived coverage, publishes owed windows. Both halves neutral. |
| `serializeVendorError` shape | `universe-stream-capture.ts:161` | The PATTERN is neutral (never `String(e)`); the error taxonomy per vendor is adapter data. |
| the commit-boundary loop | `universe-stream-capture.ts:76` | The loop is neutral. `ORDER_CLAUSE` inside it is not — see below. |

### PLATFORM ADAPTER — and three of these only LOOK neutral
| element | file:line | why it is NOT neutral |
|---|---|---|
| ⛔ **sizing (fixed → max-of-prior)** | `universe-sizing.ts:30,38,73` | **LOOKS NEUTRAL, IS NOT.** `ROW_BUDGET = 300_000` and `COLD_START_DAYS = 7` come from OUR write throughput (~2,300 rows/s) **and Google's cost model, where a query is ONE operation at ANY span.** On GA4 that model INVERTS: token cost rises with "date range length" and row count (quotas doc). **On GA4 a longer window costs MORE, so "size up to the row budget" is actively wrong.** The *shape* (fixed cold → max-of-prior) transfers; the *budget* and the *direction of the cost curve* are adapter data. |
| ⛔ **the governor / quota accounting** | `universe-governor.ts:25,34,40-42,66` | **NOT NEUTRAL, AND NOT EVEN THE SAME KIND OF NUMBER.** Google: 15,000 ops/day, `ASSUMED_OPS_PER_REQUEST = 1`. GA4: **200,000 core tokens/property/day, 40,000/hour, 10 concurrent** — variable tokens per call. Meta: **BUC percentage utilisation per AD ACCOUNT across three simultaneous meters** (`call_count`, `total_cputime`, `total_time`, each throttling at 100) reported in `X-Business-Use-Case-Usage`. Shopify: **1,000-point single-query ceiling, leaky bucket — and bulk operation execution is NOT charged at all.** Woo: **no documented rate limit** (it is the customer's own server; the limit is politeness). **Five incomparable units. The governor's INTERFACE is shared; every constant and the meter itself are per-adapter.** |
| ⛔ **window one as the delivery probe** | walk design, `google-ads-universe-writer.ts:212` | **LOOKS NEUTRAL, IS NOT.** It presumes a CATALOG of 1,164 selectable entries to probe. GA4/Meta have fixed, hand-declared surfaces; Shopify/Woo have a fixed set of entities. **Only Google has a `GoogleAdsFieldService` to generate a denominator from.** |
| ⛔ **retention wall + exhaustion semantics** | `google-ads-universe-writer.ts:156,397` | **LOOKS NEUTRAL, IS NOT — the walls are real and different.** Google Ads **37 months** (documented). Meta **37 months** (rolling; `date_preset=lifetime` removed in v10.0, replaced by `maximum`). GA4 **standard reports and the Data API are NOT limited by the retention setting** — retention (2/14 months, 26/38/50 on 360) binds **explorations only**. Shopify/Woo: **NO vendor wall — it is the merchant's own database** (`ga`'s adapter floor in `adapters.ts:75` is `'2015-08-14'`, a product-launch date, not a retention wall). ⇒ `decideVendorExhaustion`'s CONTRACT (zero rows at/below a floor, never a clock) is shared; the floor is adapter data and for two platforms there is no floor at all. |
| the vendor stream client | `universe-vendor-stream.ts` | Per-vendor by definition. |
| `ORDER_CLAUSE` + the order check | `universe-stream-capture.ts:58` | GAQL syntax. The *runtime order check* is shared; the clause and the entitlement to rule (a) are adapter declarations (§25.1). |
| GAQL build / row build / entity axis | `google-ads-universe-writer.ts:296,519,550` | Vendor response shape. |
| surface labels + failure report | `universe-surfaces.ts` | The TABLE is Google's 37 resources. **The GUARD is neutral** — "every delivering surface carries a client-vocabulary label" is the rule; the mapping is data, one per platform. |
| derived-time recompute | queued | Neutral in principle (aggregate `metrics_daily` by period), but only Google declares derived-time families today. |

## 25.3 · WHAT WOULD FORCE FOUR ENGINES — and it did not appear

I looked for it in the three places it could hide, and it is not in any of them:
1. **A platform whose warehouse rows are not date-keyed.** Would break coverage, owed, and resume at once.
   **NOT FOUND — measured, all five.**
2. **A platform with no date filter on the fetch.** Would make "narrow to owed days" inexpressible.
   **NOT FOUND — all five, cited in §25.0.**
3. **A platform whose resumable unit is genuinely not the day.** **THE CLOSEST CALL, AND IT RESOLVED
   PARTWAY:** Shopify's unit is an order-cursor and its connection has no ordering guarantee I could verify,
   so `coveredDaysStrict` rule (a) is unsound there. **That is a per-adapter ENTITLEMENT, not a second
   engine** — the predicate already takes `dayCommitted` as an optional argument and needs no change.

⛔ **THE ONE FINDING THAT COMES CLOSEST, STATED SO IT IS NOT DISCOVERED IN THE THIRD ADAPTER: TWO PLATFORMS
DO NOT STREAM AT ALL — THEY HAND BACK A DURABLE JOB HANDLE.**
- **Shopify bulk operations**: `bulkOperationRunQuery` → poll `bulkOperation(id:)` → download a **JSONL URL
  that expires after one week**; operations may run for **10 days**; up to **5 concurrent** (2026-01+);
  **the bulk query's execution is NOT rate-limited**, only the mutation and the polls.
- **Meta async insights**: POST `/insights` → `report_run_id` → poll `async_status` /
  `async_percent_completion` → read the edge. **The id expires after 30 days and a job cannot be resumed —
  it is resubmitted.**

**For these two the invocation does not have to survive the work.** A cron submits, a later cron collects.
That is *better* than streaming, not worse — and it is why this is an adapter capability rather than a fork:
**the core asks "give me the owed days"; whether the adapter answers by streaming now or by submitting a job
and collecting next tick is behind that interface.** ⚠ But it does mean the adapter contract needs a
**two-phase shape** (`submit` / `collect`) with streaming as the degenerate one-phase case. **DESIGN THAT IN
FROM THE START.** Discovering it while writing the Shopify adapter is the "third adapter" failure Russ named.

## 25.4 · PER PLATFORM — the five questions, from docs read this session

**GA4 (Data API v1)** · pages by `limit`/`offset`, **no cursor, no streaming API**, default 10,000 rows.
**No resumable handle** ⇒ a killed invocation re-fetches, and offsets are cheap to recompute.
Retention: **the Data API and standard reports are NOT bound by the retention setting**; retention (2/14
months; 26/38/50 on 360) binds explorations. ⇒ **no vendor wall to walk to** — the floor is property
creation. Quota: **200,000 core tokens/property/day · 40,000/hour · 14,000/project/property/hour · 10
concurrent**; **most requests ≤ 10 tokens but cost rises with date-range LENGTH and row count** ⇒ **NOT
comparable to Google's one-op-per-query, and inverted for sizing.** Catalog: **fixed** — seven hand-declared
runReport buckets (`ga-intelligence.ts`). Warehouse: 1 entity_level, 13 breakdown_types, 11 clients.

**Meta (Marketing API Insights)** · sync cursor paging today (`meta-graph-paged.ts:31` follows
`paging.next`); **async `report_run` available and unused**. Retention **37 months, rolling**. Quota: **BUC
percentage per AD ACCOUNT, three meters** — not comparable to anything else here. Catalog: **fixed** —
breakdowns are a documented enum, and the repo's own hard-won fact stands (dimensional fields go in
`breakdowns=`, never `fields=`). Warehouse: 4 entity_levels, 26 breakdown_types, 13 clients — **the closest
in shape to Google.**

**Shopify (GraphQL Admin)** · cursor paging with `endCursor`; **bulk operations are the documented path for
anything large.** Retention: **NONE — it is the merchant's own store data.** Quota: **1,000-point
single-query ceiling enforced BEFORE execution on the REQUESTED cost** (measured live 2026-07-19,
`OrdersInRange` at 651/134); **bulk execution is not charged.** Catalog: **fixed** entities. Warehouse: 3
entity_levels, 16 breakdown_types, 7 clients, and **849 rows in a month against Google's 2.08M — three
orders of magnitude smaller.**

**WooCommerce (REST v3)** · `page`/`per_page`/`offset`, `X-WP-Total` / `X-WP-TotalPages` headers,
`after`/`before` ISO8601 date filters. **No cursor.** Retention: **NONE.** Quota: **none documented** — it is
the customer's own WordPress host, so the real limit is not overloading it (the repo already carries a
per-page timeout for exactly this, `woocommerce-intelligence.ts:357`). Catalog: **fixed.** Warehouse: 3
entity_levels, 12 breakdown_types, **2 clients.**

## 25.5 · SEQUENCING — first-run cost, and is any platform its own project

⛔ **THE ASYMMETRY RUSS NAMED IS REAL AND IT CUTS THE OPPOSITE WAY TO THE WORRY.** Google is the only
platform with walked history, so it is the only one whose first run is *cheap* (most of it is already
covered — every probe returns "covered" and costs no vendor request). The other four start cold: **every day
in range is owed, so first-run cost ≈ the full range.**

But cold ≠ expensive, because the four cold platforms are all **small**:
- **Meta** — 37-month wall × 13 clients, BUC-metered per ad account. **The largest of the four.** Real, but
  bounded by a documented wall.
- **GA4** — **no wall**, so the range is "since the property existed", which is unbounded in principle.
  ⚠ **THIS IS THE ONE THAT COULD BE ITS OWN PROJECT, AND FOR A REASON THAT IS NOT SIZE:** with no vendor
  wall, `decideVendorExhaustion` has nothing to stop on, and `ZERO_ROWS_IS_NOT_EXHAUSTION` says a run of
  empty days is not a floor. **GA4 needs a STOP RULE that Google's design does not supply.** Cheapest
  honest answer: property creation date from the Admin API — **not verified this session, and it is the
  first thing to check before the GA4 adapter is scoped.**
- **Shopify / WooCommerce** — ~850 and ~530 rows per month respectively. **Not projects. Days of range at
  trivial row counts, and Shopify's bulk path is not even rate-limited.**

## 25.6 · HOURS — SHARED-AS-SHARED vs GOOGLE-THEN-REFACTOR

Basis: this session's measured rates — migration 060 ~20 min across four lock-profiled statements; migration
061 + three helpers + guard with six red proofs ≈ 3 h; the v2 consumer + coverage + sizing + capture + guard
with six red proofs ≈ 4 h; each guard ~45 min including its red proof.

**BUILT AS SHARED (recommended)**
- Retrofit the core to the adapter interface (two-phase submit/collect; per-adapter meter; per-adapter
  floor; per-adapter day-closure entitlement) — **4–6 h**, and it is mostly *deleting Google assumptions
  from files that already exist*.
- Google adapter (extract from what is built) — **2–3 h**.
- Steps 7–12 for Google, now written once against the interface — **12–16 h** (resumer, reporting surface,
  incident fn, coverage-travels-with-data, guards, Gate-B).
- Meta adapter — **6–9 h** (BUC meter is genuinely new; async job path optional).
- Shopify adapter — **5–8 h** (bulk-operation two-phase; day-closure entitlement; the 1,000-point ceiling
  already measured and banked).
- GA4 adapter — **6–9 h** (token meter; **inverted sizing**; and the stop-rule question above).
- WooCommerce adapter — **3–5 h** (no quota, no wall, smallest surface).
⇒ **38–56 HOURS.**

**GOOGLE STANDALONE, THEN THREE REFACTORS**
Google to done **14–19 h**, then each adapter pays the retrofit again *and* re-opens the core: **+8–12 h per
platform** rather than 3–9, plus a rising regression surface on a live engine.
⇒ **50–75 HOURS, and every hour after the first is spent on a system that is already running.**

⛔ **AND THE HONEST ANSWER ABOUT 9/30, WITH THE ARITHMETIC RATHER THAN AN IMPLICATION.** 53 days from
2026-08-08. **The hours fit. The DEPTH does not, at tonight's rate.** Tonight produced ~4 build steps in one
session, and every one of them turned up something that changed the design — a falsified model, two guard
defects, two build failures `tsc` passed clean, a partial-day hazard invented by the fix. **That rate is the
value, and it does not compress.** 38–56 hours at this depth is **9–14 sessions of tonight's length.** In 53
days that is comfortable *if* they are scheduled; it is not comfortable if the four adapters are expected to
be planned as adversarially as the Google engine was — that adversarial planning was itself ~6 hours across
five rounds, and it is **not** included above.
⇒ **STATED PLAINLY: the BUILD fits before 9/30. Four MORE five-round adversarial plans do not.** The way it
fits is that the adversarial work already happened — **it produced a core**, and the adapters inherit it
instead of re-deriving it. If any adapter demands its own five-round plan, that is the signal the seam was
wrong, and §25.3 says where to look first.

## 25.7 · RECOMMENDATION AND REVISED BUILD ORDER

**ONE CORE, FOUR ADAPTERS. Retrofit the interface NOW, before the resumer wires anything** — the resumer is
the first component that would harden Google's assumptions into a running system.

0. **Adapter interface + retrofit** — two-phase `submit`/`collect`, per-adapter meter, per-adapter floor
   (nullable), per-adapter day-closure entitlement. Google becomes the first adapter. **NEW, and it moves
   ahead of the resumer.**
7. Resumer cron — written against the interface.
8. Reporting surface + `universe_incident`.
9. Coverage-travels-with-data (live path, STOP-and-confirm).
10. Sizing + per-account deferral derivation.
11. Guards, red-first. 12. Gate-B on Google.
13. **WooCommerce adapter SECOND, not last** — smallest surface, no quota, no wall. **It is the cheapest
    possible test that the seam is real**, and it fails fast if it is not.
14. Shopify (bulk two-phase) · 15. Meta (BUC meter) · 16. GA4 (token meter, inverted sizing, stop rule).

---

## 26 · STEP 8 INHERITS THE JUNE STATUS CONTRACT — IT DOES NOT INVENT ONE

`src/app/api/backfill/status/route.ts:56-68`, `LORAMER_BACKFILL_STATUS_GET_V2`, reports **warehouse truth
NEXT TO cursor claim**, per platform, behind an ownership gate:
```
earliestDate  ← min(date) from metrics_daily, entity_level='account'   // the FACT
sweptTo       ← sync_state.backfill_earliest_date                       // the CLAIM
targetDate · complete · updatedAt
```
Its own comment: *"Honest depth: the actual earliest account-level row we hold for this platform, REGARDLESS
OF HOW FAR THE CURSOR SWEPT."*

⛔ **THAT IS v2's COVERAGE MODEL, ARRIVED AT INDEPENDENTLY, IN JUNE, IN THE UI** — and it uses the same
indexed ordered-LIMIT-1 shape the coverage probe uses, not the `count(distinct)` that took 51 seconds. **Step
8 adds `uncovered` and a SURFACE label to this contract. It does not design a new one.**

WHAT THE JUNE CONTRACT CANNOT DO, and it is exactly the step-8 scope:
- it is **per PLATFORM, never per SURFACE** — it has no notion of a surface, so it cannot say
  "search terms incomplete 2025-11-07 → 2025-12-06";
- it reports a **START DATE, not a GAP** — a hole in the middle of a range reads as "complete back to
  `<earliest>`";
- it needs the tab open (`BackfillControl` polls nothing; the POST *is* the tick).

Proven on the one case that mattered: Bath Fitter's `sync_state.google` cursor reads NULL/NULL/false while
`metrics_daily` holds google account rows from **2020-01-27** — exactly June's proof date — unbroken to
2026-08-07. **The data survived; the bookkeeping did not.** A cursor is a claim that can vanish; the
warehouse is the fact.

---

## 27 · THE REMAINING PRINCIPLES, BANKED 2026-08-08 (companions to §23 asymmetric-loss and §24 broken-instrument)

**A METER THAT IS ONLY A DAILY CAP *IS* THE GOOGLE UNIT WEARING AN INTERFACE.** `Meter` therefore REQUIRES
`unit` and `costDirection` alongside `cap` and `costOf(days)` — a shape that cannot express GA4's variable
tokens, Meta's BUC percentage across three simultaneous meters, or Shopify's uncharged bulk execution is not
a meter. Red-proved: a bare `{cap, spentSoFar}` must not satisfy `mayFetch`.

**THE DEPENDENCY RUNS ADAPTER → CORE, NEVER CORE → ADAPTER. THE REVERSE EDGE IS HOW ONE CORE BECOMES FOUR
CORES IN A TRENCH COAT.** Guarded as its own leg, because the first import is the cheapest one to make and
the last one anybody notices.

**A LAW ON LINE 400 OF A 700-LINE DOC IS A LAW NOBODY RE-READS.** Learned live: inserting the
resumable-unit law pushed the ONE-BLOCK law from line 25 to line 46 and `one-block-output.guard.mjs` failed
the build. **Placement is guardable even when obedience is not** — and the guard was right.

**A RED PROOF THAT SILENTLY EXERCISED A DIFFERENT LEG IS WORSE THAN NO PROOF.** Three coverage mutations in
the resumer guard "passed" because the PARTITION check caught the inputs first, so deleting the legs they
were written for changed nothing. Inputs must ISOLATE the leg under test — and where a check is genuinely
SUBSUMED and cannot be isolated by any input, **say so in the guard** rather than shipping a proof that
proves something else. (`assessCoverage` check 1 is subsumed by check 2; it is kept for its message.)

## 28 · THE JUNE ENGINE — READ 2026-08-08, AND ITS DISPOSITION

**CARRIED FORWARD, all three, and none of them were in the plan before it was read:**
1. **The no-progress bound** — `BackfillControl.tsx:81-83`. IN step 7 (`decideRepublish`).
2. **The honest-depth status contract** — `status/route.ts:56-68`. §26; step 8 INHERITS it.
3. **The component shape + four-state vocabulary** — `BackfillControl.tsx:99-121`. Step 8.

**SUPERSEDED:** the clock-derived target (`run-backfill.ts:184-186`, `setUTCMonth(-132)` — the same shape
that produced 214 false completions) · positional complete (`:268`, rows never consulted) · the permanent
complete flag (`:170`, never re-examined) · the raw `metrics_daily` upsert (`:243`) · the unchecked cursor
read (`:164-169`, a failed read is indistinguishable from "no cursor") · **a browser tab as the scheduler**.

⛔ **DISPOSITION: LEFT IN PLACE AND STILL MOUNTED. NOT DELETED, AND NOT FOR SENTIMENT — IT IS LOAD-BEARING
TODAY.** `drain-registry.ts:270-283` laps it for google/meta/ga; four routes call it
(`/api/backfill/{google,meta,ga}` + `/run`); `next/coverage.ts:105` ranks on its flags; and it is the only
working button. **RETIRE IT PER PLATFORM, as each adapter lands and is Gate-B'd — never as one act.**
Deleting the working thing before the replacement is wired is how you end up with neither.

### 28.1 · ⛔ BATH FITTER — RESOLVED, AND IT IS THE PROOF THE WHOLE REBUILD RESTS ON
`metrics_daily`, Bath Fitter (60e6dd99), google, `entity_level='account'`: **earliest 2020-01-27 — EXACTLY
June's proof date — unbroken to 2026-08-07.** `sync_state(client,'google')`: `last_forward_sync_date`
2026-08-07, `backfill_earliest_date` NULL, target NULL, complete false.
**THE DATA SURVIVED. THE CURSOR DID NOT.**
NOT a systematic clobber: platform='google' has 18 rows and **17 CARRY the cursor**. NOT a forward-path
overwrite: PostgREST merge-duplicates SETs only the columns in the payload, and `cron/sync:893-902` supplies
`last_forward_sync_date` + `updated_at`. NOT a re-run: `run-backfill.ts:170` returns early on complete.
⛔ **THE MECHANISM IS UNRESOLVABLE FROM THE REPO** — `sync_state` has no history and `updated_at` is stamped
by the forward path every run, so it says nothing about when the backfill columns were last written. One
row, one client, no trace. What did NOT do it is known; what did is not.
⇒ **A CURSOR IS A CLAIM THAT CAN VANISH; THE WAREHOUSE IS THE FACT.** Everything in §25 follows from this.


---

# ⛔ PROGRESS-TRUTH — LORAMER_PROGRESS_TRUTH_SPEC_V1 (2026-08-17, IMPLEMENT FROM THIS; DO NOT RE-DERIVE IT)

⛔ **THIS SECTION IS COMPLETE ENOUGH TO BUILD FROM. If the next flight finds itself re-tracing writers or
re-reading migration 064, stop — the answer is here and re-deriving it is how a session gets spent twice.**

## THE ONE FACT THAT OWNS PROGRESS
**THE WINDOW THAT WAS ASKED, AND WHETHER THAT WINDOW IS FULLY ANSWERED.** Everything else is a reader of it.
Today no site records that fact. Progress is INFERRED from whichever attempt row happens to be newest.

## PRIOR ART, ADOPTED (Airbyte, verified 2026-08-17)
- `DatetimeBasedCursor` partitions a range into windows by `step`, and — quoted —
  *"This cursor is progressed as these partitions of records are successfully transmitted to the destination."*
  **Advancement is per COMPLETED PARTITION, never per record.**
- Progress is **ONE value** (a single datetime), carried in a STATE message, and only real once echoed:
  *"If a source sends a state message out, and the destination echos that same state message back… that means
  'I have committed all the records the source gave me up to this point'."*
- A partially-consumed partition advances only to the last CONFIRMED state — *"State B was checkpointed but not
  State C… we have checkpointed up to Record 6."*
⇒ **THREE PROPERTIES WE MUST MATCH: one value · advanced only on completion of the unit it names · exactly one
writer.** We violate all three. Sources: docs.airbyte.com/platform/connector-development/config-based/understanding-the-yaml-file/incremental-syncs · airbyte.com/blog/checkpointing

## THE FIVE WRITERS — one column pair, two meanings
| # | site | records |
|---|---|---|
| 1 | `src/app/api/queues/google-ads-universe-v2/route.ts:341` `appendAttemptStarted(rangeKey, 1)` | **the RANGE ← THE DEFECT** |
| 2 | `src/app/api/queues/google-ads-universe-v2/route.ts:247` `appendAttemptStarted(coveredKey, 0)` | the WINDOW (covered-skip) |
| 3 | `src/app/api/cron/universe-resume/route.ts:336` | the WINDOW (covered-skip + implausible refusal) |
| 4 | `src/app/api/backfill/universe-drive/route.ts:150` | the WINDOW (covered-skip) |
| 5 | `src/lib/backfill/google-ads-universe-writer.ts:344` | the `__account_inception` pseudo-row (1970 window, excluded from rotation by name) |

⛔ **`universe_attempt_log.window_start/window_end` MEANS "RANGE" OR "WINDOW" DEPENDING ON WHICH WRITER TOUCHED
IT LAST.** The consumer builds `key` from `msg.startDate/msg.endDate` — **that IS the window** — and then
discards it one line later: `const rangeKey = { ...key, windowStart: range.start, windowEnd: range.end }`.
**THE WINDOW IS NOT LOST. IT IS IN SCOPE AT THE WRITE SITE AND SIMPLY NOT WRITTEN.**

## THE FIVE READERS
`universe_surface_rotation` (migrations/064) → the resumer's anchor + rotation order, and the drive ·
`readAttemptsAtSpan` (BROKEN / MIS-SIZED bound) · `readLastAttempt` (no-progress bound) · `attestedEmptyDays`
(window-overlap on outcome zero/nongrain) · `sizeNextWindow` (rows_written history).

## MIGRATION 064 SAYS ONE THING AND RETURNS ANOTHER
Its own comment: *"one row per (resource, segment): **the last window ASKED** and when."*
What it returns: `select distinct on (l.resource, l.segment) … l.window_start, l.window_end … where l.phase =
'attempt_started' … order by l.resource, l.segment, l.recorded_at desc` — **the last RANGE WALKED.**
The name, the column and the comment agree with each other and disagree with the data. That is why nobody
caught it: every reader believed the name.

## WHY THE STEP IS 1, OR 16, OR 30 — AN ARTIFACT OF WRITE ORDER
`ORDER BY recorded_at DESC` takes the **LAST-WRITTEN** row, and the consumer walks owed ranges in **ASCENDING
date order**, so the last row written is the **NEWEST** range — the one nearest the top of the window.
`deriveAnchorEnd` then recedes to `lastWindowStart − 1`.
- window `2026-02-03..2026-03-04`, ranges walked `02-03` then **`03-04` (written last)** ⇒ anchor `03-03` ⇒ **1 day**
- one range only, `2025-12-26..2026-01-10` (16 days) ⇒ anchor `12-25` ⇒ **16 days**
- covered-skip (a WINDOW is written) ⇒ **~30 days, at zero vendor cost**
⇒ **STEP = previous window end − start of the LAST-WRITTEN RANGE.** It is not a property of the walk.

## THE DESIGN
- **ADDITIVE, NULLABLE `parent_window_start` / `parent_window_end`** on `universe_attempt_log`, written by the
  consumer from `msg.startDate` / `msg.endDate` (already in scope). Rotation PREFERS them and falls back to the
  existing columns when null. **No backfill, no rename, no reader breaks** — legacy rows keep today's behaviour.
- ⛔ **SIZING CANNOT BE RECOMPUTED.** `sizeNextWindow` is adaptive and time-varying (`{minDays:1,maxDays:30}`,
  row-budget driven), so yesterday's window cannot be re-derived from today's policy. Recomputation is a guess
  wearing a schema's clothes. RULED OUT.

## ⛔ THE TRAP — BOTH HALVES OR IT IS WRONG
Window owes 20 of 30 days. The consumer walks 2 ranges and hits `deferredForBudget`, which returns **without
advancing**. If the anchor recedes by the full WINDOW, the 18 unwalked owed days fall below it and are
**SKIPPED PERMANENTLY AND SILENTLY** — the false-all-clear class this rebuild exists to end.
**AND THE EXISTING GUARD DOES NOT PROTECT AGAINST IT, BECAUSE IT IS BLIND THE SAME WAY:** the resumer computes
`lastWindowFullyAnswered` as `rangesStillOwed(coverageKey, rot.last_window_start, rot.last_window_end)` — over
the ROTATION's bounds, i.e. **the RANGE**. It verifies the last range is answered, never the window.
⇒ **RECORD THE WINDOW *AND* EVALUATE `fullyAnswered` OVER THAT WINDOW. Either half alone is worse than today.**

## BLAST RADIUS + POSTURE
The walk's entire progress mechanism: **346 surfaces, every client, five writers, five readers, two publishers.**
Schema change ⇒ its own migration ⇒ **`seams-proof-includes-the-database` posture: name every reader AND the
constraint before shipping.** The 23514 incident of 2026-08-17 came from skipping exactly that.

## HOW IT IS PROVEN
`scripts/drive-one-surface.mjs` — **~10 vendor requests.** Correct fix = days-gained-per-pass goes **1 → ~30**.
`tests/guards/anchor-recedes-by-window.guard.mjs` is RED until it does.
