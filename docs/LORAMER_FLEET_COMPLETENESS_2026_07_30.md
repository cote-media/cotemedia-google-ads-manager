# LORAMER_FLEET_COMPLETENESS_V1 — FLEET COMPLETENESS MEASUREMENT, 2026-07-30

**A MEASUREMENT OF RECORD.** Both passes are reproduced here verbatim as they were reported, so this file is
readable a month from now without the chat that produced it. Meta was measured 2026-07-29/30; Shopify and GA4
immediately after. **Google is NOT measured** — its developer-scope quota was exhausted until
2026-07-30T08:03:57Z and it runs separately with the same method.

**SCOPE:** the TEN GOLDEN CLIENTS (DECISIONS `[SCOPE 2026-07-29 — RUSS]`), resolved BY ID through
`src/lib/clients/canonical.ts`. Read-only throughout: zero writes, zero vendor API calls.

**HEADLINE: 62,893 recoverable client-days** — Meta 26,140 · Shopify 19,869 · GA4 16,884.

---

## ⚠ TWO CAVEATS THAT BIND EVERY NUMBER IN THIS FILE

### 1. THE TIMEOUT THESE NUMBERS WERE TAKEN AGAINST

**Every figure here was measured through the Supabase MCP session, `statement_timeout` 120s — NOT the live 8s
PostgREST ceiling that production runs under.** Nothing in this document is evidence that any of these queries
would survive in production. Four query shapes timed out even at 120s.

**THE SHAPE THAT WORKS**, recorded because it is the reusable part: a **per-client bounded scan with CTEs forced
`AS MATERIALIZED`**. Without `MATERIALIZED`, Postgres inlines and re-executes the `GROUP BY` per reference and
the same query blows the limit at 4+ clients. Fleet-wide aggregates over `metrics_daily` (~39M rows) time out
unconditionally — always bound by `client_id` + `platform` so the query rides
`idx_metrics_daily_client_platform_bt_level_date`. Heaviest single probe measured **363ms** as an index-only
scan. Queries that ran long were **killed, not retried bigger**.

### 2. THE UNIT CAVEAT ON THE COMBINED SORT

**A Shopify GraphQL lap, a GA4 Data API request and a Meta Insights report are NOT the same currency.** The
combined ranked list at the foot of this file treats "one vendor request" as a common unit. That is defensible
for deciding what to run first and **wrong for anything else**. All cost figures are **derived from route
shapes, not from `plan=true` dry runs** — no vendor calls were made in either pass. The routes' own plan mode
returns exact sub-range and report counts.

### CLASSIFICATION VOCABULARY

- **(a) TRUE ZERO** — the vendor served nothing. Requires evidence, never assumed.
- **(b) RECOVERABLE** — inside vendor retention, fetchable today.
- **(c) PERMANENTLY LOST** — outside retention; the wall and when it passed are named.
- **(d) STUCK** — cursor not advancing, or a writer failing silently.
- **UNKNOWN** — used deliberately where TRUE ZERO and a capture hole cannot be distinguished. Saying UNKNOWN is
  the finding; forcing a class to make the table tidy is the failure mode this vocabulary exists to prevent.

---

# PASS 1 — META (complete)

