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
import { resolveDateWindow } from '@/lib/date-range'
import { aggregateMoney, MONEY_KEYS, chainForBasis } from '@/lib/next/money-surface' // LORAMER_QUERY_MONEY_V1 — reuse the canonical money aggregation (reconciles with /api/next/money by construction)

export type MetricTotals = {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  revenue: number
  rowCount: number
}

export type WindowResult = {
  label: string
  startDate: string
  endDate: string
  totals: MetricTotals
  derived: Record<string, number>
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

async function aggregateWindow(
  clientId: string,
  platforms: string[],
  level: string,
  startDate: string,
  endDate: string
): Promise<MetricTotals> {
  const totals = emptyTotals()
  const PAGE = 1000
  let from = 0
  for (;;) {
    let q = supabaseAdmin
      .from('metrics_daily')
      .select('spend,impressions,clicks,conversions,conversion_value,revenue')
      .eq('client_id', clientId)
      .eq('entity_level', level)
      .eq('breakdown_type', '')
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
      totals.spend += Number(row.spend || 0)
      totals.impressions += Number(row.impressions || 0)
      totals.clicks += Number(row.clicks || 0)
      totals.conversions += Number(row.conversions || 0)
      totals.conversionValue += Number(row.conversion_value || 0)
      totals.revenue += Number(row.revenue || 0)
      totals.rowCount += 1
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  return totals
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
      const totals = valid
        ? await aggregateWindow(opts.clientId, platforms, level, startDate, endDate)
        : emptyTotals()
      windows.push({ label, startDate, endDate, totals, derived: derive(totals) })
    }
  } else {
    const offsets = opts.offsetsMonths && opts.offsetsMonths.length ? opts.offsetsMonths : [0, 6, 12, 18]
    const base = resolveDateWindow(baseRange)
    const span = daysInclusive(base.startDate, base.endDate)
    for (const off of offsets) {
      const endDate = off === 0 ? base.endDate : shiftMonthsUTC(base.endDate, -off)
      const startDate = off === 0 ? base.startDate : addDaysUTC(endDate, -(span - 1))
      const totals = await aggregateWindow(opts.clientId, platforms, level, startDate, endDate)
      windows.push({
        label: off === 0 ? baseRange : off + 'mo ago',
        startDate,
        endDate,
        totals,
        derived: derive(totals),
      })
    }
  }

  const resolvedPlatforms = platforms.length ? platforms : ['all']
  const notes: string[] = []
  const metaInScope = resolvedPlatforms.includes('meta') || resolvedPlatforms.includes('all')
  if (metaInScope) {
    notes.push('IMPORTANT - when this answer reports Meta conversion counts or CPA, you MUST add one brief sentence telling the user these are Meta account-level historical figures that are directionally accurate but may not perfectly reconcile with campaign-level conversion numbers, while Meta spend, clicks, and impressions are exact. Omit this note entirely when the answer does not discuss conversions or CPA.')
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
const BREAKDOWN_ALIAS: Record<string, string> = { publisher_platform: 'placement' } // writer stores 'placement'; repoint the legacy read-name (§3)
const BREAKDOWN_PLATFORMS: Record<string, string[]> = {
  search_term: ['google'], keyword: ['google'],
  placement: ['meta'], age: ['meta'], gender: ['meta'],
  device: ['meta', 'google'], device_platform: ['meta'], hour: ['meta', 'google'],
  action_type: ['meta'], conversion_action: ['google'],
  impression_share: ['google'], video: ['meta'], // LORAMER_QUERY_NONADDITIVE_V1 — per-entity NON-additive projection (below)
  geo_country: ['shopify', 'meta'], geo_region: ['shopify', 'meta'],
}
// Multi-platform types with a documented PRIMARY (their historical single platform) → the back-compat default when
// opts.platform is omitted, so existing calls stay byte-identical. Multi-platform types NOT listed (device, hour)
// have no historical behavior to preserve → platform is REQUIRED.
const BREAKDOWN_PRIMARY: Record<string, string> = { geo_country: 'shopify', geo_region: 'shopify' }
// action_type/conversion_action carry per-action CONVERSIONS, not partitioned spend (spend cols = 0) → default rank
// by conversions (never spend, which is 0) and flag it. WRITE-ONLY families; still a SUBSET of the entity total.
const SPEND_ZERO_BREAKDOWNS = new Set(['action_type', 'conversion_action'])
// LORAMER_QUERY_NONADDITIVE_V1 — impression_share + video are PER-ENTITY metric families (their breakdown_value is a
// constant/empty marker), so they are grouped by ENTITY, not value, and their non-additive fields are NEVER summed
// as base metrics. Handled by projectNonAdditive() below — NOT the additive sum-6-metrics path. Zero effect on any
// other breakdown_type.
const NONADDITIVE_BREAKDOWNS = new Set(['impression_share', 'video'])
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
}): Promise<QueryBreakdownResult> {
  const bt = BREAKDOWN_ALIAS[opts.breakdownType] || opts.breakdownType // canonicalize legacy read-names (§3)
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
  const allowed = BREAKDOWN_PLATFORMS[bt]
  const rankBy = RANKABLE.has(opts.rankBy || '')
    ? (opts.rankBy as string)
    : (SPEND_ZERO_BREAKDOWNS.has(bt) ? 'conversions' : 'spend')
  const topN = Math.max(1, Math.min(50, opts.topN || 20))
  const orderDir: 'asc' | 'desc' = opts.orderDir === 'asc' ? 'asc' : 'desc'

  const result: QueryBreakdownResult = {
    breakdownType: bt, platform: '', window: { startDate, endDate }, rankBy,
    rows: [], distinctValueCount: 0, truncated: false,
  }

  if (!allowed) {
    result.note = `Unknown breakdownType "${bt}". Supported: ${Object.keys(BREAKDOWN_PLATFORMS).join(', ')}.`
    return result
  }
  // Resolve the platform (multi-platform aware; back-compat default via BREAKDOWN_PRIMARY; never guess a multi type).
  let platform: string
  if (opts.platform) {
    if (!allowed.includes(opts.platform)) {
      result.note = `breakdownType "${bt}" is not captured on platform "${opts.platform}" — it exists on: ${allowed.join(', ')}.`
      return result
    }
    platform = opts.platform
  } else if (allowed.length === 1) {
    platform = allowed[0]
  } else if (BREAKDOWN_PRIMARY[bt]) {
    platform = BREAKDOWN_PRIMARY[bt]
  } else {
    result.note = `breakdownType "${bt}" is captured on multiple platforms (${allowed.join(', ')}); pass platform to choose one.`
    return result
  }
  result.platform = platform

  // LORAMER_QUERY_NONADDITIVE_V1 — impression_share/video are per-ENTITY projections (their non-additive fields are
  // never summed as base metrics). Everything BELOW this branch is the untouched additive sum-by-value path.
  if (NONADDITIVE_BREAKDOWNS.has(bt)) {
    return projectNonAdditive({
      clientId: opts.clientId, bt, platform, startDate, endDate,
      rankBy: opts.rankBy, topN, orderDir, entityLevel: opts.entityLevel,
      parentEntityId: opts.parentEntityId, entityId: opts.entityId,
    })
  }

  type Agg = { value: string; parents: Set<string>; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; revenue: number }
  const byValue = new Map<string, Agg>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    let q = supabaseAdmin
      .from('metrics_daily')
      .select('breakdown_value, parent_entity_id, spend, impressions, clicks, conversions, conversion_value, revenue')
      .eq('client_id', opts.clientId)
      .eq('platform', platform)
      .eq('breakdown_type', bt) // NEVER '' — base rows are physically excluded (double-count guard)
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + PAGE - 1)
    if (opts.parentEntityId) q = q.eq('parent_entity_id', opts.parentEntityId)
    if (opts.entityId) q = q.eq('entity_id', opts.entityId)
    const { data, error } = await q
    if (error) throw new Error('metrics_daily breakdown query failed: ' + error.message)
    const rows = data || []
    for (const r of rows) {
      const row = r as Record<string, unknown>
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
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  result.distinctValueCount = byValue.size
  if (byValue.size === 0) {
    result.note = `No ${bt} data captured for this client in ${startDate}..${endDate}.`
    return result
  }

  const sorted = Array.from(byValue.values()).sort((a, b) => {
    const av = (a as any)[rankBy] as number
    const bv = (b as any)[rankBy] as number
    return orderDir === 'asc' ? av - bv : bv - av
  })
  result.truncated = sorted.length > topN
  result.rows = sorted.slice(0, topN).map((a) => {
    const totals: MetricTotals = { spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue, revenue: a.revenue, rowCount: 0 }
    return {
      value: a.value.length > VALUE_MAXLEN ? a.value.slice(0, VALUE_MAXLEN) + '…' : a.value,
      parentEntityId: a.parents.size === 1 ? Array.from(a.parents)[0] : undefined,
      spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue, revenue: a.revenue,
      derived: derive(totals),
    }
  })
  if (result.truncated) {
    result.note = `Showing top ${topN} of ${byValue.size} ${bt} values by ${rankBy}; more exist (these are a SUBSET of total activity, not the account/campaign total).`
  }
  if (SPEND_ZERO_BREAKDOWNS.has(bt)) {
    const z = `${bt} carries per-action conversions, NOT partitioned spend (spend is 0 here); ranked by ${rankBy}.`
    result.note = result.note ? `${result.note} ${z}` : z
  }
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
