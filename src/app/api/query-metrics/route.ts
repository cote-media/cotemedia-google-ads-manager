// LORAMER_QUERY_METRICS_0B_V1
// LORAMER_QUERY_METRICS_DATE_FLEX_V1 - route now also accepts explicit `windows`
// so arbitrary date ranges (e.g. Q4 2024) can be proven headlessly via curl
// before trusting the in-app tool path.
// Phase 0b proving route: multi-period comparison from metrics_daily via
// queryMetrics(). Read-only. Auth: CRON_SECRET bearer (same as the backfill
// driver). Query params:
//   clientId (required)
//   platform (optional; single platform e.g. google, or 'all' / omitted = all)
//   level    (optional; default 'account')
//   baseRange(optional; default 'LAST_7_DAYS' - any resolveDateWindow preset)
//   offsets  (optional CSV of month offsets; default '0,6,12,18')
//   windows  (optional; explicit ranges. Format per window: start:end[:label],
//            windows separated by ';'. Dates are YYYY-MM-DD. When present,
//            baseRange/offsets are ignored. Example:
//            windows=2024-10-01:2024-12-31:Q4 2024;2025-10-01:2025-12-31:Q4 2025)

import { NextResponse } from 'next/server'
import { queryMetrics } from '@/lib/metrics-query'

export const maxDuration = 60

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }

  const platform = searchParams.get('platform')
  const level = searchParams.get('level') || 'account'
  const baseRange = searchParams.get('baseRange') || 'LAST_7_DAYS'
  const offsetsParam = searchParams.get('offsets') || '0,6,12,18'
  const offsetsMonths = offsetsParam
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !Number.isNaN(n))
  const platforms = platform && platform !== 'all' ? [platform] : []

  const windowsParam = searchParams.get('windows')
  let windows: Array<{ label?: string; startDate: string; endDate: string }> | undefined
  if (windowsParam) {
    windows = windowsParam
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .map(seg => {
        const parts = seg.split(':')
        const startDate = (parts[0] || '').trim()
        const endDate = (parts[1] || '').trim()
        const label = parts.length > 2 ? parts.slice(2).join(':').trim() : ''
        return { label: label || undefined, startDate, endDate }
      })
  }

  try {
    const result = await queryMetrics({ clientId, platforms, level, baseRange, offsetsMonths, windows })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
