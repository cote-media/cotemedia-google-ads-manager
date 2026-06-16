// /api/shopify/daily — fetch daily orders/revenue for chart
// LORAMER_GRAPHQL_MIGRATION_V1
// Migrated from REST (/admin/api/2024-01/orders.json) to GraphQL Admin API
// per Shopify App Store requirement 2.2.4.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { shopifyGraphQL } from '@/lib/intelligence/shopify-intelligence' // LORAMER_SHOPIFY_DAILY_HARDEN_V1 — shared pagination + throttle-retry

const GRAPHQL_API_VERSION = '2025-01'
const MAX_ORDERS = 1000

// LORAMER_SHOPIFY_NET_SALES_V1
type OrderNode = {
  id: string
  createdAt: string
  currentSubtotalPriceSet: { shopMoney: { amount: string } }
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // LORAMER_OWNERSHIP_GATE_20260616 (#16) — same proven gate as /api/insight, /api/intelligence, /api/backfill/run.
  const { data: owned } = await supabaseAdmin
    .from('clients').select('id')
    .eq('id', clientId).eq('user_email', session.user.email)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

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
    return NextResponse.json(
      { error: 'Shopify auth required', reason: tokenResult.reason, detail: tokenResult.detail },
      { status: 401 }
    )
  }
  const accessToken = tokenResult.accessToken

  // LORAMER_DATE_RANGE_CANONICAL_V1
  const { startDate: start, endDate: end } = resolveDateWindow(
    dateRange,
    customStart || undefined,
    customEnd || undefined
  )

  const endpoint = `https://${conn.account_id}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  }

  // Shopify GraphQL date filter syntax for the orders `query` arg
  const queryString = `created_at:>=${start}T00:00:00Z AND created_at:<=${end}T23:59:59Z`

  const gqlQuery = `
    query OrdersDaily($query: String!, $cursor: String) {
      orders(first: 250, after: $cursor, query: $query) {
        edges {
          cursor
          node {
            id
            createdAt
            currentSubtotalPriceSet { shopMoney { amount } }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `

  try {
    // Fetch all orders in range with cursor-based pagination
    const allOrders: OrderNode[] = []
    let cursor: string | null = null

    while (true) {
      // LORAMER_SHOPIFY_DAILY_HARDEN_V1 — route through the shared throttle-retry helper so a
      // THROTTLED/transient page retries instead of 500ing (deep ranges previously 500'd here).
      const json: any = await shopifyGraphQL(endpoint, headers, gqlQuery, { query: queryString, cursor })

      if (json.errors) {
        console.error('Shopify GraphQL errors:', JSON.stringify(json.errors))
        return NextResponse.json({ error: 'GraphQL query returned errors' }, { status: 500 })
      }

      const edges = json.data?.orders?.edges || []
      for (const e of edges) allOrders.push(e.node)

      const pageInfo = json.data?.orders?.pageInfo
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
      if (allOrders.length >= MAX_ORDERS) break

      cursor = pageInfo.endCursor
    }

    // Aggregate by date
    const byDate: Record<string, { date: string; orders: number; revenue: number; avgOrderValue: number }> = {}
    const startDate = new Date(start)
    const endDate = new Date(end)
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0]
      byDate[key] = { date: key.slice(5), orders: 0, revenue: 0, avgOrderValue: 0 }
    }

    allOrders.forEach((order) => {
      const key = order.createdAt.split('T')[0]
      if (byDate[key]) {
        byDate[key].orders += 1
        byDate[key].revenue += parseFloat(order.currentSubtotalPriceSet?.shopMoney?.amount || '0')
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
