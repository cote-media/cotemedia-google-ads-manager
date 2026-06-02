// LORAMER_GA_CHART_V1
// /api/ga/daily — fetch daily GA4 metrics for the Analytics tab chart

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveDateWindow } from '@/lib/date-range'
import { getValidGaToken } from '@/lib/ga-token'

const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta'

const DAILY_METRICS = [
  'sessions',
  'totalUsers',
  'newUsers',
  'keyEvents',
  'engagedSessions',
  'eventCount',
  'screenPageViews',
  'averageSessionDuration',
] as const

type GaReportRow = {
  dimensionValues?: Array<{ value?: string }>
  metricValues?: Array<{ value?: string }>
}

type GaRunReportResponse = {
  rows?: GaReportRow[]
  error?: { message?: string }
}

type DailyRow = {
  date: string
  sessions: number
  totalUsers: number
  newUsers: number
  keyEvents: number
  engagedSessions: number
  eventCount: number
  screenPageViews: number
  averageSessionDuration: number
}

function normalizePropertyId(propertyId: string): string {
  if (propertyId.startsWith('properties/')) return propertyId
  return `properties/${propertyId}`
}

function metricNum(row: GaReportRow, index: number): number {
  const raw = row.metricValues?.[index]?.value
  if (raw === undefined || raw === '') return 0
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

function gaDateToIso(gaDate: string): string | null {
  const s = gaDate.trim()
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

function displayDate(isoDate: string): string {
  return isoDate.slice(5)
}

async function runGaReport(
  propertyId: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<GaReportRow[]> {
  const url = `${GA_DATA_API}/${normalizePropertyId(propertyId)}:runReport`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as GaRunReportResponse & { message?: string }
  if (!res.ok) {
    throw new Error(json.error?.message || json.message || `GA runReport HTTP ${res.status}`)
  }
  return json.rows || []
}

function emptyDailyRow(isoDate: string): DailyRow {
  return {
    date: displayDate(isoDate),
    sessions: 0,
    totalUsers: 0,
    newUsers: 0,
    keyEvents: 0,
    engagedSessions: 0,
    eventCount: 0,
    screenPageViews: 0,
    averageSessionDuration: 0,
  }
}

function buildDateSkeleton(startDate: string, endDate: string): Record<string, DailyRow> {
  const byDate: Record<string, DailyRow> = {}
  const start = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().split('T')[0]
    byDate[key] = emptyDailyRow(key)
  }
  return byDate
}

const DAILY_NUMERIC_KEYS: Array<Exclude<keyof DailyRow, 'date'>> = [
  'sessions',
  'totalUsers',
  'newUsers',
  'keyEvents',
  'engagedSessions',
  'eventCount',
  'screenPageViews',
  'averageSessionDuration',
]

function applyRows(
  skeleton: Record<string, DailyRow>,
  rows: GaReportRow[],
  apiMetricNames: string[]
): void {
  for (const row of rows) {
    const rawDate = row.dimensionValues?.[0]?.value || ''
    const iso = gaDateToIso(rawDate)
    if (!iso || !skeleton[iso]) continue
    const entry = skeleton[iso]
    apiMetricNames.forEach((name, i) => {
      const outKey = (name === 'conversions' ? 'keyEvents' : name) as Exclude<keyof DailyRow, 'date'>
      if (!DAILY_NUMERIC_KEYS.includes(outKey)) return
      entry[outKey] = metricNum(row, i)
    })
  }
}

async function fetchDailyReport(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
  apiMetricNames: string[]
): Promise<GaReportRow[]> {
  return runGaReport(propertyId, accessToken, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: apiMetricNames.map((name) => ({ name })),
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  })
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as { user?: { email?: string } } | null
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  const tokenResult = await getValidGaToken(clientId, session.user.email)
  if (!tokenResult.ok) {
    return NextResponse.json(
      { error: 'GA auth required', reason: tokenResult.reason, detail: tokenResult.detail },
      { status: 401 }
    )
  }

  const { startDate, endDate } = resolveDateWindow(
    dateRange,
    customStart || undefined,
    customEnd || undefined
  )

  const propertyId = tokenResult.gaPropertyId
  const accessToken = tokenResult.accessToken

  try {
    const skeleton = buildDateSkeleton(startDate, endDate)
    const primaryMetrics = [...DAILY_METRICS] as string[]
    let rows: GaReportRow[] = []
    let apiMetricNames = primaryMetrics

    try {
      rows = await fetchDailyReport(propertyId, accessToken, startDate, endDate, apiMetricNames)
    } catch (e) {
      console.error('[ga-daily] report with keyEvents failed:', e)
      apiMetricNames = primaryMetrics.map((m) => (m === 'keyEvents' ? 'conversions' : m))
      try {
        rows = await fetchDailyReport(propertyId, accessToken, startDate, endDate, apiMetricNames)
        console.log('[ga-daily] using conversions metric as keyEvents fallback')
      } catch (fallbackErr) {
        console.error('[ga-daily] report with conversions fallback failed:', fallbackErr)
        throw fallbackErr
      }
    }

    applyRows(skeleton, rows, apiMetricNames)

    const daily = Object.keys(skeleton)
      .sort()
      .map((iso) => skeleton[iso])

    return NextResponse.json({ daily })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[ga-daily] error:', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
