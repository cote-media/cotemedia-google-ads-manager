<!-- QUEUE-EXEMPT: query_metrics API reference, not a build plan. -->
# query_metrics / query_breakdown — reference

Seed of the future `query_metrics` Skill (structured-accuracy program). This is the authoritative
description of how Lora reads LoraMer's historical store (`metrics_daily`). **Maintenance rule
(accuracy program):** any adapter/schema/grain change updates THIS doc in the SAME commit.

Created 2026-06-12 with LORAMER_QUERY_BREAKDOWN_V1 (Phase 1.1).

## (a) The two tools — when to use each

- **`query_metrics`** — whole-entity TOTALS over one or more time windows (aggregator). Returns one
  summed totals object per window (spend/impressions/clicks/conversions/conversionValue/revenue +
  derived CTR/CPC/CPA/ROAS/AOV). Use for "how much did we spend last month", period-over-period, any
  account/campaign/ad_group/ad TOTAL. Two mutually-exclusive time modes: explicit `windows`
  (arbitrary YYYY-MM-DD ranges) or rolling `baseRange`+`offsetsMonths`.
- **`query_breakdown`** — ranked LIST of dimensional values over a SINGLE window. Returns up to
  `topN` rows, each a breakdown value (a search term, a keyword, a Meta publisher_platform/age/
  gender) with its summed metrics + derived. Use for "top search terms by spend", "which keywords
  convert", "Meta spend by placement". Ranking within one window only.

Pick `query_breakdown` when the question is about *individual terms/keywords/dimension values*; pick
`query_metrics` when it's about *totals*.

## (b) The grains in metrics_daily

`metrics_daily` is one dimensional table. The conflict key is
`(client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value)`.

- **Base rows** — `breakdown_type = ''`. The hierarchy: `entity_level` ∈ account / campaign /
  ad_group / ad (Google, Meta) / product (Shopify, Woo). These carry the authoritative TOTALS.
  `query_metrics` reads ONLY base rows. **Shopify product is a BASE entity_level**
  (`entity_level='product'`, NET revenue via lineItem discountedTotalSet, units = conversions, gross +
  units + currencyCode in `extra`; LORAMER_SHOPIFY_DEPTH_2A_V1) — read it with
  `query_metrics(level='product')`, NOT query_breakdown.
- **Breakdown rows** — `breakdown_type != ''`. A dimensional cut hanging off an entity:
  - `search_term` / `keyword` (Google): `entity_level='ad_group'`, `entity_id`=adGroupId,
    `parent_entity_id`=campaignId, `breakdown_value`=the term/keyword text. status / match_type live
    in `extra` (readable names, e.g. EXACT/PHRASE/BROAD, ENABLED/PAUSED). Captured nightly
    (forward) + backfilled ~90 days (LORAMER_SEARCH_TERMS_CAPTURE_V1 / _BACKFILL_V1). Top 300 terms /
    200 keywords per day by cost; fully-inactive rows skipped.
  - `publisher_platform` / `age` / `gender` (Meta): existing breakdown rows.
  - `geo_country` / `geo_region` (Shopify): ship-to geo on the account row — net revenue + order
    count per ISO country / `<country>-<province>` region; missing addresses bucket as 'UNKNOWN'
    (never dropped). Cancelled orders excluded. SHIPPED 2a (LORAMER_SHOPIFY_DEPTH_2A_V1). (Shopify
    PRODUCT is NOT a breakdown — it's a base entity_level, see above.)
    SEMANTICS (LORAMER_SHOPIFY_DIM_BACKFILL_V1): Shopify depth rows reflect the CURRENT state of
    historical orders — forward capture re-reads yesterday nightly, and the backfill re-reads past
    days, so a late refund/edit/cancel correctly lowers that day's net on the next run (idempotent
    upsert). If a window spans >1 base currency (rare — a store changed currency), the net sums mix
    currencies and the rows carry `currencyMixed: true` in extra (and a loud log) — do NOT trust a
    cross-currency sum.
  `query_breakdown` reads ONLY breakdown rows, one `breakdown_type` per call.

## (c) Double-count rule (the one that matters)

NEVER sum base rows and breakdown rows together. They overlap: a search_term row's spend is already
counted inside its ad_group's base-row spend. The tools enforce this STRUCTURALLY:
- `query_metrics` → `.eq('breakdown_type','')` always (base only).
- `query_breakdown` → `.eq('breakdown_type', <one grain>)`, NEVER `''` (breakdown only, one grain).
There is no parameter that lets either tool cross the line. When answering: a breakdown value's spend
is a **subset** of the entity's total — describe it as "top search terms", never as "the account's
spend". The summed spend of the top-N terms is ≤ the account/campaign total (the difference is the
long tail + non-search-attributed spend like PMax/Display).

## (d) Breakdown semantics

- `breakdown_value` is the term/keyword text VERBATIM (trimmed at capture; empty skipped). Grouped by
  EXACT text — no case folding (Google search terms are typically lowercased; keywords may be cased).
- `query_breakdown` aggregates a value ACROSS ad groups and dates within the window. `parentEntityId`
  is returned only when the value maps to a single campaign; pass `parentEntityId`/`entityId` to scope
  to one campaign/ad group.
- Response truncates a value to 120 chars (+ "…") for token budget; full text stays in the DB.
- `match_type`/`status` are NOT in the ranked row (they're in `extra` at the row level); a value can
  span multiple match types (aggregated).

## (e) Empty-data behavior (honesty)

If a client has no rows for the requested grain+window, `query_breakdown` returns `rows: []`,
`distinctValueCount: 0`, and `note: "No <type> data captured for this client in <range>."` Lora MUST
say exactly that — no data of that kind was captured for that period — and must NOT infer or invent
values from live context or memory. (Several accounts legitimately have zero search-term history:
paused, PMax/Display-only, or newly connected.) A capture/backfill that hit a retention floor or an
inactive day is empty-by-truth, not an error.

## (f) Caps, defaults, ownership

- `topN` default 20, HARD max 50 (token budget). `truncated: true` + `distinctValueCount` tell Lora
  there are more — never imply you saw all terms.
- Date window default `LAST_30_DAYS`; explicit `startDate`+`endDate` validated YYYY-MM-DD, start≤end
  (invalid → empty, not an error).
- `rankBy` default `spend`; also accepts `revenue` (Shopify geo is revenue-centric — ad breakdowns
  carry spend, commerce breakdowns carry revenue). Each returned row includes spend/impressions/
  clicks/conversions/conversionValue/revenue + derived.
- `orderDir` default `desc`.
- Platform is implied by `breakdownType`; a mismatched `platform` arg is rejected (no cross-platform
  read).
- OWNERSHIP: both tools are exposed by `runClaudeToolLoop` ONLY when the signed-in user owns the
  current client (`userOwnsClient`); withheld otherwise (fails closed). Consumers `/api/chat`,
  `/api/insight`, `/api/intelligence` gate at the route level too. query_breakdown adds NO new surface
  and inherits this gate unchanged.

## Later (not in 1.1)

- Per-value TREND over time (a date series for one term) — different result shape.
- Multi-window period-over-period for a value.
- Negative-keyword / waste analysis (spend with 0 conversions) — derived view on top of 1.1.
