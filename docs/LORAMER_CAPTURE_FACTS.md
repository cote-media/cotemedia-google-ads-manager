# LORAMER_CAPTURE_FACTS.md — the walls, floors and capability limits, verified against the vendors
<!-- LORAMER_CAPTURE_FACTS_V1 -->

> ⛔ **NEW-DOC GATE: OVERRIDDEN EXPLICITLY BY RUSS**, 2026-08-01, by name ("WRITE
> docs/LORAMER_CAPTURE_FACTS.md"). Recorded because the default is refuse.
>
> **WHY THIS DOC EXISTS.** 7 of 19 graded boundary failures in the 2026-08-01 eval were Lora
> correctly reporting that data was absent and then MISNAMING THE CAUSE — calling a vendor
> retention wall a capture gap, a forward-only family a genuine zero, an API capability limit an
> ingestion failure. She was never told these boundaries exist. The coverage instrument answers
> "do we hold this window?" and nothing answers "why not, and whose limit is it?"
>
> ⛔ **EVERY FACT BELOW WAS FETCHED FROM THE VENDOR'S OWN PAGE ON 2026-08-01, NOT FROM
> LORAMER_DECISIONS.md AND NOT FROM MEMORY.** Where a vendor page contradicts what this repo had
> banked, BOTH are printed and the fact is marked CONTESTED — it is not silently resolved. A wrong
> wall in the prompt is worse than no wall.
>
> **DECISIONS REMAINS THE OWNER OF THESE FACTS AS DECISIONS.** This doc is the VERIFIED, SOURCED,
> PROMPT-SHAPED form of them, and it exists to be read by the answer path. Where the two differ,
> the vendor page cited here is the evidence and DECISIONS is the record of what we believed.

---

## 1 · GOOGLE ADS — VERIFIED

**Source: <https://support.google.com/google-ads/answer/15188209> — "Google Ads Data Retention
Policy". Fetched 2026-08-01. No last-updated date is displayed on the page.**

- **Effective 2026-06-01.** Verbatim: *"hourly, daily and weekly reporting data collected by Google
  Ads for periods of time shorter than one month will be available for 37 months."*
- Verbatim: *"Monthly, quarterly and annual data is available for 11 years."*
- Verbatim: *"After that period, the data will not be accessible via the Google Ads interface or
  APIs."*
- Requesting granular segments (`segments.date`, `segments.week`) beyond 37 months returns a
  **DateRangeError**; a report spanning the boundary simply contains no rows for the granular days
  older than the window.
- ⚠ **A THIRD TIER THIS REPO HAD NOT BANKED — verbatim: *"Reach and frequency metrics will be
  available for 3 years only"***, covering unique users, average impression frequency and frequency
  distribution. LORAMER_DECISIONS.md:162 records only the 37-month granular and 11-year aggregate
  tiers. This is an ADDITION, not a contradiction, and it is sourced. Do not state it as 37 months.

### Google search terms — NO VENDOR WALL FOUND. OUR FLOOR WAS OURS.
- No Google page found on 2026-08-01 publishes a search-term-specific retention window shorter than
  the general policy above. Searched the retention policy, the reporting overview and the date-range
  docs.
- **`DEFAULT_DAYS = 90` in our own backfill was OURS, not Google's** — DECISIONS
  LORAMER_GOOGLE_SEARCH_TERM_FLOOR_IS_OURS_V1. Live probe 2026-08-01T08:58:13Z, both controls
  passing, served every test day back to ~35 months (2023-08-31 → 405 rows); empty only at ~38
  months, which is the general 37-month wall.
- ⛔ **UNESTABLISHED: the true search-term UPPER wall.** The probe proves ~35 months are reachable
  and that ~38 is not. It does NOT establish a search-term-specific limit, because none was found
  published. Say "we have not established a search-term-specific wall; the general 37-month
  granular window applies as far as we know."

---

## 2 · META MARKETING API — VERIFIED

**Source: <https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/>
— "Ads Insights API Metric Availability Updates". Post dated 2025-10-16. Changes effective
2026-01-12. Fetched 2026-08-01.**

Per-field classes, and they are NOT interchangeable:
- **Aggregated totals — 37 months.** Verbatim: *"Total values for API fields are unaffected by the
  above changes and will continue to be available for up to 37 months"*
- **Unique-count fields — 13 months.** Verbatim: *"limited to 13-month's of historical data"*
- **Hourly breakdowns — 13 months.** Verbatim: *"limited to 13-month's of historical data"*
- **Frequency breakdowns — 6 months.** Verbatim: *"limited to 6-months of historical data"*
- MMM breakdowns: restricted to asynchronous jobs only.
- ⇒ **NEVER quote 37 months as the Meta floor for hourly or unique-count families.** All four
  numbers match what LORAMER_DECISIONS.md:171 banked on 2026-07-27. Independently corroborated in
  our own data: the Meta `hour` family bottoms out at 2025-06-22/23 on SIX deep-history clients,
  all within one day of each other — a backfill floor varies per client, a retention wall does not.

### Attribution changes — TWO, both vendor-side, neither our defect
- **2026-01-12 — `7d_view` and `28d_view` REMOVED.** Verbatim: *"7-day view (`7d_view`) and 28-day
  view (`28d_view`) attribution windows will no longer be returned"*. Remaining: 1d_click, 7d_click,
  28d_click, 1d_view, plus a 1-day engage-through. A request returns EMPTY, not an error.
- **2026-03-03 — CLICK-THROUGH REDEFINED TO LINK CLICKS ONLY.** Source:
  <https://www.facebook.com/business/news/click-attribution> — "Simplifying Ad Measurement for a
  Social-First World". Meta historically attributed to *"all different types of clicks (share, save,
  like, link click, etc.)"*; click-through now counts genuine link clicks only, and conversions from
  shares/saves/other non-link actions move to **engage-through** attribution (renamed from
  engaged-view). Ramped from late March. **This is a DEFINITIONAL change to the three click windows
  we capture and store** — a pre-March click number and a post-March one are not the same quantity.

---

## 3 · GA4 — VERIFIED, AND THE COMMON MISREADING IS NAMED

**Source: <https://support.google.com/analytics/answer/7667196> — "Data retention". Fetched
2026-08-01. No last-updated date displayed.**

- The 2-month / 14-month setting scopes **user-level and event-level data** — data *"associated with
  cookies, user-identifiers, such as User-ID, and advertising identifiers"*.
- ⛔ **IT DOES NOT SCOPE STANDARD REPORTS.** Verbatim: *"the data retention setting does not affect
  standard aggregated reports (including primary and secondary dimensions) in your Google Analytics
  property, even if you create comparisons in the reports. The data retention setting only affects
  explorations and funnel reports."*
- ⇒ Aggregated standard reports persist for the life of the property. Confirms
  LORAMER_DECISIONS.md:172. **Never tell a user their GA4 history is capped at 14 months** — that is
  the Explorations limit, not the reporting limit.
- ⛔ **UNESTABLISHED: GA4's actual inbound floor.** Practically it is the property-CREATION date
  (GA4 launched Oct 2020, so ≥2020); our deepest capture is Foam OH 2022-02-02. Universal Analytics
  is a separate, sunset, DELETED product and is unreachable. The `2015-08-14` in our adapter is a
  CLAMP CONSTANT, not a retention fact. Say "we have not established GA4's inbound wall; in practice
  it is the property's creation date." Tracked as ★GA4-RETENTION-WALL-UNESTABLISHED.

---

## 4 · OURS, NOT THE VENDOR'S — forward-only families

- **`conversion_action` and `impression_share` have NO history by construction.** First row anywhere
  on the fleet is **2026-06-27**, which is their own writer's ship date. Zero backfill. Every other
  Google family's first row predates its writer by ~3 years because those writers backfilled; these
  two did not.
- ⇒ A window before 2026-06-27 shows these families absent and **that absence is CORRECT** — not a
  hole, not a loss, not backfillable without a new writer. Source: QUEUE
  ★GOOGLE-FORWARD-ONLY-FAMILIES, 2026-07-30. This is a LoraMer fact, not a Google one; say so.

---

## 5 · API CAPABILITY LIMITS — one holds, one is CONTESTED

### 5a · Auction Insights competitor detail — UI-only. NOT RE-VERIFIED THIS PASS.
True Auction Insights (competitor domains, overlap rates) is not available via the Google Ads API;
impression share is. Banked in code at `build-claude-context.ts:901`. ⚠ **This was NOT re-fetched
from a vendor page on 2026-08-01.** Treat as banked-but-unverified until it is.

### 5b · ⛔ PMax per-asset BEST/GOOD/LOW labels — CONTESTED. STOPPED. DO NOT PUT IN THE PROMPT.
**WHAT WE HAVE BANKED**, `build-claude-context.ts:764`:
> "Google v23 API does NOT expose per-asset BEST/GOOD/LOW performance labels (UI-only). Per-asset
> raw metrics also not exposed."

**WHAT GOOGLE PUBLISHES**, <https://developers.google.com/google-ads/api/performance-max/asset-reporting>,
**last updated 2026-07-22**:
> "Full performance statistics (such as `clicks`, `impressions`, and `conversions`) are now
> available at the asset level"

and the API reference carries `AssetPerformanceLabelEnum.AssetPerformanceLabel` with a
`performance_label` field on `asset_group_asset`.

**THE SPLIT, as far as this pass established it:**
- The PMax page does say labels are not directly surfaced per-asset there, pointing instead at
  `primary_status` / `primary_status_reasons` and `asset_group_top_combination_view`. So the FIRST
  half of our comment may hold **for PMax specifically**.
- **THE SECOND HALF — "per-asset raw metrics also not exposed" — IS CONTRADICTED IN TERMS.** Google
  says they are "now available", which implies a change since our comment was written.
- Separately, `performance_label` demonstrably EXISTS on `ad_group_ad_asset_view` (responsive search
  ads) and **we already read it** — `google-intelligence.ts:606`. So a blanket "the API does not
  expose performance labels" is false for RSAs regardless of the PMax answer.
- We pin `google-ads-api ^23.0.0`; the cited page is v24-era.

⛔ **CONSEQUENCE, AND IT REACHES THE EVAL.** Eval case **A19** was graded FAIL with the judge's
reason asserting "labels are UI-only at any date". If that premise is wrong or stale, **the rubric
is wrong too**, and A19 is mis-specified rather than a Lora defect. NOT RESOLVED HERE. This fact is
deliberately EXCLUDED from the prompt block until a probe settles it. Do not adopt either side.

---

## 5c · SHOPIFY — ⚠ NOT VERIFIED AGAINST A VENDOR PAGE ON THIS PASS

⛔ **THIS SECTION EXISTS BECAUSE THE GUARD FOUND IT MISSING, AND THAT IS THE GUARD WORKING.** We
have captured from Shopify for months and never wrote its walls down. Recording the gap honestly
rather than omitting the platform.

- **NO ROLLING RETENTION WALL HAS BEEN OBSERVED.** Shopify's Admin API serves full order history;
  our deepest capture is Influential Drones back to 2019. Treat the practical floor as the store's
  own history, not a vendor cap. **UNVERIFIED against a Shopify page.**
- **WHAT IS REAL AND IS NOT A RETENTION WALL: the query-cost ceiling.** A single GraphQL query may
  not exceed **1,000 points**, enforced BEFORE execution on the requested cost; over it Shopify
  returns `MAX_COST_EXCEEDED` — a hard refusal, not a throttle. This bounds how MUCH we can ask for
  in one call, never how far BACK. Do not report it as a history limit.
  (Measured live 2026-07-19; DECISIONS LORAMER_SHOPIFY_QUERY_COST_CEILING_V1 owns it.)
- ⛔ **UNESTABLISHED: whether Shopify imposes any age-based limit at all.** Say so.

## 5d · WOOCOMMERCE — ⚠ NOT VERIFIED AGAINST A VENDOR PAGE ON THIS PASS

- WooCommerce is **SELF-HOSTED**. There is no vendor retention wall, because there is no vendor
  holding the data — history is bounded by the merchant's own database and their host's behaviour.
  An absence here is a MERCHANT-SIDE or OUR-SIDE fact, never a platform retention wall.
- Precedent, and it is the reason this matters: Shelley Kyle's store returns HTTP 500 on
  `/wp-json/wc/v3/orders` on every forward fire. That is a merchant-side outage. Reporting it as a
  retention limit, or as a zero, would be wrong in both directions.
- ⛔ **UNESTABLISHED: nothing about Woo retention has been verified against documentation**, because
  there is no single vendor to verify against. Say so plainly.

## 6 · HOW LORA MUST USE THIS

When reporting that data is absent, **name which kind of boundary it is**:
1. **Our capture floor** — we simply have not captured back that far. Derivable per client and per
   family from `coverage.captureFloor` and `breakdownCoverage`.
2. **A vendor retention wall** — the platform no longer serves it to anyone. §1, §2, §3 above.
3. **A forward-only family** — no history exists by construction. §4.
4. **An API capability limit** — the platform never served it to any API client. §5.
5. **Unestablished** — we have not determined which. Say exactly that.

⛔ Never assert a wall that is not in this document. ⛔ Never present an UNESTABLISHED item as
established. "We have not established this" is a correct and complete answer.
