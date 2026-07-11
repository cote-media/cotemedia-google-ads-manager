// LORAMER_NEXT_STORE_READS_V1 — store-scoped daily TIMESERIES (revenue + orders) for the -next store platform page.
// Store-scoped (shopify|woo per captured data), NOT the portfolio-combined /api/next/client-timeseries. resolveAccess-
// gated; reads CAPTURED metrics_daily account rows via queryStoreTimeseries. No-sale days are absent by the writer's
// false-zero discipline (a gap in the line, not a $0). chosen=null (no store data ever) → empty series + hasStoreData:false.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveAccess } from '@/lib/access/can-access'
import { resolveStorePlatform } from '@/lib/next/store-detect'
import { queryStoreTimeseries } from '@/lib/metrics-query'
import { resolveDateWindow } from '@/lib/date-range'

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
    return NextResponse.json({ clientId, platform: null, availablePlatforms: [], hasStoreData: false, window: win, series: [] })
  }

  const series = await queryStoreTimeseries({ clientId, platform: chosen, startDate: win.startDate, endDate: win.endDate })
  return NextResponse.json({
    clientId, platform: chosen, availablePlatforms: available, multiStore: available.length > 1, hasStoreData: true,
    window: { startDate: win.startDate, endDate: win.endDate },
    series, // [{ date, revenue, orders }] — captured days only (no-sale days absent by design)
  })
}
