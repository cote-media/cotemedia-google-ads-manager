// LORAMER_NEXT_COMBINED_CHART_V1 — daily Google/Meta time-series for the -next Combined Performance chart
// (membership-aware). Reads canonical account rows (entity_level='account', breakdown_type=''/value='') from the
// captured metrics_daily, grouped by date+platform over the CURRENT ET window (portfolioWindows), zero-filled for
// missing days. Additive: does NOT touch /api/next/client-metrics. Reconciles to its channel/Top-stat totals.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveAccess } from '@/lib/access/can-access'
import { portfolioWindows, isPortfolioPeriod } from '@/lib/next/portfolio-windows'
import { addDaysIso } from '@/lib/date-range'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
type Pt = { spend: number; clicks: number; conversions: number }
const zero = (): Pt => ({ spend: 0, clicks: 0, conversions: 0 })

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const clientId = sp.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const access = await resolveAccess(clientId, email)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const period = isPortfolioPeriod(sp.get('period')) ? (sp.get('period') as string) : 'LAST_30_DAYS'
  const { current } = portfolioWindows(period)

  // Zero-filled day map across the window (ISO date string compare == chronological).
  const days: Record<string, { date: string; google: Pt; meta: Pt }> = {}
  for (let d = current.startDate; d <= current.endDate; d = addDaysIso(d, 1)) {
    days[d] = { date: d, google: zero(), meta: zero() }
  }

  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('platform,spend,clicks,conversions,date')
      .eq('client_id', clientId)
      .eq('entity_level', 'account')
      .eq('breakdown_type', '')
      .eq('breakdown_value', '')
      .in('platform', ['google', 'meta'])
      .gte('date', current.startDate)
      .lte('date', current.endDate)
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: 'metrics_daily query failed', detail: error.message }, { status: 500 })
    const rows = data || []
    for (const r of rows) {
      const d = days[r.date as string]
      if (!d) continue
      const pf = r.platform === 'google' ? d.google : d.meta
      pf.spend += fin(r.spend); pf.clicks += fin(r.clicks); pf.conversions += fin(r.conversions)
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const series = Object.values(days)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    // Full precision per day (toFixed(6) is lossless for micros-derived spend) so the series sums EXACTLY to the
    // Top-stats/channels headline totals (Σ of round-2 per-day would drift by a cent). The chart rounds for display.
    .map((d) => ({
      date: d.date,
      google: { spend: Number(d.google.spend.toFixed(6)), clicks: Math.round(d.google.clicks), conversions: Number(d.google.conversions.toFixed(6)) },
      meta: { spend: Number(d.meta.spend.toFixed(6)), clicks: Math.round(d.meta.clicks), conversions: Number(d.meta.conversions.toFixed(6)) },
    }))

  return NextResponse.json({ period, current, series })
}
