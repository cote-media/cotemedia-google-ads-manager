// LORAMER_BREAKDOWN_REGISTRY_V1
//
// THE ONE DECLARED SOURCE for every (platform, breakdown_type, entity_level) tuple LoraMer captures in
// metrics_daily. In G2 STEP 2 both the Lora query layer (src/lib/metrics-query.ts — BREAKDOWN_PLATFORMS /
// BREAKDOWN_PRIMARY / SPEND_ZERO / LEVEL scoping) and the Lora tool schema (src/lib/claude-tools.ts —
// query_breakdown enums) will DERIVE from this file. Until STEP 2 wires them, this file is authored but NOT
// consumed by the read path, so creating it changes ZERO runtime behavior.
//
// WHY IT EXISTS (G2 — LORA SEES EVERYTHING): millions of captured rows were UNREADABLE by Lora because the
// allowlist in metrics-query.ts and the enum in claude-tools.ts were two hand-maintained lists that drifted
// from what the writers actually persist (2026-07-16 recon: 54 hard-blind tuples — the whole Google geo
// family, all 12 GA dimensional types, Meta age_gender). Collapsing both onto this single source kills the
// drift as a CLASS — the settleRevenue / META_BREADTH_FORWARD / resolveShellClient shape.
//
// GRANULARITY: one entry per (platform, breakdown_type) — NOT per breakdown_type — because entity levels
// differ BY platform for the same dimension (google device = campaign/ad_group/ad/keyword; meta device =
// account/campaign/ad_set/ad). A single platforms[]+entityLevels[] entry cannot express that asymmetry
// without over-declaring tuples that were never captured. Expanding all entries by entityLevels reproduces
// EXACTLY the 118 live tuples the recon found.
//
// GEO COLLAPSE (limit #1 — a ~44-value flat enum degrades tool selection): the 19 Google geo breakdown_types
// collapse to ONE tool-facing type 'geo' + a (geoGrain, geoScope) axis — EXCEPT geo_country / geo_region,
// which keep their own tool types so the SAME country/region question unifies Shopify + Meta + Google (the
// recon "add google to geo_country/geo_region platforms"). So 'geo' carries the 17 google-only fine grains;
// geo_country/geo_region carry country/region ACROSS all platforms. Every real geo breakdown_type maps to
// exactly ONE toolType — no tuple is declared twice.
//
// DERIVED-FROM-CODE GUARD: tests/guards/breakdown-registry-drift.guard.mjs asserts the query_breakdown enums
// in claude-tools.ts equal the enums derived from this file. THAT GUARD PROVES SCHEMA / QUERY-LAYER PARITY
// ONLY — it CANNOT prove live-DB reachability (CI has no DB, and the DB is prod). A separate non-build
// reachability check (loose-index-scan of live DISTINCT tuples vs this registry) is a G2 STEP 2 deliverable.

export type Platform = 'google' | 'meta' | 'shopify' | 'woocommerce' | 'ga'
export type EntityLevel = 'account' | 'campaign' | 'ad_group' | 'ad_set' | 'ad' | 'keyword' | 'product' | 'variant'
export type Surface = 'base' | 'breakdown'
export type RankBy = 'spend' | 'conversions' | 'revenue' | 'impressions' | 'clicks'
export type GeoScope = 'ad' | 'user'

export interface BreakdownEntry {
  platform: Platform
  breakdownType: string        // the REAL metrics_daily breakdown_type string ('' = base rows)
  toolType: string             // the tool-facing type Lora selects (geo family collapses to 'geo'); '' for base
  surface: Surface             // 'base' = read via query_metrics (level); 'breakdown' = read via query_breakdown
  entityLevels: EntityLevel[]  // the grains this (platform, breakdown_type) is actually captured at, per the live DB
  rankBy: RankBy               // default ranking anchor; SPEND_ZERO families rank by conversions, stores/ga by revenue
  additive: boolean            // false = non-additive per-entity projection (impression_share, video) — never summed
  highCardinality: boolean     // true = wide-window reads risk the 8s statement_timeout (limit #2); must have rankBy
  geoGrain?: string            // city|county|metro|state|province|district|postal|most_specific|region|country
  geoScope?: GeoScope          // ad-location vs user-location
  note?: string
}

