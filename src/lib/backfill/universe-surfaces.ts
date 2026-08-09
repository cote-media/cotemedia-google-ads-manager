// LORAMER_UNIVERSE_SURFACE_LABELS_V1 — VENDOR VOCABULARY → CLIENT VOCABULARY.
//
// ⛔ WHAT THIS IS FOR. The failure surface on the client dashboard must be able to say
// **"Google search terms are incomplete from 2025-11-07 to 2025-12-06; Shopify, Meta and GA4 are current."**
// Coverage is computed in the VENDOR's names — `campaign_search_term_view`, `segments.ad_network_type` — and
// a client has never heard of either. This table is the only place those become a sentence.
//
// ⛔ IT IS HAND-AUTHORED AND THAT IS NOT THE `DEFERRED_ENTRIES` CLASS. DEFERRED_ENTRIES encodes a JUDGMENT
// about ONE ACCOUNT's measured yields and does not generalise. This is a TRANSLATION of vendor vocabulary
// into English — universal across every account, and wrong only if the English is wrong.
//
// ⛔ THE TEST EVERY LABEL HAD TO PASS (Russ): would a Foam OH stakeholder recognise this WITHOUT explanation?
// Not "would an engineer accept it". `universe-surface-labels.guard.mjs` enforces the mechanical half — no
// underscores, no `view` suffix, every delivering resource labelled, every label carrying its reason.
//
// ⛔ RELATIONSHIP TO docs/LORAMER_BREAKDOWN_REGISTRY.md, stated so two vocabularies never drift into one
// question: THE REGISTRY NAMES DIMENSIONS (`search_term`, `device`, `age`, `hour`, `geo_*`) — the SEGMENT
// axis. THIS NAMES SURFACES — the RESOURCE axis, i.e. what a row is ABOUT. They are complementary and
// neither replaces the other: "Search terms, split by device" is one label from each. Where the registry has
// a word for a dimension, the qualifier below uses the registry's word rather than inventing a second one.

// ── LORAMER_CANONICAL_KEY_SPELLING_V1, 2026-08-09 — ONE SPELLING PER FACT, IN THE KEY ────────────────────
// ⛔ WHY THIS LIVES HERE AND NOT AS CONDITIONALS IN THE WRITER. The walk and the drain wrote the SAME FACT as
// TWO ROWS — same campaign, same day, same device, identical numbers — because they disagreed on two of the
// seven columns of `metrics_daily_p_natural_key`. The unique index cannot collapse them, so both persist:
// 67,455 rows on Foam OH across 2022-03-05 → 2026-04-05, and `queryBreakdown` groups by breakdown_value, so
// Lora is handed buckets literally named "2", "3", "4" beside MOBILE/TABLET/DESKTOP.
// ⛔ THE DRAIN IS THE INCUMBENT AND DOES NOT MOVE. Every form below is READ FROM ITS PRODUCER, never
// re-derived from a vendor doc — and `canonical-key-spelling.guard.mjs` leg (r) EXECUTES that agreement, so
// these tables cannot drift from the producer silently.

/**
 * ⛔ WALK RESOURCES WHOSE NAME **IS** A LEGACY `entity_level`, so they share a key space with the drain.
 * Measured against the catalog on 2026-08-09: of 182 resources, exactly THREE collide.
 * ⚠ `ad` IS THE THIRD AND IT WAS NOT IN THE ORIGINAL BRIEF — `customer`, `ad_group_ad` and `keyword_view` are
 * near-misses that do NOT collide (the legacy names are `account`, `ad`, `keyword`).
 */
export const LEGACY_ENTITY_LEVEL_RESOURCES = new Set(['campaign', 'ad_group', 'ad'])

/**
 * The drain's entity_id at those levels is the BARE vendor id — `String(r.campaign?.id || '')` at
 * `google-device.ts:56`, `r.ad_group?.id` at `:61`, `r.ad_group_ad?.ad?.id` at `:66`. The walk receives a
 * resource_name (`customers/7688521852/campaigns/23424584377`); the id is its last path segment.
 * ⛔ A NON-COLLIDING RESOURCE IS RETURNED UNCHANGED. Its resource_name is the only identity it has, and
 * rewriting it would invent a second spelling in the other direction.
 */
export function canonicalEntityId(resource: string, entityId: string | null): string | null {
  if (entityId === null || !LEGACY_ENTITY_LEVEL_RESOURCES.has(resource)) return entityId
  const i = entityId.lastIndexOf('/')
  return i === -1 ? entityId : entityId.slice(i + 1)
}

