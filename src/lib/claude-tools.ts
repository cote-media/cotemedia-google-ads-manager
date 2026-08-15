// LORAMER_QUERY_METRICS_SHARED_LOOP_V1
// LORAMER_QUERY_METRICS_DATE_FLEX_V1 - query_metrics now accepts explicit
// `windows` (arbitrary YYYY-MM-DD date ranges). Description rewritten so the
// model translates specific calendar periods (quarters/months/years) to exact
// dates itself. Additive; baseRange/offsetsMonths path unchanged.
// Single source of truth for Claude's tools and the capped tool-use loop.
// Consumed by /api/chat (Sonnet) and /api/insight follow-ups (Sonnet) so the two
// surfaces cannot drift (handoff lesson 26). clientId is injected server-side by
// the caller - it is NEVER a model-controlled input.

import { queryMetrics, queryBreakdown, queryMoney, queryEntities } from '@/lib/metrics-query' // queryEntities: LORAMER_LORA_NAMED_ENTITY_READ_V1
// LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B) — the query_breakdown enums are GENERATED from the ONE declared
// source (breakdown-registry.ts), never hand-written, so the tool schema and the query layer cannot drift.
import { breakdownToolTypes, breakdownPlatforms, breakdownEntityLevels, geoGrains, geoScopes, platformsForToolType, allAdditiveExtraKeys } from '@/lib/breakdown-registry'
// LORAMER_LORA_COVERAGE_V1 — coverage FACT (state) for the query_metrics tool layer ONLY (queryMetrics untouched).
import { getCoverageForWindows, coverageNotes, getBreakdownCoverage, breakdownCoverageNote, getDensityForWindow, DENSITY_HOLE_RUN_DAYS } from '@/lib/next/coverage' // density: LORAMER_COVERAGE_DENSITY_V1
import { bindWindow, bindRanking, bindMoney, combineRankingVerdict } from '@/lib/lora/coverage-binding' // LORAMER_BINDING_COVERAGE_V1 + LORAMER_BREAKDOWN_MONEY_BINDING_V1 — the pure verdict-gating deciders
import { annotateContribution } from '@/lib/next/query-completeness' // LORAMER_LORA_INCOMPLETE_TOTAL_V1 (T0#2 slice 1)
import { resolveAccess, listAccessibleClientsWithNames } from '@/lib/access/can-access'
import { logToolDecision } from '@/lib/lora-tool-log' // LORAMER_LORA_TOOL_DECISION_LOG_V1 — L2-retrieval instrument (fire-and-forget)
import { toolSubject } from '@/lib/chat/tool-subject' // LORAMER_CHAT_STATUS_SUBJECT_V1 — subject, never raw tool args

// LORAMER_QUERY_METRICS_OWNERSHIP_V1 / LORAMER_RBAC_ACCESS_ORG_V1
// Defense-in-depth ACCESS check (the routes also gate before calling the loop). Now membership/org-AWARE via
// resolveAccess (owner ∪ org-grant ∪ legacy client_members), not owner-only — so a GRANTED member gets the tools.
// The query tools read metrics_daily BY clientId (owner-agnostic data), so a member's read == the owner's; no
// owner-keyed data is read here. Fails CLOSED: any error / no access → false → tools withheld, single-shot loop.
async function viewerCanAccess(viewerEmail: string, clientId: string): Promise<boolean> {
  if (!viewerEmail || !clientId) return false
  const a = await resolveAccess(clientId, viewerEmail)
  return !!a?.ok
}

export const QUERY_METRICS_TOOL: any = {
  name: 'query_metrics',
  description:
    'Query LoraMer\u2019s historical store for aggregated advertising/commerce metrics over one or more time windows for the CURRENT client. Data is read from our own database (not a live fetch), so it is fast and covers paused or historical periods, including periods older than the ad platforms themselves retain. Returns spend, impressions, clicks, conversions, conversionValue, revenue and rowCount per window, plus derived CTR/CPC/CPA/ROAS/AOV. REVENUE & ROAS — READ THIS: for any total-revenue or ROAS answer use `canonical` — canonical.revenue and canonical.roas are the figures that MATCH THE DASHBOARD CARDS (revenue precedence store > ga > none, NEVER summed; roas = revenue/spend). `totals.revenue` is a RAW cross-platform SUM that double-counts store + GA — NEVER report totals.revenue as the total revenue. `bySource` breaks revenue/spend out by origin (store, ga, google, meta), each labeled — when more than one revenue source is present, surface them ALL with their own ROAS and explain why they differ. `derived.roas` is AD-ATTRIBUTED (platform conversionValue/spend) and is NOT the card ROAS. ⛔ COMPLETENESS IS STRUCTURAL, NOT ADVISORY — READ THE SHAPE OF WHAT COMES BACK. Every window carries `coverageVerdict` (COMPLETE / PARTIAL / UNKNOWN) and `answerable`. THE FIGURE MOVES DEPENDING ON THE VERDICT, and that is deliberate: (1) COMPLETE — `totals` and `canonical` are present as normal and the window is fully answerable; if it also carries `zeroIsReal: true` the account GENUINELY had no activity and you should say so plainly as a real zero. (2) PARTIAL — THERE IS NO `totals` KEY. The numbers are on `partialTotals` / `partialCanonical`, and a `withheld` object carries the reason and a `mustSay` directive. Report partialTotals ONLY as the covered portion, name the platform and reason from `contribution[]`, and NEVER present it as the window total. (3) UNKNOWN — THERE IS NO `totals` KEY. The numbers are on `unverifiedTotals` and `withheld.reason` says why coverage could not be measured; label any figure you give as UNVERIFIED and never treat a zero here as a real zero. A missing `totals` key is the system telling you the number is not safe to state as a whole figure — it is not an error and you must not reconstruct a total from the parts. Each window also carries `contribution[]` (platform + status: ok / capture_failing / trailing_gap / predates_capture / draining / not_connected); a platform whose status is capture_failing / trailing_gap / predates_capture is NOT $0 — its data simply was not captured. Non-account grains additionally carry `grainCoverage`: a grain can have its OWN floor inside a window the account covers, so a breakdown-level claim needs the grain’s verdict, never the account’s. There are two MUTUALLY EXCLUSIVE ways to specify time. (1) For ANY specific calendar period - a quarter, a named month, a year, or any arbitrary explicit range - translate it to exact YYYY-MM-DD dates YOURSELF and pass them in `windows`, one object per period you want compared. Examples: "Q4 2024" -> [{label:"Q4 2024",startDate:"2024-10-01",endDate:"2024-12-31"}]; "compare Q4 2024 to Q4 2025" -> two window objects. Label each window for the exact dates it covers and NEVER relabel a different span as the requested period. (2) For rolling recent-vs-prior comparisons only, use `baseRange` (a preset such as LAST_30_DAYS) together with `offsetsMonths`. If `windows` is provided, `baseRange` and `offsetsMonths` are ignored. Prefer this tool over reasoning from numbers already in your context whenever the question involves a specific historical period or a period-over-period comparison.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: {
        type: 'string',
        description: 'The target client’s id, taken ONLY from the "clients you can access" list in your instructions. REQUIRED at the agency / all-clients view (no client is selected). At a single-client view it is IGNORED — the current client is always used. Never invent an id.', // LORAMER_AGENCY_SCOPE_LORA_V1
      },
      platform: {
        type: 'string',
        enum: ['google', 'meta', 'shopify', 'woocommerce', 'ga', 'all'],
        description: 'Which platform to query. Use "all" (default) to query every connected platform in ONE call: the result’s `canonical` gives the correctly-settled total (store>ga>none, never summed) and `bySource` the labeled per-source split. Do NOT read the raw `totals.revenue` as the total (it double-counts store+GA). Defaults to all if omitted.',
      },
      level: {
        type: 'string',
        enum: ['account', 'campaign', 'ad_group', 'ad_set', 'ad', 'product', 'variant'],
        description: 'Aggregation level. Default "account" (whole-account totals). "product" and "variant" are the commerce grains (Shopify/Woo — variant = a product’s SKU/variation). Note: only account-level history is broadly backfilled today; deeper levels exist mainly from the connect date forward.',
      },
      baseRange: {
        type: 'string',
        description: 'Rolling-comparison mode only (ignored when `windows` is set). The primary / most-recent window, as a preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, or LAST_MONTH. Default LAST_7_DAYS.',
      },
      offsetsMonths: {
        type: 'array',
        items: { type: 'number' },
        description: 'Rolling-comparison mode only (ignored when `windows` is set). Month offsets for comparison windows; 0 is the base window itself. Each offset produces an equal-length window ending that many calendar months before the base window. Example: [0, 6, 12, 18].',
      },
      windows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Human-readable label naming the period exactly as the user referred to it, e.g. "Q4 2024".',
            },
            startDate: {
              type: 'string',
              description: 'Inclusive start date in YYYY-MM-DD format.',
            },
            endDate: {
              type: 'string',
              description: 'Inclusive end date in YYYY-MM-DD format.',
            },
          },
          required: ['startDate', 'endDate'],
        },
        description: 'Explicit, fully-specified comparison windows for any specific calendar period or arbitrary range. Translate the period to exact YYYY-MM-DD dates yourself and pass one object per window. Example: "Q4 2024" -> [{label:"Q4 2024",startDate:"2024-10-01",endDate:"2024-12-31"}]. When provided, baseRange and offsetsMonths are ignored (mutually exclusive).',
      },
    },
    required: [],
  },
}

