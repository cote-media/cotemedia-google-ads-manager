// LORAMER_NEXT_CLIENT_OVERVIEW_V1 — single-client Overview "Top stats" from the CAPTURED system-of-record
// (metrics_daily), membership-aware. Byte-identical metric definition to /api/next/portfolio-metrics
// (entity_level='account', breakdown_type=''/value=''; spend=google+meta; revenue precedence store>ga>null) —
// only single-client + the extra Conversions/conversionValue/ROAS headline fields. ONE paginated query covers
// the selected period AND its like-for-like prior (reusing portfolioWindows). Reconciles to portfolio + Lora.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveAccess } from '@/lib/access/can-access'
import { portfolioWindows, isPortfolioPeriod } from '@/lib/next/portfolio-windows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ADS_PLATFORMS = ['google', 'meta']
const STORE_PLATFORMS = ['shopify', 'woocommerce']

type Acc = { spend: number; conversions: number; conversionValue: number; storeRev: number; gaRev: number; storeRows: number; gaRows: number }
const emptyAcc = (): Acc => ({ spend: 0, conversions: 0, conversionValue: 0, storeRev: 0, gaRev: 0, storeRows: 0, gaRows: 0 })
const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }

function settle(a: Acc) {
  const spend = Number(a.spend.toFixed(2))
  let revenue: number | null = null
  let revenueSource: 'store' | 'ga' | 'none' = 'none'
  if (a.storeRows > 0) { revenue = Number(a.storeRev.toFixed(2)); revenueSource = 'store' }
  else if (a.gaRows > 0) { revenue = Number(a.gaRev.toFixed(2)); revenueSource = 'ga' }
  const conversions = Number(a.conversions.toFixed(2))
  const conversionValue = Number(a.conversionValue.toFixed(2))
  const roas = spend > 0 && revenue != null && Number.isFinite(revenue / spend) ? Number((revenue / spend).toFixed(2)) : null
  return { spend, revenue, revenueSource, conversions, conversionValue, roas }
}

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const clientId = sp.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const access = await resolveAccess(clientId, email)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // 404, don't confirm the id

  const period = isPortfolioPeriod(sp.get('period')) ? (sp.get('period') as string) : 'LAST_30_DAYS'
  const { current, prior } = portfolioWindows(period)
  const overallStart = current.startDate < prior.startDate ? current.startDate : prior.startDate
  const overallEnd = current.endDate > prior.endDate ? current.endDate : prior.endDate

  const cur = emptyAcc(), prev = emptyAcc()
  const curByPlatform: Record<string, number> = { google: 0, meta: 0 } // per-platform ads SPEND, CURRENT window only
  const curStoreRev: Record<string, number> = { shopify: 0, woocommerce: 0 } // per-platform store REVENUE, CURRENT window
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('platform,spend,revenue,conversions,conversion_value,date')
      .eq('client_id', clientId)
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
      const a = d >= current.startDate && d <= current.endDate ? cur
        : d >= prior.startDate && d <= prior.endDate ? prev
        : null
      if (!a) continue
      const platform = r.platform as string
      if (ADS_PLATFORMS.includes(platform)) {
        a.spend += fin(r.spend); a.conversions += fin(r.conversions); a.conversionValue += fin(r.conversion_value)
        if (a === cur && (platform === 'google' || platform === 'meta')) curByPlatform[platform] += fin(r.spend)
      }
      else if (STORE_PLATFORMS.includes(platform)) {
        a.storeRev += fin(r.revenue); a.storeRows += 1
        if (a === cur && (platform === 'shopify' || platform === 'woocommerce')) curStoreRev[platform] += fin(r.revenue)
      }
      else if (platform === 'ga') { a.gaRev += fin(r.revenue); a.gaRows += 1 }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const c = settle(cur), p = settle(prev)

  // hasDataEver: does this client have ANY metrics_daily rows for the platform across all time (honest
  // "is it connected" proxy) — so an unconnected platform renders "not connected", never a fabricated $0.
  const ever = async (pf: string) => {
    const { data } = await supabaseAdmin.from('metrics_daily').select('platform').eq('client_id', clientId).eq('platform', pf).limit(1).maybeSingle()
    return !!data
  }
  const [googleEver, metaEver, shopifyEver, wooEver] = await Promise.all([ever('google'), ever('meta'), ever('shopify'), ever('woocommerce')])
  const channels = [
    { platform: 'google', spend: Number(curByPlatform.google.toFixed(2)), revenue: null as number | null, hasDataEver: googleEver },
    { platform: 'meta', spend: Number(curByPlatform.meta.toFixed(2)), revenue: null as number | null, hasDataEver: metaEver },
    { platform: 'shopify', spend: null as number | null, revenue: Number(curStoreRev.shopify.toFixed(2)), hasDataEver: shopifyEver },
    { platform: 'woocommerce', spend: null as number | null, revenue: Number(curStoreRev.woocommerce.toFixed(2)), hasDataEver: wooEver },
  ]

  // True freshness for this client (unbounded by the window) so the captured basis is transparent.
  const { data: latest } = await supabaseAdmin
    .from('metrics_daily').select('date').eq('client_id', clientId)
    .order('date', { ascending: false }).limit(1).maybeSingle()

  return NextResponse.json({
    clientId, period, current, prior,
    spend: c.spend, revenue: c.revenue, revenueSource: c.revenueSource,
    conversions: c.conversions, conversionValue: c.conversionValue, roas: c.roas,
    spendPrior: p.spend, revenuePrior: p.revenue, conversionsPrior: p.conversions,
    latestCapturedDate: latest?.date || null,
    channels,
  })
}