/**
 * ⛔ DECLARED AS DATA, PINNED TO THE PRODUCER BY A GUARD RATHER THAN BY AN IMPORT. Importing
 * `deviceName` from `intelligence/google-device.ts` would drag the Google Ads client into every module that
 * reads a surface label — including the resumer, which must never be able to reach the vendor. Leg (r) of
 * `canonical-key-spelling.guard.mjs` executes both this table and the producer's, so a drift is a red build.
 * SOURCE: `google-device.ts:31` — seven entries, and note 5=OTHER / 6=CONNECTED_TV, which is NOT the order a
 * reading of Google's docs suggests. The producer wins.
 */
const DEVICE_ENUM_NAME: Record<string, string> = {
  '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'MOBILE', '3': 'TABLET', '4': 'DESKTOP', '5': 'OTHER', '6': 'CONNECTED_TV',
}

/**
 * Canonicalise a raw segment value into the spelling the drain already writes.
 * SOURCES: device → `google-device.ts:31-33`; hour → `google-hour.ts:33` (`padStart(2, '0')`).
 * ⛔ AN UNKNOWN breakdown_type IS RETURNED UNCHANGED — this normalises the facts the two engines SHARE, and
 * inventing a form for a fact only the walk writes would be the same mistake in a new place.
 */
export function canonicalBreakdownValue(breakdownType: string, raw: string): string {
  if (breakdownType === 'device') return DEVICE_ENUM_NAME[raw] ?? raw
  if (breakdownType === 'hour') {
    const n = Number(raw)
    return Number.isFinite(n) ? String(Math.trunc(n)).padStart(2, '0') : raw
  }
  return raw
}

export interface SurfaceLabel {
  /** What a client calls it. No vendor vocabulary — the guard enforces this. */
  surface: string
  /** Why this resource collapses to this surface. A collapse without its reason cannot be re-examined. */
  why: string
}

/**
 * ⛔ 37 DELIVERING RESOURCES → 18 SURFACES. Not the ~15 first estimated, and the three extra are DELIBERATE
 * SPLITS recorded in `mustDiffer` in the guard: collapsing any of them would let an incomplete surface report
 * as complete under another surface's name.
 */
