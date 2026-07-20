// LORAMER_QUERY_METRICS_0B_V1
// LORAMER_QUERY_METRICS_DATE_FLEX_V1 - adds optional explicit `windows` so any
// arbitrary date range (e.g. Q4 2024) can be queried directly. Additive and
// fully back-compatible: when `windows` is absent the baseRange/offsetsMonths
// path is behavior-identical to before.
// Phase 0b query layer over metrics_daily. Pure aggregation + multi-period
// comparison FROM THE STORE (no live platform fetch). Account-level by default;
// generalizes to campaign/ad_group/ad/product via the `level` arg. JS-side
// summation with pagination (Supabase returns max 1000 rows per select). Phase 3
// may move the sums into a Postgres RPC if query volume warrants it.

import { supabaseAdmin } from '@/lib/supabase'
import { projectActionCanon } from '@/lib/meta-action-canon' // LORAMER_META_ALIAS_CANON — opt-in read-layer Meta action_type alias collapse
import { resolveDateWindow } from '@/lib/date-range'
import { aggregateMoney, MONEY_KEYS, chainForBasis } from '@/lib/next/money-surface' // LORAMER_QUERY_MONEY_V1 — reuse the canonical money aggregation (reconciles with /api/next/money by construction)
// LORAMER_LORA_QUERYMETRICS_CANONICAL_V1 (Fix #1 B2) — CONSUME the ONE canonical settle (B1). Do NOT write a 4th settle.
import { settleRevenue, emptyRevenueAcc, type RevenueAcc } from '@/lib/next/revenue-settle'
// LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B) — the ONE declared source for the breakdown allowlist + geo collapse.
import { breakdownPlatformsMap, spendZeroTypes, breakdownToolTypes, resolveGeo, geoGrains, entryFor, EXISTING_TOOL_TYPES } from '@/lib/breakdown-registry'

export type MetricTotals = {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  revenue: number
  rowCount: number
}

// LORAMER_LORA_QUERYMETRICS_CANONICAL_V1 (Fix #1 B2) — the card-canonical figure + labeled per-source split.
export type Canonical = {
  revenue: number | null
  revenueSource: 'store' | 'ga' | 'none'
  roas: number | null
}
export type BySource = {
  store: { revenue: number; rows: number }
  ga: { revenue: number; rows: number }
  google: { spend: number; conversionValue: number }
  meta: { spend: number; conversionValue: number }
}

export type WindowResult = {
  label: string
  startDate: string
  endDate: string
  totals: MetricTotals
  derived: Record<string, number>
  // ADDITIVE (B2): canonical = the dashboard-card number (store>ga>none, never summed; roas = revenue/spend).
  // bySource = every source visible in ONE result, for multi-source ROAS honesty. Only Lora reads these;
  // totals/derived are UNCHANGED so store-stats and the headless route stay byte-identical.
  canonical: Canonical
  bySource: BySource
}

export type QueryMetricsResult = {
  level: string
  platforms: string[]
  baseRange: string
  windows: WindowResult[]
  notes?: string[]
}

function emptyTotals(): MetricTotals {
  return { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, revenue: 0, rowCount: 0 }
}

// LORAMER_LORA_QUERYMETRICS_CANONICAL_V1 (Fix #1 B2) — aggregateWindow carries the raw totals (unchanged) PLUS
// the per-source accumulation needed for the canonical settle and the labeled bySource split.
type WindowAgg = {
  totals: MetricTotals
  acc: RevenueAcc // ads spend/conv (google+meta) + store/ga revenue split — the card's RevenueAcc shape
  google: { spend: number; conversionValue: number }
  meta: { spend: number; conversionValue: number }
}
function emptyAgg(): WindowAgg {
  return { totals: emptyTotals(), acc: emptyRevenueAcc(), google: { spend: 0, conversionValue: 0 }, meta: { spend: 0, conversionValue: 0 } }
}
// Build the card-canonical figure + labeled per-source split from an aggregate, via the ONE settle (B1).
function buildCanonical(agg: WindowAgg): { canonical: Canonical; bySource: BySource } {
  const s = settleRevenue(agg.acc)
  return {
    canonical: { revenue: s.revenue, revenueSource: s.revenueSource, roas: s.roas },
    bySource: {
      store: { revenue: Number(agg.acc.storeRev.toFixed(2)), rows: agg.acc.storeRows },
      ga: { revenue: Number(agg.acc.gaRev.toFixed(2)), rows: agg.acc.gaRows },
      google: { spend: Number(agg.google.spend.toFixed(2)), conversionValue: Number(agg.google.conversionValue.toFixed(2)) },
      meta: { spend: Number(agg.meta.spend.toFixed(2)), conversionValue: Number(agg.meta.conversionValue.toFixed(2)) },
    },
  }
}

