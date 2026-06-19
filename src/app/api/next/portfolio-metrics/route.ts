// LORAMER_NEXT_PORTFOLIO_METRICS_V1 — -next batch portfolio metrics (membership-aware). ONE paginated
// metrics_daily query for ALL accessible clients (NOT a per-client loop of heavy intelligence calls).
//
// DEFINITION IS REPLICATED from the current app's /api/clients/metrics (LORAMER_CLIENT_METRICS_ROLLUP_V2) —
// that route is on the frozen reviewer path, so it is NOT imported/edited; the identical query lives here and
// is reconciled to it (Gate A): metrics_daily CANONICAL account rows (entity_level='account',
// breakdown_type='' , breakdown_value='') over LAST_30_DAYS via the ONE resolver; spend = google+meta;
// revenue precedence store(shopify/woo) > ga > null (NEVER summed); ads conversion_value is NOT revenue.
//
// NO delta: the current app computes no portfolio-level delta, so there is nothing to reconcile a delta to
// (deferred — see CONTINUE_HERE / report). Returns only the objective, reconcilable Spend + Revenue.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
import { listAccessibleClients } from '@/lib/access/can-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ADS_PLATFORMS = ['google', 'meta']
const STORE_PLATFORMS = ['shopify', 'woocommerce']

export async function GET() {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientIds = await listAccessibleClients(email)
  if (!clientIds.length) return NextResponse.json({ metrics: [] })

  const { startDate, endDate } = resolveDateWindow('LAST_30_DAYS')
  const buckets: Record<string, { spend: number; storeRev: number; gaRev: number; storeRows: number; gaRows: number }> = {}
  for (const id of clientIds) buckets[id] = { spend: 0, storeRev: 0, gaRev: 0, storeRows: 0, gaRows: 0 }

  // Canonical top-level rows only; paginate (Supabase caps selects at 1000). Identical filter to the query layer.
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('client_id,platform,spend,revenue')
      .in('client_id', clientIds)
      .eq('entity_level', 'account')
      .eq('breakdown_type', '')
      .eq('breakdown_value', '')
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: 'metrics_daily query failed', detail: error.message }, { status: 500 })
    const rows = data || []
    for (const r of rows) {
      const b = buckets[r.client_id as string]
      if (!b) continue
      const platform = r.platform as string
      if (ADS_PLATFORMS.includes(platform)) b.spend += Number(r.spend || 0)
      else if (STORE_PLATFORMS.includes(platform)) { b.storeRev += Number(r.revenue || 0); b.storeRows += 1 }
      else if (platform === 'ga') { b.gaRev += Number(r.revenue || 0); b.gaRows += 1 }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  const metrics = clientIds.map((id) => {
    const b = buckets[id]
    const spend = Number(b.spend.toFixed(2))
    let revenue: number | null = null
    let revenueSource: 'store' | 'ga' | 'none' = 'none'
    if (b.storeRows > 0) { revenue = Number(b.storeRev.toFixed(2)); revenueSource = 'store' }
    else if (b.gaRows > 0) { revenue = Number(b.gaRev.toFixed(2)); revenueSource = 'ga' }
    return { clientId: id, spend, revenue, revenueSource }
  })
  return NextResponse.json({ metrics })
}