export const SURFACE_BY_RESOURCE: Record<string, SurfaceLabel> = {
  // ── SEARCH ────────────────────────────────────────────────────────────────────────────────────────────
  campaign_search_term_view:   { surface: 'Search terms', why: 'the queries people actually typed, at campaign grain — the same thing a client means by "search terms"' },
  search_term_view:            { surface: 'Search terms', why: 'the same fact at ad-group grain; a client does not distinguish the two reports, only the data' },
  paid_organic_search_term_view: { surface: 'Search terms, paid and organic', why: 'SPLIT DELIBERATELY: this joins Search Console, so it can be incomplete while paid search terms are whole. One label would hide that.' },
  keyword_view:                { surface: 'Keywords', why: 'the keywords bid on, as distinct from the queries they matched' },

  // ── STRUCTURE ─────────────────────────────────────────────────────────────────────────────────────────
  customer:                    { surface: 'Account totals', why: 'the whole-account line a client checks first' },
  campaign:                    { surface: 'Campaigns', why: 'the level clients plan and budget at' },
  campaign_budget:             { surface: 'Campaigns', why: 'JUDGMENT CALL, FLAGGED: a budget is not a campaign, but no client checks "is my budget data complete" as a separate question. Split it the moment one does.' },
  ad_group:                    { surface: 'Ad groups', why: 'the level below campaigns; clients recognise the term' },
  ad_group_ad:                 { surface: 'Ads', why: 'the individual ads that ran' },

  // ── CREATIVE ──────────────────────────────────────────────────────────────────────────────────────────
  ad_group_ad_asset_view:      { surface: 'Creative assets', why: 'the individual headline, description, image or video inside an ad' },
  ad_group_asset:              { surface: 'Creative assets', why: 'the same assets attached at ad-group level' },
  campaign_asset:              { surface: 'Creative assets', why: 'the same assets attached at campaign level' },
  customer_asset:              { surface: 'Creative assets', why: 'the same assets attached account-wide' },
  asset_field_type_view:       { surface: 'Creative assets', why: 'which ROLE an asset played (headline vs description); a property of the asset, not a separate thing a client tracks' },
  ad_group_ad_asset_combination_view: { surface: 'Creative combinations', why: 'SPLIT DELIBERATELY: which headline ran WITH which image. Asset-combination conversion attribution is a banked CORE capability — folding it into "creative assets" would make the flagship invisible in the report.' },

  // ── PERFORMANCE MAX ───────────────────────────────────────────────────────────────────────────────────
  asset_group:                 { surface: 'Performance Max', why: 'PMax has its own vocabulary and clients treat it as a separate campaign type' },
  asset_group_asset:           { surface: 'Performance Max', why: 'assets inside a PMax asset group' },
  asset_group_product_group_view: { surface: 'Performance Max', why: 'product groups inside a PMax asset group' },
  performance_max_placement_view: { surface: 'Performance Max', why: 'where PMax ads appeared; clients ask about it as part of PMax, not as generic placements' },

  // ── SHOPPING ──────────────────────────────────────────────────────────────────────────────────────────
  shopping_performance_view:   { surface: 'Shopping products', why: 'per-product performance — what a store owner means by "how are my products doing"' },
  product_group_view:          { surface: 'Shopping products', why: 'the product-group bidding structure above individual products' },

  // ── PLACE ─────────────────────────────────────────────────────────────────────────────────────────────
  geographic_view:             { surface: 'Locations targeted', why: 'where we AIMED. SPLIT from presence deliberately — one being complete says nothing about the other.' },
  location_view:               { surface: 'Locations targeted', why: 'performance of the location-targeting criteria themselves; the same question a client is asking' },
  user_location_view:          { surface: 'Locations people were in', why: 'SPLIT DELIBERATELY: where the user actually WAS, which is a different fact from where we targeted (recorded as GEO_LOSS in the deferral notes).' },

  // ── PEOPLE ────────────────────────────────────────────────────────────────────────────────────────────
  age_range_view:              { surface: 'Demographics', why: 'age; clients ask about age, gender, income and parental status as one question' },
  gender_view:                 { surface: 'Demographics', why: 'gender, same question' },
  income_range_view:           { surface: 'Demographics', why: 'household income, same question' },
  parental_status_view:        { surface: 'Demographics', why: 'parental status, same question' },
  ad_group_audience_view:      { surface: 'Audiences', why: 'audience lists and segments — a targeting concept clients name separately from demographics' },

  // ── DESTINATION AND PLACEMENT ────────────────────────────────────────────────────────────────────────
  landing_page_view:           { surface: 'Landing pages', why: 'where the click went' },
  expanded_landing_page_view:  { surface: 'Landing pages', why: 'the same pages with the final URL expanded; not a distinction a client makes' },
  detail_placement_view:       { surface: 'Placements', why: 'the individual sites and apps ads appeared on' },
  group_placement_view:        { surface: 'Placements', why: 'the same, grouped by domain' },
  detail_content_suitability_placement_view: { surface: 'Placements', why: 'JUDGMENT CALL, FLAGGED: brand-safety content ratings are arguably their own surface, but they have never delivered a row on any account walked so far. Split it when they do.' },
  group_content_suitability_placement_view:  { surface: 'Placements', why: 'as above, grouped' },

  // ── VIDEO ─────────────────────────────────────────────────────────────────────────────────────────────
  video:                       { surface: 'Videos', why: 'video creative performance' },
  video_enhancement:           { surface: 'Videos', why: 'JUDGMENT CALL, FLAGGED: Google-generated video variants are a distinct thing, but a client reads them as part of "my videos".' },
}

export interface QualifierLabel {
  /** The slice, in client English, phrased to follow a surface: "Search terms" + "split by device". */
  label: string
  /**
   * ⛔ TRUE means this segment is the SAME FACT ROLLED UP IN TIME, not a different slice of it. Such a
   * family carries an empty label ON PURPOSE, and leg (e) of the guard demands the flag so that "no label"
   * can never be confused with "someone forgot to write one".
   *
   * ⚠ WHETHER A TIME-GRAIN FAMILY REPORTS SEPARATELY IS **NOT DECIDED HERE.** It matters: Foam OH's
   * December read found the daily family complete for all 25 days while `month` held 18, `quarter` 11 and
   * `year` 8 — so these families really can be partial on their own. But they are DERIVABLE from the daily
   * rows, so the reporting surface may legitimately recompute rather than re-walk them. That call belongs
   * to the reporting step; this table only records WHICH families are time grains.
   */
  timeGrain?: boolean
}