```
FLEET COMPLETENESS — META ONLY, COMPLETE. Shopify + GA4 NOT MEASURED. Read-only, zero writes, zero vendor calls.

⚠ WHICH LIMIT EVERY NUMBER WAS TAKEN AGAINST: all of it through the Supabase MCP session, statement_timeout
120s — NOT the live 8s PostgREST ceiling. So these are MEASUREMENTS, and none of them is evidence that the same
query would survive in production. Four of my query shapes DID time out even at 120s; the shape that works is
the per-client bounded scan with CTEs forced `AS MATERIALIZED` (without it Postgres re-ran the group-by per
reference and blew the limit at 4 clients). Heaviest single probe measured 363ms via index-only scan on
idx_metrics_daily_client_platform_bt_level_date. I killed the timeouts rather than retrying them bigger.

SCOPE RESOLVED BY ID, AND THE NAME LOOKUP PROVED THE POINT: querying clients by the ten golden NAMES returned
ELEVEN rows, because "Influential Drones" matches two. Registry-resolved: 5bb9b2ff (cohort) is in scope,
2617b163 (demo@loramer.com fixture) is OUT. "The Escential Group" -> c39ee088, not bb9e2c31.
META connections: 9 of the 10, all healthy (Bath Fitter has no meta connection — out of scope, not a gap).

RETENTION WALLS USED, and where they sit today (2026-07-30)
  meta aggregate insights   36 months -> floor 2023-07-30 (the same floor36 the shipped routes compute)
  meta HOURLY (`hour`)      13 months -> ~2025-06-30. PROOF it is a wall and not our backfill floor: five
                            clients' hour data all begins 2025-06-22/23, within a day of each other.
EXPECTED SPAN per client = account-grain days with spend>0, from max(first activity, floor) to today. Using
ACTIVE days, not all account days, is load-bearing: a breakdown cannot exist on a $0 day, and counting those
would manufacture thousands of false gaps.

ACTIVITY WINDOWS (account grain, spend>0) — three of the nine are dormant or dead, which decides their gaps
  BusyBee          2025-03-17 .. 2026-07-28   408 active days   $6,442
  Escential        2026-02-23 .. 2026-07-28   155               $14,329
  Glass Plus       2024-10-17 .. 2026-07-28   640               $19,497
  My Vacation Net  2024-05-17 .. 2026-07-28   569               $31,538
  Shelley Kyle     2023-12-17 .. 2026-07-28   691               $27,646
  Vet mastermind   2026-02-02 .. 2026-07-28   180               $14,998
  Foam OH          2023-06-21 .. 2025-09-30   746 since floor   $875,565  DORMANT since 2025-09-30
  Infl Drones      2024-09-17 .. 2025-08-27   271               $8,911    DORMANT since 2025-08-27
  Thought Streams  never                        0               $0        NEVER DELIVERED (52 account days, all $0)

1. THE TABLE — client x family x missing-active-days x classification
   (only families with a gap; REC=recoverable, PERM=permanently lost, TZ=true zero. Full per-family splits
   measured, condensed here by family group. Interior/trailing/leading were measured separately — see §3.)

  SHELLEY KYLE (691 active, expected from 2023-12-17)
    7 asset families (ad_format/description/video/image/call_to_action/link_url/title)  4,405  REC
    body_asset 551 REC · product_id 520 REC · video 300 REC (231 of it INTERIOR)
    3 *_asset_type  199 REC + 358 TZ each  ·  geo_country 71 REC · geo_region 71 REC · action_type 7 REC
    hour 374 PERM  ·  attribution_window 492 TZ  ·  comscore_market DECLARED-BUT-EMPTY, TZ
  MY VACATION NET (569 active, from 2024-05-17)
    product_id 568 REC · 6 asset families 532 each REC · body_asset 523 · title_asset 523 REC
    video 343 REC (202 INTERIOR) · 3 *_asset_type 208 REC + 315 TZ each · action_type 1 REC
    hour 335 PERM · attribution_window 438 TZ · comscore_market EMPTY/TZ
  GLASS PLUS (640 active, from 2024-10-17)
    ad_format_asset 500 REC · 6 asset families 474 each REC · video 466 REC (236 INTERIOR)
    3 *_asset_type 281 REC + 219 TZ each · action_type 1 REC
    product_id + video_asset DECLARED-BUT-EMPTY, 640 each REC
    hour 240 PERM · attribution_window 390 TZ · comscore_market 605 TZ (probe-proven empty)
  BUSYBEE (408 active, from 2025-03-17)
    product_id 363 REC · ad_format_asset 294 REC · 6 asset families 282 each REC
    3 *_asset_type 220 REC + 74 TZ each · video 158 REC (83 INTERIOR)
    image_asset DECLARED-BUT-EMPTY, 408 REC
    hour 95 PERM · attribution_window 239 TZ · comscore_market EMPTY/TZ
  INFL DRONES (271 active, from 2024-09-17, DORMANT since 2025-08-27)
    video 265 REC · 9 families DECLARED-BUT-EMPTY and recoverable: ad_format/body/call_to_action/description/
      image/link_url/title/video_asset/product_id = 271 each = 2,439 REC
    hour 223 mostly PERM · attribution_window + comscore_market EMPTY/TZ
    3 *_asset_type: EMPTY; the 2025-06-01..2025-08-27 slice is recoverable but I did NOT measure it — see LIMITS
  FOAM OH (746 active since floor, DORMANT since 2025-09-30)
    image_asset 119 REC (116 TRAILING) · 3 *_asset_type 28/28/16 REC + 660 TZ each
    6 families 1-3 REC each (interior singletons)
    product_id DECLARED-BUT-EMPTY, 746 REC
    hour 682 PERM · attribution_window 739 TZ · comscore_market EMPTY/TZ
  ESCENTIAL (155 active, from 2026-02-23)
    product_id 56 REC (all LEADING) · ad_format 47 · video_asset 46 · 4 families 36 · 3 *_asset_type 16
    title 12 · body 5 REC · 13 families at ZERO missing · comscore_market EMPTY/TZ
  VET MASTERMIND (180 active, from 2026-02-02)
    product_id 154 REC (95 TRAILING, 2 INTERIOR) · video_asset 54 REC · ad_format 27 · 3 *_asset_type 26 each
    6 families 1 each · comscore_market EMPTY/TZ
  THOUGHT STREAMS — ALL 25 DECLARED FAMILIES EMPTY, ALL TRUE ZERO. Zero breakdown rows of any kind; only the
    account grain exists, 52 days, every one $0. Nothing was delivered, so nothing can be missing.

  (a) TRUE ZERO IS PROVEN, NOT ASSUMED — the evidence for each:
    · Thought Streams: 52 account days, spend total $0, zero active days ever. No delivery.
    · Foam OH / Infl Drones post-dormancy: expected set is spend>0 days only, so their dead tails are excluded
      by construction rather than counted and excused.
    · comscore_market: banked read-only probe of 2024-11 returns EMPTY with no error — a valid breakdown that
      yields nothing for these accounts.
    · flexible_format_asset_type / gen_ai_asset_type / creative_relaxation_asset_type pre-2025-06: banked
      probes of 2024-11 return EMPTY, and a clean 23-month backfill wrote 197,334 rows with ZERO for these.
    · attribution_window: banked probe returns Meta error code 100 verbatim — it is NOT a valid `breakdowns`
      value at all. The rows we hold come from action_attribution_windows on the REQUEST. Nothing to backfill.
    I made no vendor calls this flight, so every (a) above rests on a previously banked probe, cited. Where I
    had no probe I did not claim (a).

2. RANKED RECOVERY LIST — largest recoverable loss first, with vendor cost
   Cost basis, measured this session on the shipped routes: asset lap = 11 breakdowns x 3 entity levels = 33
   reports per calendar-month chunk; single-breakdown lap (product_id) = 3 reports per month chunk; observed
   ~4,000ms per report.
   #1 SHELLEY KYLE      6,522 days   assets ~26 months x 33 = ~858 reports (~57 min) + product_id ~51 reports
   #2 GLASS PLUS        5,934 days   assets ~16 mo x 33 = ~528 + product_id ~63 + video_asset (in the asset lap)
   #3 MY VACATION NET   5,774 days   assets ~21 mo x 33 = ~693 + product_id ~66
   #4 BUSYBEE           3,575 days   assets ~11 mo x 33 = ~363 + product_id ~36 + image_asset (in asset lap)
   #5 INFL DRONES       2,704 days   assets ~12 mo x 33 = ~396 + product_id ~36  (dormant client, fixed ceiling)
   #6 FOAM OH             954 days   product_id ~25 mo x 3 = ~75 reports; the rest is 1-3 day singletons
   #7 VET MASTERMIND      319 days   product_id ~6 mo x 3 = ~18 reports  (cheapest per day recovered)
   #8 ESCENTIAL           358 days   product_id ~2 mo x 3 = ~6 reports   (cheapest absolute)
   #9 THOUGHT STREAMS       0 days   nothing to run
   SEQUENCING NOTE, not a proposal: #7 and #8 buy 677 days for ~24 reports; #1 buys 6,522 for ~909. If tonight
   is report-limited rather than time-limited, the order above is wrong and cost-per-day is the right sort.

3. (d) STUCK — everything the cursors say is losing data right now
   ONE, and it RECONCILES EXACTLY with the frozen-cursor detector, no disagreement:
     · Escential meta_product_id — cursor 2026-05-06, complete=false, 8 days stale. Baselined in
       frozen-cursors.baseline.mjs with "root cause already fixed (63c65ca + 37fce69), expected to clear on the
       next drain lap". Still parked.
   NOTHING ELSE among the golden nine is stuck on Meta. Every other meta_* cursor for these clients advanced
   within 0-1 days. Checked explicitly because it is the obvious wrong inference: Shelley/Glass Plus/BusyBee/
   My Vacation asset cursors sit at 2026-02-13/19 with 500-640 day gaps behind them, which LOOKS stuck and is
   not — they are advancing daily and have simply only walked back that far. That is (b) RECOVERABLE, and the
   detector agrees.
   The 8 frozen cursors the detector reports on 2617b163 are NOT in this measurement — that is the demo fixture,
   correctly out of scope.

4. HEADLINE — TOTAL RECOVERABLE CLIENT-DAYS, GOLDEN TEN, META ONLY
   ✦ 26,140 recoverable client-days ✦
   = 21,267 in families with partial coverage + 4,873 in DECLARED-BUT-EMPTY families.
   Alongside it: ~1,949 days PERMANENTLY LOST behind the 13-month hourly wall, and ~7,781 days classified TRUE
   ZERO on banked probe evidence. Thought Streams contributes 0 recoverable and its entire 25-family absence is
   true zero.
   ⚠ THE DECLARED-BUT-EMPTY HALF WOULD HAVE BEEN INVISIBLE. My first measurement pass reported 21,267 because a
   family with ZERO rows never enters a min/max/count query at all — it produces no gap because it produces no
   row to compare. 4,873 days, 19% of the total, existed only in the difference between the 25 declared families
   and what each client actually holds. A completeness measurement that only measures what is present cannot
   find what is wholly absent.

LIMITS, stated rather than buried
  · Infl Drones' three *_asset_type families for 2025-06-01..2025-08-27 are recoverable and NOT measured
    (≤264 days). Excluded from the headline rather than estimated into it.
  · Interior/trailing/leading were measured for every partial-coverage family; I condensed them in §1 and
    called out only the material ones. The largest INTERIOR holes are Glass Plus video 236, Shelley video 231,
    My Vacation video 202 — mid-history, not stale tails, and a different problem from the leading gaps.
  · Month counts in §2 are derived from date spans, not from a plan=true dry run. The routes' own plan mode
    returns the exact sub-range and report count; I did not call it (no vendor calls this flight).
  · Every classification uses ACTIVE days. If you want the alternative denominator (all account days), the
    numbers rise and most of the increase is false.
```

