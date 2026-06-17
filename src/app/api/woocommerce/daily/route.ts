// LORAMER_WOO_INTEL_V1 + LORAMER_WOO_CAPTURED_E1_V1
// /api/woocommerce/daily — daily orders/revenue/AOV for the dashboard chart.
// NOW reads CAPTURED metrics_daily account rows instead of live-fetching the merchant's self-hosted store
// on every chart render (LIVE-SOURCE PRINCIPLE). The Woo dashboard chart is this route's ONLY consumer.
// Revenue here is NET (sale-only) from capture — the prior live path summed GROSS across all statuses
// (latent over-reporting); the captured basis is the corrected one.
// Shape matches /api/shopify/daily so the shared chart renders unchanged:
//   { daily: [{ date:"MM-DD", orders, revenue, avgOrderValue }], asOf?, capturedFrom? }
// Edges (never fabricate unknowns as 0):
//   - today/intraday + future days (capture runs through yesterday) are OMITTED; `asOf` carries the latest captured day
//   - pre-capture days (before earliest captured) are OMITTED; `capturedFrom` carries the earliest captured day
//   - a missing day INSIDE the captured range is a genuine no-sales day → 0
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveDateWindow } from '@/lib/date-range'
import { supabaseAdmin } from '@/lib/supabase'

function addDaysStr(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
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

  // LORAMER_DATE_RANGE_CANONICAL_V1
  const { startDate: start, endDate: end } = resolveDateWindow(
    dateRange,
    customStart || undefined,
    customEnd || undefined
  )

  try {
    // Captured account rows in-window (paginate; Supabase caps a select at 1000). Ownership-scoped by user_email.
    const rows: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('metrics_daily')
        .select('date, revenue, conversions, extra')
        .eq('client_id', clientId)
        .eq('user_email', session.user.email)
        .eq('platform', 'woocommerce')
        .eq('entity_level', 'account')
        .eq('breakdown_type', '')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
        .range(from, from + 999)
      if (error) throw new Error('metrics_daily read failed: ' + error.message)
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < 1000) break
    }

    // Earliest / latest captured day (independent of the requested window) for edge handling.
    const boundQuery = (asc: boolean) =>
      supabaseAdmin
        .from('metrics_daily')
        .select('date')
        .eq('client_id', clientId)
        .eq('user_email', session.user.email)
        .eq('platform', 'woocommerce')
        .eq('entity_level', 'account')
        .eq('breakdown_type', '')
        .order('date', { ascending: asc })
        .limit(1)
    const [{ data: minRow }, { data: maxRow }] = await Promise.all([boundQuery(true), boundQuery(false)])
    const earliestCaptured = minRow?.[0]?.date ? String(minRow[0].date) : null
    const latestCaptured = maxRow?.[0]?.date ? String(maxRow[0].date) : null

    if (!earliestCaptured || !latestCaptured) {
      return NextResponse.json({ daily: [], asOf: null, capturedFrom: null })
    }

    // Clamp the rendered window to what's actually captured — NEVER fabricate today/future or pre-capture days as 0.
    const effStart = start < earliestCaptured ? earliestCaptured : start
    const effEnd = end > latestCaptured ? latestCaptured : end

    const byDate: Record<string, { date: string; orders: number; revenue: number; avgOrderValue: number }> = {}
    rows.forEach((r) => {
      const key = String(r.date) // YYYY-MM-DD
      const revenue = Number(r.revenue || 0)
      const orders = Number(r.conversions || 0)
      const aovExtra =
        r.extra && r.extra.avgOrderValue != null ? Number(r.extra.avgOrderValue) : null
      byDate[key] = {
        date: key.slice(5),
        orders,
        revenue: parseFloat(revenue.toFixed(2)),
        avgOrderValue: parseFloat(
          (aovExtra != null ? aovExtra : orders > 0 ? revenue / orders : 0).toFixed(2)
        ),
      }
    })

    // 0-fill genuine no-sales days INSIDE the captured intersection only.
    const daily: { date: string; orders: number; revenue: number; avgOrderValue: number }[] = []
    if (effStart <= effEnd) {
      for (let d = effStart; d <= effEnd; d = addDaysStr(d, 1)) {
        daily.push(byDate[d] || { date: d.slice(5), orders: 0, revenue: 0, avgOrderValue: 0 })
      }
    }

    return NextResponse.json({
      daily,
      // Honesty notes (Woo-only; the shared chart renders them only when present).
      asOf: end > latestCaptured ? latestCaptured : null,
      capturedFrom: start < earliestCaptured ? earliestCaptured : null,
    })
  } catch (e: any) {
    console.error('WooCommerce captured daily error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