/**
 * ⛔ 80 DELIVERING SEGMENTS → THE SLICE HALF OF THE SENTENCE. A surface alone cannot carry the claim:
 * "Search terms are incomplete" is FALSE when only the split-by-device slice is missing, and that kind of
 * over-claim destroys trust as surely as silence does.
 *
 * ⛔ WHERE `docs/LORAMER_BREAKDOWN_REGISTRY.md` ALREADY HAS A WORD FOR A DIMENSION, THAT WORD IS USED —
 * device, hour, network, conversion action, keyword. Leg (g) pins those six mechanically. Two vocabularies
 * for one dimension is how a product ends up confusing the person it is explaining itself to.
 */
export const QUALIFIER_BY_SEGMENT: Record<string, QualifierLabel> = {
  // ── TIME GRAINS — the same fact rolled up. Empty label by design; see `timeGrain` above. ──────────────
  'segments.date':          { label: '', timeGrain: true },
  'segments.week':          { label: '', timeGrain: true },
  'segments.month':         { label: '', timeGrain: true },
  'segments.quarter':       { label: '', timeGrain: true },
  'segments.year':          { label: '', timeGrain: true },
  // ⛔ NOT time grains despite living on the clock: these answer "WHEN in the cycle", which is a question
  // clients actually ask (dayparting, seasonality) and which the registry already treats as a breakdown.
  'segments.hour':          { label: 'split by hour of day' },
  'segments.day_of_week':   { label: 'split by day of week' },
  'segments.month_of_year': { label: 'split by month of year' },

  // ── HOW AND WHERE THE AD SHOWED ──────────────────────────────────────────────────────────────────────
  'segments.device':                 { label: 'split by device' },
  'segments.ad_network_type':        { label: 'split by network' },
  'segments.ad_sub_network_type':    { label: 'split by network detail' },
  'segments.slot':                   { label: 'split by position on the page' },
  'segments.click_type':             { label: 'split by click type' },
  'segments.ad_format_type':         { label: 'split by ad format' },
  'segments.ad_destination_type':    { label: 'split by where the ad sent people' },
  'segments.ad_using_product_data':  { label: 'split by whether the ad used product data' },
  'segments.ad_using_video':         { label: 'split by whether the ad used video' },
  'segments.landing_page_source':    { label: 'split by landing page source' },
  'segments.search_engine_results_page_type': { label: 'split by results page type' },

  // ── MATCHING ─────────────────────────────────────────────────────────────────────────────────────────
  'segments.keyword.info.text':            { label: 'split by keyword' },
  'segments.keyword.ad_group_criterion':   { label: 'split by keyword' },
  'segments.keyword.info.match_type':      { label: 'split by match type' },
  'segments.match_type':                   { label: 'split by match type' },
  'segments.search_term_match_type':       { label: 'split by match type' },
  'segments.search_term_match_source':     { label: 'split by what the query matched against' },
  'segments.search_term_targeting_status': { label: 'split by whether the term is already targeted' },

  // ── CONVERSIONS ──────────────────────────────────────────────────────────────────────────────────────
  'segments.conversion_action':          { label: 'split by conversion action' },
  'segments.conversion_action_name':     { label: 'split by conversion action' },
  'segments.conversion_action_category': { label: 'split by conversion category' },
  'segments.external_conversion_source': { label: 'split by where the conversion was recorded' },
  'segments.conversion_adjustment':      { label: 'split by whether the conversion was later adjusted' },
  'segments.conversion_attribution_event_type': { label: 'split by click or view' },
  'segments.conversion_lag_bucket':               { label: 'split by how long the conversion took' },
  'segments.conversion_or_adjustment_lag_bucket': { label: 'split by how long the conversion or adjustment took' },
  'segments.new_versus_returning_customers':      { label: 'split by new versus returning customers' },

  // ── CREATIVE INTERACTION ─────────────────────────────────────────────────────────────────────────────
  'segments.asset_interaction_target.asset': { label: 'split by which asset was interacted with' },
  'segments.asset_interaction_target.interaction_on_this_asset': { label: 'split by whether the interaction was on this asset' },

  // ── PLACE ────────────────────────────────────────────────────────────────────────────────────────────
  // Registry stems reused: geo_country → country, geo_region → region, and the finer ones follow the same
  // pattern rather than inventing a parallel naming scheme.
  'segments.geo_target_city':                  { label: 'split by city' },
  'segments.geo_target_state':                 { label: 'split by state' },
  'segments.geo_target_region':                { label: 'split by region' },
  'segments.geo_target_province':              { label: 'split by province' },
  'segments.geo_target_canton':                { label: 'split by canton' },
  'segments.geo_target_county':                { label: 'split by county' },
  'segments.geo_target_district':              { label: 'split by district' },
  'segments.geo_target_metro':                 { label: 'split by metro area' },
  'segments.geo_target_postal_code':           { label: 'split by postal code' },
  'segments.geo_target_airport':               { label: 'split by nearest airport' },
  'segments.geo_target_most_specific_location': { label: 'split by most specific location' },
  'segments.travel_destination_city':    { label: 'split by travel destination city' },
  'segments.travel_destination_region':  { label: 'split by travel destination region' },
  'segments.travel_destination_country': { label: 'split by travel destination country' },

  // ── SHOPPING PRODUCT ATTRIBUTES — Google's own UI words, which are already client vocabulary ─────────
  'segments.product_item_id':      { label: 'split by product ID' },
  'segments.product_title':        { label: 'split by product title' },
  'segments.product_brand':        { label: 'split by brand' },
  'segments.product_condition':    { label: 'split by product condition' },
  'segments.product_channel':      { label: 'split by online or in-store' },
  'segments.product_channel_exclusivity': { label: 'split by whether the product sells online only' },
  'segments.product_country':      { label: 'split by country of sale' },
  'segments.product_language':     { label: 'split by product language' },
  'segments.product_feed_label':   { label: 'split by feed label' },
  'segments.product_merchant_id':  { label: 'split by merchant account' },
  'segments.product_store_id':     { label: 'split by store' },
  'segments.product_aggregator_id': { label: 'split by aggregator' },
  'segments.product_category_level1': { label: 'split by product category, level 1' },
  'segments.product_category_level2': { label: 'split by product category, level 2' },
  'segments.product_category_level3': { label: 'split by product category, level 3' },
  'segments.product_category_level4': { label: 'split by product category, level 4' },
  'segments.product_category_level5': { label: 'split by product category, level 5' },
  'segments.product_type_l1': { label: 'split by product type, level 1' },
  'segments.product_type_l2': { label: 'split by product type, level 2' },
  'segments.product_type_l3': { label: 'split by product type, level 3' },
  'segments.product_type_l4': { label: 'split by product type, level 4' },
  'segments.product_type_l5': { label: 'split by product type, level 5' },
  // Google's UI calls these "custom label 0..4"; the API name is the only place they read as attributes.
  'segments.product_custom_attribute0': { label: 'split by custom label 0' },
  'segments.product_custom_attribute1': { label: 'split by custom label 1' },
  'segments.product_custom_attribute2': { label: 'split by custom label 2' },
  'segments.product_custom_attribute3': { label: 'split by custom label 3' },
  'segments.product_custom_attribute4': { label: 'split by custom label 4' },

  // ── BUDGET ASSOCIATION ───────────────────────────────────────────────────────────────────────────────
  'segments.budget_campaign_association_status.campaign': { label: 'split by the campaign the budget serves' },
  'segments.budget_campaign_association_status.status':   { label: 'split by whether the budget is still attached' },
}

