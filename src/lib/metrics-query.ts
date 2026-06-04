// LORAMER_QUERY_METRICS_0B_V1
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

// Multi-period comparison. Each offset in offsetsMonths produces an EQUAL-LENGTH
// window ending that many calendar months before the base window's end date.
// offset 0 = the base window itself.
export async function queryMetrics(opts: {
  clientId: string
  platforms?: string[]
  level?: string
  baseRange?: string
  offsetsMonths?: number[]
}): Promise<QueryMetricsResult> {
  const level = opts.level || 'account'
  const platforms = opts.platforms && opts.platforms.length ? opts.platforms : []
  const baseRange = opts.baseRange || 'LAST_7_DAYS'
  const offsets = opts.offsetsMonths && opts.offsetsMonths.length ? opts.offsetsMonths : [0, 6, 12, 18]
  const base = resolveDateWindow(baseRange)
  const span = daysInclusive(base.startDate, base.endDate)
  const windows: WindowResult[] = []
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
  return { level, platforms: platforms.length ? platforms : ['all'], baseRange, windows }
}
