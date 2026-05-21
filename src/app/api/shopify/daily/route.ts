// /api/shopify/daily — fetch daily orders/revenue for chart
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getValidShopifyToken } from '@/lib/shopify-token'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // Get shop connection
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('client_id', clientId)
    .eq('platform', 'shopify')
    .single()

  if (!conn) return NextResponse.json({ error: 'No Shopify connection' }, { status: 404 })

  // Get a valid token (auto-refreshes if expired)
  const tokenResult = await getValidShopifyToken(session.user.email, conn.account_id)
  if (!tokenResult.ok) {
    const status = tokenResult.reason === 'refresh_expired' ? 401 : 401
    return NextResponse.json(
      { error: 'Shopify auth required', reason: tokenResult.reason, detail: tokenResult.detail },
      { status }
    )
  }
  const accessToken = tokenResult.accessToken

  // Build date range
  const end = customEnd || new Date().toISOString().split('T')[0]
  const start = customStart || (() => {
    const d = new Date()
    const days: Record<string, number> = {
      LAST_7_DAYS: 7, LAST_14_DAYS: 14, LAST_30_DAYS: 30,
      THIS_MONTH: new Date().getDate(), LAST_MONTH: 60,
    }
    d.setDate(d.getDate() - (days[dateRange] || 30))
    return d.toISOString().split('T')[0]
  })()

  const SHOPIFY_API = `https://${conn.account_id}/admin/api/2024-01`
  const headers = { 'X-Shopify-Access-Token': accessToken }

  try {
    // Fetch all orders in range with line items
    let allOrders: any[] = []
    let url: string | null = `${SHOPIFY_API}/orders.json?status=any&created_at_min=${start}T00:00:00Z&created_at_max=${end}T23:59:59Z&limit=250&fields=id,created_at,total_price,financial_status,line_items`
    
    while (url) {
      const res: Response = await fetch(url, { headers })
      const data: any = await res.json()
      allOrders = allOrders.concat(data.orders || [])
      const linkHeader = res.headers.get('link') || ''
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      url = nextMatch ? nextMatch[1] : null
      if (allOrders.length > 1000) break
    }

    // Aggregate by date
    const byDate: Record<string, { date: string; orders: number; revenue: number; avgOrderValue: number }> = {}

    const startDate = new Date(start)
    const endDate = new Date(end)
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0]
      byDate[key] = { date: key.slice(5), orders: 0, revenue: 0, avgOrderValue: 0 }
    }

    allOrders.forEach((order: any) => {
      const key = order.created_at.split('T')[0]
      if (byDate[key]) {
        byDate[key].orders += 1
        byDate[key].revenue += parseFloat(order.total_price || '0')
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
    console.error('Shopify daily error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
