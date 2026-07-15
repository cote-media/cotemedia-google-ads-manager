// LORAMER_NEXT_GA_OVERVIEW_V1 — property-level GA4 Overview read (NO dimensions; the dimensional GA4 report tables
// are capture-gated = N4, not built). Reads the CAPTURED account-grain GA rows (metrics_daily platform='ga',
// entity_level='account', breakdown_type='') and their extra{} JSONB — sessions/totalUsers/newUsers/engagementRate/
// transactions plus the revenue+conversions columns. Mirrors /api/next/client-metrics' window logic (portfolioWindows
// current+prior + Δ) and store-timeseries' captured-only series. resolveAccess-gated. FALSE-ZERO HONEST: reports
// whether GA is connected (any row ever) and whether there is ANY non-zero signal in range — the UI shows an honest
// empty state instead of a wall of fabricated $0.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveAccess } from '@/lib/access/can-access'
import { portfolioWindows, isPortfolioPeriod } from '@/lib/next/portfolio-windows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }

type Acc = { sessions: number; users: number; newUsers: number; conversions: number; revenue: number; transactions: number; engWeighted: number; rows: number }
const empty = (): Acc => ({ sessions: 0, users: 0, newUsers: 0, conversions: 0, revenue: 0, transactions: 0, engWeighted: 0, rows: 0 })
function totals(a: Acc) {
  // engagementRate is a RATE — session-weighted blend Σ(rate×sessions)/Σsessions (NEVER a sum of daily rates).
  const engagementRate = a.sessions > 0 ? Number((a.engWeighted / a.sessions).toFixed(4)) : null
  return {
    sessions: Math.round(a.sessions), users: Math.round(a.users), newUsers: Math.round(a.newUsers),
    conversions: Number(a.conversions.toFixed(2)), revenue: Number(a.revenue.toFixed(2)),
    transactions: Math.round(a.transactions), engagementRate,
  }
}

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
  const pw = portfolioWindows(period)
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const qs = sp.get('start'), qe = sp.get('end'), qcs = sp.get('cmpStart'), qce = sp.get('cmpEnd')
  const current = qs && qe && ISO.test(qs) && ISO.test(qe) ? { startDate: qs, endDate: qe } : pw.current
  const prior = qcs && qce && ISO.test(qcs) && ISO.test(qce) ? { startDate: qcs, endDate: qce } : pw.prior
  const overallStart = current.startDate < prior.startDate ? current.startDate : prior.startDate
  const overallEnd = current.endDate > prior.endDate ? current.endDate : prior.endDate

  const cur = empty(), prev = empty()
  const seriesMap = new Map<string, { date: string; sessions: number; users: number; revenue: number }>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('date,revenue,conversions,extra')
      .eq('client_id', clientId).eq('platform', 'ga').eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
      .gte('date', overallStart).lte('date', overallEnd)
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: 'metrics_daily query failed', detail: error.message }, { status: 500 })
    const rows = data || []
    for (const r of rows) {
      const d = r.date as string
      const a = d >= current.startDate && d <= current.endDate ? cur : d >= prior.startDate && d <= prior.endDate ? prev : null
      if (!a) continue
      const ex = (r.extra || {}) as Record<string, unknown>
      const sessions = fin(ex.sessions)
      a.sessions += sessions
      a.users += fin(ex.totalUsers); a.newUsers += fin(ex.newUsers)
      a.conversions += fin(r.conversions); a.revenue += fin(r.revenue); a.transactions += fin(ex.transactions)
      a.engWeighted += fin(ex.engagementRate) * sessions
      a.rows += 1
      if (a === cur) seriesMap.set(d, { date: d, sessions, users: fin(ex.totalUsers), revenue: fin(r.revenue) })
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const c = totals(cur), p = totals(prev)
  const series = Array.from(seriesMap.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Connected proxy: any GA account row EVER for this client. + latest captured GA day (unbounded) for the freshness note.
  // LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1 — breakdown_type='' + breakdown_value='' are LOAD-BEARING, not redundant:
  // entity_level='account' ALONE does NOT satisfy migration 035's partial-index predicate, so the planner cannot
  // prove implication and the index is silently unusable — post GA-dimensional capture this client×platform holds
  // many breakdown rows to scan. Rests on the EMPIRICAL invariant that an account row exists on every captured day
  // (23/23 fleet + per client×platform, 2026-07-15; NOT schema-enforced). Do not delete as redundant.
  const { data: latest } = await supabaseAdmin
    .from('metrics_daily').select('date').eq('client_id', clientId).eq('platform', 'ga').eq('entity_level', 'account')
    .eq('breakdown_type', '').eq('breakdown_value', '')
    .order('date', { ascending: false }).limit(1).maybeSingle()
  const hasGaEver = !!latest
  const hasSignalInRange = c.sessions > 0 || c.users > 0 || c.revenue > 0 || c.conversions > 0 || c.transactions > 0

  return NextResponse.json({
    clientId, period, current, prior,
    hasGaEver, hasSignalInRange,
    totals: c, priorTotals: p, series,
    latestCapturedDate: latest?.date || null,
  })
}
