// LORAMER_REFUSED_RATIO_IS_NULL_V1 — GENERATED FROM docs/google-ads-capture-universe.json. DO NOT HAND-EDIT.
//   node scripts/build-refused-metrics.mjs
//
// ⛔ WHICH METRICS GOOGLE REFUSES AT WHICH GRAIN, keyed `${breakdown_type}|${entity_level}`.
//
// ⛔ WHY THE READ PATH CANNOT USE THE ROW'S OWN STAMP INSTEAD. queryBreakdown has two aggregation paths and
// the fast one is a SQL GROUP BY (`query_breakdown_agg`, migration 038) that returns SUMS ONLY — `extra`
// never crosses the wire. A read-path defence built on the per-row stamp would therefore work on the JS
// paging path and SILENTLY NOT WORK on the SQL path, which is the one that runs for every large breakdown.
// Refusal is a property of the (resource, segment) GRAIN, not of an individual row — the artifact says so and
// the writer decides it the same way — so keying on the grain is both correct and path-independent.
//
// ⛔ REFUSAL VARIES BY entity_level ON 10 OF 111 TYPES, which is why the key is a PAIR. A map keyed on
// breakdown_type alone would be wrong for exactly those ten and right everywhere else — the worst shape.
export const GOOGLE_REFUSED_METRICS: Record<string, string[]> = {
  "ad_destination_type|ad_group": ["impressions"],
  "ad_destination_type|ad_group_ad": ["impressions"],
  "ad_destination_type|campaign": ["impressions"],
  "ad_group_ad_asset_combination_view|ad_group_ad_asset_combination_view": ["clicks","conversion_value","conversions","spend"],
  "ad_network_type|ad_group_ad_asset_combination_view": ["clicks","conversion_value","conversions","spend"],
  "ad_sub_network_type|ad_group_ad_asset_combination_view": ["clicks","conversion_value","conversions","spend"],
  "conversion_action_category|ad_group_asset": ["clicks","impressions","spend"],
  "conversion_action_category|asset_field_type_view": ["clicks","impressions","spend"],
  "conversion_action_category|asset_group_product_group_view": ["clicks","impressions","spend"],
  "conversion_action_category|campaign_asset": ["clicks","impressions","spend"],
  "conversion_action_category|campaign_budget": ["clicks","impressions","spend"],
  "conversion_action_category|campaign_search_term_view": ["clicks","impressions","spend"],
  "conversion_action_category|customer_asset": ["clicks","impressions","spend"],
  "conversion_action_category|expanded_landing_page_view": ["clicks","impressions","spend"],
  "conversion_action_category|income_range_view": ["clicks","impressions","spend"],
  "conversion_action_category|landing_page_view": ["clicks","impressions","spend"],
  "conversion_action_category|location_view": ["clicks","impressions","spend"],
  "conversion_action_category|parental_status_view": ["clicks","impressions","spend"],
  "conversion_action_category|shopping_performance_view": ["clicks","impressions","spend"],
  "conversion_action_name|ad_group_asset": ["clicks","impressions","spend"],
  "conversion_action_name|asset_field_type_view": ["clicks","impressions","spend"],
  "conversion_action_name|asset_group_product_group_view": ["clicks","impressions","spend"],
  "conversion_action_name|campaign_asset": ["clicks","impressions","spend"],
  "conversion_action_name|campaign_budget": ["clicks","impressions","spend"],
  "conversion_action_name|campaign_search_term_view": ["clicks","impressions","spend"],
  "conversion_action_name|customer_asset": ["clicks","impressions","spend"],
  "conversion_action_name|expanded_landing_page_view": ["clicks","impressions","spend"],
  "conversion_action_name|income_range_view": ["clicks","impressions","spend"],
  "conversion_action_name|landing_page_view": ["clicks","impressions","spend"],
  "conversion_action_name|location_view": ["clicks","impressions","spend"],
  "conversion_action_name|parental_status_view": ["clicks","impressions","spend"],
  "conversion_action_name|shopping_performance_view": ["clicks","impressions","spend"],
  "conversion_action|ad_group_asset": ["clicks","impressions","spend"],
  "conversion_action|asset_field_type_view": ["clicks","impressions","spend"],
  "conversion_action|asset_group_product_group_view": ["clicks","impressions","spend"],
  "conversion_action|campaign_asset": ["clicks","impressions","spend"],
  "conversion_action|campaign_budget": ["clicks","impressions","spend"],
  "conversion_action|campaign_search_term_view": ["clicks","impressions","spend"],
  "conversion_action|customer_asset": ["clicks","impressions","spend"],
  "conversion_action|expanded_landing_page_view": ["clicks","impressions","spend"],
  "conversion_action|income_range_view": ["clicks","impressions","spend"],
  "conversion_action|landing_page_view": ["clicks","impressions","spend"],
  "conversion_action|location_view": ["clicks","impressions","spend"],
  "conversion_action|parental_status_view": ["clicks","impressions","spend"],
  "conversion_action|shopping_performance_view": ["clicks","impressions","spend"],
  "conversion_adjustment|campaign": ["clicks","impressions","spend"],
  "conversion_attribution_event_type|campaign": ["clicks","impressions","spend"],
  "conversion_lag_bucket|campaign": ["clicks","impressions","spend"],
  "conversion_or_adjustment_lag_bucket|campaign": ["clicks","impressions","spend"],
  "detail_content_suitability_placement_view|detail_content_suitability_placement_view": ["clicks","conversion_value","conversions"],
  "device|paid_organic_search_term_view": ["conversion_value","conversions","spend"],
  "external_conversion_source|ad_group_asset": ["clicks","impressions","spend"],
  "external_conversion_source|asset_field_type_view": ["clicks","impressions","spend"],
  "external_conversion_source|asset_group_product_group_view": ["clicks","impressions","spend"],
  "external_conversion_source|campaign": ["clicks","impressions","spend"],
  "external_conversion_source|campaign_asset": ["clicks","impressions","spend"],
  "external_conversion_source|campaign_budget": ["clicks","impressions","spend"],
  "external_conversion_source|campaign_search_term_view": ["clicks","impressions","spend"],
  "external_conversion_source|customer_asset": ["clicks","impressions","spend"],
  "external_conversion_source|expanded_landing_page_view": ["clicks","impressions","spend"],
  "external_conversion_source|income_range_view": ["clicks","impressions","spend"],
  "external_conversion_source|landing_page_view": ["clicks","impressions","spend"],
  "external_conversion_source|location_view": ["clicks","impressions","spend"],
  "external_conversion_source|parental_status_view": ["clicks","impressions","spend"],
  "external_conversion_source|shopping_performance_view": ["clicks","impressions","spend"],
  "group_content_suitability_placement_view|group_content_suitability_placement_view": ["clicks","conversion_value","conversions"],
  "keyword_ad_group_criterion|paid_organic_search_term_view": ["conversion_value","conversions","spend"],
  "keyword_info_match_type|paid_organic_search_term_view": ["conversion_value","conversions","spend"],
  "keyword_info_text|paid_organic_search_term_view": ["conversion_value","conversions","spend"],
  "month_of_year|ad_group": ["conversion_value","conversions"],
  "month_of_year|ad_group_ad": ["conversion_value","conversions"],
  "month_of_year|ad_group_asset": ["conversion_value","conversions"],
  "month_of_year|ad_group_audience_view": ["conversion_value","conversions"],
  "month_of_year|age_range_view": ["conversion_value","conversions"],
  "month_of_year|asset_field_type_view": ["conversion_value","conversions"],
  "month_of_year|asset_group_product_group_view": ["conversion_value","conversions"],
  "month_of_year|campaign": ["conversion_value","conversions"],
  "month_of_year|campaign_asset": ["conversion_value","conversions"],
  "month_of_year|campaign_search_term_view": ["conversion_value","conversions"],
  "month_of_year|customer": ["conversion_value","conversions"],
  "month_of_year|customer_asset": ["conversion_value","conversions"],
  "month_of_year|detail_placement_view": ["conversion_value","conversions"],
  "month_of_year|expanded_landing_page_view": ["conversion_value","conversions"],
  "month_of_year|gender_view": ["conversion_value","conversions"],
  "month_of_year|geographic_view": ["conversion_value","conversions"],
  "month_of_year|group_placement_view": ["conversion_value","conversions"],
  "month_of_year|income_range_view": ["conversion_value","conversions"],
  "month_of_year|keyword_view": ["conversion_value","conversions"],
  "month_of_year|landing_page_view": ["conversion_value","conversions"],
  "month_of_year|location_view": ["conversion_value","conversions"],
  "month_of_year|paid_organic_search_term_view": ["conversion_value","conversions","spend"],
  "month_of_year|parental_status_view": ["conversion_value","conversions"],
  "month_of_year|product_group_view": ["conversion_value","conversions"],
  "month_of_year|search_term_view": ["conversion_value","conversions"],
  "month_of_year|user_location_view": ["conversion_value","conversions"],
  "month_of_year|video": ["conversion_value","conversions"],
  "new_versus_returning_customers|campaign": ["clicks","impressions","spend"],
  "new_versus_returning_customers|location_view": ["clicks","impressions","spend"],
  "paid_organic_search_term_view|paid_organic_search_term_view": ["conversion_value","conversions","spend"],
  "performance_max_placement_view|performance_max_placement_view": ["clicks","conversion_value","conversions","spend"],
  "search_engine_results_page_type|paid_organic_search_term_view": ["conversion_value","conversions","spend"],
  "slot|ad_group_ad_asset_combination_view": ["clicks","conversion_value","conversions","spend"],
}