// One entry per (platform, breakdown_type). Authored one-per-line so the hermetic guard can text-derive the
// declared enums without executing TypeScript. Expands to the 118 live tuples the 2026-07-16 recon verified.
export const REGISTRY: BreakdownEntry[] = [
  // ── BASE ROWS (breakdown_type ''): read via query_metrics `level`, NOT query_breakdown ────────────────────
  { platform: 'ga', breakdownType: '', toolType: '', surface: 'base', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'google', breakdownType: '', toolType: '', surface: 'base', entityLevels: ['account', 'campaign', 'ad_group', 'ad'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'meta', breakdownType: '', toolType: '', surface: 'base', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'shopify', breakdownType: '', toolType: '', surface: 'base', entityLevels: ['account', 'product', 'variant'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'woocommerce', breakdownType: '', toolType: '', surface: 'base', entityLevels: ['account', 'product', 'variant'], rankBy: 'revenue', additive: true, highCardinality: false },

  // ── GA DIMENSIONAL (platform 'ga', account grain): the entire LORAMER_GA_DIMENSIONAL_CAPTURE_V1 flight ─────
  { platform: 'ga', breakdownType: 'ga_age', toolType: 'ga_age', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_campaign', toolType: 'ga_campaign', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_channel', toolType: 'ga_channel', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_device', toolType: 'ga_device', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_event', toolType: 'ga_event', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_gender', toolType: 'ga_gender', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_geo_city', toolType: 'ga_geo_city', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: true },
  { platform: 'ga', breakdownType: 'ga_geo_country', toolType: 'ga_geo_country', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_geo_region', toolType: 'ga_geo_region', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_item', toolType: 'ga_item', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },
  { platform: 'ga', breakdownType: 'ga_landing_page', toolType: 'ga_landing_page', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: true },
  { platform: 'ga', breakdownType: 'ga_source_medium', toolType: 'ga_source_medium', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false },

  // ── GOOGLE non-geo dimensional (already visible today, preserved) ─────────────────────────────────────────
  { platform: 'google', breakdownType: 'conversion_action', toolType: 'conversion_action', surface: 'breakdown', entityLevels: ['campaign'], rankBy: 'conversions', additive: true, highCardinality: false, note: 'SPEND_ZERO — per-action conversions, spend cols are 0; rank by conversions.' },
  { platform: 'google', breakdownType: 'device', toolType: 'device', surface: 'breakdown', entityLevels: ['campaign', 'ad_group', 'ad', 'keyword'], rankBy: 'spend', additive: true, highCardinality: false, note: 'ad_group + keyword grains are new to Lora (were unreachable — entityLevel enum lacked them).' },
  { platform: 'google', breakdownType: 'hour', toolType: 'hour', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, note: 'hour "00" is a Google catch-all bucket (Display/PMax full-day spend) — not real midnight.' },
  { platform: 'google', breakdownType: 'impression_share', toolType: 'impression_share', surface: 'breakdown', entityLevels: ['campaign'], rankBy: 'spend', additive: false, highCardinality: false, note: 'NON-ADDITIVE point-in-time ratios — never summed; most-recent in-window per campaign.' },
  { platform: 'google', breakdownType: 'keyword', toolType: 'keyword', surface: 'breakdown', entityLevels: ['ad_group'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'google', breakdownType: 'search_term', toolType: 'search_term', surface: 'breakdown', entityLevels: ['ad_group'], rankBy: 'spend', additive: true, highCardinality: false, note: 'wide-window reads page all rows to JS — the 12mo≈18s ROUTE finding; STEP 2 must SQL-aggregate.' },
  // Google age/gender (G-FILL#3) — SAME cross-platform toolType as Meta age/gender (query requires platform now).
  // age_range_view/gender_view served at campaign + ad_group only; value = the raw enum (AGE_RANGE_* / MALE/FEMALE/UNDETERMINED).
  { platform: 'google', breakdownType: 'age', toolType: 'age', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, note: 'google age (age_range_view); value = AGE_RANGE_* enum. FLAG-NOT-BLOCK partition of campaign spend.' },
  { platform: 'google', breakdownType: 'gender', toolType: 'gender', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, note: 'google gender (gender_view); value = MALE/FEMALE/UNDETERMINED. FLAG-NOT-BLOCK partition of campaign spend.' },

  // ── GOOGLE GEO FAMILY — 19 real types, collapsed to toolType 'geo' EXCEPT geo_country/geo_region ──────────
  // ad-location scope (segments.geo_target_*)
  { platform: 'google', breakdownType: 'geo_city', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: true, geoGrain: 'city', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_country', toolType: 'geo_country', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'country', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_county', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'county', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_district', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'district', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_metro', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'metro', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_most_specific', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: true, geoGrain: 'most_specific', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_postal', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: true, geoGrain: 'postal', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_province', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'province', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_region', toolType: 'geo_region', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'region', geoScope: 'ad' },
  { platform: 'google', breakdownType: 'geo_state', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'state', geoScope: 'ad' },
  // user-location scope (segments.geo_target_* user)
  { platform: 'google', breakdownType: 'user_geo_city', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: true, geoGrain: 'city', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_county', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'county', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_district', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'district', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_metro', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'metro', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_most_specific', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: true, geoGrain: 'most_specific', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_postal', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: true, geoGrain: 'postal', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_province', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'province', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_region', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'region', geoScope: 'user' },
  { platform: 'google', breakdownType: 'user_geo_state', toolType: 'geo', surface: 'breakdown', entityLevels: ['campaign', 'ad_group'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'state', geoScope: 'user' },

  // ── META dimensional ──────────────────────────────────────────────────────────────────────────────────────
  { platform: 'meta', breakdownType: 'action_type', toolType: 'action_type', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'conversions', additive: true, highCardinality: false, note: 'SPEND_ZERO — per-action conversions; rank by conversions.' },
  { platform: 'meta', breakdownType: 'age', toolType: 'age', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'meta', breakdownType: 'age_gender', toolType: 'age_gender', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'hard-blind at HEAD — never in the enum despite 425,293 captured rows.' },
  { platform: 'meta', breakdownType: 'device', toolType: 'device', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'meta', breakdownType: 'device_platform', toolType: 'device_platform', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'meta', breakdownType: 'gender', toolType: 'gender', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'meta', breakdownType: 'geo_country', toolType: 'geo_country', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'country', geoScope: 'user' },
  { platform: 'meta', breakdownType: 'geo_region', toolType: 'geo_region', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, geoGrain: 'region', geoScope: 'user' },
  { platform: 'meta', breakdownType: 'hour', toolType: 'hour', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false },
  { platform: 'meta', breakdownType: 'placement', toolType: 'placement', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'writer stores publisher:position as breakdown_type=placement; legacy read-name publisher_platform aliases here. Grain-complete campaign+ad_set+ad (LORAMER_META_PLACEMENT_ADSET_AD_V1); account is derive-not-capture (clean rollup of campaign).' },
  { platform: 'meta', breakdownType: 'video', toolType: 'video', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: false, highCardinality: false, note: 'NON-ADDITIVE per-entity projection — view counts summed, rates null across multi-day windows.' },

  // ── META creative-ASSET family (M-FILL#1) — 7 breakdown_types, campaign/ad_set/ad ONLY (account served-empty). ─
  // WRITE-ONLY component attribution: per-asset spend is NOT a partition — NEVER sum across asset types or to the ad
  // total (title over-counts under Dynamic Creative). breakdown_value = the canonical label per type (description=id).
  { platform: 'meta', breakdownType: 'image_asset', toolType: 'image_asset', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'creative image; value = image name. Component attribution — never sum across asset types or to the ad total.' },
  { platform: 'meta', breakdownType: 'video_asset', toolType: 'video_asset', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'creative video; value = video name. Component attribution — never sum across asset types or to the ad total.' },
  { platform: 'meta', breakdownType: 'title_asset', toolType: 'title_asset', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'headline text; value = the headline. Component attribution — never sum across asset types or to the ad total.' },
  { platform: 'meta', breakdownType: 'body_asset', toolType: 'body_asset', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'primary text; value = the body (capped). Component attribution — never sum across asset types or to the ad total.' },
  { platform: 'meta', breakdownType: 'call_to_action_asset', toolType: 'call_to_action_asset', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'CTA enum (LEARN_MORE…). Component attribution — never sum across asset types or to the ad total.' },
  { platform: 'meta', breakdownType: 'description_asset', toolType: 'description_asset', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'link description; value = ASSET ID ONLY (Meta serves no label). Component attribution — never sum across asset types or to the ad total.' },
  { platform: 'meta', breakdownType: 'link_url_asset', toolType: 'link_url_asset', surface: 'breakdown', entityLevels: ['campaign', 'ad_set', 'ad'], rankBy: 'spend', additive: true, highCardinality: false, note: 'destination URL; value = website_url (else asset id). Component attribution — never sum across asset types or to the ad total.' },

  // ── META attribution windows (M-FILL#2) — per (action_type × window) conversions/value; spend 0 (SPEND_ZERO). ──
  { platform: 'meta', breakdownType: 'attribution_window', toolType: 'attribution_window', surface: 'breakdown', entityLevels: ['account', 'campaign', 'ad_set', 'ad'], rankBy: 'conversions', additive: true, highCardinality: false, note: 'value = "<action_type>:<window>" (1d_click/7d_click/28d_click/1d_view). Windows OVERLAP (1d⊂7d⊂28d) + view/click double-count → NEVER sum across windows.' },

  // ── SHOPIFY dimensional (store ship-to geo) ──────────────────────────────────────────────────────────────
  { platform: 'shopify', breakdownType: 'geo_country', toolType: 'geo_country', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false, geoGrain: 'country', geoScope: 'ad' },
  { platform: 'shopify', breakdownType: 'geo_region', toolType: 'geo_region', surface: 'breakdown', entityLevels: ['account'], rankBy: 'revenue', additive: true, highCardinality: false, geoGrain: 'region', geoScope: 'ad' },
  { platform: 'shopify', breakdownType: 'abandoned_checkout', toolType: 'abandoned_checkout', surface: 'breakdown', entityLevels: ['account'], rankBy: 'conversions', additive: false, highCardinality: false, note: 'WRITE-ONLY POTENTIAL/LOST revenue — Σ abandoned-checkout totalPriceSet in conversionValue + abandoned count in conversions; spend/revenue are 0. NEVER actual revenue; never sum/reconcile into net sales or order counts. ~90-day Shopify retention floor → forward-first, NOT full history like orders (S-FILL#2, LORAMER_SHOPIFY_ABANDONED_VALUE_V1).' },
]

// ── DERIVATIONS — the single source the tool schema (STEP 2) and this file's guard both read ─────────────────
const BREAKDOWN = REGISTRY.filter((e) => e.surface === 'breakdown')
const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort()

/** The query_breakdown `breakdownType` enum: unique tool-facing types (geo family collapsed to 'geo'). */
export const breakdownToolTypes = (): string[] => uniqSorted(BREAKDOWN.map((e) => e.toolType))
/** The query_breakdown `platform` enum: platforms that serve at least one dimensional breakdown. */
export const breakdownPlatforms = (): string[] => uniqSorted(BREAKDOWN.map((e) => e.platform))
/** The query_breakdown `entityLevel` enum: every grain a dimensional breakdown is captured at. */
export const breakdownEntityLevels = (): string[] => uniqSorted(BREAKDOWN.flatMap((e) => e.entityLevels))
/** Total (platform, breakdown_type, entity_level) tuples this registry DECLARES — code-only, not live-DB. */
export const declaredTupleCount = (): number => REGISTRY.reduce((n, e) => n + e.entityLevels.length, 0)
/** Real metrics_daily breakdown_types + platforms behind a tool-facing type (geo → its 17 fine-grain types). */
export const resolveToolType = (toolType: string): BreakdownEntry[] => BREAKDOWN.filter((e) => e.toolType === toolType)
/** All platforms a tool-facing type is captured on (e.g. geo_country → shopify, meta, google). */
export const platformsForToolType = (toolType: string): string[] => uniqSorted(resolveToolType(toolType).map((e) => e.platform))
/** The one entry for a real (platform, breakdown_type), or undefined if not captured. */
export const entryFor = (platform: string, breakdownType: string): BreakdownEntry | undefined =>
  REGISTRY.find((e) => e.platform === platform && e.breakdownType === breakdownType)

// ── QUERY-LAYER derivations (src/lib/metrics-query.ts consumes these; its hand-maintained literals are deleted) ─
/** breakdown_type (REAL) → the platforms that serve it — the BREAKDOWN_PLATFORMS allowlist, registry-derived. */
export const breakdownPlatformsMap = (): Record<string, string[]> => {
  const m: Record<string, string[]> = {}
  for (const e of BREAKDOWN) (m[e.breakdownType] ||= []).push(e.platform)
  for (const k of Object.keys(m)) m[k] = uniqSorted(m[k])
  return m
}
/** SPEND_ZERO breakdown_types (per-action conversions, spend=0) = those whose default rank is conversions. */
export const spendZeroTypes = (): Set<string> => new Set(BREAKDOWN.filter((e) => e.rankBy === 'conversions').map((e) => e.breakdownType))
/** The tool-facing 'geo' collapse: (geoGrain, geoScope) → the REAL Google geo breakdown_type, or undefined. */
export const resolveGeo = (geoGrain: string, geoScope: string): string | undefined =>
  BREAKDOWN.find((e) => e.toolType === 'geo' && e.geoGrain === geoGrain && e.geoScope === geoScope)?.breakdownType
/** Valid geoGrain values on the collapsed 'geo' tool type (for the tool enum + description). */
export const geoGrains = (): string[] => uniqSorted(BREAKDOWN.filter((e) => e.toolType === 'geo' && e.geoGrain).map((e) => e.geoGrain as string))
/** Valid geoScope values: 'ad' = where you TARGETED, 'user' = where the person PHYSICALLY WAS (not interchangeable). */
export const geoScopes = (): string[] => uniqSorted(BREAKDOWN.filter((e) => e.toolType === 'geo' && e.geoScope).map((e) => e.geoScope as string))
// The 14 tool-facing types reachable at HEAD — the BYTE-IDENTICAL-protected set. Everything the registry declares
// beyond these is NEW reach → routed through the bounded top-N RPC (migration 039). This list is a FROZEN invariant,
// not an allowlist: it names the pre-2B contract so the query layer can keep those exact paths unchanged.
export const EXISTING_TOOL_TYPES: ReadonlySet<string> = new Set(['search_term', 'keyword', 'placement', 'age', 'gender', 'device', 'device_platform', 'hour', 'action_type', 'conversion_action', 'impression_share', 'video', 'geo_country', 'geo_region'])
