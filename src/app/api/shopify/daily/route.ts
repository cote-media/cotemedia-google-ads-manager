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

const GRAPHQL_API_VERSION = '2026-07' // LORAMER_SHOPIFY_VERSION_PIN_2026_07_V1
const MAX_ORDERS = 1000

// LORAMER_SHOPIFY_NET_SALES_V1
type OrderNode = {
  id: string
  createdAt: string
  // LORAMER_SHOPIFY_CANCELLED_EXCLUDED_V1 — nullable BY THE VENDOR: null means the order stands. The type
  // mirrors shopify-intelligence.ts's GraphQLOrderNode so the two paths cannot drift on the field's shape.
  cancelledAt: string | null
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
    .eq('id', clientId).eq('user_email', session.user.email).is('deleted_at', null) // LORAMER_DELETE_CLIENT_V1 — archived → 404
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
            cancelledAt
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

    // ⛔ LORAMER_SHOPIFY_CANCELLED_EXCLUDED_V1 — CANCELLED ORDERS ALWAYS INFLATE THE COUNT AND OCCASIONALLY
    // THE REVENUE. MEASURED on live vendor data, 162 cancelled orders across two stores: 160 carry a $0
    // `currentSubtotalPriceSet` and TWO DO NOT ($325.00, $316.00). The earlier claim in this file — "a
    // cancelled order's subtotal is $0, so the inflation is COUNT-only" — was generalised from SEVEN orders
    // over five days and is FALSE; AUDIT_FINDINGS:44 item 6 now carries the falsification. No mechanism is
    // asserted for the two: 2 days and 26 days elapsed respectively, so "cancelled late" does not explain it.
    // ⇒ THE GATE IS AN ACCOUNTING IDENTITY, NOT AN ASSERTION THAT REVENUE HOLDS STILL:
    //     revenue_before − revenue_after == Σ(currentSubtotalPriceSet of the orders this filter excludes)
    // exactly, to the cent. That identity is what proves the RIGHT field was touched; "revenue unchanged"
    // would have been a green light on a false premise. Verified on three stores 2026-08-23, all exact.
    // The casualty that matters to a reader is :137's `revenue / orders` — the right numerator over an
    // inflated denominator understated average order value on every client with a cancellation.
    // ⛔ BYTE-IDENTICAL SPELLING TO THE CAPTURED PATH (shopify-intelligence.ts:475, `orderNodes.filter(o =>
    // !o.cancelledAt)`) ON PURPOSE: two spellings of one rule is how these two surfaces came to disagree.
    const liveOrders = allOrders.filter((o) => !o.cancelledAt)
    liveOrders.forEach((order) => {
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