/** Refused metric names for a grain, or an empty array. Unknown grain = nothing refused (never a guess). */
export function refusedMetricsFor(platform: string, breakdownType: string, entityLevel?: string | null): string[] {
  if (platform !== 'google' || !entityLevel) return []
  return GOOGLE_REFUSED_METRICS[`${breakdownType}|${entityLevel}`] || []
}

/** The six derived ratios and the metrics each is built from. A ratio is UNAVAILABLE if EITHER side is refused. */
export const RATIO_INPUTS: Record<string, [string, string]> = {
  ctr: ['clicks', 'impressions'], cpc: ['spend', 'clicks'], cpm: ['spend', 'impressions'],
  roas: ['conversion_value', 'spend'], cpa: ['spend', 'conversions'], convRate: ['conversions', 'clicks'],
}

/**
 * ⛔ THE READ-PATH SUPPRESSION, AS A PURE FUNCTION SO A GUARD CAN EXECUTE IT.
 * Written inline in metrics-query it could only be guarded by searching the source for a name — and that
 * exact shape went green over broken behaviour three times in 24 hours
 * (★CODE-HYGIENE-SWEEP-KNOWN-HAZARDS item 3). A decision that must be guarded has to be callable.
 *
 * ⛔ IT LIVES IN THE GENERATOR TEMPLATE, NOT APPENDED TO THE OUTPUT. It was first hand-appended to the
 * generated file and the very next regeneration DELETED IT — caught only because the guard drives the
 * function rather than grepping for it. Nothing may be added to a generated file except through its
 * generator.
 *
 * Returns metrics and derived ratios with every refused value replaced by null:
 *   · a REFUSED METRIC becomes null — not zero, so a caller cannot sum or divide it
 *   · a RATIO becomes null when EITHER input is refused, not only the denominator. CPC = spend/clicks is
 *     meaningless if either side is missing, and a half-real ratio is worse than none.
 */
export function applyRefusal(
  metrics: Record<string, number>,
  derived: Record<string, number | null>,
  refused: string[]
): { metrics: Record<string, number | null>; derived: Record<string, number | null> } {
  const r = new Set(refused)
  const outM: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(metrics)) outM[k] = r.has(k) ? null : v
  const outD: Record<string, number | null> = { ...derived }
  for (const [name, [numer, denom]] of Object.entries(RATIO_INPUTS)) {
    if (r.has(numer) || r.has(denom)) outD[name] = null
  }
  return { metrics: outM, derived: outD }
}
