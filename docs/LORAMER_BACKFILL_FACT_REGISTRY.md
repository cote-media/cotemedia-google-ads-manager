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
| "Per day" is a SLIDING 24-hour window keyed to the developer token | RESEARCHED | GLOBAL | https://developers.google.com/google-ads/api/docs/api-policy/access-levels | 2026-08-10 | Verbatim: "'Per day' is based on a sliding 24 hour time period in which API requests were made with your developer token." Corroborates LORAMER_GOOGLE_ROLLING_QUOTA_WINDOW_V1. |
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
| `VENDOR_FLOOR_DATE = '2022-03-05'` | VERIFIED | PER-ACCOUNT | `src/lib/backfill/google-ads-universe-writer.ts:158` | 2026-08-03 | Foam OH's measured floor. The adapter says so itself at `capture-adapters/google-ads.adapter.ts:40`: "`VENDOR_FLOOR_DATE` is Foam OH's MEASURED floor and is therefore per-account." Applied to every account. **The fifth instance of the pattern.** |
| `floorDate: '2015-08-14'` (GA4) | VERIFIED | PER-ACCOUNT | `src/lib/backfill/adapters.ts:75` | 2026-08-10 | **THE SIXTH INSTANCE.** GA4 property floors are demonstrably per-property: the read-only `/api/backfill/probe-ga` returned earliest 2023-06-22 for Influential Drones (property 388079271) and 2022-12-14 for My Vacation Network (property 346191496). The constant is wrong for both by 7+ years. |
| `HARD_FLOOR = '2015-08-14'` (GA4) | VERIFIED | PER-ACCOUNT | `src/lib/backfill/ga-dimensional-backfill.ts:51` | 2026-08-10 | **THE SAME FACT AS THE ROW ABOVE, WITH A SECOND OWNER.** Two constants, two files, one fact — a G1 divergence waiting to happen on top of a scope defect. |
| `floor36()` — a clock 36 months before the day the lap runs | VERIFIED | GLOBAL (but wrongly authoritative) | `src/lib/backfill/drain-registry.ts:76` | 2026-08-03 | Seals a cursor when `subStart <= floor36()`. `src/lib/backfill/google-ads-universe-writer.ts:9-15` records the consequence: "that produced 214 cursors across 18 clients reading backfill_complete=true while Google still served years more." The clock is global; **whether the vendor actually stops there is per-account** — and the row above about 53 months says it does not. |
| `GAQL_REQUESTS_PER_CONNECTION_DAY = 67` | VERIFIED | PER-CLIENT | `src/lib/backfill/google-op-budget.ts:73` | not measured | Self-flagged in place: "⚠ AND NEVER LIVE-MEASURED". Three of the four lanes convert work units through it, "so their spend figures inherit its error in an unknown direction". Tracked as ★LANE-VOLUME-IS-ESTIMATED-FROM-AN-UNMEASURED-CONSTANT. |

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