// LORAMER_QUERY_BREAKDOWN_V1 — sibling of query_metrics for the DIMENSIONAL grain
// (individual search terms, keywords, and the existing Meta publisher_platform/age/
// gender rows). Reads only breakdown rows (never base rows), so it cannot be summed
// against query_metrics' account/campaign totals.
export const QUERY_BREAKDOWN_TOOL: any = {
  name: 'query_breakdown',
  description:
    'List the TOP breakdown values for the CURRENT client over a SINGLE time window, ranked by a metric, from LoraMer’s historical store. Use this for "top search terms" (the actual queries people typed that triggered ads), "top keywords" (the keywords you bid on), or Meta/Google breakdowns (placement, age, gender, device, hour, action_type/conversion_action). Returns up to topN rows, each with the value text, summed spend/impressions/clicks/conversions/conversionValue and derived CTR/CPC/CPA/ROAS, plus distinctValueCount and a truncated flag. CRITICAL: these values are a SUBSET of the entity’s activity — their summed spend is LESS THAN the account or campaign total and you must describe them as "top search terms/keywords", NEVER as the account’s or campaign’s total spend. If rows is empty or the note says no data, tell the user that no data of that kind was captured for that period — do NOT infer or invent values from anything else in context. Scope to a campaign or ad group by passing parentEntityId or entityId. This is for ranking within one window; for whole-account or period-over-period TOTALS use query_metrics instead. COMPLETENESS — READ THIS BEFORE STATING A RANKING: every result carries "breakdownCoverage" with a verdict of COMPLETE, PARTIAL or UNKNOWN, and when it is not COMPLETE a "coverageNote" tells you what to say. PARTIAL means some days on which the platform DID report activity carry NO rows for this family — the ranking is computed over an incomplete window, so state that it is partial and name the gap, and never treat a value missing from the list as proof it did not occur. UNKNOWN carries an "unknownReason" and they are NOT interchangeable: "read_failed" is a failure on OUR side (say the completeness could not be measured; never claim the ranking is complete and never say the account was inactive), "not_connected" means the platform is not connected, "never_captured" means capture has never run for it so an empty ranking says NOTHING about the account, "unattested_absence" means the window holds NO captured base rows AND NO vendor attestation — report it as NOT CAPTURED / activity cannot be confirmed, NEVER as "genuinely inactive" and NEVER as a real zero (it may be a capture hole), and "no_activity_in_window" is VENDOR-ATTESTED inactivity — the vendor was asked and answered nothing for every day, so an empty ranking IS real and you may say the account was inactive. COMPLETE carries no note and needs no caveat. STRUCTURE — the verdict gates the payload, not just the note: on a COMPLETE window `rows` is present as usual; on PARTIAL the ranking lives on `partialRows` and on UNKNOWN on `unverifiedRows`, each with a `withheld {reason, mustSay}` — follow mustSay verbatim, and never present partialRows/unverifiedRows as the complete ranking.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: {
        type: 'string',
        description: 'The target client’s id, taken ONLY from the "clients you can access" list in your instructions. REQUIRED at the agency / all-clients view; IGNORED at a single-client view (the current client is used). Never invent an id.', // LORAMER_AGENCY_SCOPE_LORA_V1
      },
      breakdownType: {
        type: 'string',
        enum: breakdownToolTypes(),
        description: 'Which dimension to list. GOOGLE ads: search_term, keyword, conversion_action, impression_share, device, hour, and the GEO family via breakdownType "geo" + geoGrain + geoScope (city/county/metro/state/province/district/postal/most_specific/region). META ads: placement (publisher:position), age, gender, age_gender, device_platform, action_type, video, device, hour. GA4 SITE ANALYTICS (pass platform "ga"): ga_source_medium, ga_channel, ga_campaign, ga_landing_page, ga_device, ga_geo_country, ga_geo_region, ga_geo_city, ga_age, ga_gender, ga_event, ga_item — these are SITE analytics (sessions/users/revenue), NOT ad spend. CROSS-PLATFORM: geo_country/geo_region are on Shopify (ship-to, the default) AND Meta AND Google (pass platform). CAVEAT platform="google" hour: hour "00" is a Google CATCH-ALL absorbing the full-day spend of campaigns without hourly segmentation (Display, some Performance Max) — inflated, NOT genuine midnight; never call hour 0 a dayparting peak or suggest a midnight bid-down. action_type/conversion_action carry per-action conversions, not spend — ranked by conversions. NON-ADDITIVE per-entity families (metrics under nonAdditiveMetrics): impression_share (per Google campaign — POINT-IN-TIME, most-recent day in-window) and video (per Meta entity — view counts summed + avg-time/cost-per-thruplay rates null across multi-day windows). COMMERCE (Shopify/Woo — pass platform; account grain; these carry revenue and orders, never ad spend): sales_channel, discount_code, discount_type, coupon_code, coupon_type, order_status, order_time, financial_status, fulfillment_status, payment_method, shipping_method, abandoned_checkout, customer_cohort, product_type, product_vendor, product_tag, product_category, product_collection, geo_city. META CREATIVE ASSETS (campaign/ad_set/ad — WHICH creative element was served, the input to "what creative is working"): image_asset, video_asset, title_asset, body_asset, description_asset, call_to_action_asset, link_url_asset, ad_format_asset, flexible_format_asset_type, creative_relaxation_asset_type, gen_ai_asset_type. META OTHER: attribution_window (per-window decomposition of every action_type), product_id (catalog grain), comscore_market. (Product/variant performance → query_metrics with level="product"/"variant".) ══ GOOGLE ADS VENDOR SURFACE (LORAMER_UNIVERSE_ENTITY_AXIS_V1 — captured by the universe walk; entityLevel for these is the GOOGLE REPORT RESOURCE the row came from, e.g. shopping_performance_view or campaign, NOT account/campaign/ad_group — pass the resource name as entityLevel, and if you are unsure omit it and read what comes back): SHOPPING AND MERCHANT FEED, the answer to what is actually selling and at what margin-relevant grain — shopping_performance_view, product_item_id, product_title, product_brand, product_type_l1, product_type_l2, product_type_l3, product_type_l4, product_type_l5, product_category_level1, product_category_level2, product_category_level3, product_category_level4, product_category_level5, product_condition, product_channel, product_channel_exclusivity, product_country, product_language, product_feed_label, product_store_id, product_merchant_id, product_aggregator_id, product_custom_attribute0, product_custom_attribute1, product_custom_attribute2, product_custom_attribute3, product_custom_attribute4, product_group_view, asset_group_product_group_view. SEARCH TERMS AND KEYWORD MATCHING, what people actually typed versus what you bought — campaign_search_term_view, paid_organic_search_term_view, search_term_match_type, search_term_match_source, search_term_targeting_status, search_engine_results_page_type, keyword_info_text, keyword_info_match_type, keyword_ad_group_criterion, match_type. PLACEMENTS, where a Display, Video or Performance Max impression physically ran — detail_placement_view, group_placement_view, performance_max_placement_view, detail_content_suitability_placement_view, group_content_suitability_placement_view. ASSETS AND CREATIVE, which element was served and what it did — campaign_asset, ad_group_asset, customer_asset, asset_field_type_view, ad_group_ad_asset_combination_view, asset_interaction_target_asset, asset_interaction_target_interaction_on_this_asset, video, video_enhancement. LANDING PAGES, where the click went — landing_page_view, expanded_landing_page_view, landing_page_source. AUDIENCE AND DEMOGRAPHICS beyond age and gender — ad_group_audience_view, income_range_view, parental_status_view, new_versus_returning_customers. VENDOR-NAMED GEO, the raw Google geo target grains that sit under the collapsed geo family — location_view, geo_target_state, geo_target_county, geo_target_region, geo_target_metro, geo_target_district, geo_target_postal_code, geo_target_airport, geo_target_most_specific_location. CONVERSION MECHANICS, how a conversion was counted rather than how many — conversion_action_name, conversion_action_category, conversion_attribution_event_type, conversion_adjustment, conversion_lag_bucket, conversion_or_adjustment_lag_bucket, external_conversion_source. ⛔ THE date FAMILY IS NOT A SEPARATE SHELF — use the BASE rows. A `date` breakdown exists in older stored data and still resolves, but it is no longer written: it was one row per entity per day, which is exactly what the base rows already are, so ask for the base family (or query_metrics) and read the date column. Proven lossless on real data before it was retired — every (entity, date, metric) it carried is present in the base family with identical values. ⛔ TIME AXES coarser than day — day_of_week, week, month, quarter, year (plus month_of_year, which IS still requested from Google) — ARE COMPUTED BY US, NOT REPORTED BY GOOGLE, and you must say so if a user asks where a weekly or monthly figure came from. We stopped requesting them because each is a pure function of the row date, and we now aggregate them locally from the same data: every such row carries extra.provenance="COMPUTED_FROM_DATE" plus the exact derivation rule on the row itself, versus "VENDOR_REPORTED" elsewhere. The definitions were measured against Google own rows with zero mismatches, not assumed: WEEK STARTS MONDAY (ISO, the row value is that Monday date), QUARTER IS CALENDAR not fiscal, day_of_week is Google numeric enum where MONDAY=2 and SUNDAY=8. These are TRUE AGGREGATES — one row per entity per period — whereas Google own version was one row per entity per DAY wearing a period label, so do not expect a row count to match a daily count. The numbers reconcile exactly either way; only the provenance and the grain differ. NETWORK, SLOT AND AD FORM — ad_network_type, ad_sub_network_type, click_type, slot, ad_destination_type, ad_format_type, ad_using_video, ad_using_product_data. BUDGET — campaign_budget, budget_campaign_association_status_campaign, budget_campaign_association_status_status. TRAVEL — travel_destination_city, travel_destination_region, travel_destination_country. SURFACED BY THE 2026-08-03 RE-PROBE, and the geo ones are the highest-cardinality data in the whole system — ⛔ ALWAYS rank and limit these, never ask for a full list: geo_target_city (16,067 distinct values on the probe account in ONE month via geographic_view, 16,772 via user_location_view), geo_target_province, geo_target_canton, and the two RESOURCES that serve them, geographic_view (AD-location: where you TARGETED) and user_location_view (USER-location: where the person PHYSICALLY WAS — these are different questions and conflating them yields a confident wrong answer). ALSO NEW: the base grains of the core reporting resources themselves — campaign and ad_group are covered above, plus ad_group_ad (the ad grain), ad_group_ad_asset_view, asset_group, asset_group_asset, keyword_view, search_term_view, age_range_view, gender_view, customer (the account grain as Google names it), and the date axis. ⛔⛔ SOME OF THESE FAMILIES REPORT CONVERSIONS ONLY, AND THEIR spend/clicks/impressions ARE UNAVAILABLE — NOT ZERO. Measured 2026-08-03: of the 358 entries the walk requests, 100 are PARTIAL and 59 of those serve ONLY conversions and conversionValue because Google REFUSES cost, clicks and impressions at that grain. The stored columns read 0 because the database forbids null there — that 0 IS NOT A ZERO. Every affected row carries extra.refusedMetrics (which columns are fake), extra.metricsReported (which are real), extra.refusedReason (the vendor own words, verbatim) and extra.refusedCode. ⛔ NEVER present a refused metric as 0, never sum one, and NEVER compute a ratio from one — no ROAS, no CPA, no CPC, no CTR built on a refused numerator or denominator. A ratio on a refused denominator is a confident wrong number, which is the single worst thing you can hand a user. If asked for spend or ROAS on such a family, say plainly that Google does not report it at that grain and offer the conversion figures you DO have, or the same question at a grain that reports spend. The families where cost is refused at EVERY grain are already ranked by conversions and say so in their note; the ones refused at only SOME grains cannot be judged from the family name at all — you must read extra.refusedMetrics on the rows you got back. ⛔ These families are NEWLY WIRED and the walk that fills them has NOT been run, so most will be EMPTY for now: an empty result here means the walk has not reached that window yet, NOT that the client has no such data. Say that plainly rather than reporting a zero.',
      },
      platform: {
        type: 'string',
        enum: breakdownPlatforms(),
        description: 'Which platform this dimension is on. "ga" = GA4 site analytics (the ga_* types). REQUIRED for multi-platform dimensions (device, hour). For geo_country/geo_region omit for Shopify ship-to geo (the default) or pass "meta"/"google". For single-platform dimensions it is implied and can be omitted. A platform the dimension is not captured on is rejected.',
      },
      geoGrain: {
        type: 'string',
        enum: geoGrains(),
        description: 'For breakdownType "geo" ONLY: the geographic grain (city, county, metro, state, province, district, postal, most_specific, region). For country- or region-level totals that also span Shopify/Meta, use breakdownType geo_country / geo_region instead.',
      },
      geoScope: {
        type: 'string',
        enum: geoScopes(),
        description: 'For breakdownType "geo" ONLY, and it MATTERS: "ad" = where you TARGETED the ad (ad-location); "user" = where the person PHYSICALLY WAS (user-location). These are DIFFERENT — someone in Boston can see an ad targeted to New York. Pick deliberately; conflating ad-location with user-location yields a confident WRONG answer.',
      },
      baseRange: {
        type: 'string',
        description: 'Single-window preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, LAST_MONTH. Default LAST_30_DAYS. Ignored if startDate+endDate are given.',
      },
      startDate: { type: 'string', description: 'Optional explicit window start, YYYY-MM-DD (use with endDate).' },
      endDate: { type: 'string', description: 'Optional explicit window end, YYYY-MM-DD (use with startDate).' },
      rankBy: {
        type: 'string',
        // LORAMER_EXTRA_METRIC_REACHABILITY_V1 — the additive `extra` keys are rankable, DERIVED from the
        // registry so the enum, the query layer and migration 067 cannot drift into three different answers.
        enum: ['spend', 'impressions', 'clicks', 'conversions', 'conversionValue', 'revenue', ...allAdditiveExtraKeys()],
        description: 'Metric to rank by. Default spend (for the conversion families action_type/conversion_action the default is conversions, since their spend is 0). Use "revenue" for revenue-centric breakdowns like Shopify geo (ad breakdowns have no revenue; commerce breakdowns have no spend). ⛔ SESSION AND EVENT METRICS ARE CAPTURED AND RANKABLE — this was WRONG until 2026-08-14 and you may have been told otherwise: GA4 families (ga_landing_page, ga_channel, ga_device, ga_source_medium, ga_event, ga_geo_*) carry sessions, engagedSessions, newUsers, eventCount, eventValue and transactions in the CAPTURED store, over the FULL history, not just a live 30-day panel. Rank by "sessions" for "top landing pages by traffic" and by "eventCount" for "which events fired most". Shopify/Woo carry orders, units, grossRevenue, refundedAmount, newCustomers; Meta carries purchases, addToCart, initiateCheckout, viewContent, outboundClicks. They come back on each row under extraMetrics. NEVER tell a user these are unavailable, live-only or not captured.',
      },
      topN: { type: 'number', description: 'How many to return. Default 20, maximum 50.' },
      orderDir: { type: 'string', enum: ['desc', 'asc'], description: 'desc (default) for top, asc for bottom.' },
      parentEntityId: { type: 'string', description: 'Optional: restrict to one campaign id (the parent of the ad group).' },
      entityId: { type: 'string', description: 'Optional: restrict to one ad group id.' },
      entityLevel: {
        type: 'string',
        enum: breakdownEntityLevels(),
        description: 'Which entity grain to scope the breakdown to. Default = the COARSEST grain present for the family (so metrics are never double-counted across levels). It is honored for ALL breakdown types — e.g. Google device or hour at ad_group or keyword — NOT video-only. For breakdownType="video" it additionally prevents cross-level double-counting of view counts.',
      },
    },
    required: ['breakdownType'],
  },
}

