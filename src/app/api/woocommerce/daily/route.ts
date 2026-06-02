// LORAMER_WOO_INTEL_V1
// /api/woocommerce/daily - daily orders/revenue/AOV for the dashboard chart
// Matches the shape returned by /api/shopify/daily so the dashboard renders
// the same chart without modification.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveDateWindow } from '@/lib/date-range'
import { supabaseAdmin } from '@/lib/supabase'

function basicAuth(k: string, s: string): string {
  return 'Basic ' + Buffer.from(k + ':' + s).toString('base64')
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
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

  const { data: tok } = await supabaseAdmin
    .from('woocommerce_tokens')
    .select('store_url, consumer_key, consumer_secret')
    .eq('user_email', session.user.email)
    .eq('client_id', clientId)
    .single()

  if (!tok?.consumer_key || !tok?.consumer_secret || !tok?.store_url) {
    return NextResponse.json({ error: 'No WooCommerce credentials' }, { status: 404 })
  }

  // LORAMER_DATE_RANGE_CANONICAL_V1
  const { startDate: start, endDate: end } = resolveDateWindow(
    dateRange,
    customStart || undefined,
    customEnd || undefined
  )

  const base = tok.store_url.replace(/\/+$/, '') + '/wp-json/wc/v3'
  const headers = {
    Authorization: basicAuth(tok.consumer_key, tok.consumer_secret),
    Accept: 'application/json',
  }

  const after = start + 'T00:00:00'
  const before = end + 'T23:59:59'

  try {
    let allOrders: any[] = []
    for (let page = 1; page <= 10; page++) {
      const url =
        base +
        '/orders?per_page=100&page=' + page +
        '&after=' + encodeURIComponent(after) +
        '&before=' + encodeURIComponent(before) +
        '&status=any'
      const res = await fetch(url, { headers })
      if (!res.ok) break
      const orders = await res.json()
      if (!Array.isArray(orders) || orders.length === 0) break
      allOrders = allOrders.concat(orders)
      if (orders.length < 100) break
    }

    const byDate: Record<string, { date: string; orders: number; revenue: number; avgOrderValue: number }> = {}
    const startD = new Date(start)
    const endD = new Date(end)
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0]
      byDate[key] = { date: key.slice(5), orders: 0, revenue: 0, avgOrderValue: 0 }
    }

    allOrders.forEach((order: any) => {
      const key = (order.date_created || '').split('T')[0]
      if (byDate[key]) {
        byDate[key].orders += 1
        byDate[key].revenue += parseFloat(order.total || '0')
      }
    })

    Object.values(byDate).forEach(d => {
      d.avgOrderValue = d.orders > 0 ? d.revenue / d.orders : 0
      d.revenue = parseFloat(d.revenue.toFixed(2))
      d.avgOrderValue = parseFloat(d.avgOrderValue.toFixed(2))
    })

    const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
    return NextResponse.json({ daily })
  } catch (e: any) {
    console.error('WooCommerce daily error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
