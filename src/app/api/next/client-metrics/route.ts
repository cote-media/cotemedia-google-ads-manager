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
// LORAMER_LORA_CANONICAL_SETTLE_V1 (Fix #1 B1) — the ONE canonical settle (extracted verbatim from this file).
import { emptyRevenueAcc, settleRevenue } from '@/lib/next/revenue-settle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ADS_PLATFORMS = ['google', 'meta']
const STORE_PLATFORMS = ['shopify', 'woocommerce']

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
// Acc shape + settle now live in @/lib/next/revenue-settle (settleRevenue) — this file was the reference.

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
  const pw = portfolioWindows(period)
  // LORAMER_NEXT_CARD_ENGINE_RESHAPE_V1 — the card engine passes an EXPLICIT current window (global range / per-card
  // override) and, when a compare mode is active, an explicit comparison window (used as `prior`). Both optional:
  // absent → the preset's like-for-like prior (back-compatible). The viz only SHOWS the delta when compare is on.
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const qs = sp.get('start'), qe = sp.get('end'), qcs = sp.get('cmpStart'), qce = sp.get('cmpEnd')
  const current = qs && qe && ISO.test(qs) && ISO.test(qe) ? { startDate: qs, endDate: qe } : pw.current
  const prior = qcs && qce && ISO.test(qcs) && ISO.test(qce) ? { startDate: qcs, endDate: qce } : pw.prior
  const overallStart = current.startDate < prior.startDate ? current.startDate : prior.startDate
  const overallEnd = current.endDate > prior.endDate ? current.endDate : prior.endDate

  const cur = emptyRevenueAcc(), prev = emptyRevenueAcc()
  const curByPlatform: Record<string, number> = { google: 0, meta: 0 } // per-platform ads SPEND, CURRENT window only
  const curStoreRev: Record<string, number> = { shopify: 0, woocommerce: 0 } // per-platform store REVENUE, CURRENT window
  let curGaRev = 0, curGaConv = 0 // GA revenue + conversions, CURRENT window only
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('platform,spend,revenue,conversions,conversion_value,impressions,clicks,date')
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
        a.impressions += fin(r.impressions); a.clicks += fin(r.clicks)
        if (a === cur && (platform === 'google' || platform === 'meta')) curByPlatform[platform] += fin(r.spend)
      }
      else if (STORE_PLATFORMS.includes(platform)) {
        a.storeRev += fin(r.revenue); a.storeRows += 1
        if (a === cur && (platform === 'shopify' || platform === 'woocommerce')) curStoreRev[platform] += fin(r.revenue)
      }
      else if (platform === 'ga') {
        a.gaRev += fin(r.revenue); a.gaRows += 1
        if (a === cur) { curGaRev += fin(r.revenue); curGaConv += fin(r.conversions) }
      }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const c = settleRevenue(cur), p = settleRevenue(prev)

  // hasDataEver: does this client have ANY metrics_daily rows for the platform across all time (honest
  // "is it connected" proxy) — so an unconnected platform renders "not connected", never a fabricated $0.
  const ever = async (pf: string) => {
    const { data } = await supabaseAdmin.from('metrics_daily').select('platform').eq('client_id', clientId).eq('platform', pf).limit(1).maybeSingle()
    return !!data
  }
  const [googleEver, metaEver, shopifyEver, wooEver, gaEver] = await Promise.all([ever('google'), ever('meta'), ever('shopify'), ever('woocommerce'), ever('ga')])
  const channels = [
    { platform: 'google', spend: Number(curByPlatform.google.toFixed(2)), revenue: null as number | null, conversions: null as number | null, hasDataEver: googleEver },
    { platform: 'meta', spend: Number(curByPlatform.meta.toFixed(2)), revenue: null as number | null, conversions: null as number | null, hasDataEver: metaEver },
    { platform: 'shopify', spend: null as number | null, revenue: Number(curStoreRev.shopify.toFixed(2)), conversions: null as number | null, hasDataEver: shopifyEver },
    { platform: 'woocommerce', spend: null as number | null, revenue: Number(curStoreRev.woocommerce.toFixed(2)), conversions: null as number | null, hasDataEver: wooEver },
    { platform: 'ga', spend: null as number | null, revenue: Number(curGaRev.toFixed(2)), conversions: Math.round(curGaConv), hasDataEver: gaEver },
  ]

  // True freshness for this client (unbounded by the window) so the captured basis is transparent.
  const { data: latest } = await supabaseAdmin
    .from('metrics_daily').select('date').eq('client_id', clientId)
    .order('date', { ascending: false }).limit(1).maybeSingle()

  return NextResponse.json({
    clientId, period, current, prior,
    spend: c.spend, revenue: c.revenue, revenueSource: c.revenueSource,
    conversions: c.conversions, conversionValue: c.conversionValue, roas: c.roas,
    impressions: c.impressions, clicks: c.clicks, ctr: c.ctr, cpc: c.cpc, cpa: c.cpa,
    spendPrior: p.spend, revenuePrior: p.revenue, conversionsPrior: p.conversions,
    impressionsPrior: p.impressions, clicksPrior: p.clicks,
    latestCapturedDate: latest?.date || null,
    channels,
  })
}