/** The distinct surfaces, for a report that lists what is current and what is not. */
export function allSurfaces(): string[] {
  return [...new Set(Object.values(SURFACE_BY_RESOURCE).map((s) => s.surface))].sort()
}

/**
 * The report line for one catalog entry: **"Search terms, split by device"**.
 *
 * ⛔ RETURNS null WHEN EITHER HALF IS UNKNOWN, and callers must treat that as UNREPORTABLE rather than
 * skipping the entry. An entry that cannot be named is still incomplete; dropping it silently is the
 * failure this whole table exists to prevent, and the guard is what keeps null from ever occurring in
 * practice for a delivering entry.
 */
export function reportLabel(resource: string, segment: string | null): string | null {
  const surface = SURFACE_BY_RESOURCE[resource]
  if (!surface) return null
  if (!segment) return surface.surface
  const qual = QUALIFIER_BY_SEGMENT[segment]
  if (!qual) return null
  return qual.label ? `${surface.surface}, ${qual.label}` : surface.surface
}

/**
 * ⛔ AN UNKNOWN RESOURCE RETURNS null AND MUST NEVER BE SILENTLY DROPPED. The catalog is regenerated from
 * GoogleAdsFieldService, so Google can add a resource at any time; the guard fails the build when a
 * delivering one is unlabelled, and this returns null so a caller cannot mistake absence for coverage.
 */
export function surfaceFor(resource: string): SurfaceLabel | null {
  return SURFACE_BY_RESOURCE[resource] ?? null
}