---

# PASS 2 — SHOPIFY + GA4 (complete)

```
FLEET COMPLETENESS — SHOPIFY + GA4 COMPLETE. Read-only, zero writes, zero vendor calls.

⚠ TIMEOUT LIMIT FOR EVERY NUMBER: Supabase MCP session, statement_timeout 120s — NOT the live 8s PostgREST
ceiling. `AS MATERIALIZED` was again load-bearing; without it the same shapes timed out at 4+ clients on Meta.
Nothing here proves these queries would survive in production. GA4 ran in two 5-client batches, Shopify in one
3-client batch. Nothing killed this pass.
CLIENTS RESOLVED BY ID via canonical.ts. Influential Drones = 5bb9b2ff (cohort), never 2617b163.

════════ SHOPIFY ════════
DECLARED 15 families. Connections: 3 of the golden ten, all healthy.
EXPECTED SPAN = first-order-date -> today. NO VENDOR RETENTION WALL ON ORDERS, so NOTHING on Shopify is class
(c). The 1,000-point query-cost ceiling is reported below as COST, not as a wall.
DENOMINATOR = account days with revenue>0. This matters more here than anywhere: Shopify breakdowns are
order-CONDITIONAL, and counting no-order days would reproduce the 2026-07-19 geo false alarm exactly.
  Foam OH      1,220 revenue days of 1,647 account days   2022-01-24 .. 2026-07-26
  Infl Drones    911 revenue days of 2,664                2019-04-13 .. 2026-07-28
  Escential       23 revenue days of 225                  2025-12-19 .. 2026-07-28

1. TABLE — client x family x missing revenue-days x class
  FOAM OH (1,220 revenue days)
    geo_country, geo_region                    0 missing   COMPLETE (1,247 dates — the original capture)
    10 breadth families, 1,047 LEADING each    10,470  REC   (customer_cohort, financial_status,
      fulfillment_status, geo_city, order_time, product_collection, product_tag, product_type,
      product_vendor, sales_channel — all begin 2025-11-02)
    discount_code / discount_type              1,047 lead each = 2,094 REC; +72 interior +2 trailing each UNKNOWN
    abandoned_checkout                         1,219 missing, 1 date held (2026-07-24)   UNKNOWN
  INFL DRONES (911 revenue days)
    geo_country, geo_region                    0 missing   COMPLETE (927 dates)
    10 breadth families, 598 LEADING each      5,980  REC   (all begin 2024-07-10)
    discount_code / discount_type              600 lead each = 1,200 REC; +267/+242 interior, +27 trailing UNKNOWN
    product_collection                         598 lead REC; +91 interior UNKNOWN (nested id-batched call,
                                                 soft+split-on-failure — the shape that fails quietly)
    abandoned_checkout                         909 missing, 2 dates held   UNKNOWN
  ESCENTIAL (23 revenue days)
    10 breadth families, 12 INTERIOR each      120  REC   (14 dates held of 23 revenue days — interior, not a
                                                 leading gap, so this is a hole not an un-walked frontier)
    geo_country/geo_region/order_time          1 each = 3 REC
    discount_code / discount_type              1 lead each = 2 REC; +19 trailing +2 interior UNKNOWN
    abandoned_checkout                         DECLARED-BUT-EMPTY, 0 rows ever   UNKNOWN
  DECLARED-BUT-EMPTY SET, measured explicitly: exactly ONE — Escential abandoned_checkout. Foam OH and Infl
  Drones hold all 15 declared families. (Meta's lesson applied; on Shopify it turned out to be almost nothing.)
  WHY abandoned_checkout IS UNKNOWN AND NOT TRUE ZERO: 1 day for Foam OH, 2 for Infl Drones, 0 for Escential
  across 2,154 combined revenue days. Abandoned checkouts are common in real stores, so sparsity that extreme
  looks like a capture problem — but I have NO probe and cannot distinguish it from a genuinely short vendor
  query window. It is the single most suspicious item on Shopify and I am not classifying it either way.

2. RANKED RECOVERY — Shopify. COST = GraphQL calls. OrdersInRange measures 651 requested / 134 actual points
   against the 1,000 hard ceiling, so ~349 points of headroom; scalars are free, anything nested needs its own
   id-batched call. Recovery walks month windows.
   #1 FOAM OH      12,564 days   ~35 month-laps   ≈ 359 days per lap
   #2 INFL DRONES   7,180 days   ~25 month-laps   ≈ 287 days per lap
   #3 ESCENTIAL       125 days   ~1 lap           ≈ 125 days per lap

3. (d) STUCK — NONE on Shopify, and the reconciliation is exact:
   `shopify_order_time` owns all ten breadth families. Foam OH cursor 2025-11-02 complete=false moved TODAY;
   Infl Drones cursor 2024-07-09 complete=false moved TODAY. Their data minimums are 2025-11-02 and 2024-07-10.
   THE CURSORS MATCH THE DATA FRONTIER TO THE DAY — those 1,047 and 598 day gaps are the un-walked remainder of
   a backfill that is RUNNING, not a stall. Escential's is complete=true at 2025-12-16, its first order date.
   shopify_deep / money / variant read complete=true and 21-48 days stale: frozen-by-COMPLETION, correctly not
   flagged. The frozen-cursor detector reports nothing here. NO DISAGREEMENT.

4. HEADLINE — SHOPIFY: ✦ 19,869 recoverable client-days ✦ (19,744 partial-coverage + 125 Escential + 0
   declared-but-empty recoverable). ~2,968 days UNKNOWN. ZERO permanently lost — no wall exists.

════════ GA4 ════════
DECLARED 12 families. All ten golden clients hold a healthy ga connection.
DENOMINATOR = account days with `extra->>'sessions' > 0`. GA4 has no spend, and sessions is the only
delivery signal that exists at the account grain; a zero-session day cannot carry a dimensional breakdown.
⚠ RETENTION WALL: I could NOT establish one. There is no banked GA4 wall in this repo and I made no vendor
calls. GA4's user-data retention setting (2 or 14 months) plausibly makes ga_age/ga_gender leading gaps
permanently lost while property-scoped dimensions are not affected — but I am NOT asserting that. Every GA4
leading gap below is classed REC-PENDING-WALL, and if the 14-month limit binds, part of it moves to (c).

1. TABLE — client x family x missing session-days x class
  FOAM OH (1,636 session days from 2022-02-02) — THE WORST GA4 CLIENT ON THE BOARD
    9 core families (campaign, channel, device, event, geo_city, geo_country, geo_region, landing_page,
      source_medium)                      1,428 LEADING + 1 interior each = 12,861  REC-PENDING-WALL
      ALL NINE begin 2026-01-01. Four years of GA4 dimensional history absent.
    ga_item      1,428 lead REC + 88 interior UNKNOWN + 2 trailing
    ga_age       1,428 lead REC-PENDING-WALL; 78 interior + 6 trailing THRESHOLD/UNKNOWN
    ga_gender    1,428 lead; 83 interior + 6 trailing THRESHOLD/UNKNOWN
  INFL DRONES (1,133 session days from 2023-06-22)
    9 core families   224 lead + 2 interior each = 2,034  REC-PENDING-WALL (all begin 2024-02-01)
    ga_item 224 lead REC + 640 interior UNKNOWN · ga_age 224+128 · ga_gender 224+84 THRESHOLD/UNKNOWN
  MY VACATION (1,317 session days from 2022-12-14)
    9 core families   18 lead each = 162  REC
    ga_age  576 lead + 94 interior + 101 TRAILING — frozen at 2026-04-15. ⚠ THIS ONE MATCHES THE BANKED
      THRESHOLD DATE EXACTLY (My Vacation 04-15). TRUE ZERO on the trailing 101, thresholding proven by the
      banked per-property freeze list.
    ga_gender 576 lead + 196 interior + 2 trailing THRESHOLD/UNKNOWN
    ga_item DECLARED-BUT-EMPTY
  SHELLEY (913 session days from 2023-07-27)
    9 core families   1 interior each = 9  REC
    ga_item 135 lead REC + 232 interior UNKNOWN
    ga_age + ga_gender  DECLARED-BUT-EMPTY, ZERO ROWS EVER — TRUE ZERO, evidence: banked "Shelley Kyle is NULL
      throughout, most likely Google Signals disabled." Absence is the property's configuration, not our gap.
  BUSYBEE (1,076 session days from 2023-05-11)
    9 core families   1 interior each = 9  REC
    ga_age 578 lead + 355 interior + 2 trailing · ga_gender 578 + 343 + 1 THRESHOLD/UNKNOWN (banked freeze
      06-30; data now runs to 07-26/27, so it RESUMED — the banked date is a past episode, not current state)
    ga_item DECLARED-BUT-EMPTY
  GLASS PLUS (779 session days) — 9 core families COMPLETE, 0 missing.
    ga_age 145 lead + 168 interior · ga_gender 145 + 118 THRESHOLD/UNKNOWN (banked 07-20; resumed to 07-27)
    ga_item DECLARED-BUT-EMPTY
  BATH FITTER (1,217 session days) — 10 families COMPLETE, 0 missing. ga_age 49+116, ga_gender 49+117
    THRESHOLD/UNKNOWN. ga_item DECLARED-BUT-EMPTY.
  ESCENTIAL (180 session days) — 9 core families COMPLETE. ga_item 22 lead REC + 137 interior UNKNOWN.
    ga_age 25+13, ga_gender 25+6 THRESHOLD/UNKNOWN.
  VET MASTERMIND (207 session days) — 9 core families COMPLETE. ga_item 173 interior UNKNOWN.
    ga_age/ga_gender 61 lead each THRESHOLD/UNKNOWN.
  THOUGHT STREAMS (488 session days) — 9 core families COMPLETE.
    ⚠ ga_age frozen at 2026-02-16 (162 trailing), ga_gender at 2026-02-11 (167 trailing). THIS CLIENT IS NOT IN
    THE BANKED THRESHOLD LIST. Five months of trailing absence with no banked evidence either way → UNKNOWN.
    It is the one GA4 age/gender freeze I cannot attribute, and I am not calling it thresholding to make it tidy.
    ga_item DECLARED-BUT-EMPTY.
  DECLARED-BUT-EMPTY SET, measured explicitly: ga_item absent for Bath Fitter, BusyBee, Glass Plus, My Vacation,
    Thought Streams (5 clients); ga_age + ga_gender absent for Shelley. The ga_item absences are all
    non-ecommerce service businesses, which makes TRUE ZERO likely — but "likely" is not proven, so UNKNOWN.
    Shelley's age/gender absence IS proven TRUE ZERO by the banked Signals finding.

2. RANKED RECOVERY — GA4. COST = Data API requests, ~1 per family per month-window.
   #1 FOAM OH      14,289 days   ~47 mo x 10 fam ≈ 470 req   ≈ 30 days/request
   #2 INFL DRONES   2,258 days   ~8 mo x 10 ≈ 80 req         ≈ 28 days/request
   #3 MY VACATION     162 days   ~1 mo x 9 ≈ 9 req           ≈ 18 days/request
   #4 SHELLEY         144 days   ~5 mo x 10 ≈ 50 req         ≈ 2.9 days/request
   #5 ESCENTIAL        22 days   ~1 req                      ≈ 22 days/request
   #6 BUSYBEE           9 days   ~1 req                      ≈ 9 days/request
   Glass Plus, Bath Fitter, Vet mastermind, Thought Streams: nothing recoverable in the core families.

3. (d) STUCK — ONE FINDING, AND IT DISAGREES WITH THE FROZEN-CURSOR DETECTOR
   ⚠ FALSE COMPLETE ON ga_dimensional, three clients. Foam OH's `ga_dimensional` cursor reads
   backfill_earliest_date 2015-08-14 with backfill_complete=TRUE — while its GA4 dimensional data begins
   2026-01-01 and 1,428 session-days sit unwritten behind a cursor that claims the walk is finished. Same shape
   for Infl Drones (cursor 2015-08-14 complete, data from 2024-02-01, 224 days) and My Vacation (cursor
   2015-08-14 complete, data from 2023-01-01, 18 days).
   THE DETECTOR REPORTS NOTHING FOR THESE, AND IT IS RIGHT BY ITS OWN RULE AND WRONG ABOUT REALITY: it filters
   on backfill_complete=false, so a cursor that lies about being complete is invisible to it by construction.
   This is exactly the blind spot named in its own honest limit — "cannot distinguish frozen-by-failure from
   reached-a-floor-the-code-failed-to-mark-complete" — and this is the first measured instance of the other
   half: marked-complete-while-unwritten. 13,103 recoverable days hide behind three booleans.
   Everything else: `ga` cursors complete at 2015-08-14 across all ten, 1 day stale. ga_dimensional complete for
   all ten, 15-16 days stale — frozen-by-completion, correctly unflagged.
   ALSO SUSPICIOUS, not classified: ga_dimensional complete=true at 2025-07-01 for Escential and Vet mastermind
   and 2022-09-01 for Bath Fitter — different "complete" floors per client with no stated reason. Their core
   families measure 0 missing, so if those floors are wrong the loss is outside my session-day window and this
   measurement cannot see it.

4. HEADLINE — GA4: ✦ 16,884 recoverable client-days ✦ (15,075 core families + 1,809 ga_item leading gaps).
   Of that, 13,103 sits behind the three FALSE-COMPLETE cursors. ~2,000+ days THRESHOLD/TRUE-ZERO on banked
   evidence, and a large UNKNOWN block in ga_age/ga_gender/ga_item interiors that I will not force into a class.

════════ COMBINED ════════
✦ TOTAL RECOVERABLE ACROSS THE GOLDEN TEN, META + SHOPIFY + GA4: 62,893 CLIENT-DAYS ✦
   META    26,140      SHOPIFY  19,869      GA4  16,884
   Google excluded (quota reset 2026-07-30T08:03:57Z).

SINGLE RANKED LIST — SORTED BY DAYS RECOVERED PER UNIT OF VENDOR COST, best value first
 ⚠ READ THE UNIT CAVEAT FIRST: a Shopify GraphQL lap, a GA4 Data API request and a Meta Insights report are NOT
 the same currency. This list treats "one vendor request" as the common unit, which is defensible for
 sequencing and wrong for anything else. All cost figures are DERIVED FROM ROUTE SHAPES, not from plan=true dry
 runs — I made no vendor calls.
   1.  SHOPIFY  Foam OH        12,564 days   ~35 laps    359 days/unit
   2.  SHOPIFY  Infl Drones     7,180 days   ~25 laps    287
   3.  SHOPIFY  Escential         125 days   ~1 lap      125
   4.  META     Escential         358 days   ~6 reports   60
   5.  GA4      Foam OH        14,289 days   ~470 req     30
   6.  GA4      Infl Drones     2,258 days   ~80 req      28
   7.  GA4      Escential          22 days   ~1 req       22
   8.  GA4      My Vacation       162 days   ~9 req       18
   9.  META     Vet mastermind    319 days   ~18 reports  17.7
   10. META     Foam OH           954 days   ~75 reports  12.7
   11. META     Glass Plus      5,934 days   ~591 reports 10.0
   12. META     BusyBee         3,575 days   ~399 reports  9.0
   13. GA4      BusyBee             9 days   ~1 req        9.0
   14. META     My Vacation     5,774 days   ~759 reports  7.6
   15. META     Shelley         6,522 days   ~909 reports  7.2
   16. META     Infl Drones     2,704 days   ~432 reports  6.3
   17. GA4      Shelley           144 days   ~50 req       2.9
 WHAT THIS SORT CHANGES: by absolute size the order is Shelley Meta first. By cost per day it is SHOPIFY FOAM OH
 first — 12,564 days for roughly 35 laps, ~50x better value per request than any Meta item. The top three
 Shopify entries alone recover 19,869 days for ~61 laps. Meta's 26,140 days cost roughly 3,200 reports.
 AND THE SINGLE LARGEST ITEM ON THE BOARD IS NOT A BACKFILL AT ALL: GA4 Foam OH's 14,289 days are locked behind
 a cursor that says complete=true. No amount of drain laps will touch it until that boolean is corrected —
 which is a code question, not a quota question.

LIMITS, stated
 · GA4 retention wall UNESTABLISHED. If the 14-month user-data limit binds, part of the ga_age/ga_gender leading
   gaps is class (c) and the GA4 headline falls. Core property-scoped families should be unaffected.
 · Shopify abandoned_checkout (2,128 days across three clients) left UNKNOWN, not counted as recoverable.
 · GA4 ga_item interiors (1,270 days) and ga_age/ga_gender interiors left UNKNOWN, not counted.
 · Cost figures are estimates from route shapes; the routes' own plan=true mode returns exact counts.
 · Nothing truncated: Meta reported last turn, Shopify and GA4 complete here, Google excluded by instruction.
```

