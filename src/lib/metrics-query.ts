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

const BREAKDOWN_TYPES = new Set(['search_term', 'keyword', 'publisher_platform', 'age', 'gender', 'geo_country', 'product'])
const BREAKDOWN_PLATFORM: Record<string, string> = {
  search_term: 'google', keyword: 'google',
  publisher_platform: 'meta', age: 'meta', gender: 'meta',
  geo_country: 'shopify', product: 'shopify',
}
const RANKABLE = new Set(['spend', 'impressions', 'clicks', 'conversions', 'conversionValue'])
const VALUE_MAXLEN = 120

export type BreakdownRow = {
  value: string
  parentEntityId?: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  derived: Record<string, number>
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
}): Promise<QueryBreakdownResult> {
  const bt = opts.breakdownType
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
  const platform = BREAKDOWN_PLATFORM[bt] || ''
  const rankBy = RANKABLE.has(opts.rankBy || '') ? (opts.rankBy as string) : 'spend'
  const topN = Math.max(1, Math.min(50, opts.topN || 20))
  const orderDir: 'asc' | 'desc' = opts.orderDir === 'asc' ? 'asc' : 'desc'

  const result: QueryBreakdownResult = {
    breakdownType: bt, platform, window: { startDate, endDate }, rankBy,
    rows: [], distinctValueCount: 0, truncated: false,
  }

  if (!BREAKDOWN_TYPES.has(bt)) {
    result.note = `Unknown breakdownType "${bt}". Supported: ${Array.from(BREAKDOWN_TYPES).join(', ')}.`
    return result
  }
  if (opts.platform && opts.platform !== platform) {
    result.note = `breakdownType "${bt}" belongs to platform "${platform}", not "${opts.platform}" — no cross-platform read.`
    return result
  }

  type Agg = { value: string; parents: Set<string>; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }
  const byValue = new Map<string, Agg>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    let q = supabaseAdmin
      .from('metrics_daily')
      .select('breakdown_value, parent_entity_id, spend, impressions, clicks, conversions, conversion_value')
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
        agg = { value, parents: new Set<string>(), spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
        byValue.set(value, agg)
      }
      if (row.parent_entity_id) agg.parents.add(String(row.parent_entity_id))
      agg.spend += Number(row.spend || 0)
      agg.impressions += Number(row.impressions || 0)
      agg.clicks += Number(row.clicks || 0)
      agg.conversions += Number(row.conversions || 0)
      agg.conversionValue += Number(row.conversion_value || 0)
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
    const totals: MetricTotals = { spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue, revenue: 0, rowCount: 0 }
    return {
      value: a.value.length > VALUE_MAXLEN ? a.value.slice(0, VALUE_MAXLEN) + '…' : a.value,
      parentEntityId: a.parents.size === 1 ? Array.from(a.parents)[0] : undefined,
      spend: a.spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: a.conversionValue,
      derived: derive(totals),
    }
  })
  if (result.truncated) {
    result.note = `Showing top ${topN} of ${byValue.size} ${bt} values by ${rankBy}; more exist (these are a SUBSET of total activity, not the account/campaign total).`
  }
  return result
}
