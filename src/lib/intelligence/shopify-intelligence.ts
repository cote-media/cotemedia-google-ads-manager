// ─── Shopify Intelligence Adapter ─────────────────────────────────────────────
// LORAMER_GRAPHQL_MIGRATION_V1
// Migrated from REST (/admin/api/2024-01/orders.json) to GraphQL Admin API
// per Shopify App Store requirement 2.2.4.
//
// Output shape conforms to IntelligenceShopify schema — unchanged from REST version.
// One GraphQL query replaces what was two REST calls.

import { resolveDateWindow } from '@/lib/date-range'
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

// LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1
// Separate query with its own try/catch. Returns undefined on any failure
// (permission denied / network / GraphQL error) so the rest of the Shopify
// intelligence fetch keeps working. Fetches ONLY the id field — no customer
// data, no email, no addresses, no line items. PII never enters the
// intelligence layer.
async function fetchAbandonedCheckoutCount(
  endpoint: string,
  headers: Record<string, string>,
  queryString: string,
): Promise<number | undefined> {
  const gql = `
    query AbandonedInRange($query: String!) {
      abandonedCheckouts(first: 250, query: $query) {
        edges { node { id } }
      }
    }
  `
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: gql, variables: { query: queryString } }),
    })
    const json = await res.json()
    if (json.errors) {
      console.warn('[abandonedCheckouts] GraphQL error (likely missing manage_abandoned_checkouts permission):',
        JSON.stringify(json.errors).slice(0, 200))
      return undefined
    }
    const nodes = json.data?.abandonedCheckouts?.edges || []
    return nodes.length
  } catch (e) {
    console.warn('[abandonedCheckouts] fetch failed:', e)
    return undefined
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

  // LORAMER_DATE_RANGE_CANONICAL_V1
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)

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

    // LORAMER_SHOPIFY_DEEPER_SIGNALS_V1 — derived metrics from existing query response
    // Refund rate: any order where displayFinancialStatus indicates a refund.
    const refundedOrderCount = orderNodes.filter(o => {
      const s = (o.displayFinancialStatus || '').toUpperCase()
      return s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED'
    }).length
    const refundRate = totalOrders > 0 ? (refundedOrderCount / totalOrders) * 100 : 0
    // Returning rate (% of orders from returning customers in this window)
    const returningRate = totalOrders > 0 ? (returningCustomers / totalOrders) * 100 : 0
    // New vs returning AOV split
    const newOrderAmounts = orderNodes
      .filter(o => o.customer?.numberOfOrders === 1)
      .map(o => parseFloat(o.totalPriceSet?.shopMoney?.amount || '0'))
    const returningOrderAmounts = orderNodes
      .filter(o => o.customer && o.customer.numberOfOrders > 1)
      .map(o => parseFloat(o.totalPriceSet?.shopMoney?.amount || '0'))
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
    const newCustomerAov = newOrderAmounts.length > 0 ? sum(newOrderAmounts) / newOrderAmounts.length : 0
    const returningCustomerAov = returningOrderAmounts.length > 0 ? sum(returningOrderAmounts) / returningOrderAmounts.length : 0
    // Revenue concentration: what % of total revenue comes from the top 10% of orders by value
    const orderAmountsSorted = orderNodes
      .map(o => parseFloat(o.totalPriceSet?.shopMoney?.amount || '0'))
      .sort((a, b) => b - a)
    const top10Count = Math.max(1, Math.ceil(orderAmountsSorted.length * 0.1))
    const top10Revenue = sum(orderAmountsSorted.slice(0, top10Count))
    const revenueConcentration = totalRevenue > 0 ? (top10Revenue / totalRevenue) * 100 : 0

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

    // LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 — separate fail-soft fetch.
    // Reuses the same date queryString as the orders query so the count is
    // scoped to the same window.
    const abandonedCheckoutCount = await fetchAbandonedCheckoutCount(endpoint, headers, queryString)

    return {
      connected: true,
      totalOrders,
      totalRevenue,
      avgOrderValue,
      newCustomers,
      returningCustomers,
      // LORAMER_SHOPIFY_DEEPER_SIGNALS_V1
      refundedOrderCount,
      refundRate,
      returningRate,
      newCustomerAov,
      returningCustomerAov,
      revenueConcentration,
      // LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 — undefined when permission/perm or network failed
      abandonedCheckoutCount,
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
      // LORAMER_SHOPIFY_DEEPER_SIGNALS_V1
      refundedOrderCount: 0,
      refundRate: 0,
      returningRate: 0,
      newCustomerAov: 0,
      returningCustomerAov: 0,
      revenueConcentration: 0,
      topProducts: [],
    }
  }
}