// LORAMER_WIRE_COVERAGE_INSTRUMENT_V1 — BREAKDOWN-GRAIN COMPLETENESS REACHES LORA, AND ONLY HERE.
//
// ⛔ THIS TOOL, AND NOTHING ELSE. Not query_metrics — its totals are ACCOUNT grain and a breakdown hole does not
// change them, so a caveat there would hang on a number it does not bear on, which is the noise that trains a
// reader to skip captions. Not per-turn — most turns never touch breakdown grain, and on a wide window the read
// costs seconds for nothing. Keying on the TOOL is decidable in code, which is the determinism law's own
// preference: push truth into code, leave judgment to the prompt.
//
// WHY IT WAS NEEDED (MEASURED 2026-07-30): Foam OH GA, window 2023-07-01..2025-12-31 — base grain min
// 2022-02-02 / max 2026-07-29, so `coversWindow` said 'covered' and coverageNotes emitted NOTHING (its loop
// opens `if (c.state === 'covered') continue`), while that window held ZERO dimensional rows across all 12
// families. 915 base-active days. She would have named a top source/medium from a window with no dimensional
// data and no hedge — ESSENCE law 6's dangerous state exactly: a confident answer over an uncaptured window.
//
// COST, MEASURED on the real RPC and the reason no cache or global bound is needed: it scales with WINDOW SIZE,
// not client size. Foam OH meta 30 days = 11ms · 7 months = 1,295ms · 3.5 years = 13,316ms. Lora's default is
// 30 days, so the ordinary cost is ~11ms against a ~9s turn. A wide window exceeds the 8s PostgREST ceiling and
// surfaces as read_failed carrying the timeout text — legible, not silence (LORAMER_COVERAGE_UNKNOWN_REASON_V1).
export async function runQueryBreakdownTool(input: any, clientId: string) {
  const result: any = await queryBreakdown({
    clientId,
    breakdownType: typeof input?.breakdownType === 'string' ? input.breakdownType : '',
    platform: typeof input?.platform === 'string' ? input.platform : undefined,
    baseRange: typeof input?.baseRange === 'string' ? input.baseRange : undefined,
    startDate: typeof input?.startDate === 'string' ? input.startDate : undefined,
    endDate: typeof input?.endDate === 'string' ? input.endDate : undefined,
    rankBy: typeof input?.rankBy === 'string' ? input.rankBy : undefined,
    topN: typeof input?.topN === 'number' ? input.topN : undefined,
    orderDir: input?.orderDir === 'asc' ? 'asc' : input?.orderDir === 'desc' ? 'desc' : undefined,
    parentEntityId: typeof input?.parentEntityId === 'string' ? input.parentEntityId : undefined,
    entityId: typeof input?.entityId === 'string' ? input.entityId : undefined,
    entityLevel: typeof input?.entityLevel === 'string' ? input.entityLevel : undefined,
    geoGrain: typeof input?.geoGrain === 'string' ? input.geoGrain : undefined, // LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B)
    geoScope: typeof input?.geoScope === 'string' ? input.geoScope : undefined,
  })

  const family = typeof input?.breakdownType === 'string' ? input.breakdownType : ''
  // Scope the coverage read. The EXPLICIT platform wins; otherwise the registry resolves it, and a family
  // captured on several platforms with none chosen is already refused upstream by queryBreakdown with its own
  // note ("pass platform to choose one"), so there is nothing to measure and nothing to say.
  const explicit = typeof input?.platform === 'string' ? input.platform : undefined
  let platform: string | undefined = explicit
  if (!platform) {
    try {
      const cands = platformsForToolType(family)
      if (cands.length === 1) platform = cands[0]
    } catch { /* unknown family — queryBreakdown already returned its own note */ }
  }
  // ⛔ THE WINDOW COMES FROM queryBreakdown's OWN RESOLUTION, never re-derived here. resolveDateWindow is the
  // ONE date resolver (Lesson 19) and a second one in this file would be free to drift from the rows it is
  // supposed to be describing.
  const win = result?.window
  if (!platform || !win?.startDate || !win?.endDate) return result

  const cov = await getBreakdownCoverage(clientId, platform, win)
  result.breakdownCoverage = {
    verdict: cov.verdict,
    unknownReason: cov.unknownReason,
    holeDays: cov.holeDays,
    baseActiveDays: cov.baseActiveDays,
    breakdownDays: cov.breakdownDays,
    detail: cov.detail,
  }
  // A DIRECTIVE, not a description — and null on COMPLETE, because silence is the correct signal on a clean
  // window. Attached as its OWN field: `result.note` is a single string already carrying six other meanings
  // (truncation, unknown family, wrong platform, geo grain, empty family), and overwriting it would trade one
  // honest message for another.
  const coverageNote = breakdownCoverageNote(cov, family)
  if (coverageNote) result.coverageNote = coverageNote
  // ⛔ LORAMER_BREAKDOWN_MONEY_BINDING_V1 — STRUCTURE, NOT ADVICE, matching query_metrics exactly. The grain
  // verdict above plus the BASE density verdict (the calibrated 7-day/frontier/zero-days resolver — the SAME
  // one query_metrics uses, never a stricter breakdown-only threshold) combine into ONE decision, and a
  // non-COMPLETE decision moves `rows` to partialRows/unverifiedRows with a `withheld.mustSay`. A13 quoted
  // the coverage note while contradicting it; a key that no longer exists cannot be quoted.
  const frontier = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  let density: any = null
  try { density = await getDensityForWindow(clientId, platform, win, frontier) } catch { density = null }
  if (density) result.baseDensity = { verdict: density.verdict, unknownReason: density.unknownReason, daysInWindow: density.daysInWindow, daysPresent: density.daysPresent, longestMissingRun: density.longestMissingRun, detail: density.detail }
  const decision = combineRankingVerdict({
    grainVerdict: cov.verdict, grainUnknownReason: cov.unknownReason, grainDetail: cov.detail,
    densityVerdict: density?.verdict, densityDetail: density?.detail,
  })
  return bindRanking(result, decision)
}

