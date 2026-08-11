<!-- QUEUE-EXEMPT: a REGISTRY OF ESTABLISHED FACTS, not a build plan. Every row records something already researched, verified, tested or run; nothing here is work to schedule. The open WORK this file makes visible (GA4's two floor constants, floor36, the 67-request constant, ★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR) is owned by LORAMER_QUEUE_OF_RECORD.md, which is where scheduling lives. -->

# LORAMER_BACKFILL_FACT_REGISTRY.md — ONE ROW PER FACT THE CAPTURE PATH RELIES ON

<!-- LORAMER_BACKFILL_FACT_REGISTRY_V1 -->

> ⛔ **CREATED 2026-08-10 UNDER AN EXPLICIT RUSS OVERRIDE OF THE NO-NEW-DOCS GATE** (CLAUDE.md
> DOC-OWNERSHIP GATES). The default is refuse; the override was given in one line and is recorded here
> so the exception does not read as precedent.

## WHY THIS EXISTS — THE SCOPE COLUMN IS THE WHOLE POINT

`VENDOR_FLOOR_DATE = '2022-03-05'` is **one account's measured floor, written into the code as a global
constant**, and it is the fifth constant of that shape this project has found. The pattern is never
"somebody invented a number". The pattern is: *a real measurement, taken honestly, on one account, on one
day — and then stored somewhere that has no room to say which account or which day.*

A fact with no scope recorded **defaults to global in the reader's head.** That is the defect. This file
gives every fact a scope column so the demotion from GLOBAL to PER-ACCOUNT is a visible edit rather than a
silent assumption.

## ENFORCEMENT INTENT

**Any vendor fact cited in the capture path must have an entry in this registry, and a RESEARCHED entry
must carry a URL.** A number in a code comment that cannot be traced to a row here is undocumented by
definition. This is intent, not yet a guard — no mechanical check enforces it as of 2026-08-10, and per
[[LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1]] that means **this document is UNENFORCEABLE
today and must be read as such.** The guard that would enforce it does not exist.

## THE FOUR CLASSES — AND THE LADDER IS THE POINT

| CLASS | MEANS | SOURCE MUST BE |
|---|---|---|
| RESEARCHED | A vendor published it. | A URL. |
| VERIFIED | Read in our own code or our own data. | file:line, or the query. |
| TESTED | An instrument proved it **and** the instrument was proven to fail when the behaviour is removed. | The guard filename. |
| SUCCESSFUL | It ran in production and produced the expected result. | The run, with its date. |

⛔ **RESEARCHED IS THE WEAKEST CLASS, NOT THE STRONGEST.** A vendor's published statement is what the
vendor says it will do, which is a different fact from what it did on our token this morning. See the
retention rows below, where the two disagree.

## SCOPE — EXACTLY ONE OF

`GLOBAL` · `PER-ACCOUNT` · `PER-CLIENT` · `PER-SURFACE`

---

## VENDOR FACTS — RETENTION

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| Hourly/daily/weekly reporting data is available for 37 months, beginning 2026-06-01 | RESEARCHED | GLOBAL | https://support.google.com/google-ads/answer/15188209 | 2026-08-10 | Verbatim: "Beginning on June 1, 2026, hourly, daily and weekly reporting data collected by Google Ads for periods of time shorter than one month will be available for 37 months." No last-updated date shown on the page. |
| Monthly/quarterly/annual data is available for 11 years | RESEARCHED | GLOBAL | https://support.google.com/google-ads/answer/15188209 | 2026-08-10 | Verbatim: "Monthly, quarterly and annual data is available for 11 years." ⚠ Stated on the PRODUCT help page and the developer blog; **no 11-year ceiling appears anywhere in the Google Ads API documentation.** |
| Reach and frequency metrics are available for 3 years only | RESEARCHED | GLOBAL | https://support.google.com/google-ads/answer/15188209 | 2026-08-10 | Verbatim. Applies to unique users and impression-frequency metrics. We do not currently capture these. |
| Granular date segments support a 37-month lookback | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/reporting/segmentation | 2026-08-10 | Verbatim: "Starting June 1, 2026, granular date segments (`segments.date`, `segments.week`, and hourly segments) only support a lookback window of 37 months." |
| Beyond the window the API ERRORS; it does not return empty | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/reporting/segmentation | 2026-08-10 | Verbatim: "Queries exceeding this range will return `DateRangeError.REQUESTED_DATE_GRANULARITY_NOT_SUPPORTED` in v24+ (or `DateRangeError.INVALID_DATE` in earlier versions)." **This is the fact that makes floor-probing cost money.** |
| The retention change was announced 2026-05-01, effective 2026-06-01 | RESEARCHED | GLOBAL | https://ads-developers.googleblog.com/2026/05/new-data-retention-policy-for-google.html | 2026-08-10 | Published Friday 2026-05-01, Nadine Wang, Advertising and Measurement APIs Team. No delay or grace period found on any Google property. |
| Google recommends exporting older data before the deadline | RESEARCHED | GLOBAL | https://ads-developers.googleblog.com/2026/05/new-data-retention-policy-for-google.html | 2026-08-10 | Verbatim: "we recommend exporting it prior to the June 1, 2026 deadline". |
| **Google served DAILY, vendor-reported rows 53 months back — AFTER the policy took effect** | VERIFIED | PER-ACCOUNT | `metrics_daily`, client 957d484e, platform google, `date BETWEEN '2022-03-01' AND '2022-03-31'`, grouped by breakdown_type | 2026-08-10 | 255,452 rows at `geographic_view` / `geo_target_most_specific_location` spanning 2022-03-05..2022-03-31, **all with `extra->>'provenance'` NOT `COMPUTED_FROM_DATE`** (i.e. vendor-reported, not our aggregate). Written by the only walk that has ever run, `universe_window_log` started_at 2026-08-04..2026-08-08 — **after 2026-06-01.** ⛔ **THIS CONTRADICTS THE RESEARCHED ROWS ABOVE.** One account, one token, one 5-day window; it does NOT prove the policy is generally unenforced and it may change without notice. |
| "37 months" is never expressed as a number of DAYS by Google | RESEARCHED | GLOBAL | https://support.google.com/google-ads/answer/15188209 · https://developers.google.com/google-ads/api/docs/reporting/segmentation | 2026-08-10 | Every first-party statement says "37 months" or "37 months from the current date". **NOT PUBLISHED as a day count.** Calendar-months and 37×30.44≈1,126 days give different boundary dates. Any clamp we compute inherits this ambiguity. |
| Behaviour of a window that STRADDLES the boundary | — | — | — | — | ⛔ **NOT PUBLISHED.** Checked the segmentation doc and https://developers.google.com/google-ads/api/docs/query/date-ranges — neither states whether a partially-overlapping range returns the in-window rows or refuses entirely. **NO CLASS: this row records an absence, not a fact.** |

## VENDOR FACTS — QUOTA AND OPERATIONS

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| A Search or SearchStream request is ONE operation at any span | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/best-practices/quotas | 2026-08-10 | Verbatim: "A `Search` or `SearchStream` request counts as one operation against the user's daily operation quota. One `SearchStream` request counts as one API operation irrespective of the number of batches." This is what makes a wider window cheaper per day. |
| A request rejected with `GoogleAdsFailure` STILL counts against quota | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/best-practices/quotas | 2026-08-10 | Verbatim: "Requests that are rejected with a `GoogleAdsFailure` still count against the user's daily operation quota." ⇒ **Every failed probe is billed.** |
| Network-level failures do NOT count | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/best-practices/quotas | 2026-08-10 | Verbatim: "Requests that fail but don't return a `GoogleAdsFailure`, such as from an error at the network level, won't count against the user's daily operation quota since the requests would never reach the service." |
| Paginated requests with a VALID next_page_token are free | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/best-practices/quotas | 2026-08-10 | Verbatim: "Paginated requests (for example, requests that contain a valid `next_page_token`) are not counted against a user's daily operation quota." |
| Paginated requests with an EXPIRED or INVALID token DO count | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/best-practices/quotas | 2026-08-10 | Verbatim: "pagination requests that contain an expired or invalid page token will generate an exception and will count against the daily operation quota." Tracked as ★INVALID-PAGE-TOKEN-REQUESTS-COUNT-AGAINST-QUOTA. |
| Whether a SUCCESSFUL zero-row query costs an operation | — | — | — | — | **NOT ADDRESSED as its own case** by the quotas page. Implied by "one operation per Search request" but not stated. Recorded as an absence. |
| Basic Access is 15,000 operations/day | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/api-policy/access-levels | 2026-08-10 | Verbatim: "15,000 operations / day for both test and production accounts". |
| Standard Access is UNLIMITED operations/day | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/api-policy/access-levels | 2026-08-10 | Verbatim: "Unlimited operations / day for both test and production accounts". The single fact that would retire the entire lane-allocation problem. |
| "Per day" is a SLIDING 24-hour window keyed to the developer token | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/api-policy/access-levels | 2026-08-11 (re-read; first 2026-08-10) | Verbatim: "'Per day' is based on a sliding 24 hour time period in which API requests were made with your developer token." Corroborates LORAMER_GOOGLE_ROLLING_QUOTA_WINDOW_V1. ⛔ **RE-READ AT THE VENDOR 2026-08-11 as the compressed RESEARCH round of the meter flight, rather than cited back from this row — the sentence is unchanged.** ⚠ **AND IT WAS MEASURED AGAINST OUR OWN CODE THE SAME DAY, WHICH IS WHAT MAKES IT MORE THAN A QUOTATION: at 13:47:20Z the walk's ledger read 23 over the rolling window and 20 over UTC-midnight, the 3-request difference being wet run #1 (2026-08-10 23:xxZ) — spend the calendar counter had already forgotten while the vendor had not.** See DECISIONS LORAMER_V2_METER_ROLLING_WINDOW_V1. |
| The cap is pooled ACROSS every customer the token manages | VERIFIED | GLOBAL | `src/lib/backfill/google-op-budget.ts:64-68` | 2026-08-09 | ⚠ **CLASS DEMOTED FROM RESEARCHED ON 2026-08-10.** The code says "⛔ VERIFIED AT GOOGLE 2026-08-09: 15,000 operations/day is enforced PER DEVELOPER TOKEN, across every customer that token manages". The access-levels page says only "with your developer token" and **does not state the across-every-customer part in so many words.** The reading is reasonable and is probably right; it is an INFERENCE from the vendor's wording, not a vendor sentence, and is recorded as ours. |
| `OPS_PER_REQUEST = 1` | RESEARCHED | GLOBAL | `src/lib/backfill/google-op-budget.ts:75-87`, citing https://developers.google.com/google-ads/api/docs/best-practices/quotas | 2026-08-09 | Vendor-settled, replacing a `SAFETY_MULTIPLIER = 1.5` that was ours. ⚠ The invalid-page-token case above is a known un-modelled exception. |

## OUR OWN FACTS — CODE AND MEASUREMENT

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| The walk's lane allocation is 6,000 operations/day | VERIFIED | GLOBAL | `src/lib/backfill/google-op-budget.ts:113` | 2026-08-09 | `backfill: 6_000`. ⛔ A DECISION BY RUSS, not a derivation — the file says so at :96. Shared across the whole fleet, not per connection. |
| Cold-start window sizing is 7 days | VERIFIED | PER-SURFACE | `src/lib/backfill/capture-adapters/google-ads.adapter.ts:92`, applied at `src/lib/backfill/capture-adapter.ts:304-307` | 2026-08-10 | `coldStartDays: 7`, from `rowBudget: 300_000` and a measured densest-month of ~40,900 rows/day (adapter.ts:89). **The density measurement is PER-SURFACE and PER-ACCOUNT; the constant is written GLOBAL.** |
| Window sizing is bounded 1..30 days | VERIFIED | PER-SURFACE | `src/lib/backfill/capture-adapter.ts:319-321` | 2026-08-10 | `days = min(30, max(1, floor(300_000 / maxPerDay)))`, where `maxPerDay` is that surface's max rows/day over its last 12 finished attempts **for that client**. |
| Sizing reads `universe_attempt_log`, which holds ZERO rows | VERIFIED | GLOBAL | `src/lib/backfill/universe-sizing.ts:40-47`; `select count(*) from universe_attempt_log` → 0 | 2026-08-10 | ⇒ **Every connection, including Foam OH, currently cold-starts at 7 days.** |
| The walk requests 346 entries, of 559 catalog-eligible, of 1,300 total | VERIFIED | GLOBAL | `selectableEntries()` at `src/lib/backfill/google-ads-universe-writer.ts:214-218`; counted from `docs/google-ads-capture-universe.json` | 2026-08-10 | Reproduces the 559/346 figures banked in the file's own comment at :224. A pure catalog filter — **no account input, so the entry count is genuinely GLOBAL.** 37 distinct resources. |
| Derived time families are COMPUTED from `segments.date`, never requested | VERIFIED | GLOBAL | `buildDerivedTimeRows()` at `src/lib/backfill/google-ads-universe-writer.ts:639-698`; excluded from requests at :147 + :216 | 2026-08-10 | month/quarter/year/week/day_of_week are aggregated locally at zero vendor cost, stamped `provenance: COMPUTED_FROM_DATE`, keyed on the period's earliest active day as `date` (:671). **They cannot exist where daily rows do not.** |
| Google's own `segments.month` rows are daily rows wearing a month label | VERIFIED | GLOBAL | `src/lib/backfill/google-ads-universe-writer.ts:632-634` | date of that measurement not recorded in the file | ⚠ **THIS ROW IS THE WEAKEST IN THE REGISTRY AND IS LISTED SO THAT IS VISIBLE.** It is a measured claim with no date and no query recorded, and it was measured *inside* the 37-month window. Whether it holds *beyond* the window is UNVERIFIED. |
| `universe_window_log` holds one client / 17,892 windows / 17,878 requests | VERIFIED | PER-CLIENT | `select count(*), count(distinct client_id), sum(requests_spent) from universe_window_log` | 2026-08-10 | 11,364 windows wrote rows; 6,528 wrote zero. Only client 957d484e. Run window 2026-08-04..2026-08-08. |
| 1 window ≈ 1 vendor request | VERIFIED | GLOBAL | `universe_window_log`: 17,892 windows against 17,878 `requests_spent` | 2026-08-10 | 0.999. The 14-window difference is the two content-suitability resources that spent 0. |

## FACTS WITH A SCOPE DEFECT — PER-ACCOUNT OR PER-SURFACE, WRITTEN GLOBAL

⛔ **THIS IS THE SECTION THE DOCUMENT EXISTS FOR.** Every row is a real measurement stored where it cannot
say what it is a measurement OF.

| FACT AS WRITTEN | CLASS | TRUE SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| `floorDate: '2015-08-14'` (GA4) | VERIFIED | PER-ACCOUNT | `src/lib/backfill/adapters.ts:75` | 2026-08-10 | **THE SIXTH INSTANCE.** GA4 property floors are demonstrably per-property: the read-only `/api/backfill/probe-ga` returned earliest 2023-06-22 for Influential Drones (property 388079271) and 2022-12-14 for My Vacation Network (property 346191496). The constant is wrong for both by 7+ years. |
| `HARD_FLOOR = '2015-08-14'` (GA4) | VERIFIED | PER-ACCOUNT | `src/lib/backfill/ga-dimensional-backfill.ts:51` | 2026-08-10 | **THE SAME FACT AS THE ROW ABOVE, WITH A SECOND OWNER.** Two constants, two files, one fact — a G1 divergence waiting to happen on top of a scope defect. |
| `floor36()` — a clock 36 months before the day the lap runs | VERIFIED | GLOBAL (but wrongly authoritative) | `src/lib/backfill/drain-registry.ts:76` | 2026-08-03 | Seals a cursor when `subStart <= floor36()`. `src/lib/backfill/google-ads-universe-writer.ts:9-15` records the consequence: "that produced 214 cursors across 18 clients reading backfill_complete=true while Google still served years more." The clock is global; **whether the vendor actually stops there is per-account** — and the row above about 53 months says it does not. |
| `GAQL_REQUESTS_PER_CONNECTION_DAY = 67` | VERIFIED | PER-CLIENT | `src/lib/backfill/google-op-budget.ts:73` | not measured | Self-flagged in place: "⚠ AND NEVER LIVE-MEASURED". Three of the four lanes convert work units through it, "so their spend figures inherit its error in an unknown direction". Tracked as ★LANE-VOLUME-IS-ESTIMATED-FROM-AN-UNMEASURED-CONSTANT. |

## RESOLVED — A SCOPE DEFECT THAT HAS BEEN FIXED

⛔ **A ROW LEAVES THE DEFECT SECTION ONLY WHEN A GUARD CAN FAIL THE BUILD ON ITS RETURN.** Moving it because
the code looks right today is how a fix becomes a comment.

| FACT AS WRITTEN | RESOLVED BY | GUARD | ESTABLISHED | NOTES |
|---|---|---|---|---|
| `VENDOR_FLOOR_DATE = '2022-03-05'` used as an account floor | LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1, 2026-08-10 | `tests/guards/google-account-floor.guard.mjs` (proven RED by restoring `floorDate: '2022-03-05'` on the adapter) | 2026-08-10 | Foam OH's floor applied to every account — the fifth instance of the pattern. **The v2 path no longer reads it:** `google-ads.adapter.ts` declares `floorDate: null` (no PRE-KNOWN wall exists for an arbitrary account), and the wall is DISCOVERED per (account, surface) from the vendor's own `DateRangeError` and stored in `universe_account_floor`. ⚠ **NOT FULLY DELETED.** `src/app/api/queues/google-ads-universe/route.ts` (v1) and `src/app/api/cron/universe-resume/route.ts` still import it; both were outside the flight's ceiling. The guard states that limit in its own PASS line rather than letting green read as total. QUEUE: ★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR. |

## FACTS ESTABLISHED BY THE DISCOVERED-FLOOR BUILD — 2026-08-10

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| `decideExhaustion` CANNOT represent a vendor refusal | VERIFIED | GLOBAL | `src/lib/backfill/capture-adapter.ts:234-240` + `src/lib/backfill/universe-stream-capture.ts:155-160` | 2026-08-10 | It takes `rowsReturned: number` and a floor. **The capture path returns early on an error, so `decideExhaustion` has structurally never seen a refusal.** The rule it does implement — zero rows is dormancy, never exhaustion — is correct and was reused unchanged. The WALL half had no path into the engine at all; `isRetentionWallRefusal` is that path. |
| A null retention floor makes exhaustion structurally unclaimable | TESTED | GLOBAL | `tests/guards/universe-zero-is-not-a-wall.guard.mjs` leg (b); the behaviour lives at `capture-adapter.ts:245-253` | 2026-08-10 | Proven RED by restoring a non-null floor on the Google adapter. This is the pre-existing contract switched ON, not new logic. |
| Only `DateRangeError` is a wall; quota, auth, timeout and our own query bugs are not | TESTED | GLOBAL | `tests/guards/universe-zero-is-not-a-wall.guard.mjs` leg (a) — 9 non-walls and 2 walls, driven | 2026-08-10 | Proven RED by widening the discriminator to `return true`, which flagged the successful-zero case, quota, auth, timeout, our own query bug, and the enum name in bare free text. Enum names come from https://developers.google.com/google-ads/api/docs/reporting/segmentation. |
| The floor is resolved at EXECUTE time, never carried on a queue message | TESTED | PER-ACCOUNT | `tests/guards/universe-floor-execute-time.guard.mjs` | 2026-08-10 | Proven RED by restoring `msg.floorDate ?? …` in the v2 consumer. The gap it closes is up to the queue's 24h TTL against a boundary that moves one day per day. |
| The discovered wall is stored per (client, vendor, resource, segment) | VERIFIED | PER-SURFACE | `migrations/062_universe_account_floor.sql`; read path `google-ads-universe-writer.ts` `readAccountWall()` | 2026-08-10 | ⛔ **WRITTEN, NOT RUN.** `select to_regclass('public.universe_account_floor')` returns NULL as of 2026-08-10 — the table and its RPC do not exist yet. **Until the migration runs, `readAccountWall` throws and the v2 walk FAILS CLOSED rather than defaulting to a date.** That is the intended posture, and it is also a hard precondition on running v2 at all. |
| today−37mo is a REPORTING warning line and never stops a walk | VERIFIED | GLOBAL | `google-ads-universe-writer.ts` `RETENTION_WARNING_LINE_MONTHS` / `retentionWarningLine()` | 2026-08-10 | Gate-A read it as **2023-07-10**. Foam OH holds 255,452 vendor-reported rows from March 2022 — 16 months BELOW that line. Nothing in the engine compares against it. ⚠ It is NOT covered by a guard: no mechanical check today prevents a future caller using it as a stop. UNENFORCED, stated rather than implied. |

## VENDOR FACTS — ZERO METRICS, AND THE ATTACK THEY ANSWER (2026-08-10)

⛔ **THE ATTACK, STATED BEFORE THE ANSWER:** if any entry the walk requests returns rows REGARDLESS of
activity, a backward walk on that entry never bottoms out. It reads "rows returned ⇒ ground exists" forever,
walks past account inception, and burns quota indefinitely. The discovered-floor design depends on this
not being possible.

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| Rows whose selected metrics are all zero are not returned | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/reporting/zero-metrics | 2026-08-10 | Verbatim: "Rows whose selected metrics are all zero won't be returned." |
| Zero metrics are ALWAYS excluded when a report is segmented | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/reporting/zero-metrics | 2026-08-10 | Verbatim: "Zero metrics are always excluded when segmenting a report, provided all _selected_ metrics are zero." And: "Segmenting a report is done by including any `segments` field in the search query." |
| A date-segmented report returns no row for a date with no metrics | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/reporting/zero-metrics | 2026-08-10 | Verbatim: "Dates with no metrics are not returned in such a report." **This is what makes a backward walk bottom out** — an inactive range returns nothing rather than rows. |
| A documented resource class that returns rows regardless of activity | — | — | — | — | ⛔ **NOT PUBLISHED.** The page does not distinguish "attribute" resources from "metrics" resources and names no such class. It states a MECHANISM (all *selected* metrics zero ⇒ excluded), not a resource taxonomy. The attack is answered by the mechanism, not by an exemption list. |
| Every entry the walk requests selects at least one metric | VERIFIED | PER-SURFACE | `buildGaql` at `google-ads-universe-writer.ts:314-317`; skip at `:735-737`; counted from `docs/google-ads-capture-universe.json` | 2026-08-10 | `servesMetrics` is used when non-empty, else the default five-metric set — so a metric is ALWAYS selected. **Exactly 2 of the 358 pre-deferral entries carry `servesMetrics: []` and are SKIPPED before a request is spent: `detail_content_suitability_placement_view` and `group_content_suitability_placement_view`.** Both reconcile with `universe_window_log`, where those two resources spent 0 requests. **0 entries have `metricCount == 0`.** ⇒ **THE ATTACK DOES NOT LAND for our query shape.** |
| The 346 figure reconciles: 358 selectable − 12 deferred | VERIFIED | GLOBAL | `selectableEntries()` `google-ads-universe-writer.ts:214-218`; the deferral note at `:162` | 2026-08-10 | 1,300 catalog → 559 eligible → 358 after the derived-time filter → **346** after the disk deferral of "12 of 358 entries [that] carry 41.9% of the walk's disk". 37 distinct resources. |
| ⚠ Whether all five of OUR metrics reach zero on an inactive day, for every surface | — | — | — | — | **UNVERIFIED, and it is the residual the zero-metrics rule leaves.** The vendor's exclusion is conditional on *all selected* metrics being zero. 100 of the selectable entries are PARTIAL (they serve 1–4 of our 5). A surface reporting a non-zero non-performance metric regardless of activity would keep returning rows. Not measured; not designed around. |

## EXTERNAL ADVERSARIAL REVIEW — TWO INDEPENDENT REVIEWERS, 2026-08-10

| CORRECTION | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| `GoogleAdsFailure ⇒ WALL` would be too broad; only the specific error code qualifies | INFERRED | GLOBAL | external adversarial review (two reviewers, independently); no vendor URL asserts this | 2026-08-10 | **THE CODE ALREADY HELD.** `isRetentionWallRefusal` (`google-ads.adapter.ts:91-99`) requires the `date_range_error` KEY *and* one of the two enum names. **Nothing was changed.** The guard's driven non-wall list was extended from 9 to 17 to include the bare gRPC statuses (RESOURCE_EXHAUSTED, UNAVAILABLE, INTERNAL, UNKNOWN, ABORTED, INVALID_ARGUMENT, FAILED_PRECONDITION) and a permission failure, so the claim now rests on a driven check rather than on reading a regex. |
| A successful empty response does not establish DORMANCY | INFERRED | PER-SURFACE | external adversarial review; the weaker reading is grounded by the zero-metrics URL above | 2026-08-10 | Renamed to **NO_DATA_OBSERVED** in `capture-adapter.ts` (comment + both returned proof strings) and in the v2 consumer. It establishes only "this query returned no rows" — not that the account was idle, not that the entity is absent, and nothing about any other resource, segment or granularity. It grounds NO floor. |
| The floor is not an ACCOUNT property; it is account × resource × segment × granularity | INFERRED | PER-SURFACE | external adversarial review; the granularity half IS vendor-grounded — the 37-month rule is stated for granular segments specifically (https://developers.google.com/google-ads/api/docs/reporting/segmentation) | 2026-08-10 | Migration 062's key was already right. The LANGUAGE was not: "the account's floor" is the sentence in which one resource's refusal becomes an account-wide seal — floor36's exact shape. Log lines, comments and this registry swept. **TESTED by `tests/guards/wall-is-surface-scoped.guard.mjs`** (proven RED by dropping `resource` from the read key). ⚠ RESIDUAL: `readAccountWall`/`recordAccountWall` still carry "Account" in their names; renaming needs `google-ads-universe-writer.ts`, outside this flight's ceiling — ★WALL-HELPERS-STILL-NAMED-ACCOUNT. |
| CANNOT-RUN must not render like FAILED | INFERRED | GLOBAL | this session, 2026-08-10 — a push report that could not say which it was looking at | 2026-08-10 | `canonical-key-spelling` (s) and `drain-alias-coverage` (v) now separate ENVIRONMENT blockers from data findings: **exit 3 = CANNOT-RUN, exit 1 = FAILED**, distinct banners, and a data failure still lists any blockers beside it. Neither check was weakened, no skip was added, nothing was baselined — both still refuse to pass. |

## THE METRIC UNIVERSE — WHY 062 NEEDS NO METRIC-FAMILY COLUMN (2026-08-10)

⛔ **THE ATTACK THIS ANSWERS:** reach/frequency metrics retire at 3 YEARS while granular stats run 37
months, and Google's `DateRangeError` does not say which boundary was hit — so a reach-metric refusal
recorded into `universe_account_floor` would seal a surface 13 months early, forever (GREATEST() never
lowers a wall).

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| The ENTIRE metric universe is five performance counters | VERIFIED | GLOBAL | `docs/google-ads-capture-universe.json` (all entries' `servesMetrics` + `metricShape`) + `DEFAULT_METRICS` at `google-ads-universe-writer.ts:388-390` | 2026-08-10 | The complete distinct set across all three inputs to `buildGaql`: `metrics.clicks` · `metrics.conversions` · `metrics.conversions_value` · `metrics.cost_micros` · `metrics.impressions`. `metricShape` takes exactly two values (`metrics.conversions`, `metrics.cost_micros`). **ZERO reach-family metrics. The poisoning is unreachable by construction.** |
| The unreachability is guarded, not remembered | TESTED | GLOBAL | `tests/guards/google-account-floor.guard.mjs` leg (d) — proven RED by injecting `metrics.average_impression_frequency_per_user` into one catalog entry | 2026-08-10 | The catalog is REGENERABLE data; a future regeneration admitting a reach metric re-arms the poisoning silently. The leg reads the ARTIFACT on every run. If it ever fires, the choice it forces is stated in its own message: drop the metric, or give 062 a metric-family key first. |
| A refusal's boundary tier is NOT identifiable from the error | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/reporting/segmentation (the enum names carry granularity, not tier) | 2026-08-10 | `REQUESTED_DATE_GRANULARITY_NOT_SUPPORTED` names the granularity axis, never the 3y/37mo/11y tier. If a reach metric is ever selected, the family must be derived from the REFUSED QUERY's metric list at capture time — never from the error text. |

## MEASURED DORMANCY — THE GAP TABLE THAT KILLED THE PARK DESIGN (2026-08-10)

Longest interior gap between consecutive held account-grain days, per roster client (google platform,
via `idx_mdp_account_canonical` — the partial index IS the day list; not an A6 scan):

| CLIENT | HELD DAYS | SPAN | LONGEST GAP (days) |
|---|---|---|---|
| BusyBee Bookkeeping | 157 | 2019-12-18 → 2026-08-09 | **2,267 (~6.2 YEARS, data on BOTH sides)** |
| Influential Drones (5bb9b2ff) | 556 | 2018-08-11 → 2026-08-09 | 1,729 |
| Glass Plus, Inc. | 1,038 | 2020-04-28 → 2026-08-09 | 1,227 |
| Inside | 216 | 2025-06-09 → 2026-08-09 | 203 |
| Foam OH | 1,432 | 2022-03-05 → 2026-08-09 | 57 |
| Champion Cleaning Systems | 2,399 | 2019-11-05 → 2026-08-09 | 49 |
| Bath Fitter \| O'Gorman Bros | 1,999 | 2020-01-27 → 2026-08-09 | 46 |
| Veterinary mastermind | 139 | 2026-03-23 → 2026-08-09 | 1 |
| The Escential Group | 168 | 2026-02-23 → 2026-08-09 | 0 |

⛔ **WHAT THIS TABLE DECIDED:** any consecutive-empty threshold small enough to bound a quota leak (10–20
windows) parks BusyBee's walk mid-gap and refuses the 2019 history on the far side. So the shipped design
REPORTS at `EMPTY_STRETCH_REPORT_AFTER = 400` windows — above the worst dormancy ever measured at any
window size — and NEVER stops. And the same arithmetic exposed the sizing defect: crossing 2,267 days at
the old 7-day intermittent pin cost ~324 requests/surface (4.3× the 30-day cost), which is why the
intermittent branch now WIDENS to maxDays under flat-per-request cost
(LORAMER_INTERMITTENT_WIDENS_UNDER_FLAT_COST_V1, TESTED by `capture-adapter-seam.guard.mjs` leg (d3)).

## RESEARCHED-BY-MEASUREMENT — THE 2026-08-10 VENDOR PROBE (Russ-approved, Foam OH ONLY)

⛔ **SCOPE ON ITS FACE, EVERY ROW: ONE account (957d484e / 7688521852), ONE developer token, ONE day
(2026-08-10). 4 operations spent of a 12-op cap.** These are observations of what Google DID, not statements
of what Google says it will do; the two disagree and both belong in this file. The probe used the walk's own
query shape (`buildGaql`, campaign resource, DEFAULT_METRICS) except row 4, which `buildGaql` cannot express.

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| Daily grain at 53 months back is STILL SERVED, 71 days after the policy's effective date | RESEARCHED-BY-MEASUREMENT | PER-ACCOUNT | probe op 1: `SELECT segments.date, campaign.resource_name, <5 metrics> FROM campaign WHERE segments.date BETWEEN '2022-03-01' AND '2022-03-31'` | 2026-08-10 | SERVED: 75 rows, 27 distinct days (2022-03-05..2022-03-31). No error of any kind. Reconfirms the 08-04..08 walk observation on a fresh request. |
| NO refusal boundary exists at ANY depth — 2016-01 (128 months back) returns SUCCESS-EMPTY | RESEARCHED-BY-MEASUREMENT | PER-ACCOUNT | probe op 2: same shape, `BETWEEN '2016-01-01' AND '2016-01-31'` | 2026-08-10 | SERVED: **0 rows, no error.** Not `DateRangeError.INVALID_DATE`, not `REQUESTED_DATE_GRANULARITY_NOT_SUPPORTED` — a clean empty response 91 months past the documented 37-month wall. ⇒ **For this account/token, retention enforcement at the API is ABSENT, not lazy.** The binary search terminated in one op because there is no boundary to search for. The discovered-floor design's posture — walk until refused, treat zero as NO_DATA_OBSERVED — is exactly right for this reality: a 37-month clamp would have discarded 16 months of served data, and a refusal-probe strategy would have found nothing to record. |
| A range straddling the DATA floor returns partial rows — the in-data days only | RESEARCHED-BY-MEASUREMENT | PER-ACCOUNT | probe op 3: same shape, `BETWEEN '2022-02-28' AND '2022-03-09'` | 2026-08-10 | SERVED: 8 rows, 5 distinct days — **2022-03-05..2022-03-09 only.** Days before the account's data-start contribute nothing; days after flow normally, in ONE query. ⚠ This straddles the DATA floor, NOT a retention wall — no wall exists to straddle on this account, so the vendor's straddle-the-RETENTION-boundary behaviour remains NOT PUBLISHED and now also NOT MEASURABLE here. |
| `segments.month` WITHOUT `segments.date` returns TRUE monthly aggregates | RESEARCHED-BY-MEASUREMENT | PER-ACCOUNT | probe op 4: `SELECT segments.month, <5 metrics> FROM campaign WHERE segments.date BETWEEN '2022-03-01' AND '2022-03-31'` (hand-built) | 2026-08-10 | SERVED: **5 rows — one per campaign per month** (vs 75 daily rows for the same range), clicks 10,253 on the sample row vs single-day rows an order of magnitude smaller. ⛔ **THIS RESOLVES THE REGISTRY'S WEAKEST ROW:** "Google's segments.month rows are daily rows wearing a month label" (writer.ts:632-634) was measured through `buildGaql`, WHICH CO-SELECTS `segments.date` IN EVERY QUERY (writer.ts:400) — the daily grain was OUR OWN query shape reflected back. Without segments.date, monthly is a true aggregate. ⚠ Whether it serves BEYOND a daily wall is untestable here (no wall exists on this account). |
| `buildGaql` cannot express a monthly query | VERIFIED | GLOBAL | `google-ads-universe-writer.ts:400` — `const select = ['segments.date']` unconditionally | 2026-08-10 | Every query the walk can construct forces daily granularity. Consistent with the derived-time design (month is COMPUTED, never fetched) — recorded so nobody assumes the walk could fall back to vendor-monthly without a writer change. |
| ⛔ **AD-HOC VENDOR CALLS ARE INVISIBLE TO EVERY GOVERNOR — MEASURED, NOT SUSPECTED** | RESEARCHED-BY-MEASUREMENT | GLOBAL | post-probe read: `universe_attempt_log` 0 rows · `universe_window_log` 0 rows · `cron_runs` (google) 0 rows in the window | 2026-08-10 | The probe's 4 operations appear in NO ledger. Every lane meter (`google-op-budget.ts`, the adapter's `spentSoFar`) sums OUR OWN ledgers — `cron_runs`, `universe_window_log`, `universe_attempt_log` — so any Google call outside the ledgered paths spends real quota that every governor then re-grants to someone else. The 15,000/day cap is enforced by GOOGLE per token; our accounting of it has a hole exactly the size of whatever bypasses the ledgers. Today that was 4 ops (5 after the feasibility probe below). QUEUE: ★UNLEDGERED-VENDOR-SPEND-IS-INVISIBLE. |
| `campaign.start_date` is REJECTED by our stack — GENERALLY, not context-specifically | RESEARCHED-BY-MEASUREMENT | PER-ACCOUNT | probe op 5: `SELECT campaign.start_date FROM campaign ORDER BY campaign.start_date ASC LIMIT 1` (no status filter, no co-selection) | 2026-08-10 | **REJECTED, verbatim: `{"query_error":32} Unrecognized field in the query: 'campaign.start_date'.`** A bare single-field query — no other resource's fields, no metrics, no segments — so the rejection is GENERAL on google-ads-api 23.0.0 against this account, settling the question `google-intelligence.ts:132` left open (its failure could have been co-selection context; it was not). ⚠ RESOLVED SAME DAY, from the installed library's own field list: **the field does not exist in API v23 at all** — `fields.d.ts` carries `campaign.start_date_time` and NOT `campaign.start_date`. The rejection was our stack being CURRENT, not stale. One account, one token, one day. |
| The earliest campaign inception date IS queryable — via `campaign.start_date_time`, one op | RESEARCHED-BY-MEASUREMENT | PER-ACCOUNT | probe op 6: `SELECT campaign.start_date_time FROM campaign ORDER BY campaign.start_date_time ASC LIMIT 1` (no status filter — removed campaigns included by API default, per the cookbook) | 2026-08-10 | **SERVED, verbatim raw row: `{"campaign":{"resource_name":"customers/7688521852/campaigns/16473849753","start_date_time":"2022-03-04 13:49:44"}}`.** FORMAT: a DATETIME — `YYYY-MM-DD HH:MM:SS`, space-separated, **NO timezone designator** (Google Ads reports in the account's own timezone; `segments.date` days are in the same frame, so a date-only comparison via `.slice(0, 10)` is internally consistent — but the frame is the ACCOUNT's, and that caveat travels with any stop built on it). **FIRST LIVE TEST OF THE DATA-CANNOT-PRECEDE-FIRST-CAMPAIGN PREMISE: PASSED.** Earliest campaign 2022-03-04 13:49:44 vs the account's metrics_daily data-start 2022-03-05 — the first data day is ONE DAY AFTER campaign start, and the same campaign id (16473849753) appears in probe op 3's straddle sample rows. A stop at the start_date_time's date would have kept every row we hold. One account, one token, one day: the premise has one confirming instance, not a proof. |

## THE CHOKE POINT — CONSTRUCTION CLOSED 2026-08-10; CHARGING STILL OPEN

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| Google Ads client construction is CHOKED — factory + 14 frozen sites, ratchet | TESTED | GLOBAL | `src/lib/google-ads-client.ts` (`googleAdsCustomerFor`); `tests/guards/google-client-choke-point.guard.mjs`, proven RED by adding a bypass construction site | 2026-08-10 | The answer's STRUCTURAL half to the six-unledgered-ops measurement above: a NEW self-constructed client is now a build failure; the 14 pre-existing live-path sites are frozen by name with per-file counts (ratchet — only falls; a migrated file must delete its entry). The two INERT universe vendor files migrated first (zero live traffic). ⚠ CHARGING IS NOT UNIFIED YET — the v2 walk charges at its own boundary, v1 bills universe_window_log, forward/catchup/drain are estimated from cron_runs × the unmeasured 67; a factory-level charge today would DOUBLE-charge them. ★GOOGLE-REQUEST-LEDGER owns the follow-on. |

## THE INCEPTION STOP — BUILT 2026-08-10, TESTED, NEVER RUN

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| The discovery query is pinned, unfiltered, one op | TESTED | GLOBAL | `INCEPTION_DISCOVERY_GAQL` in the writer; `tests/guards/inception-stop.guard.mjs` leg (a), proven RED by adding a status predicate | 2026-08-10 | No status filter — removed campaigns included by API default (cookbook, banked). `campaign.start_date_time` per probe op 6; `campaign.start_date` does not exist in v23 per probe op 5. |
| The inception is PER-ACCOUNT with mandatory provenance, and the EARLIEST wins | TESTED | PER-ACCOUNT | `migrations/063_universe_account_inception.sql` (WRITTEN, NOT RUN); guard leg (b), proven RED by dropping clientId from a call site | 2026-08-10 | PK (client_id, vendor); raw vendor datetime stored beside the derived date; RPC keeps LEAST() so a re-discovery against a purged earliest campaign cannot RAISE the stop. NOT in 062 — that table is per-surface by law and its CHECK refused this source. |
| The wall and the inception are composed in EXACTLY ONE site | TESTED | GLOBAL | `composeWalkStop()` in the writer, called once in the v2 consumer; guard leg (c), proven RED by adding a second call site | 2026-08-10 | stop = max(vendor refusal wall, min(inception, earliest held date)). The held-data min is a measurement, not a margin: rows we hold outrank the claim. Account-timezone frame caveat travels with the probe-op-6 row. |
| UNKNOWN never falls through to a date; an unbounded walk REFUSES on it | TESTED | GLOBAL | guard leg (d), DRIVEN (4 scenarios), proven RED by making UNKNOWN fall through to held data | 2026-08-10 | UNKNOWN → stopDate null + inceptionKnown false → `advance()` returns REFUSED-UNBOUNDED unless the message carries `walkToEpoch: true`, which no code ever sets — walk-to-epoch is an explicit operator choice only. A wall may still stop a walk whose inception is unknown, but the unbounded refusal still fires. |
| ⚠ NOTHING HERE HAS RUN | — | — | — | 2026-08-10 | Migration 063 not applied (`universe_record_account_inception` does not exist in the DB), no discovery op has been spent through the engine, and the consumer path is Gate-A'd on the pure function only. The SUCCESSFUL column stays empty. |

## ATTESTATION SCOPE — FOUND BY THE FIRST WET RUN, FIXED SAME SESSION (2026-08-10)

| FACT | CLASS | SCOPE | SOURCE | ESTABLISHED | NOTES |
|---|---|---|---|---|---|
| A `zero` attests EXACTLY its own (resource, segment) surface — a sibling segment's zero attests NOTHING | TESTED | GLOBAL | `attestedEmptyDays` scope filter (universe-coverage.ts); `tests/guards/attested-empty-segment-scope.guard.mjs`, proven RED first (5 findings against the pre-fix code, including the live wet-run shape) | 2026-08-10 | Found by the engine's FIRST execution, 23:52Z: the read filtered by resource only, so one segment's zero attested every sibling — 17 of 20 published surfaces read "already covered" and never asked the vendor. Which sibling won the race was nondeterministic (maxConcurrency 2). LORAMER_ATTESTED_EMPTY_SEGMENT_SCOPE_V1. |
| The (resource, segment) → breakdown_type mapping has ONE owner and is applied FORWARD only | TESTED | GLOBAL | `breakdownTypeForSurface` (universe-surfaces.ts); the writer's `breakdownTypeFor` delegates; guard leg (e), RED when the delegation is absent | 2026-08-10 | '.'→'_' collides with literal '_', so the mapping is lossy in reverse and is never inverted into a query — rows are filtered forward over the returned set. |
| The attempt log's base-entry segment is `''`, NOT NULL — `.eq` semantics are safe; `.is()` not needed | VERIFIED | GLOBAL | `migrations/061_universe_attempt_log.sql:95` (`segment text not null, -- ''`); live rows ids 5/7 read `seg_is_empty_string=true`; guard leg (e) pins the migration line | 2026-08-10 | PostgREST: `eq` is SQL `=` and never matches NULL; `is` exists for exact null equality (docs.postgrest.org/en/stable/references/api/tables_views.html; supabase.com/docs/reference/javascript/using-filters). If the column is ever relaxed, the guard goes red before any `.eq('segment', …)` read silently loses rows. |

## THE SUCCESSFUL COLUMN IS EMPTY, AND THAT IS THE POINT

**NOTHING IN THIS REGISTRY IS CLASS `SUCCESSFUL`, AND NOTHING IS CLASS `TESTED` FOR THE RETENTION FACTS.**

- `universe_attempt_log` holds **0 rows**. The v2 consumer has never run.
- `/api/cron/universe-resume` is **absent from `vercel.json`**, defaults to dry-run, and is `CRON_SECRET`-gated.
- The only walk that has ever run is v1, on **one client**, over **five days** in August 2026.

Every number this capture arc rests on is therefore RESEARCHED (what the vendor says) or VERIFIED (what we
read once, mostly on one account). **None of it has been proven by running.** A reader who wants to know
"has this ever worked in production" should read the emptiness of that column as the answer, not look for
a caveat elsewhere.

## RELATED

- Governing law: [[LORAMER_ESSENCE]] — capture EVERYTHING from EVERYWHERE, store it FOREVER.
- The law this document cannot yet satisfy: [[LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1]].
- Status of the walk rebuild: `LORAMER_QUEUE_OF_RECORD.md` ★WALK-REBUILD-STEPS-8-16. This file owns FACTS,
  never status.