---

## HOW TO REPRODUCE THIS

The query shape, so the next measurement does not rediscover it:

1. Resolve the golden ten **by id** through `src/lib/clients/canonical.ts`. Do **not** query `clients` by name —
   doing so returned ELEVEN rows for a ten-client list because two clients are named "Influential Drones".
2. Per platform, read the declared family set from `src/lib/breakdown-registry.ts` — that is the DECLARED set,
   and the diff against what each client holds is where the invisible half of the loss lives.
3. Per client (never fleet-wide), with `AS MATERIALIZED` on both CTEs:
   - `exp` = account-grain days with the platform's activity signal (`spend>0` / `revenue>0` /
     `extra->>'sessions'>0`), floored at the vendor wall where one exists.
   - `pres` = `group by breakdown_type, date` over that client × platform.
   - anti-join `exp` against `pres` per family; bucket the misses into **leading / interior / trailing** against
     each family's own min/max.
4. Read `sync_state` for the family cursors, and **compare `backfill_earliest_date` against the family's actual
   `min(date)`** — that comparison is what caught the false-complete flags and is the check the frozen-cursor
   detector does not perform.
5. Batch size: 3–5 clients per query held under the 120s limit. More timed out.

## OWNERSHIP

This file owns the 2026-07-30 fleet completeness MEASUREMENT and nothing else. `LORAMER_DECISIONS.md` owns the
laws this measurement produced and the headline figure; `LORAMER_QUEUE_OF_RECORD.md` owns what is open as a
result. Per DOCS_SINGLE_OWNER, those two point HERE for detail rather than restating the tables.