// LORAMER_LORA_NAMED_ENTITY_READ_V1 — THE NAMED-THING READ. Lora's third query tool, and the one that was missing.
//
// ⛔ WHY IT EXISTS, MEASURED 2026-08-14 (★ENTITY-NAME-AND-GRAIN-UNREACHABLE): Lora had NO per-entity named read —
// not a broken one, NONE. `query_metrics` sums a whole entity_level into ONE unnamed total (aggregateWindow's
// projection carries no entity_id/entity_name, deliberately — migration-035's partial index depends on its shape,
// and it is NOT widened by this flight). `query_breakdown` groups by `breakdown_value` over dimension rows and
// never reads `entity_name`. The consequences were both baseline failures:
//   · "the campaign breakdown returns one row with a blank name" — literally true: 2,564 google campaign-family
//     rows carry breakdown_value='' (identity is in entity_id), so grouping by value yields ONE blank group,
//     while the 4,878 BASE rows holding "Sales-Performance Max-BF '24" were unreachable.
//   · a Meta creative question answered at ASSET grain where every conversion is legitimately 0 — she chose
//     CORRECTLY given what she could reach: the asset families are the only ones offering NAMED values, and the
//     ad-grain answer (2,164 base rows, 1,523 conversions, names in entity_name) was not on the menu.
// ⛔ THE FIX IS NOT A NEW QUERY LAYER. `queryEntities` already existed, correct and paginated, wired to exactly one
// consumer (/api/next/entities, the -next drill). CHECK-WHAT-ALREADY-WORKS: this exposes it, nothing more.
export const QUERY_ENTITIES_TOOL: any = {
  name: 'query_entities',
  description:
    'List the CURRENT client’s NAMED ENTITIES — individual campaigns, ad groups / ad sets, ads, or store products — with each one’s own metrics over a single window, from LoraMer’s historical store. Returns up to topN rows, each carrying entityId, entityName (the real name as it appears in the ad platform), spend, impressions, clicks, conversions, conversionValue, revenue and derived CTR/CPC/CPA/ROAS/convRate, plus the level’s totals and entityCount. ' +
    '⛔ CHOOSING BETWEEN THIS AND query_breakdown — GET THIS RIGHT OR YOU WILL ANSWER A DIFFERENT QUESTION THAN THE ONE ASKED. Use query_entities for a named THING the advertiser created and can point at: "which CAMPAIGN drove the most conversions" (→ level "campaign"), "what was our best AD last month" (→ level "ad"). Use query_breakdown for a named DIMENSION VALUE the platform reports activity against: "which AGE BAND converts best" (→ breakdownType "age"), "which CREATIVE ASSET was served most" (→ breakdownType "image_asset"). ' +
    '⛔ THE TRAP THIS EXISTS TO END, stated because it produced a confident wrong answer on a real question: for "which creative/ad performed best", the ASSET breakdown families are NOT the answer — Meta does not attribute conversions to individual creative assets, so those families legitimately carry ZERO conversions and ranking them returns all-zeros that look like real data. The answer lives at the AD level here (level "ad"), where the ad’s name and its real conversions are. If a question is about performance of a THING WITH A NAME, reach for this tool first. ' +
    'Scope to one parent with parentEntityId (a campaign id to list its ad groups, an ad-group id to list its ads) — the drill mechanic. Reads CAPTURED base rows only, never a live platform call, and never breakdown rows, so its numbers are directly comparable to query_metrics’ totals for the same level and window. ' +
    '⚠ HONEST LIMITS: entity-level history begins at the client’s connect date (query_metrics account totals reach further back), and an empty result means no entity of that level was captured in that window — say that, never infer a zero. If entityName comes back empty for a row, report the entityId and say the name was not captured rather than presenting a blank.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: {
        type: 'string',
        description: 'The target client’s id, taken ONLY from the "clients you can access" list in your instructions. REQUIRED at the agency / all-clients view; IGNORED at a single-client view (the current client is used). Never invent an id.', // LORAMER_AGENCY_SCOPE_LORA_V1
      },
      platform: {
        type: 'string',
        enum: ['google', 'meta', 'shopify', 'woocommerce'],
        description: 'Which platform’s entities. REQUIRED — entity names are per-platform and there is no cross-platform entity list. google/meta carry campaign/ad_group/ad_set/ad; shopify/woocommerce carry product/variant.',
      },
      level: {
        type: 'string',
        enum: ['campaign', 'ad_group', 'ad_set', 'ad', 'product', 'variant'],
        description: 'Which grain to list. google uses ad_group, meta uses ad_set — passing the wrong one for the platform returns an empty list, not an error. "product"/"variant" are the store grains.',
      },
      parentEntityId: {
        type: 'string',
        description: 'Optional. List only the children of this entity — a campaign id to get its ad groups / ad sets, an ad-group / ad-set id to get its ads. Take the id from a previous query_entities row’s entityId; never invent one.',
      },
      rankBy: {
        type: 'string',
        enum: ['spend', 'conversions', 'clicks', 'impressions', 'conversionValue', 'revenue'],
        description: 'Which metric orders the list. Default "spend". For "best/top performing by conversions" pass "conversions" — do NOT rank by spend and describe the result as best-performing.',
      },
      topN: { type: 'number', description: 'How many entities to return, default 10, max 50. The response always carries entityCount so you can say how many exist beyond the ones shown.' },
      baseRange: { type: 'string', description: 'Single-window preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, LAST_MONTH. Default LAST_30_DAYS. For any specific calendar period use startDate/endDate instead.' },
      startDate: { type: 'string', description: 'Optional explicit window start, YYYY-MM-DD (use with endDate). Overrides baseRange.' },
      endDate: { type: 'string', description: 'Optional explicit window end, YYYY-MM-DD (use with startDate).' },
    },
    required: ['platform', 'level'],
  },
}

