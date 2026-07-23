// LORAMER_NEXT_STORE_READS_V1 — store-scoped STAT read (net revenue · orders · AOV) for the -next store platform
// page. DEDICATED store route (consistent with /api/next/money, which is likewise a dedicated store-scoped read —
// NOT a platform param on the portfolio-combined client-metrics). Reuses queryMetrics(platform=[store], level=
// 'account'): revenue = totals.revenue, orders = totals.conversions (account.conversions = order count, VERIFIED in
// the store row builders), AOV = derived.aov (revenue ÷ orders). resolveAccess-gated; connection/data-aware
// (resolveStorePlatform: shopify|woo per captured data; neither → honest empty, hasDataEver law, NEVER a false $0).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveAccess } from '@/lib/access/can-access'
import { resolveStorePlatform } from '@/lib/next/store-detect'
import { queryMetrics } from '@/lib/metrics-query'
import { resolveDateWindow } from '@/lib/date-range'
import { getCoverageForWindows } from '@/lib/next/coverage' // LORAMER_QUERY_COMPLETENESS_V1 slice 2
import { annotateContribution, buildIncompleteNote } from '@/lib/next/query-completeness' // LORAMER_QUERY_COMPLETENESS_V1 slice 2

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const clientId = sp.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const access = await resolveAccess(clientId, email)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const qs = sp.get('start'), qe = sp.get('end')
  const win = qs && qe && ISO.test(qs) && ISO.test(qe) ? { startDate: qs, endDate: qe } : resolveDateWindow(sp.get('period') || 'LAST_30_DAYS')

  const { chosen, available } = await resolveStorePlatform(clientId, sp.get('platform'))
  if (!chosen) {
    return NextResponse.json({
      clientId, platform: null, availablePlatforms: [], hasStoreData: false,
      window: win, revenue: null, orders: null, aov: null, rowCount: 0, noDataInRange: true,
    })
  }

  const r = await queryMetrics({ clientId, platforms: [chosen], level: 'account', windows: [{ startDate: win.startDate, endDate: win.endDate }] })
  const w = r.windows[0]

  // LORAMER_QUERY_COMPLETENESS_V1 slice 2 — flag a store total whose OWN capture is failing/stale (scoped to the
  // chosen store platform), so a store stat card marks it partial instead of showing an understated number as whole.
  let incompleteNote: string | undefined
  try {
    const cw = [{ startDate: win.startDate, endDate: win.endDate }]
    const cov = await getCoverageForWindows(clientId, [chosen], cw)
    const comp = await annotateContribution(clientId, cw, cov)
    incompleteNote = buildIncompleteNote(comp.perWindow[0])
  } catch { /* best-effort */ }

  return NextResponse.json({
    clientId, platform: chosen, availablePlatforms: available, multiStore: available.length > 1, hasStoreData: true,
    window: { startDate: win.startDate, endDate: win.endDate },
    revenue: w.totals.revenue,
    orders: w.totals.conversions, // account.conversions = order count (verified)
    aov: w.derived.aov ?? null,   // revenue ÷ orders
    rowCount: w.totals.rowCount,
    noDataInRange: w.totals.rowCount === 0, // captured no data in this window → don't read 0 as "no sales"
    incompleteNote, // LORAMER_QUERY_COMPLETENESS_V1 slice 2
  })
}
