// ─── Shopify Intelligence Adapter ─────────────────────────────────────────────
// LORAMER_GRAPHQL_MIGRATION_V1
// Migrated from REST (/admin/api/2024-01/orders.json) to GraphQL Admin API
// per Shopify App Store requirement 2.2.4.
//
// Output shape conforms to IntelligenceShopify schema — unchanged from REST version.
// One GraphQL query replaces what was two REST calls.

import type { IntelligenceShopify } from './intelligence-types'

const GRAPHQL_API_VERSION = '2025-01'

type GraphQLOrderNode = {
  id: string
  totalPriceSet: { shopMoney: { amount: string } }
  displayFinancialStatus: string | null
  customer: { id: string; numberOfOrders: number } | null
  lineItems: {
    edges: Array<{
      node: {
        title: string
        quantity: number
        product: { id: string } | null
        originalUnitPriceSet: { shopMoney: { amount: string } }
      }
    }>
  }
}

export async function fetchShopifyIntelligence(
  accessToken: string,
  shopDomain: string,   // e.g. "my-store.myshopify.com"
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<IntelligenceShopify> {
  const endpoint = `https://${shopDomain}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  }

  // Build date filter
  const endDate = customEnd || new Date().toISOString().split('T')[0]
  const startDate = customStart || (() => {
    const d = new Date()
    // LORAMER_THIS_MONTH_FIX_V1 - THIS_MONTH means back to the 1st of the current month, matching /api/shopify/daily and woocommerce-intelligence
    const days: Record<string, number> = { LAST_7_DAYS: 7, LAST_14_DAYS: 14, LAST_30_DAYS: 30, THIS_MONTH: new Date().getDate(), LAST_MONTH: 60 }
    d.setDate(d.getDate() - (days[dateRange] || 30))
    return d.toISOString().split('T')[0]
  })()

  // Shopify GraphQL date filter syntax for the orders `query` arg.
  const queryString = `created_at:>=${startDate}T00:00:00Z AND created_at:<=${endDate}T23:59:59Z`

  const gqlQuery = `
    query OrdersInRange($query: String!) {
      orders(first: 250, query: $query) {
        edges {
          node {
            id
            totalPriceSet { shopMoney { amount } }
            displayFinancialStatus
            customer { id numberOfOrders }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  product { id }
                  originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      }
    }
  `

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: gqlQuery, variables: { query: queryString } }),
    })

    const json = await res.json()

    if (json.errors) {
      console.error('Shopify GraphQL errors:', JSON.stringify(json.errors))
      throw new Error('GraphQL query returned errors')
    }

    const orderNodes: GraphQLOrderNode[] = (json.data?.orders?.edges || []).map((e: any) => e.node)

    // Totals
    const totalRevenue = orderNodes.reduce(
      (s, o) => s + parseFloat(o.totalPriceSet?.shopMoney?.amount || '0'),
      0
    )
    const totalOrders = orderNodes.length
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // Customer segmentation
    // GraphQL: customer.numberOfOrders is the lifetime order count for that customer.
    // numberOfOrders === 1 means this is their first order = new customer.
    const newCustomers = orderNodes.filter((o) => o.customer?.numberOfOrders === 1).length
    const returningCustomers = totalOrders - newCustomers

    // Top products (aggregate line items across all orders)
    const productSales: Record<string, { name: string; revenue: number; units: number }> = {}
    for (const order of orderNodes) {
      for (const lineEdge of order.lineItems?.edges || []) {
        const item = lineEdge.node
        const productId = item.product?.id || `notitle:${item.title}`
        const id = String(productId)
        if (!productSales[id]) productSales[id] = { name: item.title, revenue: 0, units: 0 }
        const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || '0')
        productSales[id].revenue += unitPrice * item.quantity
        productSales[id].units += item.quantity
      }
    }

    const topProducts = Object.entries(productSales)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(([id, data]) => ({ id, ...data }))

    return {
      connected: true,
      totalOrders,
      totalRevenue,
      avgOrderValue,
      newCustomers,
      returningCustomers,
      topProducts,
    }
  } catch (e) {
    console.error('Shopify intelligence error:', e)
    // Return connected:true with zeros rather than connected:false
    // so the UI shows empty data rather than an error state
    return {
      connected: true,
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      newCustomers: 0,
      returningCustomers: 0,
      topProducts: [],
    }
  }
}