// LORAMER_LORA_NAMED_ENTITY_READ_V1 — the runner. queryEntities returns EVERY entity in the window (it is the
// drill's data source); the tool ranks and truncates here rather than in the query layer, so the -next drill's
// behaviour is byte-identical and only this caller sees a cap.
export const QUERY_ENTITIES_MAX_TOPN = 50
export async function runQueryEntitiesTool(input: any, clientId: string) {
  const platform = typeof input?.platform === 'string' ? input.platform : ''
  const level = typeof input?.level === 'string' ? input.level : ''
  const rankBy = typeof input?.rankBy === 'string' ? input.rankBy : 'spend'
  const topN = Math.max(1, Math.min(QUERY_ENTITIES_MAX_TOPN, typeof input?.topN === 'number' ? input.topN : 10))
  const result = await queryEntities({
    clientId,
    platform,
    level,
    parentEntityId: typeof input?.parentEntityId === 'string' ? input.parentEntityId : undefined,
    baseRange: typeof input?.baseRange === 'string' ? input.baseRange : undefined,
    startDate: typeof input?.startDate === 'string' ? input.startDate : undefined,
    endDate: typeof input?.endDate === 'string' ? input.endDate : undefined,
  })
  // Rank on the requested metric, DESC. queryEntities sorts by spend for the drill; re-sorting here leaves that
  // contract untouched. An unknown rankBy falls back to spend rather than throwing — the enum already bounds it.
  const key = ['spend', 'conversions', 'clicks', 'impressions', 'conversionValue', 'revenue'].includes(rankBy) ? rankBy : 'spend'
  const ranked = [...result.rows].sort((a: any, b: any) => Number(b[key] ?? 0) - Number(a[key] ?? 0))
  const rows = ranked.slice(0, topN)
  return {
    platform: result.platform,
    level: result.level,
    window: result.window,
    parentEntityId: result.parentEntityId,
    rankBy: key,
    rows,
    totals: result.totals,
    entityCount: result.entityCount,
    truncated: result.entityCount > rows.length,
    // THE DENOMINATOR ON AN EMPTY RESULT (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1): an empty list must say what
    // it examined, or it reads as "this client has no campaigns" when it means "none were captured in this window".
    ...(result.entityCount === 0
      ? { note: `No ${level} entities were CAPTURED for ${platform} between ${result.window.startDate} and ${result.window.endDate}. That is a statement about our capture for this window, NOT proof the advertiser had none — say so plainly and do not report zero performance.` }
      : {}),
  }
}

// LORAMER_QUERY_MONEY_V1 — the store money surface (gross→net waterfall components) for ONE store platform.
export const QUERY_MONEY_TOOL: any = {
  name: 'query_money',
  description:
    'Break the CURRENT client’s STORE revenue into its money components over a single window — gross sales, discounts, taxes, shipping, fees, tips, refunds, total sales, net sales, and an on-sale-markdown residual — from LoraMer’s historical store, at ACCOUNT grain. Use this when the user asks how revenue breaks down / where the money goes / gross vs net / discounts or taxes or shipping totals. Returns per-component values (each a summed $ amount) plus a "chain" giving the correct waterfall order and +/- direction for the store’s basis, and coverage info. IMPORTANT: net-sales BASIS differs by platform and is reported in "basis" — WooCommerce net INCLUDES shipping + tax; Shopify net EXCLUDES them — so never compare net across the two as like-for-like. A component value of null means it was not captured on at least one day in the window (honestly "not captured", NOT $0). COMPLETENESS — STRUCTURE, not advice: the result carries a base-density verdict (`baseDensity` + `coverageVerdict`). On a COMPLETE window `components` is present as usual; on PARTIAL the figures live on `partialComponents` and on UNKNOWN on `unverifiedComponents`, each with `withheld {reason, mustSay}` — follow mustSay verbatim, name the gap, and never present partial components as the window’s money story. An absent window is NOT a $0 window. Store-only: pass platform "shopify" or "woocommerce"; there is no cross-platform money total. For plain revenue/spend totals or period-over-period use query_metrics instead.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'The target client’s id, taken ONLY from the "clients you can access" list in your instructions. REQUIRED at the agency / all-clients view; IGNORED at a single-client view (the current client is used). Never invent an id.' }, // LORAMER_AGENCY_SCOPE_LORA_V1
      platform: { type: 'string', enum: ['shopify', 'woocommerce'], description: 'Which store platform’s money to break down. Required — money is per-store (different net basis); never summed across platforms.' },
      baseRange: { type: 'string', description: 'Single-window preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, LAST_MONTH. Default LAST_30_DAYS. Ignored if startDate+endDate are given.' },
      startDate: { type: 'string', description: 'Optional explicit window start, YYYY-MM-DD (use with endDate).' },
      endDate: { type: 'string', description: 'Optional explicit window end, YYYY-MM-DD (use with startDate).' },
    },
    required: ['platform'],
  },
}

export async function runQueryMoneyTool(input: any, clientId: string) {
  const result: any = await queryMoney({
    clientId,
    platform: typeof input?.platform === 'string' ? input.platform : '',
    baseRange: typeof input?.baseRange === 'string' ? input.baseRange : undefined,
    startDate: typeof input?.startDate === 'string' ? input.startDate : undefined,
    endDate: typeof input?.endDate === 'string' ? input.endDate : undefined,
  })
  // ⛔ LORAMER_BREAKDOWN_MONEY_BINDING_V1 — query_money carried NO coverage instrument at all
  // (★HONESTY-ENFORCERS-MISS-GRAIN-ABSENCE named it 2026-08-01; this closes that door). The money grain rides
  // the BASE rows, so the base density verdict — the same calibrated resolver query_metrics uses — decides,
  // and a non-COMPLETE window moves `components` to partialComponents/unverifiedComponents structurally.
  // An unresolvable platform ('' — queryMoney already returns its own refusal note) has no window to judge.
  if (result?.platform && result?.window?.startDate && result?.window?.endDate) {
    const frontier = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    let density: any = null
    try { density = await getDensityForWindow(clientId, result.platform, result.window, frontier) } catch { density = null }
    if (density) result.baseDensity = { verdict: density.verdict, unknownReason: density.unknownReason, daysInWindow: density.daysInWindow, daysPresent: density.daysPresent, longestMissingRun: density.longestMissingRun, detail: density.detail }
    // ⛔ GRAIN IS VACUOUSLY COMPLETE HERE — money has no grain instrument, so DENSITY alone decides. The grain
    // slot must NOT receive density's unknownReason: density spells its beyond-frontier state
    // 'no_activity_in_window' (calibrated 2026-08-15, "not held YET"), and in the GRAIN slot that token is the
    // vendor-attestation door — a frontier gap would bind as attested-real-zero, the exact false-zero shape
    // this flight closes. Attestation does not reach the money path at all; absence here always withholds.
    const decision = combineRankingVerdict({
      grainVerdict: 'COMPLETE',
      densityVerdict: density?.verdict, densityDetail: density?.detail,
    })
    return bindMoney(result, decision)
  }
  return result
}

export async function runQueryMetricsTool(input: any, clientId: string) {
  const platform = typeof input?.platform === 'string' ? input.platform : undefined
  const level = typeof input?.level === 'string' ? input.level : undefined
  const baseRange = typeof input?.baseRange === 'string' ? input.baseRange : undefined
  const offsetsMonths = Array.isArray(input?.offsetsMonths)
    ? input.offsetsMonths.filter((n: any) => typeof n === 'number')
    : undefined
  const windows = Array.isArray(input?.windows)
    ? input.windows
        .filter((w: any) => w && typeof w.startDate === 'string' && typeof w.endDate === 'string')
        .map((w: any) => ({
          label: typeof w.label === 'string' ? w.label : undefined,
          startDate: w.startDate,
          endDate: w.endDate,
        }))
    : undefined
  const platforms = platform && platform !== 'all' ? [platform] : []
  const result = await queryMetrics({ clientId, platforms, level, baseRange, offsetsMonths, windows })
  return await bindCoverage(result, { clientId, platforms, level })
}

