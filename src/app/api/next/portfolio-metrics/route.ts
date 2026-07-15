// LORAMER_NEXT_PORTFOLIO_METRICS_V1 / LORAMER_NEXT_PORTFOLIO_DELTA_V1 — -next batch portfolio metrics
// (membership-aware) for a SELECTED period + its LIKE-FOR-LIKE prior. ONE paginated metrics_daily query covers
// BOTH windows (NOT a per-client loop). ?period=<preset> (default LAST_30_DAYS for back-compat).
//
// DEFINITION replicated from the current app's /api/clients/metrics (that route is frozen — NOT imported/edited;
// reconciled in Gate A): metrics_daily CANONICAL account rows (breakdown_type=''/value='') ; spend = google+meta;
// revenue precedence store(shopify/woo) > ga > null (NEVER summed). ONLY the windows change vs 1B-2.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { listAccessibleClients } from '@/lib/access/can-access'
import { portfolioWindows, isPortfolioPeriod } from '@/lib/next/portfolio-windows'
// LORAMER_LORA_CANONICAL_SETTLE_V1 (Fix #1 B1) — the ONE canonical settle (store>ga>none; NEVER summed).
import { emptyRevenueAcc, settleRevenue, type RevenueAcc } from '@/lib/next/revenue-settle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ADS_PLATFORMS = ['google', 'meta']
const STORE_PLATFORMS = ['shopify', 'woocommerce']

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = new URL(request.url).searchParams.get('period')
  const period = isPortfolioPeriod(raw) ? raw : 'LAST_30_DAYS'
  const { current, prior } = portfolioWindows(period)
  const overallStart = current.startDate < prior.startDate ? current.startDate : prior.startDate
  const overallEnd = current.endDate > prior.endDate ? current.endDate : prior.endDate

  const clientIds = await listAccessibleClients(email)
  if (!clientIds.length) return NextResponse.json({ period, current, prior, metrics: [] })

  const cur: Record<string, RevenueAcc> = {}
  const prev: Record<string, RevenueAcc> = {}
  for (const id of clientIds) { cur[id] = emptyRevenueAcc(); prev[id] = emptyRevenueAcc() }

  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('client_id,platform,spend,revenue,date')
      .in('client_id', clientIds)
      .eq('entity_level', 'account')
      .eq('breakdown_type', '')
      .eq('breakdown_value', '')
      .gte('date', overallStart)
      .lte('date', overallEnd)
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: 'metrics_daily query failed', detail: error.message }, { status: 500 })
    const rows = data || []
    for (const r of rows) {
      const d = r.date as string
      const bucket = d >= current.startDate && d <= current.endDate ? cur
        : d >= prior.startDate && d <= prior.endDate ? prev
        : null
      if (!bucket) continue
      const a = bucket[r.client_id as string]
      if (!a) continue
      const platform = r.platform as string
      if (ADS_PLATFORMS.includes(platform)) a.spend += Number(r.spend || 0)
      else if (STORE_PLATFORMS.includes(platform)) { a.storeRev += Number(r.revenue || 0); a.storeRows += 1 }
      else if (platform === 'ga') { a.gaRev += Number(r.revenue || 0); a.gaRows += 1 }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const metrics = clientIds.map((id) => {
    const c = settleRevenue(cur[id])
    const p = settleRevenue(prev[id])
    return {
      clientId: id,
      spend: c.spend, revenue: c.revenue, revenueSource: c.revenueSource,
      spendPrior: p.spend, revenuePrior: p.revenue,
    }
  })

  // Global freshness: most-recent captured day across the accessible clients (for the data-through guard).
  // LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1 — the account-grain triple below is LOAD-BEARING, not redundant: it
  // satisfies migration 035's partial-index predicate (entity_level='account' AND breakdown_type='' AND
  // breakdown_value=''), turning this into an Index Only Scan Backward instead of scanning EVERY grain — which
  // on heavy clients exceeds the 8s live statement_timeout → 57014 → swallowed → a silent null. Correctness
  // rests on the EMPIRICAL invariant that an account row is written on every day any grain is written
  // (verified 23/23 fleet + per client×platform, 2026-07-15; NOT schema-enforced). Do not delete as redundant.
  const { data: latest } = await supabaseAdmin
    .from('metrics_daily').select('date').in('client_id', clientIds)
    .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
    .order('date', { ascending: false }).limit(1).maybeSingle()

  return NextResponse.json({ period, current, prior, latestCapturedDate: latest?.date || null, metrics })
}