function addDaysUTC(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

function shiftMonthsUTC(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().split('T')[0]
}

function daysInclusive(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z').getTime()
  const e = new Date(end + 'T00:00:00Z').getTime()
  return Math.round((e - s) / 86400000) + 1
}

function derive(t: MetricTotals): Record<string, number> {
  const d: Record<string, number> = {}
  if (t.impressions > 0) d.ctr = Number((t.clicks / t.impressions * 100).toFixed(2))
  if (t.clicks > 0) d.cpc = Number((t.spend / t.clicks).toFixed(2))
  if (t.conversions > 0) {
    d.cpa = Number((t.spend / t.conversions).toFixed(2))
    if (t.revenue > 0) d.aov = Number((t.revenue / t.conversions).toFixed(2))
  }
  if (t.spend > 0 && t.conversionValue > 0) d.roas = Number((t.conversionValue / t.spend).toFixed(2))
  return d
}

const AGG_ADS = ['google', 'meta']
const AGG_STORE = ['shopify', 'woocommerce']
async function aggregateWindow(
  clientId: string,
  platforms: string[],
  level: string,
  startDate: string,
  endDate: string
): Promise<WindowAgg> {
  const out = emptyAgg()
  const { totals, acc } = out
  const PAGE = 1000
  let from = 0
  for (;;) {
    let q = supabaseAdmin
      .from('metrics_daily')
      // LORAMER_LORA_QUERYMETRICS_CANONICAL_V1 (B2) — `platform` added to the SELECT (covered by the 035 index INCLUDE,
      // so the index-only scan / A6 latency is preserved) to split revenue per source for the canonical settle.
      .select('platform,spend,impressions,clicks,conversions,conversion_value,revenue')
      .eq('client_id', clientId)
      .eq('entity_level', level)
      .eq('breakdown_type', '')
      // LORAMER_LORA_QUERYMETRICS_INDEX_MATCH_V1 (Fix #1 A6) — complete the account-canonical predicate so the query
      // matches the migration-035 partial index (WHERE entity_level='account' AND breakdown_type='' AND breakdown_value='').
      // Verified drops ZERO rows: base rows are ALWAYS (breakdown_type='' ⟺ breakdown_value=''); dimensional rows carry
      // both non-empty. aggregateWindow ONLY — NOT queryBreakdown/queryMoney (they read breakdown rows, bt≠'').
      .eq('breakdown_value', '')
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + PAGE - 1)
    if (platforms.length === 1) q = q.eq('platform', platforms[0])
    else if (platforms.length > 1) q = q.in('platform', platforms)
    const { data, error } = await q
    if (error) throw new Error('metrics_daily query failed: ' + error.message)
    const rows = data || []
    for (const r of rows) {
      const row = r as Record<string, unknown>
      const spend = Number(row.spend || 0)
      const impressions = Number(row.impressions || 0)
      const clicks = Number(row.clicks || 0)
      const conversions = Number(row.conversions || 0)
      const conversionValue = Number(row.conversion_value || 0)
      const revenue = Number(row.revenue || 0)
      const platform = String(row.platform || '')
      // totals — UNCHANGED raw cross-platform sums (additive law; store-stats + headless route must not move).
      totals.spend += spend
      totals.impressions += impressions
      totals.clicks += clicks
      totals.conversions += conversions
      totals.conversionValue += conversionValue
      totals.revenue += revenue
      totals.rowCount += 1
      // per-source canonical accumulation — mirrors the card's RevenueAcc (store>ga>none, ads-only spend/conv).
      if (AGG_ADS.includes(platform)) {
        acc.spend += spend; acc.conversions += conversions; acc.conversionValue += conversionValue
        acc.impressions += impressions; acc.clicks += clicks
        if (platform === 'google') { out.google.spend += spend; out.google.conversionValue += conversionValue }
        else { out.meta.spend += spend; out.meta.conversionValue += conversionValue }
      } else if (AGG_STORE.includes(platform)) { acc.storeRev += revenue; acc.storeRows += 1 }
      else if (platform === 'ga') { acc.gaRev += revenue; acc.gaRows += 1 }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  return out
}

// Multi-period comparison. Two mutually-exclusive modes:
//   (A) Explicit windows: opts.windows = exact [{label?,startDate,endDate}]. Each
//       window is aggregated as-is (any dates, any length, any count). baseRange
//       and offsetsMonths are IGNORED in this mode. Used for arbitrary calendar
//       periods like "Q4 2024". Each window is validated as YYYY-MM-DD with
//       start <= end; invalid windows return honest empty totals (no DB error).
//   (B) Rolling presets (default, unchanged): each offset in offsetsMonths
//       produces an EQUAL-LENGTH window ending that many calendar months before
//       the base window's end date. offset 0 = the base window itself.
export async function queryMetrics(opts: {
  clientId: string
  platforms?: string[]
  level?: string
  baseRange?: string
  offsetsMonths?: number[]
  windows?: Array<{ label?: string; startDate: string; endDate: string }>
}): Promise<QueryMetricsResult> {
  const level = opts.level || 'account'
  const platforms = opts.platforms && opts.platforms.length ? opts.platforms : []
  const baseRange = opts.baseRange || 'LAST_7_DAYS'
  const explicitWindows = Array.isArray(opts.windows) ? opts.windows : []
  const windows: WindowResult[] = []

  if (explicitWindows.length) {
    const ISO = /^\d{4}-\d{2}-\d{2}$/
    for (const w of explicitWindows) {
      const startDate = typeof w?.startDate === 'string' ? w.startDate.trim() : ''
      const endDate = typeof w?.endDate === 'string' ? w.endDate.trim() : ''
      const label = typeof w?.label === 'string' && w.label.trim() ? w.label.trim() : `${startDate}..${endDate}`
      const valid = ISO.test(startDate) && ISO.test(endDate) && startDate <= endDate
      const agg = valid
        ? await aggregateWindow(opts.clientId, platforms, level, startDate, endDate)
        : emptyAgg()
      windows.push({ label, startDate, endDate, totals: agg.totals, derived: derive(agg.totals), ...buildCanonical(agg) })
    }
  } else {
    const offsets = opts.offsetsMonths && opts.offsetsMonths.length ? opts.offsetsMonths : [0, 6, 12, 18]
    const base = resolveDateWindow(baseRange)
    const span = daysInclusive(base.startDate, base.endDate)
    for (const off of offsets) {
      const endDate = off === 0 ? base.endDate : shiftMonthsUTC(base.endDate, -off)
      const startDate = off === 0 ? base.startDate : addDaysUTC(endDate, -(span - 1))
      const agg = await aggregateWindow(opts.clientId, platforms, level, startDate, endDate)
      windows.push({
        label: off === 0 ? baseRange : off + 'mo ago',
        startDate,
        endDate,
        totals: agg.totals,
        derived: derive(agg.totals),
        ...buildCanonical(agg),
      })
    }
  }

  const resolvedPlatforms = platforms.length ? platforms : ['all']
  const notes: string[] = []
  const metaInScope = resolvedPlatforms.includes('meta') || resolvedPlatforms.includes('all')
  if (metaInScope) {
    notes.push('IMPORTANT - when this answer reports Meta conversion counts or CPA, you MUST add one brief sentence telling the user these are Meta account-level historical figures that are directionally accurate but may not perfectly reconcile with campaign-level conversion numbers, while Meta spend, clicks, and impressions are exact. Omit this note entirely when the answer does not discuss conversions or CPA.')
  }
  // LORAMER_LORA_QUERYMETRICS_CANONICAL_V1 (B2) — steer Lora onto canonical.*, away from the raw totals.revenue double-count.
  if (level === 'account') {
    notes.push('REVENUE/ROAS: the headline TOTAL is canonical.revenue and canonical.roas — these MATCH THE DASHBOARD CARDS (revenue precedence store > ga > none, NEVER summed; roas = revenue / spend). totals.revenue is a RAW cross-platform SUM that DOUBLE-COUNTS store + GA — NEVER report totals.revenue as total revenue. derived.roas is AD-ATTRIBUTED (platform conversionValue / spend), a DIFFERENT basis — it is NOT the card ROAS; use canonical.roas for the dashboard figure.')
  }
  if (windows.some(w => w.bySource.store.rows > 0 && w.bySource.ga.rows > 0)) {
    notes.push('MULTIPLE REVENUE SOURCES present (bySource shows BOTH store and ga). When the user asks about revenue or ROAS, surface BOTH sources labeled by origin, each with its own ROAS (that source’s revenue ÷ ad spend), and explain WHY they differ (attribution window / measurement basis). Do NOT collapse them into one number and do NOT silently drop the smaller source.')
  }
  return { level, platforms: resolvedPlatforms, baseRange, windows, notes: notes.length ? notes : undefined }
}

// ─── LORAMER_QUERY_BREAKDOWN_V1 ────────────────────────────────────────────────
// Phase 1.1: the BREAKDOWN reader. A SEPARATE path from queryMetrics/aggregateWindow
// (which stay byte-identical, base-rows-only). This reads ONLY dimensional rows
// (breakdown_type != ''), groups by breakdown_value (the term/keyword/dimension
// text) over a single window, ranks, and returns the top N. Structural
// double-count guard: it filters .eq('breakdown_type', <the one requested grain>)
// and NEVER '', so it cannot read or sum a base row, and one call reads exactly one
// grain. The summed metrics here are a SUBSET of the entity's base total (e.g. the
// search-term-attributed portion) and must never be presented as the account total.

// NOTE: 'product' is NOT here — products are a BASE entity_level (read via query_metrics
// level='product'), not a breakdown_type. geo_country/geo_region are Shopify breakdowns
// (LORAMER_SHOPIFY_DEPTH_2A_V1).
// LORAMER_QUERY_ALLOWLIST_BREADTH_V1 — multi-platform allowlist. A breakdown_type maps to the platform(s) that
// capture it (PRIMARY first). Resolution (below): an explicit opts.platform must be in the list; omitted + single
// platform → that one; omitted + multi-platform → the documented BREAKDOWN_PRIMARY (back-compat) or, if none,
// platform is REQUIRED (a loud note, never a guess). Adds device/device_platform/hour + Meta on geo_* +
// action_type/conversion_action. NON-additive families (impression_share, video) are NOT here — they need a
// singleVal/extra-aware path (P1b), never this sum-6-metrics path (which would return misleading zero rows).
// LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B) — the allowlist + rank/spend-zero semantics DERIVE from the ONE
// declared source (src/lib/breakdown-registry.ts). The hand-maintained literals that used to live here are DELETED
// so the tool schema (claude-tools.ts) and this query layer cannot drift. geo / GA / age_gender and every other
// captured tuple become reachable BY CONSTRUCTION of the registry.
const BREAKDOWN_ALIAS: Record<string, string> = { publisher_platform: 'placement' } // the ONE legacy read-name (writer stores 'placement') — an alias, not registry data
const BREAKDOWN_PLATFORMS: Record<string, string[]> = breakdownPlatformsMap() // REAL breakdown_type → platforms that serve it
// Back-compat PRIMARY: a multi-platform commerce type served on Shopify defaults to Shopify when platform is omitted
// (the historical geo_country/geo_region behavior) — DERIVED from the platform map, not a literal. Multi-platform ad
// types (device, hour) have no Shopify member → no primary → platform REQUIRED, exactly as before.
const BREAKDOWN_PRIMARY: Record<string, string> = Object.fromEntries(
  Object.entries(BREAKDOWN_PLATFORMS).filter(([, ps]) => ps.length > 1 && ps.includes('shopify')).map(([bt]) => [bt, 'shopify'])
)
const SPEND_ZERO_BREAKDOWNS = spendZeroTypes() // per-action-conversion families (rankBy conversions): action_type + conversion_action
// LORAMER_QUERY_NONADDITIVE_V1 — impression_share + video are PER-ENTITY metric families (their breakdown_value is a
// constant/empty marker), so they are grouped by ENTITY, not value, and their non-additive fields are NEVER summed
// as base metrics. Handled by projectNonAdditive() below — NOT the additive sum-6-metrics path. Zero effect on any
// other breakdown_type.
const NONADDITIVE_BREAKDOWNS = new Set(['impression_share', 'video'])
// LORAMER_ASSET_ATTRWINDOW_WIRE_V1 (M-FILL#1/#2 read-path) — the 7 Meta creative-asset breakdown_types. Their spend is
// COMPONENT ATTRIBUTION (additive WITHIN a type for ranking, but never a partition of the ad total) → a provenance note.
// LORAMER_META_BATCH_MB_V1 — the four M-FILL#1b dims are ADDED HERE, not just to the registry. This set is
// an explicit allowlist, so a new asset dim that is not listed silently loses the never-mis-sum caveat while
// looking fully wired everywhere else — exactly the kind of half-shipped family this repo keeps finding.
const ASSET_BREAKDOWNS = new Set([
  'image_asset', 'video_asset', 'title_asset', 'body_asset', 'call_to_action_asset', 'description_asset', 'link_url_asset',
  'ad_format_asset', 'creative_relaxation_asset_type', 'flexible_format_asset_type', 'gen_ai_asset_type',
])
// impression_share (google, campaign): 7 POINT-IN-TIME ratios in extra — never summed; per campaign take the MOST
// RECENT captured day in-window (a real value, flagged), never an aggregate. null = the API -1 non-eligible sentinel.
const IS_RATIO_FIELDS = ['search_impression_share', 'search_top_impression_share', 'search_absolute_top_impression_share', 'search_budget_lost_impression_share', 'search_rank_lost_impression_share', 'search_budget_lost_top_impression_share', 'search_rank_lost_top_impression_share']
// video (meta, per entity level): 8 COUNTS sum across days; 2 RATES are single-value (null when the window spans >1
// day — a per-period rate is not aggregatable). NO cross-entity double-count: scope to ONE entity_level (default campaign).
const VIDEO_COUNT_FIELDS = ['video_plays', 'video_thruplays', 'video_p25', 'video_p50', 'video_p75', 'video_p95', 'video_p100', 'video_30s']
const VIDEO_RATE_FIELDS = ['video_avg_time_sec', 'cost_per_thruplay']
const VIDEO_ENTITY_LEVELS = new Set(['account', 'campaign', 'ad_set', 'ad'])
// revenue is rankable too — Shopify geo/product breakdowns are revenue-centric (LORAMER_SHOPIFY_DEPTH_2A_V1).
const RANKABLE = new Set(['spend', 'impressions', 'clicks', 'conversions', 'conversionValue', 'revenue'])
const VALUE_MAXLEN = 120

export type BreakdownRow = {
  value: string
  parentEntityId?: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  revenue: number
  derived: Record<string, number>
  // LORAMER_QUERY_NONADDITIVE_V1 — for impression_share/video rows: the projected metrics (IS ratios / video counts
  // + rates). null = not aggregatable (multi-day rate) or non-eligible (IS -1). Absent on additive-breakdown rows.
  nonAdditiveMetrics?: Record<string, number | null>
  // LORAMER_META_CONV_ACTION_VALUE_ROAS_V1 — Meta-REPORTED ROAS (extra.purchase_roas ?? website_purchase_roas)
  // for the canonicalized action_type card ONLY. null = Meta reports none (e.g. view_content/lead). NEVER
  // value÷spend (action_type spend=0). Absent on every other breakdown (carried only when canonicalize+action_type+meta).
  metaRoas?: number | null
  // LORAMER_GEO_RESOLVE_V1 (geo STEP 2) — GOOGLE geo breakdowns only: the raw `value` stays the geoTargetConstants
  // id (with any :LOCATION_TYPE suffix); these ADD the resolved place. geoResolved=false = a DMA/metro id Google's
  // reference does not name (never fabricate a name; the spend is still real). Absent on every non-google-geo row.
  geoId?: string
  geoName?: string
  geoCanonicalName?: string
  geoLocationType?: string // 'presence' (physically there) | 'interest' (showed interest) | 'unspecified'
  geoResolved?: boolean
}

export type QueryBreakdownResult = {
  breakdownType: string
  platform: string
  window: { startDate: string; endDate: string }
  rankBy: string
  rows: BreakdownRow[]
  distinctValueCount: number
  truncated: boolean
  note?: string
  nonAdditive?: boolean       // LORAMER_QUERY_NONADDITIVE_V1 — rows are per-entity projections, not summed base metrics
  entityLevel?: string        // video only — which entity grain the rows are scoped to
}

// LORAMER_GEO_RESOLVE_V1 (geo STEP 2) — resolve GOOGLE geo criterion ids to place names on the topN rows ONLY.
// Presentation-only: parses the bare id off breakdown_value ("geoTargetConstants/<id>[:<TYPE>]"), KEEPS the raw
// value + the location_type meaning, ADDS geoName/geoCanonicalName from the geo_target_constant reference (migration
// 040). A miss (DMA/metro — Google's CSV carries no DMA type) is marked geoResolved:false, never fabricated, never
// dropped. Numbers are untouched. Appends a note so Lora reads names + presence/interest + unresolved codes correctly.
const GEO_LOCTYPE: Record<string, string> = { LOCATION_OF_PRESENCE: 'presence', AREA_OF_INTEREST: 'interest' }
async function resolveGeoRows(result: QueryBreakdownResult, platform: string, bt: string): Promise<void> {
  if (platform !== 'google' || !(bt.startsWith('geo_') || bt.startsWith('user_geo_')) || result.rows.length === 0) return
  const parse = (v: string) => {
    const c = v.indexOf(':')
    const pre = c >= 0 ? v.slice(0, c) : v
    const type = c >= 0 ? v.slice(c + 1) : ''
    const slash = pre.lastIndexOf('/')
    return { id: slash >= 0 ? pre.slice(slash + 1) : pre, type }
  }
  const ids = [...new Set(result.rows.map((r) => parse(r.value).id).filter(Boolean))]
  const byId = new Map<string, { name: string; canonical: string }>()
  if (ids.length) {
    const { data, error } = await supabaseAdmin
      .from('geo_target_constant')
      .select('criteria_id, name, canonical_name')
      .in('criteria_id', ids)
    if (error) throw new Error('geo_target_constant lookup failed: ' + error.message)
    for (const g of (data || []) as Array<Record<string, unknown>>) {
      byId.set(String(g.criteria_id), { name: String(g.name ?? ''), canonical: String(g.canonical_name ?? '') })
    }
  }
  let anyUnresolved = false
  for (const r of result.rows) {
    const { id, type } = parse(r.value)
    r.geoId = id
    // user_location_view (user_geo_*, no suffix) is the person's PHYSICAL location → 'presence'.
    r.geoLocationType = type ? (GEO_LOCTYPE[type] || type.toLowerCase()) : (bt.startsWith('user_geo_') ? 'presence' : 'unspecified')
    const hit = byId.get(id)
    if (hit) { r.geoName = hit.name; r.geoCanonicalName = hit.canonical; r.geoResolved = true }
    else { r.geoResolved = false; anyUnresolved = true }
  }
  const parts = ['geo rows carry geoName + geoCanonicalName (the place) + geoLocationType (presence = the person was PHYSICALLY there, interest = they showed interest); the raw geoTargetConstants id stays in `value`. Answer with geoName, not the id.']
  if (anyUnresolved) parts.push("Rows with geoResolved:false are DMA/metro codes Google's geo reference does not name — report them as unresolved DMA codes, NEVER invent a place name; their spend is real.")
  const z = parts.join(' ')
  result.note = result.note ? `${result.note} ${z}` : z
}

export async function queryBreakdown(opts: {
  clientId: string
  breakdownType: string
  platform?: string
  baseRange?: string
  startDate?: string
  endDate?: string
  rankBy?: string
  topN?: number
  orderDir?: 'asc' | 'desc'
  parentEntityId?: string
  entityId?: string
  entityLevel?: string // LORAMER_QUERY_NONADDITIVE_V1 — video only: which entity grain to scope to (default 'campaign')
  canonicalize?: boolean // LORAMER_META_ALIAS_CANON — opt-in Meta action_type alias collapse (default OFF = byte-identical). -next card path only.
  geoGrain?: string // LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B) — for breakdownType 'geo': city|county|metro|state|province|district|postal|most_specific|region
  geoScope?: string // 'ad' = where you TARGETED, 'user' = where the person PHYSICALLY WAS
}): Promise<QueryBreakdownResult> {
  const loraTT = BREAKDOWN_ALIAS[opts.breakdownType] || opts.breakdownType // legacy read-name canonicalize (§3)
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  let startDate: string
  let endDate: string
  if (opts.startDate && opts.endDate && ISO.test(opts.startDate) && ISO.test(opts.endDate) && opts.startDate <= opts.endDate) {
    startDate = opts.startDate
    endDate = opts.endDate
  } else {
    const w = resolveDateWindow(opts.baseRange || 'LAST_30_DAYS')
    startDate = w.startDate
    endDate = w.endDate
  }
  const topN = Math.max(1, Math.min(50, opts.topN || 20))
  const orderDir: 'asc' | 'desc' = opts.orderDir === 'asc' ? 'asc' : 'desc'

  const result: QueryBreakdownResult = {
    breakdownType: loraTT, platform: '', window: { startDate, endDate }, rankBy: 'spend',
    rows: [], distinctValueCount: 0, truncated: false,
  }

  // LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B) — GEO COLLAPSE: the tool exposes ONE type 'geo' + (geoGrain,
  // geoScope); resolve it to the REAL Google geo breakdown_type (e.g. city + user → user_geo_city). country/region
  // stay their own cross-platform tool types (geo_country/geo_region).
  let bt = loraTT
  if (loraTT === 'geo') {
    const real = opts.geoGrain && opts.geoScope ? resolveGeo(opts.geoGrain, opts.geoScope) : undefined
    if (!real) {
      result.note = `breakdownType "geo" needs geoGrain (${geoGrains().join('/')}) + geoScope (ad|user); for country/region use breakdownType geo_country/geo_region instead.`
      return result
    }
    bt = real
  }
  result.breakdownType = bt

  const allowed = BREAKDOWN_PLATFORMS[bt]
  if (!allowed) {
    result.note = `Unknown breakdownType "${opts.breakdownType}". Supported: ${breakdownToolTypes().join(', ')}.`
    return result
  }
  // Resolve the platform (multi-platform aware; back-compat default via BREAKDOWN_PRIMARY; never guess a multi type).
  let platform: string
  if (opts.platform) {
    if (!allowed.includes(opts.platform)) {
      result.note = `breakdownType "${loraTT}" is not captured on platform "${opts.platform}" — it exists on: ${allowed.join(', ')}.`
      return result
    }
    platform = opts.platform
  } else if (allowed.length === 1) {
    platform = allowed[0]
  } else if (BREAKDOWN_PRIMARY[bt]) {
    platform = BREAKDOWN_PRIMARY[bt]
  } else {
    result.note = `breakdownType "${loraTT}" is captured on multiple platforms (${allowed.join(', ')}); pass platform to choose one.`
    return result
  }
  result.platform = platform

  // rankBy default: EXISTING tool types keep the exact HEAD default (byte-identical); NEW types use the registry's
  // per-(platform, breakdown_type) default (e.g. GA → revenue) so a spend=0 store/analytics dim ranks sensibly.
  const isExisting = EXISTING_TOOL_TYPES.has(loraTT)
  let rankBy: string
  if (RANKABLE.has(opts.rankBy || '')) rankBy = opts.rankBy as string
  else if (isExisting) rankBy = SPEND_ZERO_BREAKDOWNS.has(bt) ? 'conversions' : 'spend'
  else { const rb = entryFor(platform, bt)?.rankBy; rankBy = rb && RANKABLE.has(rb) ? rb : 'spend' }
  result.rankBy = rankBy

  // LORAMER_QUERY_NONADDITIVE_V1 — impression_share/video are per-ENTITY projections (their non-additive fields are
  // never summed as base metrics). Everything BELOW this branch is the untouched additive sum-by-value path.
  if (NONADDITIVE_BREAKDOWNS.has(bt)) {
    return projectNonAdditive({
      clientId: opts.clientId, bt, platform, startDate, endDate,
      rankBy: opts.rankBy, topN, orderDir, entityLevel: opts.entityLevel,
      parentEntityId: opts.parentEntityId, entityId: opts.entityId,
    })
  }

  // LORAMER_BREAKDOWN_LEVEL_SCOPE_V1 — scope the ADDITIVE sum to ONE entity level or it double-counts multi-level
  // families (meta age/gender/device/geo/hour/action_type at account+campaign+ad_set+ad; google hour campaign+
  // ad_group; google device 4 levels). Default = the COARSEST level present (probe the coarseness order, take the
  // first that has rows — index-covered, cheap; the writers emit a family's levels atomically so the coarsest is
  // always present when the family has data). An explicit entityLevel overrides (mirrors the P1b video projection).
  // Single-level families (search_term/keyword ad_group; placement/conversion_action campaign; shopify geo account)
  // resolve to their sole level → byte-identical to the pre-scope behavior. Result shape unchanged (byte-identical).
  const LEVEL_ORDER = ['account', 'campaign', 'ad_group', 'ad_set', 'ad', 'keyword']
  let level: string | null = opts.entityLevel && LEVEL_ORDER.includes(opts.entityLevel) ? opts.entityLevel : null
  if (!level) {
    for (const lv of LEVEL_ORDER) {
      const { data: probe, error: pErr } = await supabaseAdmin
        .from('metrics_daily')
        .select('entity_level')
        .eq('client_id', opts.clientId).eq('platform', platform).eq('breakdown_type', bt)
        .eq('entity_level', lv).gte('date', startDate).lte('date', endDate).limit(1)
      if (pErr) throw new Error('metrics_daily level probe failed: ' + pErr.message)
      if (probe && probe.length) { level = lv; break }
    }
  }
  if (!level) {
    result.note = `No ${bt} data captured for this client in ${startDate}..${endDate}.`
    return result
  }

  // LORAMER_META_CONV_ACTION_VALUE_ROAS_V1 — carry Meta-reported ROAS ONLY on the canonicalized action_type card
  // path (GATED on canonicalize, so the shared query_breakdown tool + every other breakdown stay byte-identical).
  const carryRoas = !!opts.canonicalize && bt === 'action_type' && platform === 'meta'

  // LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B) — BOUNDED PATH for NEW reach (geo family, GA, age_gender, and any
  // existing type at an explicitly-requested finer level). SQL does ORDER BY rankBy + LIMIT topN and returns the TRUE
  // distinct count (migration 039: query_breakdown_agg_topn), so the payload is KB-class regardless of cardinality
  // (measured: ga_landing_page 32.4 MB all-groups → 4.5 KB bounded). The 14 EXISTING tool types at their default level
  // keep the return-all-groups path below, byte-identical. Canonicalize is FORBIDDEN here (route decision G2-2B-2): it
  // collapses AFTER aggregation, so a top-N taken BEFORE the collapse would rank the wrong values — assert, never degrade.
  const bounded = !carryRoas && (!isExisting || !!opts.entityLevel)
  if (bounded) {
    if (opts.canonicalize) throw new Error('query_breakdown_agg_topn: canonicalize is unsupported on the bounded path — it must collapse before ranking (G2-2B route decision 2).')
    const { data, error } = await supabaseAdmin.rpc('query_breakdown_agg_topn', {
      p_client_id: opts.clientId, p_platform: platform, p_breakdown_type: bt, p_entity_level: level,
      p_start: startDate, p_end: endDate, p_rank_by: rankBy, p_top_n: topN, p_order_dir: orderDir,
      p_parent_entity_id: opts.parentEntityId || null, p_entity_id: opts.entityId || null,
    })
    if (error) throw new Error('query_breakdown_agg_topn RPC failed: ' + error.message)
    const payload = (data || { total_groups: 0, rows: [] }) as { total_groups: number; rows: Array<Record<string, unknown>> }
    result.distinctValueCount = payload.total_groups
    if (!payload.total_groups) {
      result.note = `No ${bt} data captured for this client in ${startDate}..${endDate}.`
      return result
    }
    result.truncated = payload.total_groups > topN
    result.rows = (payload.rows || []).map((g) => {
      const totals: MetricTotals = { spend: Number(g.spend || 0), impressions: Number(g.impressions || 0), clicks: Number(g.clicks || 0), conversions: Number(g.conversions || 0), conversionValue: Number(g.conversion_value || 0), revenue: Number(g.revenue || 0), rowCount: 0 }
      const value = String(g.breakdown_value ?? '')
      return {
        value: value.length > VALUE_MAXLEN ? value.slice(0, VALUE_MAXLEN) + '…' : value,
        parentEntityId: g.parent_entity_id ? String(g.parent_entity_id) : undefined,
        spend: totals.spend, impressions: totals.impressions, clicks: totals.clicks, conversions: totals.conversions, conversionValue: totals.conversionValue, revenue: totals.revenue,
        derived: derive(totals),
      }
    })
    if (result.truncated) {
      result.note = `Showing top ${topN} of ${payload.total_groups} ${bt} values by ${rankBy}; more exist (these are a SUBSET of total activity, not the account/campaign total).`
    }
    if (SPEND_ZERO_BREAKDOWNS.has(bt)) {
      const z = `${bt} carries per-action conversions, NOT partitioned spend (spend is 0 here); ranked by ${rankBy}.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    if (platform === 'google' && bt === 'hour') {
      const z = `Google hour "00" (midnight) is a CATCH-ALL bucket — it absorbs the full-day spend of campaigns without hourly segmentation (e.g. Display, and some Performance Max), so it is inflated and does NOT represent genuine 00:00 activity. Do NOT treat hour 0 as a real dayparting peak or recommend a midnight bid-down from it.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_ASSET_ATTRWINDOW_WIRE_V1 — provenance caveats (mirror the hour-0 pattern) so Lora never mis-sums these.
    if (platform === 'meta' && ASSET_BREAKDOWNS.has(bt)) {
      const z = `Meta creative-asset spend is COMPONENT ATTRIBUTION, not a partition — over/under the ad total by design (title over-counts under Dynamic Creative). Compare assets WITHIN this type; NEVER sum asset spend across asset types or up to the ad/campaign total.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    if (bt === 'attribution_window') {
      const z = `Attribution windows OVERLAP (1d_click ⊂ 7d_click ⊂ 28d_click) and view+click double-count — each value is one action_type×window. NEVER sum across windows; the account default (already in the base conversion number) = the account's own window setting (typically 7d_click+1d_view).`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_SHOPIFY_ABANDONED_VALUE_V1 (S-FILL#2) — potential/lost-revenue caveat (mirror the hour-0 pattern).
    if (platform === 'shopify' && bt === 'abandoned_checkout') {
      const z = `Abandoned-checkout value is POTENTIAL / LOST revenue (Σ abandoned-checkout totalPriceSet, reported in conversionValue) with the abandoned COUNT in conversions — spend and revenue are 0. It is NEVER actual revenue: never sum or reconcile it into net sales or order counts. Shopify retains abandoned checkouts only ~90 days, so this is forward-first and NOT full history like orders — treat the earliest date as a retention floor, not a true start.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3) — subset-not-partition caveat.
    if (platform === 'shopify' && bt === 'discount_code') {
      const z = `Discount-code amounts are the EXACT per-code applied money (Σ line-item allocations, in conversionValue) with orders-using-the-code in conversions; spend and revenue are 0. They are a SUBSET of total order discounting — manual and automatic (non-code) discounts are NOT included here — so NEVER sum or reconcile them into net sales or the order discount total (currentTotalDiscountsSet); a single code's allocation can even exceed an order's current discount total. Each value is one code, and multiple codes can apply to one order.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_SHOPIFY_BATCH_A3_V1 — SNAPSHOT-SEMANTICS caveat (the hour-0 note pattern). This is the one
    // that actually protects Lora: the registry note and the row's extra are storage-side, but THIS is what
    // reaches her at answer time. Without it she would read a status distribution as history and a
    // settlement shift as a trend, which is exactly the false conclusion the family invites.
    if (platform === 'shopify' && (bt === 'financial_status' || bt === 'fulfillment_status')) {
      const z = `Order ${bt === 'financial_status' ? 'FINANCIAL' : 'FULFILLMENT'} status is a CAPTURE-TIME SNAPSHOT, not an order-date fact. Status is mutable (pending→paid, unfulfilled→fulfilled), so each row records what was true WHEN THE DAY WAS CAPTURED — re-capturing the same day can legitimately produce different values. CONSEQUENCE: older history is systematically MORE SETTLED than recent days (old orders have long since resolved to PAID/FULFILLED while this week's have not), so a rising "% paid" toward the past is an ARTIFACT OF CAPTURE TIMING, never a trend in the business. Comparing status mixes across periods compares two different observation ages. Values DO partition the day's net (one status per order), so they sum to net sales within a single day.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_SHOPIFY_BATCH_A2_V1 — tag over-count caveat. product_tag is the only Shopify grouping family
    // that is NOT a partition, and the over-count is large (measured 7.3× on FoamOh), so it needs the same
    // never-mis-sum protection the Meta asset families already carry.
    if (platform === 'shopify' && bt === 'product_tag') {
      const z = `Product TAGS are NOT a partition: a product carries MANY tags, so its full net revenue is counted under EVERY tag it holds. Σ product_tag therefore EXCEEDS net sales — measured 7.3× on a real store day. A row answers "how much revenue touched this tag", NEVER "what share of the day was this tag". Compare tags to EACH OTHER; never sum them and never reconcile them to net sales.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_SHOPIFY_BATCH_A1_V1 — discount TYPE is the same subset-not-partition shape as discount_code.
    if (platform === 'shopify' && bt === 'discount_type') {
      const z = `Discount TYPE amounts (code / manual / automatic / script) are Σ line-item allocations per application type, in conversionValue, with orders-using-that-type in conversions; spend and revenue are 0. Allocations OVERLAP and are a SUBSET of total discounting, so NEVER sum or reconcile them into net sales or the order discount total. This is the TYPE axis; discount_code is the per-CODE axis of the same money.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_SHOPIFY_BATCH_C_V1 — lifetime-vs-windowed caveat. The row's revenue IS windowed and does
    // partition the day; extra.avgLifetimeSpent is NOT. Without this Lora would read a lifetime average as
    // period revenue, which is the exact mistake the lifetime numberOfOrders bug already caused once.
    if (platform === 'shopify' && bt === 'customer_cohort') {
      const z = `Customer cohorts bucket each order by its customer's LIFETIME order count (1 / 2-3 / 4-9 / 10+; UNKNOWN = guest checkout or no linked customer). The revenue and order counts on these rows ARE windowed and DO partition the day's net sales. BUT extra.avgLifetimeSpent is a LIFETIME figure for the customers who ordered that day — it is NOT revenue in this window, it CANNOT be summed across days (a customer ordering on ten days would contribute their whole lifetime value ten times), and it must never be compared to net sales. Cohorts are aggregate and non-PII: there are no per-customer rows.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // LORAMER_SHOPIFY_BATCH_B_V1 — collections carry TWO traps at once, so the note covers both.
    if (platform === 'shopify' && bt === 'product_collection') {
      const z = `Product COLLECTIONS are NOT a partition: a product belongs to MANY collections, so its full net revenue is counted under EVERY collection it sits in — the sum EXCEEDS net sales. Compare collections to EACH OTHER; never sum them and never reconcile them to net sales. SEPARATELY: collection membership is a CAPTURE-TIME SNAPSHOT — Shopify exposes today's membership, not the membership as of the order date, so historical rows reflect how products are organised NOW. A product moved between collections changes what past days look like on re-capture. Products whose collections could not be fetched emit no row rather than a fabricated bucket.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    // ── LORAMER_WOO_BATCH_WA_V1 — WooCommerce breadth caveats (the hour-0 pattern) ──────────────────────
    // These are what actually reach Lora at answer time; the registry note and the row's extra are
    // storage-side. Four of the nine Woo families are WRITE-ONLY for four DIFFERENT reasons, and each reason
    // produces a different wrong answer if she is not told.
    if (platform === 'woocommerce' && bt === 'order_status') {
      const z = `WooCommerce order_status covers ALL statuses, INCLUDING failed / cancelled / pending / on-hold — orders that are NOT sales and are NOT in net revenue. It is a SUPERSET of net sales, never a partition of it: NEVER sum these rows to a revenue total. Only the rows with extra.isSale=true ({completed, processing, refunded}) sum to account net sales. The non-sale rows are genuine DEMAND (attempted orders that failed or were cancelled) and are worth reporting as such — just never as revenue.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    if (platform === 'woocommerce' && bt === 'shipping_method') {
      const z = `WooCommerce shipping_method money (in conversionValue) is the SHIPPING CHARGE collected for that method, NOT order revenue — revenue is 0 on these rows by design. An order with a split shipment appears under EVERY method it used, so the order counts also over-count against total orders. Compare methods to EACH OTHER; never sum shipping_method into net sales or into a total order count.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    if (platform === 'woocommerce' && (bt === 'coupon_code' || bt === 'coupon_type')) {
      const z = `WooCommerce ${bt} amounts (in conversionValue) are coupon DISCOUNT money — what was taken OFF — with orders carrying the coupon in conversions; spend and revenue are 0. Orders with NO coupon produce no row at all, so this is a SUBSET of the day's activity and not a partition of anything: never sum or reconcile it into net sales or into the order discount total. coupon_code is the per-CODE axis and coupon_type is the TYPE axis of the SAME money — never add the two together. Coupon TYPES are an OPEN set, not a fixed enum: WooCommerce core ships percent / fixed_cart / fixed_product but plugins register their own (a real store returned "wbte_sc_bogo"), so an unfamiliar type is a plugin's, not an error. A coupon showing $0 discount is usually a BOGO/free-product coupon whose benefit is not money off — report it as a real use, never as missing data.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    if (platform === 'woocommerce' && (bt === 'geo_country' || bt === 'geo_region' || bt === 'geo_city')) {
      const z = `WooCommerce geo is the BILLING address (not ship-to: Woo shipping is empty for digital, virtual and local-pickup orders). It PARTITIONS the day's net sales — one billing address per order — so these rows DO sum to net revenue, with UNKNOWN kept in the partition rather than dropped. CAUTION comparing to Shopify geo: the two use different bases (Woo net INCLUDES shipping and tax and is billing-address; Shopify net EXCLUDES them and is ship-to), so never treat them as like-for-like or add them together.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    if (platform === 'woocommerce' && bt === 'order_time') {
      const z = `WooCommerce order_time is one row PER ORDER carrying a RAW timestamp — bucket it to hours at READ time against the CLIENT's timezone, never assume the raw value is the merchant's clock. WOO-SPECIFIC: Woo's date_created carries no UTC offset, so the value is date_created_gmt (UTC); extra.tzBasis states which, and a store that returned no GMT field is labelled SITE_LOCAL and must not be read as UTC. The row's DATE is the store-local capture day, so a late-evening order can carry a UTC timestamp on the following calendar day. Revenue is order net on the account basis, so these DO sum to the day's net sales.`
      result.note = result.note ? `${result.note} ${z}` : z
    }
    await resolveGeoRows(result, platform, bt) // LORAMER_GEO_RESOLVE_V1 — name the topN google-geo ids (bounded path)
    return result
  }

  type Agg = { value: string; parents: Set<string>; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; revenue: number; metaRoas?: number | null; metaRoasDate?: string }
  const byValue = new Map<string, Agg>()
  if (carryRoas) {
    // LORAMER_META_CONV_ACTION_VALUE_ROAS_V1 — carryRoas (canonicalize + action_type + meta) KEEPS the row-paging
    // aggregation UNCHANGED. It is low-cardinality (Meta action_type ~dozens of values) so it never hits the
    // paging-timeout class, and it preserves the MOST-RECENT-day Meta ROAS per value EXACTLY — that value is
    // per-row (date + extra), not derivable from a SQL sum, so it stays on the row path.
    const PAGE = 1000
    let from = 0
    for (;;) {
      let q = supabaseAdmin
        .from('metrics_daily')
        .select('breakdown_value, parent_entity_id, spend, impressions, clicks, conversions, conversion_value, revenue, date, extra')
        .eq('client_id', opts.clientId)
        .eq('platform', platform)
        .eq('breakdown_type', bt) // NEVER '' — base rows are physically excluded (double-count guard)
        .eq('entity_level', level) // LORAMER_BREAKDOWN_LEVEL_SCOPE_V1 — one level only (coarsest present / override)
        .gte('date', startDate)
        .lte('date', endDate)
        .range(from, from + PAGE - 1)
      if (opts.parentEntityId) q = q.eq('parent_entity_id', opts.parentEntityId)
      if (opts.entityId) q = q.eq('entity_id', opts.entityId)
      const { data, error } = await q
      if (error) throw new Error('metrics_daily breakdown query failed: ' + error.message)
      const rows = data || []
      for (const r of rows) {
        const row = r as unknown as Record<string, unknown>
        const value = String(row.breakdown_value ?? '')
        let agg = byValue.get(value)
        if (!agg) {
          agg = { value, parents: new Set<string>(), spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, revenue: 0 }
          byValue.set(value, agg)
        }
        if (row.parent_entity_id) agg.parents.add(String(row.parent_entity_id))
        agg.spend += Number(row.spend || 0)
        agg.impressions += Number(row.impressions || 0)
        agg.clicks += Number(row.clicks || 0)
        agg.conversions += Number(row.conversions || 0)
        agg.conversionValue += Number(row.conversion_value || 0)
        agg.revenue += Number(row.revenue || 0)
        // Meta-REPORTED ROAS only (purchase_roas, else website_purchase_roas); NEVER value/spend (spend=0). ROAS is
        // a ratio = non-additive → keep the MOST-RECENT day's value in-window (mirrors the impression_share posture).
        const ex = (row.extra || {}) as Record<string, unknown>
        const roasRaw = ex.purchase_roas ?? ex.website_purchase_roas
        const roas = roasRaw == null ? null : Number(roasRaw)
        const dt = String(row.date ?? '')
        if (roas != null && Number.isFinite(roas) && dt >= (agg.metaRoasDate || '')) { agg.metaRoas = roas; agg.metaRoasDate = dt }
      }
      if (rows.length < PAGE) break
      from += PAGE
    }
  } else {
    // LORAMER_QUERY_BREAKDOWN_SQL_AGG_V1 — SQL-side GROUP BY (migration 038: public.query_breakdown_agg). Postgres
    // sums the (client, platform, breakdown_type, level, window) slice grouped by (breakdown_value,
    // parent_entity_id) on idx_metrics_daily_client_platform_bt_level_date; ONLY the aggregated groups cross the
    // wire (not the raw rows), so the row ceiling stops being the client's problem (search_term 12mo: ~37 JS
    // pages / ~18s → one indexed GROUP BY, ~9ms). Sums are EXACT numeric (vs the JS-float paging) → results match
    // the pre-change path to the cent. Parent-set logic preserved: SQL groups BY parent, JS merges across parents
    // per value + tracks the distinct non-empty parents (parents.size===1 → parentEntityId), byte-identical.
    const { data, error } = await supabaseAdmin.rpc('query_breakdown_agg', {
      p_client_id: opts.clientId, p_platform: platform, p_breakdown_type: bt, p_entity_level: level,
      p_start: startDate, p_end: endDate,
      p_parent_entity_id: opts.parentEntityId || null, p_entity_id: opts.entityId || null,
    })
    if (error) throw new Error('query_breakdown_agg RPC failed: ' + error.message)
    for (const g of (data || []) as Array<Record<string, unknown>>) {
      const value = String(g.breakdown_value ?? '')
      let agg = byValue.get(value)
      if (!agg) {
        agg = { value, parents: new Set<string>(), spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, revenue: 0 }
        byValue.set(value, agg)
      }
      if (g.parent_entity_id) agg.parents.add(String(g.parent_entity_id))
      agg.spend += Number(g.spend || 0)
      agg.impressions += Number(g.impressions || 0)
      agg.clicks += Number(g.clicks || 0)
      agg.conversions += Number(g.conversions || 0)
      agg.conversionValue += Number(g.conversion_value || 0)
      agg.revenue += Number(g.revenue || 0)
    }
  }

  result.distinctValueCount = byValue.size
  if (byValue.size === 0) {
    result.note = `No ${bt} data captured for this client in ${startDate}..${endDate}.`
    return result
  }

  // LORAMER_META_ALIAS_CANON — opt-in read-layer collapse of Meta action_type aliases. OFF by default
  // (aggList = the raw value-grouped set → BYTE-IDENTICAL to today). ONLY the -next card path passes
  // canonicalize:true. Runs AFTER the entity-level scope + value aggregation, BEFORE rank/topN. Projects the
  // already-read set — raw metrics_daily rows are untouched. No effect on any other breakdown_type/platform.
  let aggList = Array.from(byValue.values())
  if (opts.canonicalize && bt === 'action_type' && platform === 'meta') {
    const canon = projectActionCanon(aggList)
    aggList = canon.rows
    result.distinctValueCount = aggList.length
    for (const n of canon.notes) result.note = result.note ? `${result.note} ${n}` : n
  }

  const sorted = aggList.sort((a, b) => {
    const av = (a as any)[rankBy] as number
    const bv = (b as any)[rankBy] as number
    if (av !== bv) return orderDir === 'asc' ? av - bv : bv - av
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0 // LORAMER_BREAKDOWN_LEVEL_SCOPE_V1 — stable tiebreaker (value asc): deterministic order when the rank metric ties (e.g. commerce breakdowns ranked by spend=0)
  })
  result.truncated = sorted.length > topN
  result.rows = sorted.slice(0, topN).map((a) => {
    const totals: MetricTotals = { spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue, revenue: a.revenue, rowCount: 0 }
    return {
      value: a.value.length > VALUE_MAXLEN ? a.value.slice(0, VALUE_MAXLEN) + '…' : a.value,
      parentEntityId: a.parents.size === 1 ? Array.from(a.parents)[0] : undefined,
      spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue, revenue: a.revenue,
      derived: derive(totals),
      ...(carryRoas ? { metaRoas: a.metaRoas ?? null } : {}), // LORAMER_META_CONV_ACTION_VALUE_ROAS_V1 — absent for every other breakdown
    }
  })
  if (result.truncated) {
    result.note = `Showing top ${topN} of ${byValue.size} ${bt} values by ${rankBy}; more exist (these are a SUBSET of total activity, not the account/campaign total).`
  }
  if (SPEND_ZERO_BREAKDOWNS.has(bt)) {
    const z = `${bt} carries per-action conversions, NOT partitioned spend (spend is 0 here); ranked by ${rankBy}.`
    result.note = result.note ? `${result.note} ${z}` : z
  }
  // LORAMER_GOOGLE_HOUR0_NOTE_V1 — Google hour "00" is a CATCH-ALL: Google buckets spend from campaigns without
  // hourly segmentation (Display, some PMax) into hour 0, so it is inflated and NOT genuine midnight activity.
  // Additive-only (a note; rows/values/Σ unchanged) — do not present hour 0 as a real dayparting peak.
  if (platform === 'google' && bt === 'hour') {
    const z = `Google hour "00" (midnight) is a CATCH-ALL bucket — it absorbs the full-day spend of campaigns without hourly segmentation (e.g. Display, and some Performance Max), so it is inflated and does NOT represent genuine 00:00 activity. Do NOT treat hour 0 as a real dayparting peak or recommend a midnight bid-down from it.`
    result.note = result.note ? `${result.note} ${z}` : z
  }
  await resolveGeoRows(result, platform, bt) // LORAMER_GEO_RESOLVE_V1 — name the topN google-geo ids (all-groups path)
  return result
}

// LORAMER_QUERY_NONADDITIVE_V1 — per-ENTITY projection for impression_share + video. Groups by entity_id (their
// breakdown_value is a constant/empty marker, so per-value ranking is meaningless). NEVER sums a non-additive field:
//   impression_share → 7 POINT-IN-TIME ratios; per campaign take the MOST RECENT captured day in-window (flagged).
//   video → 8 counts SUMMED across days + 2 RATES single-value (null when the window spans >1 day). Scoped to ONE
//   entity_level (default 'campaign') so counts never double-count across grains. Base metrics are all 0 (write-only).
async function projectNonAdditive(p: {
  clientId: string; bt: string; platform: string; startDate: string; endDate: string
  rankBy?: string; topN: number; orderDir: 'asc' | 'desc'; entityLevel?: string; parentEntityId?: string; entityId?: string
}): Promise<QueryBreakdownResult> {
  const isVideo = p.bt === 'video'
  const entityLevel = isVideo ? (VIDEO_ENTITY_LEVELS.has(p.entityLevel || '') ? (p.entityLevel as string) : 'campaign') : 'campaign'
  const fields = isVideo ? [...VIDEO_COUNT_FIELDS, ...VIDEO_RATE_FIELDS] : IS_RATIO_FIELDS
  const rankBy = fields.includes(p.rankBy || '') ? (p.rankBy as string) : (isVideo ? 'video_plays' : 'search_impression_share')

  const result: QueryBreakdownResult = {
    breakdownType: p.bt, platform: p.platform, window: { startDate: p.startDate, endDate: p.endDate },
    rankBy, rows: [], distinctValueCount: 0, truncated: false, nonAdditive: true,
    ...(isVideo ? { entityLevel } : {}),
  }

  type Ent = { entityName: string; parentId: string; rowCount: number; latestDate: string; latest: Record<string, any>; sums: Record<string, number> }
  const byEnt = new Map<string, Ent>()
  const selectCols = isVideo
    ? `entity_id, entity_name, parent_entity_id, date, ${[...VIDEO_COUNT_FIELDS, ...VIDEO_RATE_FIELDS].join(', ')}`
    : 'entity_id, entity_name, parent_entity_id, date, extra'
  const PAGE = 1000
  let from = 0
  for (;;) {
    let q = supabaseAdmin
      .from('metrics_daily')
      .select(selectCols)
      .eq('client_id', p.clientId)
      .eq('platform', p.platform)
      .eq('breakdown_type', p.bt) // NEVER '' — base rows excluded (double-count guard)
      .gte('date', p.startDate)
      .lte('date', p.endDate)
      .range(from, from + PAGE - 1)
    if (isVideo) q = q.eq('entity_level', entityLevel) // one grain only → counts never double-count across levels
    if (p.parentEntityId) q = q.eq('parent_entity_id', p.parentEntityId)
    if (p.entityId) q = q.eq('entity_id', p.entityId)
    const { data, error } = await q
    if (error) throw new Error('metrics_daily non-additive query failed: ' + error.message)
    const rows = data || []
    for (const r of rows) {
      const row = r as Record<string, any>
      const eid = String(row.entity_id ?? '')
      if (!eid) continue
      let e = byEnt.get(eid)
      if (!e) { e = { entityName: String(row.entity_name ?? ''), parentId: String(row.parent_entity_id ?? ''), rowCount: 0, latestDate: '', latest: {}, sums: {} }; byEnt.set(eid, e) }
      e.rowCount++
      const d = String(row.date ?? '')
      if (d > e.latestDate) { e.latestDate = d; e.latest = isVideo ? row : (row.extra || {}) } // most-recent day per entity
      if (isVideo) for (const f of VIDEO_COUNT_FIELDS) { const v = Number(row[f]); if (Number.isFinite(v)) e.sums[f] = (e.sums[f] || 0) + v }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  result.distinctValueCount = byEnt.size
  if (byEnt.size === 0) {
    result.note = `No ${p.bt} data captured for this client in ${p.startDate}..${p.endDate}` + (isVideo ? ` at entity_level=${entityLevel}.` : '.')
    return result
  }

  let anyMultiDayRate = false
  const built = Array.from(byEnt.values()).map((e) => {
    const m: Record<string, number | null> = {}
    if (isVideo) {
      for (const f of VIDEO_COUNT_FIELDS) m[f] = Number((e.sums[f] || 0).toFixed(2))
      for (const f of VIDEO_RATE_FIELDS) {
        if (e.rowCount === 1) { const v = Number(e.latest[f]); m[f] = Number.isFinite(v) ? v : null }
        else { m[f] = null; anyMultiDayRate = true } // per-period rate → not aggregatable across days
      }
    } else {
      for (const f of IS_RATIO_FIELDS) { const v = Number(e.latest[f]); m[f] = Number.isFinite(v) ? v : null }
    }
    const rk = m[rankBy]
    return { entityName: e.entityName, parentId: e.parentId, m, rank: typeof rk === 'number' ? rk : -Infinity }
  })

  built.sort((a, b) => (p.orderDir === 'asc' ? a.rank - b.rank : b.rank - a.rank))
  result.truncated = built.length > p.topN
  result.rows = built.slice(0, p.topN).map((b) => ({
    value: b.entityName.length > VALUE_MAXLEN ? b.entityName.slice(0, VALUE_MAXLEN) + '…' : b.entityName,
    parentEntityId: b.parentId || undefined,
    spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, revenue: 0,
    derived: {}, nonAdditiveMetrics: b.m,
  }))

  const notes: string[] = []
  if (isVideo) {
    notes.push(`video counts (plays/thruplays/quartiles/30s) are SUMMED over the window at entity_level=${entityLevel} (one row per ${entityLevel}; no cross-level double-count).`)
    if (anyMultiDayRate) notes.push('video_avg_time_sec + cost_per_thruplay are per-period RATES, null for entities spanning multiple days (not aggregatable) — narrow to a single day to read them.')
  } else {
    notes.push('impression_share ratios are POINT-IN-TIME — each row is the MOST RECENT captured day in-window for that campaign; ratios are NOT aggregated across days. null = campaign non-eligible (API -1) that day.')
  }
  if (result.truncated) notes.push(`Showing top ${p.topN} of ${byEnt.size} by ${rankBy}.`)
  result.note = notes.join(' ')
  return result
}

// LORAMER_QUERY_MONEY_V1 — the full ACCOUNT-grain money surface (gross → net waterfall: discounts/taxes/shipping/
// fees/tips/refunds/residual) for a single STORE platform over a window. Reads account rows' extra.money and reuses
// the CANONICAL aggregateMoney/MONEY_KEYS (the exact aggregation /api/next/money uses → reconciles by construction).
// Every component is an additive $ amount (no rate → no singleVal); per-field null-vs-zero (a component absent on ANY
// day → null, never a false $0). Platform-scoped: shopify XOR woocommerce — NEVER summed across platforms (different
// net basis: Woo incl shipping/tax vs Shopify excl). Does NOT touch queryMetrics/queryBreakdown.
const MONEY_PLATFORMS: Record<string, string> = { shopify: 'shopify', woocommerce: 'woocommerce', woo: 'woocommerce' }

export type QueryMoneyResult = {
  platform: string
  basis: string | null
  window: { startDate: string; endDate: string }
  components: Record<string, { value: number | null; present: boolean; absentDays: number }>
  chain: { key: string; label: string; op: string }[]
  accountDays: number
  moneyDays: number
  saleDaysMissingMoney: number
  coverageComplete: boolean
  note?: string
}

export async function queryMoney(opts: {
  clientId: string; platform: string; baseRange?: string; startDate?: string; endDate?: string
}): Promise<QueryMoneyResult> {
  const pf = MONEY_PLATFORMS[opts.platform] || ''
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  let startDate: string, endDate: string
  if (opts.startDate && opts.endDate && ISO.test(opts.startDate) && ISO.test(opts.endDate) && opts.startDate <= opts.endDate) {
    startDate = opts.startDate; endDate = opts.endDate
  } else {
    const w = resolveDateWindow(opts.baseRange || 'LAST_30_DAYS'); startDate = w.startDate; endDate = w.endDate
  }

  const result: QueryMoneyResult = {
    platform: pf, basis: null, window: { startDate, endDate },
    components: {}, chain: [], accountDays: 0, moneyDays: 0, saleDaysMissingMoney: 0, coverageComplete: false,
  }
  if (!pf) {
    result.note = 'money is captured only for store platforms — pass platform "shopify" or "woocommerce".'
    return result
  }

  // Same account-row query as /api/next/money → identical inputs to aggregateMoney → identical numbers.
  const moneyObjs: Array<Record<string, any>> = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('date, revenue, extra')
      .eq('client_id', opts.clientId).eq('platform', pf)
      .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
      .gte('date', startDate).lte('date', endDate)
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error('metrics_daily money query failed: ' + error.message)
    const rows = data || []
    for (const r of rows) {
      result.accountDays++
      const m = (r as any).extra?.money
      if (m && typeof m === 'object') { moneyObjs.push(m); if (!result.basis && typeof m.moneyBasis === 'string') result.basis = m.moneyBasis }
      else if (Number((r as any).revenue) !== 0) result.saleDaysMissingMoney++ // had sales, no money = a real pre-back-drain gap
    }
    if (rows.length < PAGE) break
  }

  result.moneyDays = moneyObjs.length
  if (moneyObjs.length === 0) {
    result.note = `No ${pf} money captured for this client in ${startDate}..${endDate}.`
    return result
  }
  const agg = aggregateMoney(moneyObjs)
  for (const k of MONEY_KEYS) result.components[k] = agg[k]
  result.chain = chainForBasis(result.basis).map((s) => ({ key: s.key, label: s.label, op: s.op }))
  result.coverageComplete = result.saleDaysMissingMoney === 0
  const notes = [`Money is ACCOUNT-grain, summed over the window (basis ${result.basis || 'unknown'}); every component is a $ amount, null when absent on any day (never a false $0). Read the waterfall via 'chain'.`]
  if (result.saleDaysMissingMoney > 0) notes.push(`${result.saleDaysMissingMoney} sale-day(s) predate the money back-drain and carry no money (a real gap, not $0).`)
  result.note = notes.join(' ')
  return result
}

// LORAMER_NEXT_ENTITIES_V1 — per-ENTITY base-row aggregation for the -next platform drill spine (Flight 1).
// Reads CAPTURED metrics_daily base rows (breakdown_type='') at ONE entity_level, optionally filtered to the
// children of parentEntityId, and groups by entity_id over the window. SEPARATE from aggregateWindow (which sums a
// whole level into ONE total) and from queryBreakdown (which reads breakdown_type != '' dimensions). Reuses the
// canonical derive()/MetricTotals/emptyTotals + the same paginated sum pattern; adds convRate (conversions/clicks)
// on top of derive(). NO live platform call — captured store only. The parent_entity_id filter is the drill mechanic
// (campaign→ad_group/ad_set→ad); linkage is 100% populated for google + meta (verified 2026-07-10).
export type EntityRow = {
  entityId: string
  entityName: string
  parentEntityId?: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  revenue: number
  derived: Record<string, number>
}

export type QueryEntitiesResult = {
  platform: string
  level: string
  window: { startDate: string; endDate: string }
  parentEntityId?: string
  rows: EntityRow[]
  totals: { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; revenue: number; derived: Record<string, number> }
  entityCount: number
}

// derive() + convRate (the DrillTable's derived column set: ctr/roas/cpc/cpa + convRate).
function deriveEntity(t: MetricTotals): Record<string, number> {
  const d = derive(t)
  if (t.clicks > 0) d.convRate = Number((t.conversions / t.clicks * 100).toFixed(2))
  return d
}

export async function queryEntities(opts: {
  clientId: string
  platform: string
  level: string // campaign | ad_group | ad_set | ad
  parentEntityId?: string
  baseRange?: string
  startDate?: string
  endDate?: string
}): Promise<QueryEntitiesResult> {
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  let startDate: string, endDate: string
  if (opts.startDate && opts.endDate && ISO.test(opts.startDate) && ISO.test(opts.endDate) && opts.startDate <= opts.endDate) {
    startDate = opts.startDate; endDate = opts.endDate
  } else {
    const w = resolveDateWindow(opts.baseRange || 'LAST_30_DAYS'); startDate = w.startDate; endDate = w.endDate
  }

  type Ent = { entityId: string; entityName: string; parentEntityId: string; t: MetricTotals }
  const byEntity = new Map<string, Ent>()
  const grand = emptyTotals()
  const PAGE = 1000
  let from = 0
  for (;;) {
    let q = supabaseAdmin
      .from('metrics_daily')
      .select('entity_id, entity_name, parent_entity_id, spend, impressions, clicks, conversions, conversion_value, revenue')
      .eq('client_id', opts.clientId)
      .eq('platform', opts.platform)
      .eq('entity_level', opts.level)
      .eq('breakdown_type', '') // base rows only — NEVER a breakdown dimension (double-count guard)
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + PAGE - 1)
    if (opts.parentEntityId) q = q.eq('parent_entity_id', opts.parentEntityId) // the drill filter → children of this entity
    const { data, error } = await q
    if (error) throw new Error('metrics_daily entities query failed: ' + error.message)
    const rows = data || []
    for (const r of rows) {
      const row = r as Record<string, unknown>
      const eid = String(row.entity_id ?? '')
      if (!eid) continue
      let e = byEntity.get(eid)
      if (!e) { e = { entityId: eid, entityName: String(row.entity_name ?? ''), parentEntityId: String(row.parent_entity_id ?? ''), t: emptyTotals() }; byEntity.set(eid, e) }
      if (!e.entityName && row.entity_name) e.entityName = String(row.entity_name)
      const s = Number(row.spend || 0), im = Number(row.impressions || 0), cl = Number(row.clicks || 0)
      const cv = Number(row.conversions || 0), cvv = Number(row.conversion_value || 0), rv = Number(row.revenue || 0)
      e.t.spend += s; e.t.impressions += im; e.t.clicks += cl; e.t.conversions += cv; e.t.conversionValue += cvv; e.t.revenue += rv; e.t.rowCount += 1
      grand.spend += s; grand.impressions += im; grand.clicks += cl; grand.conversions += cv; grand.conversionValue += cvv; grand.revenue += rv; grand.rowCount += 1
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const rows: EntityRow[] = Array.from(byEntity.values())
    .map((e) => ({
      entityId: e.entityId,
      entityName: e.entityName,
      parentEntityId: e.parentEntityId || undefined,
      spend: e.t.spend, impressions: e.t.impressions, clicks: e.t.clicks,
      conversions: e.t.conversions, conversionValue: e.t.conversionValue, revenue: e.t.revenue,
      derived: deriveEntity(e.t),
    }))
    .sort((a, b) => b.spend - a.spend) // default spend desc (the legacy DrillTable default; UI re-sorts)

  return {
    platform: opts.platform,
    level: opts.level,
    window: { startDate, endDate },
    parentEntityId: opts.parentEntityId,
    rows,
    totals: {
      spend: grand.spend, impressions: grand.impressions, clicks: grand.clicks,
      conversions: grand.conversions, conversionValue: grand.conversionValue, revenue: grand.revenue,
      derived: deriveEntity(grand),
    },
    entityCount: rows.length,
  }
}

// LORAMER_NEXT_STORE_READS_V1 — daily store timeseries (revenue + orders) for the -next store platform page. Reads
// CAPTURED metrics_daily ACCOUNT rows for ONE store platform (shopify|woocommerce), one point per captured day
// (no-sale days are absent by the writer's false-zero discipline — a gap, not a $0). orders = account.conversions
// (= data.totalOrders, verified in the row builders). NO live call. Separate from queryMetrics (which sums a window).
export type StoreDayPoint = { date: string; revenue: number; orders: number }
export async function queryStoreTimeseries(opts: { clientId: string; platform: string; startDate: string; endDate: string }): Promise<StoreDayPoint[]> {
  const byDay = new Map<string, { revenue: number; orders: number }>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('date, revenue, conversions')
      .eq('client_id', opts.clientId)
      .eq('platform', opts.platform)
      .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
      .gte('date', opts.startDate).lte('date', opts.endDate)
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error('metrics_daily store timeseries query failed: ' + error.message)
    const rows = data || []
    for (const r of rows) {
      const row = r as Record<string, unknown>
      const d = String(row.date ?? '')
      if (!d) continue
      const cur = byDay.get(d) || { revenue: 0, orders: 0 }
      cur.revenue += Number(row.revenue || 0)
      cur.orders += Number(row.conversions || 0) // account conversions = order count (verified)
      byDay.set(d, cur)
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, revenue: Number(v.revenue.toFixed(2)), orders: v.orders }))
}