// LORAMER_BINDING_COVERAGE_V1 — the pure decider lives in src/lib/lora/coverage-binding.ts (zero imports) so a
// guard can DRIVE it rather than read its source; this module owns only the DB reads that feed it.
// (1) NO GRAIN GAP + (3) BINDING. Every level the tool enum accepts gets a verdict — the account-only early
// return is gone. Non-account grains ALSO carry the breakdown-grain resolver's answer, because that is the
// exact gap A13/E7/C14 fell through: account coverage said `complete: true` (TRUE for base rows) while the
// GEO grain's floor postdated the window, and she applied the account verdict to a grain-level claim.
async function bindCoverage(result: any, ctx: { clientId: string; platforms: string[]; level: string }): Promise<any> {
  const wins = (result.windows || []).map((w: any) => ({ startDate: w.startDate, endDate: w.endDate }))
  let cov: any[] = [], comp: any = null, measured = true, measureError: string | undefined
  try {
    cov = await getCoverageForWindows(ctx.clientId, ctx.platforms, wins)
    comp = await annotateContribution(ctx.clientId, wins, cov)
  } catch (e: any) {
    measured = false
    measureError = e instanceof Error ? e.message : String(e)
  }
  // ⛔ THE GRAIN GAP — CLOSED BY REMOVING THE EARLY RETURN, **NOT** BY CALLING getBreakdownCoverage HERE.
  // My first cut wired the breakdown-grain resolver into this path and `breakdown-coverage-wired.guard` leg (e)
  // refused it, correctly and for a reason I had not thought through: getBreakdownCoverage answers "do the
  // BREAKDOWN FAMILIES have holes", which does not bear on a BASE-grain total, so its caveat would hang on a
  // number it says nothing about. Worse, it returned UNKNOWN for a grain with no families to measure and my
  // code converted that into PARTIAL — a FALSE refusal, the over-refusal failure arriving through a side door
  // that leg (iv) could not see. The guard was the only thing between that and production.
  // WHAT ACTUALLY CLOSES THE GAP: the account-grain resolver now runs for EVERY level instead of returning
  // early. It answers "did this platform capture in this window at all", which is a precondition for every
  // grain — if the platform captured nothing, no grain beneath it has data either.
  // ⛔ THE DENSITY LEG — LORAMER_COVERAGE_DENSITY_V1. The floor test says "capture reaches back this far";
  // this says "and every day inside is present". Without it the binding shipped in
  // LORAMER_BINDING_COVERAGE_V1 gated faithfully on a verdict that answered the narrower question, and closed
  // 0 of the 17 baseline failures. A PARTIAL density verdict downgrades the window exactly as a failing
  // platform contribution does. Frontier = YESTERDAY: capture is T+1, and judged against today every fleet
  // pair goes PARTIAL on every recent window (measured 30/30) for the most benign reason there is.
  const frontier = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const densityByWindow: any[][] = []
  if (measured) {
    const plats = ctx.platforms.length ? ctx.platforms : ['google', 'meta', 'ga', 'shopify', 'woocommerce']
    for (const [i, w] of wins.entries()) {
      // Only platforms the client is actually CONNECTED to and that the account verdict says are in scope —
      // asking density of a platform with no connection would manufacture a hole out of an absence that the
      // floor/connection legs already classify correctly.
      const inScope = (cov[i] || []).filter((c: any) => c.connected).map((c: any) => c.platform)
      const use = plats.filter((p) => inScope.length === 0 || inScope.includes(p))
      const per = await Promise.all(use.map((p) => getDensityForWindow(ctx.clientId, p, w, frontier)))
      densityByWindow[i] = per
      if (per.some((d: any) => d.verdict === 'PARTIAL')) comp.completePerWindow[i] = false
    }
  }
  const windows2 = (result.windows || []).map((w: any, i: number) =>
    bindWindow(
      // The literal `comp.perWindow` / `comp.completePerWindow` shape is what check-query-completeness pins —
      // optional chaining here broke its match, and the pin is right to be literal: it is asserting that the
      // computed verdict REACHES Lora, which a renamed or chained access could silently stop doing.
      { ...w, coverage: cov[i], contribution: measured ? comp.perWindow[i] : undefined, complete: measured ? comp.completePerWindow[i] : undefined, ...(densityByWindow[i] ? { density: densityByWindow[i] } : {}) },
      { complete: measured ? comp.completePerWindow[i] : undefined, measured, measureError },
    ))
  const notes = [...(result.notes || []), ...(measured ? [...coverageNotes(cov), ...comp.notes] : [
    `⛔ COVERAGE UNMEASURED (read_failed): ${measureError}. Every window below is labelled UNKNOWN. Do not state any figure as complete and do not report a zero as a real zero.`,
  ])]
  return {
    ...result, windows: windows2,
    complete: measured ? comp.overallComplete : false,
    coverageMeasured: measured,
    notes: notes.length ? notes : undefined,
  }
}

export type ToolLoopResult = {
  responseText: string
  usage: { input: number; output: number; cache_create: number; cache_read: number; cache_create_5m: number; cache_create_1h: number }
}

// Capped Claude tool-use loop. Exposes query_metrics only when a clientId is in
// scope. If the model calls no tool, this is a single create() - identical to the
// old single-shot behavior. Usage is summed across tool round-trips.
// LORAMER_CHAT_STREAMING_V1 — the tool executor, LIFTED VERBATIM out of runClaudeToolLoop so the blocking and
// streaming loops run THE SAME CODE. Nothing here changed in the lift: the per-call RBAC (resolve target →
// viewerCanAccess → FAIL CLOSED), the hard-error flag, and the payload shapes are byte-identical to what shipped.
// This is deliberate — with tools attached at agency scope this check is the ONLY thing preventing cross-client
// access, so it gets ONE implementation, not two that can drift.
export async function executeToolUses(
  toolUses: any[],
  ctx: { clientId: string; userEmail: string },
): Promise<any[]> {
  const clientId = ctx.clientId
  const userEmail = ctx.userEmail
  const toolResults: any[] = []
  for (const tu of toolUses) {
    let payload: any
    let isError = false
    try {
      // LORAMER_AGENCY_SCOPE_LORA_V1 — THE RBAC CHECK. Resolve the TARGET client for THIS call: the bound scope
      // client wins (single-client tab — unchanged, and the model cannot steer it elsewhere); at agency scope
      // there is none, so the model must name one via tu.input.clientId. Then viewerCanAccess THAT target on
      // EVERY call and FAIL CLOSED — with tools now attached at agency scope this per-call check is the only
      // thing preventing cross-client access, so it runs before any query touches the DB.
      const target = clientId || (typeof tu.input?.clientId === 'string' ? tu.input.clientId.trim() : '')
      if (!target) {
    payload = { error: 'No client specified. Name one of the clients you can access (use its id as clientId), or ask the user which client to look at — do not answer without a client.' }
    isError = true
      } else if (!(await viewerCanAccess(userEmail, target))) {
    payload = { error: 'Access denied: you do not have access to that client. Do not report any data for it, and tell the user you cannot access it.' }
    isError = true
      } else if (tu.name === 'query_metrics') payload = await runQueryMetricsTool(tu.input, target)
      else if (tu.name === 'query_breakdown') payload = await runQueryBreakdownTool(tu.input, target)
      else if (tu.name === 'query_money') payload = await runQueryMoneyTool(tu.input, target)
      else if (tu.name === 'query_entities') payload = await runQueryEntitiesTool(tu.input, target) // LORAMER_LORA_NAMED_ENTITY_READ_V1
      else { payload = { error: 'unknown tool: ' + tu.name }; isError = true }
    } catch (err) {
      payload = { error: err instanceof Error ? err.message : String(err) }
      isError = true
    }
    toolResults.push({
      type: 'tool_result',
      tool_use_id: tu.id,
      content: JSON.stringify(payload),
      // LORAMER_LORA_TOOL_HARD_ERROR_V1 (T0#2 slice 1) — a THROWN query (e.g. a DB failure) is a HARD tool
      // error, not error-text riding as normal content, so the model treats a real read failure as a failure
      // and never reads it as data / a false number.
      ...(isError ? { is_error: true } : {}),
    })
  }
  return toolResults
}

export async function runClaudeToolLoop(opts: {
  anthropic: any
  model: string
  maxTokens: number
  system: any
  messages: any[]
  clientId?: string | null
  userEmail?: string | null  // LORAMER_QUERY_METRICS_OWNERSHIP_V1
  maxToolTurns?: number
  // LORAMER_LORA_MODEL_CHAIN_V1 — per-request SDK options (maxRetries + timeout) supplied by the model chain, so
  // retry budget is owned by the caller that also owns the wall-clock deadline. Absent ⇒ SDK defaults, unchanged.
  requestOptions?: { maxRetries?: number; timeout?: number }
}): Promise<ToolLoopResult> {
  const { anthropic, model, maxTokens, system, messages } = opts
  const clientId = opts.clientId || ''
  const userEmail = opts.userEmail || ''
  // LORAMER_AGENCY_SCOPE_LORA_V1 — tools attach for ANY authenticated viewer, INCLUDING the agency / all-clients
  // scope (where clientId is empty). The old `clientId && viewerCanAccess(...)` presence-gate is REMOVED: withholding
  // tools was the only thing scoping access, which is why agency scope had none. Cross-client safety is now enforced
  // PER TOOL CALL in the executor below (resolve the TARGET client, viewerCanAccess that target, FAIL CLOSED) — the
  // right place, because at agency scope the target is chosen by the model per call, not fixed for the loop.
  const tools: any[] | undefined =
    userEmail ? [QUERY_METRICS_TOOL, QUERY_BREAKDOWN_TOOL, QUERY_MONEY_TOOL, QUERY_ENTITIES_TOOL] : undefined // LORAMER_LORA_NAMED_ENTITY_READ_V1 — the named-thing read joins BOTH loops (blocking + streaming); one list per loop, and they must not drift
  const convo: any[] = [...messages]
  // LORAMER_LORA_TOOL_DECISION_LOG_V1 — capture the user's QUESTION once for the decision instrument; on later turns
  // the last message is a tool_result, not the question.
  const originalQuestion: string = (() => {
    // LORAMER_CHAT_HISTORY_CACHE_V1 — the FINAL user message now carries array-of-blocks content (the
    // cache_control breakpoint requires it), so the extractor reads both shapes. String-only here would
    // silently fall back to the PREVIOUS user turn and mislabel every tool-decision log row.
    const lu = [...messages].reverse().find((m: any) => m?.role === 'user'
      && (typeof m?.content === 'string' || Array.isArray(m?.content)))
    if (!lu) return ''
    if (typeof lu.content === 'string') return lu.content
    return lu.content.map((b: any) => (b?.type === 'text' ? String(b.text ?? '') : '')).join(' ').trim()
  })()
  // LORAMER_CHAT_HISTORY_CACHE_V1 — cache writes now happen at TWO TTLs (1h prefix · 5m messages), and
  // they are PRICED DIFFERENTLY ($10/M vs $6.25/M on Opus 5). The API splits them in
  // `usage.cache_creation.ephemeral_{1h,5m}_input_tokens`; summing them into one number is how the ledger
  // under-priced every 1h write by 37.5% for a week. `cache_create` stays as the TOTAL (the log column's
  // meaning is unchanged); the split rides beside it for pricing.
  const usage = { input: 0, output: 0, cache_create: 0, cache_read: 0, cache_create_5m: 0, cache_create_1h: 0 }
  const MAX = opts.maxToolTurns ?? 5

  let out: any = null
  let last: any = null
  for (let turn = 0; turn < MAX; turn++) {
    const createParams: any = { model, max_tokens: maxTokens, system, messages: convo }
    if (tools) createParams.tools = tools
    const resp: any = opts.requestOptions
      ? await anthropic.messages.create(createParams, opts.requestOptions) // LORAMER_LORA_MODEL_CHAIN_V1
      : await anthropic.messages.create(createParams)
    last = resp
    const u = resp.usage || {}
    usage.input += u.input_tokens || 0
    usage.output += u.output_tokens || 0
    usage.cache_create += u.cache_creation_input_tokens || 0
    usage.cache_read += u.cache_read_input_tokens || 0
    // The split object is present whenever cache_control was sent. If the API omits it while total
    // creation is non-zero, attribute to 1h — the PREFIX (1h) is the block that dominates a cold write,
    // and under-attributing to 5m is the exact under-pricing this split exists to end.
    if (u.cache_creation && typeof u.cache_creation === 'object') {
      usage.cache_create_5m += u.cache_creation.ephemeral_5m_input_tokens || 0
      usage.cache_create_1h += u.cache_creation.ephemeral_1h_input_tokens || 0
    } else if (u.cache_creation_input_tokens) {
      usage.cache_create_1h += u.cache_creation_input_tokens
    }

    // LORAMER_LORA_TOOL_DECISION_LOG_V1 — FIRE-AND-FORGET (not awaited) L2-retrieval instrument. Never blocks the
    // response and never breaks the turn (the try guards input-building; logToolDecision swallows internally).
    // BEHAVIOR UNCHANGED: no tool_choice added, tools array untouched, system prompt untouched — this only WATCHES.
    try {
      const decidedTool = (resp.content as any[])?.find((b) => b?.type === 'tool_use')
      void logToolDecision({ clientId, questionText: originalQuestion, toolCalled: !!decidedTool, toolName: decidedTool?.name ?? null, turnIndex: turn, model })
    } catch { /* never break the turn */ }

    if (resp.stop_reason === 'tool_use' && tools) {   // LORAMER_AGENCY_SCOPE_LORA_V1 — dropped `&& clientId`: agency scope has no bound client; the target is resolved + access-checked per call below
      const toolUses = (resp.content as any[]).filter(b => b.type === 'tool_use')
      convo.push({ role: 'assistant', content: resp.content })
      const toolResults = await executeToolUses(toolUses, { clientId, userEmail })
      convo.push({ role: 'user', content: toolResults })
      continue
    }

    out = resp
    break
  }

  const finalResp: any = out || last
  const responseText = finalResp
    ? (finalResp.content as any[])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim()
    : ''
  return { responseText, usage }
}

// LORAMER_CHAT_STREAMING_V1 — the STREAMING twin of runClaudeToolLoop.
//
// WHY THIS EXISTS: ★CHAT-STREAMING. Twice on 2026-07-25 (15:31 and ~18:33) a chat turn failed at the BROWSER
// while the server was fine — the 15:31 turn returned 200 with a full 3,834-token answer that the user never saw.
// A 59s or 147s answer that renders progressively is ALIVE; the same answer behind a spinner is DEAD, and the
// user cannot tell a slow turn from a broken one. Blocking is the defect; streaming is the fix.
//
// WHAT IS SHARED, NOT FORKED: tool execution + the per-call viewerCanAccess RBAC run through executeToolUses()
// above — the SAME function the blocking loop calls. Two copies of an access check is how one of them rots.
//
// CHANNEL DISTINCTION (the decision this required): the loop's intermediate turns can emit text BEFORE a tool
// call ("Let me pull the numbers…"). The blocking loop DISCARDS that text — it returns only the final turn's
// content — so streaming it as answer text would change what the user receives. Instead:
//   · intermediate-turn text  → emit('status', …)   narration, rendered as transient "working" copy
//   · tool_use blocks         → emit('tool',   …)   which tool, so the UI can say what it is doing
//   · FINAL-turn text         → emit('delta',  …)   THE ANSWER, and the only thing persisted
// So the answer a user reads is byte-identical to the blocking path's `responseText`; everything new is
// additive narration they previously had no way to see.
export type StreamEmit = (event: 'status' | 'tool' | 'delta', data: any) => void

export async function runClaudeToolLoopStreaming(opts: {
  anthropic: any
  model: string
  maxTokens: number
  system: any
  messages: any[]
  clientId?: string | null
  userEmail?: string | null
  maxToolTurns?: number
  requestOptions?: { maxRetries?: number; timeout?: number }
  emit: StreamEmit
  /** LORAMER_CHAT_STATUS_SUBJECT_V1 — the BOUND client's human name, already on the request body. Lets the
   *  status line name the client at single-client scope without a single extra query. */
  clientName?: string | null
  /** Awaited on the FIRST turn only, before the route commits to an SSE response — see the route's footgun note. */
  onFirstTurnStarted?: () => void
}): Promise<ToolLoopResult> {
  const { anthropic, model, maxTokens, system, messages } = opts
  // ── LORAMER_CHAT_STATUS_FIRST_V1 — THE COMMIT GATE RELEASES ON THE FIRST EMIT OF *ANY* KIND ──────────────
  // DEVICE DEFECT (Gate-B, Chrome iOS, 2026-08-02): the status line took more than a MINUTE to appear, with
  // the three dots showing until it did. Two stacked causes, and this is the DOMINANT one.
  //   · The route does not return its Response until `onFirstTurnStarted` fires (Promise.race against the
  //     chain settling) — a deliberate footgun guard, because once SSE headers are written the status code is
  //     fixed and a 401/404/503 can no longer be expressed.
  //   · `onFirstTurnStarted` was called ONLY from `stream.on('text')`. When the model's FIRST turn goes
  //     straight to tool_use with NO preamble — which is what a data question does, i.e. exactly the slow
  //     turns this feature exists for — no text ever arrives on turn 1, so the gate stayed shut through the
  //     whole first model turn AND the tool execution. Every `tool` event enqueued into a stream whose
  //     Response had not been returned. The user got dots until the model began writing the FINAL ANSWER,
  //     and then the whole queue flushed at once. Emitting a status event earlier would have changed nothing
  //     on its own — it would have queued behind the same shut gate.
  // THE TRADE, STATED, NOT BURIED: releasing on the first emit means an Anthropic overload that exhausts the
  // whole model chain now degrades from a JSON 503 to an SSE `error` event. The USER-VISIBLE result is
  // IDENTICAL — readChatResponse normalises both into `error: 'overloaded'` and the client renders the same
  // sentence — so what is actually lost is the HTTP status code for observability. A 503 nobody sees because
  // they are staring at a dead spinner is worth less than a live line plus that same honest sentence.
  // Auth, RBAC and prompt assembly all complete BEFORE this function is entered, so those failures still
  // return real JSON statuses exactly as before; only model-chain exhaustion changes shape.
  let gateReleased = false
  const emit: StreamEmit = (event, data) => {
    opts.emit(event, data)                                   // enqueue FIRST, so the frame is already in the
    if (!gateReleased) { gateReleased = true; opts.onFirstTurnStarted?.() }  // stream when the Response returns
  }
  const clientId = opts.clientId || ''
  const userEmail = opts.userEmail || ''
  const tools: any[] | undefined =
    userEmail ? [QUERY_METRICS_TOOL, QUERY_BREAKDOWN_TOOL, QUERY_MONEY_TOOL, QUERY_ENTITIES_TOOL] : undefined // LORAMER_LORA_NAMED_ENTITY_READ_V1 — the named-thing read joins BOTH loops (blocking + streaming); one list per loop, and they must not drift
  const convo: any[] = [...messages]
  const originalQuestion: string = (() => {
    // LORAMER_CHAT_HISTORY_CACHE_V1 — the FINAL user message now carries array-of-blocks content (the
    // cache_control breakpoint requires it), so the extractor reads both shapes. String-only here would
    // silently fall back to the PREVIOUS user turn and mislabel every tool-decision log row.
    const lu = [...messages].reverse().find((m: any) => m?.role === 'user'
      && (typeof m?.content === 'string' || Array.isArray(m?.content)))
    if (!lu) return ''
    if (typeof lu.content === 'string') return lu.content
    return lu.content.map((b: any) => (b?.type === 'text' ? String(b.text ?? '') : '')).join(' ').trim()
  })()
  // LORAMER_CHAT_HISTORY_CACHE_V1 — cache writes now happen at TWO TTLs (1h prefix · 5m messages), and
  // they are PRICED DIFFERENTLY ($10/M vs $6.25/M on Opus 5). The API splits them in
  // `usage.cache_creation.ephemeral_{1h,5m}_input_tokens`; summing them into one number is how the ledger
  // under-priced every 1h write by 37.5% for a week. `cache_create` stays as the TOTAL (the log column's
  // meaning is unchanged); the split rides beside it for pricing.
  const usage = { input: 0, output: 0, cache_create: 0, cache_read: 0, cache_create_5m: 0, cache_create_1h: 0 }
  const MAX = opts.maxToolTurns ?? 5

  // LORAMER_CHAT_STATUS_SUBJECT_V1 — id -> human name, resolved SERVER-side so no id reaches the browser.
  // TWO SOURCES, cheapest first:
  //   - the BOUND client's name is already on the request (route.ts destructures `clientName`), so the
  //     single-client case - which is nearly every turn - costs ZERO extra queries.
  //   - agency scope has no bound client and the model names one, so the RBAC-scoped roster is fetched
  //     LAZILY and ONCE, only on the first tool turn that needs it. listAccessibleClientsWithNames is the
  //     same helper the agency prompt uses (LORAMER_AGENCY_SCOPE_LORA_V1) and can never widen the set.
  // A miss returns undefined and the subject omits the client segment - never a UUID, never "unknown".
  let rosterPromise: Promise<Map<string, string>> | null = null
  const getClientNameResolver = async (): Promise<(id: string) => string | undefined> => {
    const bound = (opts.clientName || '').trim()
    const boundId = clientId.trim()
    if (boundId && bound) return (id) => (id === boundId ? bound : undefined)
    if (!userEmail) return () => undefined
    if (!rosterPromise) {
      rosterPromise = listAccessibleClientsWithNames(userEmail)
        .then((rows) => new Map(rows.map((r) => [r.id, r.name])))
        .catch(() => new Map<string, string>()) // a failed lookup omits the name; it never fails the turn
    }
    const roster = await rosterPromise
    return (id) => roster.get(id)
  }

  let last: any = null
  for (let turn = 0; turn < MAX; turn++) {
    const createParams: any = { model, max_tokens: maxTokens, system, messages: convo }
    if (tools) createParams.tools = tools

    // ⛔ THE FIRST EMITTABLE MOMENT, AND IT MAY NOT CLAIM WORK IT HAS NOT STARTED.
    // This runs immediately before the model call and is the earliest point at which anything can go on the
    // wire: the SSE controller only exists inside the route's streaming branch, which is reached AFTER auth,
    // RBAC and prompt assembly have already completed. "Thinking…" is chosen precisely because it claims
    // NOTHING about data — the model call is issued on the very next line and no read of any client's numbers
    // has begun. "Reading Foam OH · Google · Nov–Dec 2024" before a tool has been chosen would be a FALSE
    // STATUS: it would name a client, a platform and a window that nothing has looked at yet, which is the
    // same class of defect as a spinner implying progress it cannot see. On turns AFTER a tool the numbers
    // ARE in hand, so the line can honestly say so.
    // ⚠ RESIDUAL, NAMED NOT HIDDEN: everything BEFORE this function — auth, RBAC, context assembly — is still
    // silent, because no channel is open yet. That window is DB/cache work, not model work.
    emit('status', turn === 0
      ? { phase: 'thinking', label: 'Thinking…' }
      : { phase: 'composing', label: 'Working through the numbers…' })

    // messages.stream() (not stream:true) so the SDK accumulates state and finalMessage() still yields
    // stop_reason + usage + tool_use blocks per turn — the loop's control flow is unchanged.
    const stream = opts.requestOptions
      ? anthropic.messages.stream(createParams, opts.requestOptions)
      : anthropic.messages.stream(createParams)

    let turnText = ''
    // EMIT LIVE. An earlier cut buffered each turn and flushed once — which measured as first-byte 66.8s of a
    // 67.0s turn, i.e. chunked delivery of a fully-buffered answer, not streaming at all. That ships the SHAPE of
    // the feature and none of its value: the whole point is that a 59s answer renders progressively instead of
    // sitting behind a dead spinner. Deltas now go out as the model produces them.
    // Preamble on a TOOL turn is still narration, not answer: the client clears its live buffer when the `tool`
    // event lands, and the authoritative `answer` event at the end replaces whatever is on screen — so the
    // persisted answer stays exactly the blocking path's finalResp text.
    // LORAMER_CHAT_STATUS_FIRST_V1 — the explicit onFirstTurnStarted call that used to live here is GONE:
    // the wrapped `emit` above releases the commit gate on the first frame of any kind, and the status emit
    // before this line always beats the first delta. Keeping a second release path would mean two answers to
    // "when does the response commit", and one of them would rot.
    stream.on('text', (t: string) => {
      turnText += t
      emit('delta', { text: t })
    })

    const resp: any = await stream.finalMessage()
    last = resp
    const u = resp.usage || {}
    usage.input += u.input_tokens || 0
    usage.output += u.output_tokens || 0
    usage.cache_create += u.cache_creation_input_tokens || 0
    usage.cache_read += u.cache_read_input_tokens || 0
    // The split object is present whenever cache_control was sent. If the API omits it while total
    // creation is non-zero, attribute to 1h — the PREFIX (1h) is the block that dominates a cold write,
    // and under-attributing to 5m is the exact under-pricing this split exists to end.
    if (u.cache_creation && typeof u.cache_creation === 'object') {
      usage.cache_create_5m += u.cache_creation.ephemeral_5m_input_tokens || 0
      usage.cache_create_1h += u.cache_creation.ephemeral_1h_input_tokens || 0
    } else if (u.cache_creation_input_tokens) {
      usage.cache_create_1h += u.cache_creation_input_tokens
    }

    try {
      const decidedTool = (resp.content as any[])?.find((b) => b?.type === 'tool_use')
      void logToolDecision({ clientId, questionText: originalQuestion, toolCalled: !!decidedTool, toolName: decidedTool?.name ?? null, turnIndex: turn, model })
    } catch { /* never break the turn */ }

    if (resp.stop_reason === 'tool_use' && tools) {
      const toolUses = (resp.content as any[]).filter((b) => b.type === 'tool_use')
      // Tool turn: what was streamed above was preamble. Tell the client to demote it to a status line.
      //
      // LORAMER_CHAT_STATUS_SUBJECT_V1 — the event now carries the SUBJECT, not just the tool name. Before this
      // the client could only render "Checking query metrics…", because a name was the only thing on the wire;
      // `tu.input` was in scope at this exact line and was never sent. It is still not sent — toolSubject()
      // extracts only who / which platform / which window, and resolves the client to a HUMAN NAME server-side
      // so no id ever reaches the browser.
      const resolveName = await getClientNameResolver()
      for (const tu of toolUses) {
        emit('tool', {
          id: tu.id,                    // correlation id — the Anthropic tool_use id, already unique per call
          phase: 'start',
          ...toolSubject(tu.name, tu.input, clientId, resolveName),
        })
      }
      convo.push({ role: 'assistant', content: resp.content })
      // ⛔ FINISH ALWAYS FIRES, INCLUDING WHEN THE TOOL FAILS. Before this there was no finish event at all, so
      // a status line had no event that could end it: on a failure it would sit on "Reading …" until the whole
      // turn resolved. `finally` is load-bearing rather than tidy — executeToolUses catches per-tool errors and
      // returns them as is_error, but if IT throws (a DB failure outside the per-tool try, a resolver blowing up)
      // there is no other path that closes the line.
      let toolResults: any[] = []
      try {
        toolResults = await executeToolUses(toolUses, { clientId, userEmail })
      } finally {
        const errored = new Set(
          (toolResults as any[]).filter((r: any) => r?.is_error).map((r: any) => r?.tool_use_id),
        )
        for (const tu of toolUses) {
          // No results at all ⇒ executeToolUses threw ⇒ nothing succeeded. Reported as ok:false rather than
          // omitted, because "we could not look" and "we looked and it failed" are both NOT success, and a
          // missing finish is the one outcome the client cannot recover from.
          emit('tool', { id: tu.id, phase: 'finish', ok: toolResults.length > 0 && !errored.has(tu.id) })
        }
      }
      convo.push({ role: 'user', content: toolResults })
      continue
    }

    // FINAL turn — its deltas already streamed above. The route's `answer` event carries the authoritative text.
    break
  }

  const finalResp: any = last
  const responseText = finalResp
    ? (finalResp.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
    : ''
  return { responseText, usage }
}
