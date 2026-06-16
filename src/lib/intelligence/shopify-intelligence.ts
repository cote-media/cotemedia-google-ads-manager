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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// LORAMER_SHOPIFY_DIM_BACKFILL_V1 — POST a GraphQL op with Shopify cost-throttle handling.
// On a THROTTLED error, wait the computed restore time and retry. If a throttleDeadline is given
// (backfill route budget) and the wait would blow it, throw a budget error so the caller can stop +
// persist its cursor and resume later (NOT treated as empty data).
export async function shopifyGraphQL(
  endpoint: string,
  headers: Record<string, string>,
  query: string,
  variables: Record<string, unknown>,
  throttleDeadline?: number
): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query, variables }) })
    const json = await res.json()
    const throttled = Array.isArray(json.errors) && json.errors.some((e: any) => e?.extensions?.code === 'THROTTLED')
    if (!throttled) return json
    const ts = json.extensions?.cost?.throttleStatus
    const requested = Number(json.extensions?.cost?.requestedQueryCost || 0)
    const available = Number(ts?.currentlyAvailable || 0)
    const restoreRate = Number(ts?.restoreRate || 50)
    const waitMs = Math.max(500, Math.ceil(Math.max(0, requested - available) / restoreRate) * 1000)
    if (throttleDeadline && Date.now() + waitMs > throttleDeadline) {
      const err: any = new Error('THROTTLE_BUDGET — throttle wait would exceed the run budget')
      err.throttleBudget = true
      throw err
    }
    console.warn(`[shopify] THROTTLED — waiting ${waitMs}ms (avail=${available} restore=${restoreRate}/s) attempt=${attempt + 1}`)
    await sleep(waitMs)
  }
  throw new Error('Shopify GraphQL still throttled after retries')
}

// LORAMER_CUSTOMER_MIX_FIX_V1 — map each customer id → their TRUE first-order date via
// Customer.orders(first:1, sortKey:CREATED_AT) (the reliable first-order anchor; customer.createdAt
// can predate the first order). Bulk via nodes(ids:) in chunks of 250. Ids that error or have no
// order are left absent (→ classified UNKNOWN, never silently bucketed). Cheap (Gate A: cost ~4).
async function fetchFirstOrderDates(
  endpoint: string,
  headers: Record<string, string>,
  customerIds: string[],
  throttleDeadline?: number
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  const query = `query($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Customer { id orders(first: 1, sortKey: CREATED_AT) { edges { node { createdAt } } } } }
  }`
  for (let i = 0; i < customerIds.length; i += 250) {
    const chunk = customerIds.slice(i, i + 250)
    const json = await shopifyGraphQL(endpoint, headers, query, { ids: chunk }, throttleDeadline)
    if (json.errors) {
      console.warn('[shopify] first-order lookup errors (those customers → UNKNOWN):', JSON.stringify(json.errors).slice(0, 200))
      continue
    }
    for (const n of json.data?.nodes || []) {
      if (n?.id) map.set(n.id, n.orders?.edges?.[0]?.node?.createdAt || null)
    }
  }
  return map
}

// LORAMER_SHOPIFY_NET_SALES_V1
type GraphQLOrderNode = {
  id: string
  cancelledAt: string | null // LORAMER_SHOPIFY_DEPTH_2A_V1
  currentSubtotalPriceSet: { shopMoney: { amount: string; currencyCode?: string } }
  totalRefundedSet: { shopMoney: { amount: string } }
  displayFinancialStatus: string | null
  customer: { id: string } | null // LORAMER_CUSTOMER_MIX_FIX_V1 — numberOfOrders dropped (string scalar + lifetime-only; classify by first-order date instead)
  shippingAddress: { countryCodeV2: string | null; provinceCode: string | null } | null // LORAMER_SHOPIFY_DEPTH_2A_V1
  lineItems: {
    edges: Array<{
      node: {
        title: string
        quantity: number
        product: { id: string } | null
        originalUnitPriceSet: { shopMoney: { amount: string } }
        discountedTotalSet: { shopMoney: { amount: string } } // LORAMER_SHOPIFY_DEPTH_2A_V1 — line net (after discounts)
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
  customEnd?: string,
  opts?: { throttleDeadline?: number } // LORAMER_SHOPIFY_DIM_BACKFILL_V1 — backfill budget for throttle waits
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

  // LORAMER_SHOPIFY_DIM_BACKFILL_V1 — cursor pagination: accumulate ALL pages, not just the first 250.
  // (abandonedCheckouts(first:250) is still single-page — count-only, understates on huge days; paginate later.)
  const gqlQuery = `
    query OrdersInRange($query: String!, $after: String) {
      orders(first: 250, after: $after, query: $query) {
        edges {
          node {
            id
            cancelledAt
            currentSubtotalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount } }
            displayFinancialStatus
            customer { id }
            shippingAddress { countryCodeV2 provinceCode }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  product { id }
                  originalUnitPriceSet { shopMoney { amount } }
                  discountedTotalSet { shopMoney { amount } }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `

  try {
    const orderNodes: GraphQLOrderNode[] = []
    let after: string | null = null
    let pages = 0
    do {
      const json = await shopifyGraphQL(endpoint, headers, gqlQuery, { query: queryString, after }, opts?.throttleDeadline)
      if (json.errors) {
        console.error('Shopify GraphQL errors:', JSON.stringify(json.errors))
        throw new Error('GraphQL query returned errors')
      }
      const conn = json.data?.orders
      for (const e of conn?.edges || []) orderNodes.push(e.node)
      after = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null
      pages += 1
    } while (after && pages < 100) // safety cap (100 pages × 250 = 25k orders/window)

    // LORAMER_SHOPIFY_CANCELLED_ACCURACY_V1 (WS3 #6) — a CANCELLED order (cancelledAt != null) did not
    // result in a sale, so it contributes NOTHING to ANY metric at ANY grain. Base ALL account
    // aggregations on liveOrders (the depth grains already do). Refunds are a SEPARATE axis
    // (currentSubtotalPriceSet already nets them); a refunded-but-not-cancelled order stays a counted
    // order. (Test-order exclusion deferred — see CONTINUE_HERE WS3 #6.)
    const liveOrders = orderNodes.filter((o) => !o.cancelledAt)

    // LORAMER_SHOPIFY_NET_SALES_V1 — headline revenue = net sales (line-item subtotal after refunds, excludes shipping/tax)
    const totalRevenue = liveOrders.reduce(
      (s, o) => s + parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0'),
      0
    )
    const refundedAmount = liveOrders.reduce(
      (s, o) => s + parseFloat(o.totalRefundedSet?.shopMoney?.amount || '0'),
      0
    )
    const totalOrders = liveOrders.length
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // LORAMER_SHOPIFY_DEEPER_SIGNALS_V1 — refund signals
    const refundedOrderCount = liveOrders.filter(o => {
      const s = (o.displayFinancialStatus || '').toUpperCase()
      return s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED'
    }).length
    const refundRate = totalOrders > 0 ? (refundedOrderCount / totalOrders) * 100 : 0
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

    // LORAMER_CUSTOMER_MIX_FIX_V1 — classify new-vs-returning by the customer's TRUE FIRST-ORDER DATE.
    // (The old code used customer.numberOfOrders === 1, which was doubly wrong: numberOfOrders is a
    //  STRING scalar — "1" === 1 is false → ALWAYS 0 new / 100% returning — AND it's the current
    //  LIFETIME count, not window-aware. customer.createdAt is also unreliable: Gate A showed it can
    //  PREDATE the first order. So we use customer.orders(first:1, sortKey:CREATED_AT).)
    // new = the customer's first order ever falls within this window; returning = first order was
    // before the window start; unknown = no linked customer / first-order lookup failed.
    const windowStartMs = new Date(startDate + 'T00:00:00Z').getTime()
    const customerIds = Array.from(new Set(liveOrders.map((o) => o.customer?.id).filter(Boolean))) as string[]
    const firstOrderByCustomer = customerIds.length
      ? await fetchFirstOrderDates(endpoint, headers, customerIds, opts?.throttleDeadline)
      : new Map<string, string | null>()
    const bucketOf = (o: GraphQLOrderNode): 'new' | 'returning' | 'unknown' => {
      const id = o.customer?.id
      if (!id) return 'unknown'
      const fo = firstOrderByCustomer.get(id)
      if (!fo) return 'unknown'
      return new Date(fo).getTime() >= windowStartMs ? 'new' : 'returning'
    }
    let newCustomers = 0
    let returningCustomers = 0
    let unknownCustomers = 0
    for (const id of customerIds) {
      const fo = firstOrderByCustomer.get(id)
      if (!fo) unknownCustomers++
      else if (new Date(fo).getTime() >= windowStartMs) newCustomers++
      else returningCustomers++
    }
    unknownCustomers += liveOrders.filter((o) => !o.customer?.id).length // orders with no linked customer
    const knownCustomers = newCustomers + returningCustomers
    // Never fabricate a split when we can't determine anyone — the widget should say "unavailable".
    const customerMixUnavailable = knownCustomers === 0
    const returningRate = knownCustomers > 0 ? (returningCustomers / knownCustomers) * 100 : 0
    const newOrderAmounts = liveOrders.filter((o) => bucketOf(o) === 'new').map((o) => parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0'))
    const returningOrderAmounts = liveOrders.filter((o) => bucketOf(o) === 'returning').map((o) => parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0'))
    const newCustomerAov = newOrderAmounts.length > 0 ? sum(newOrderAmounts) / newOrderAmounts.length : 0
    const returningCustomerAov = returningOrderAmounts.length > 0 ? sum(returningOrderAmounts) / returningOrderAmounts.length : 0
    // Revenue concentration: what % of total revenue comes from the top 10% of orders by value
    const orderAmountsSorted = liveOrders
      .map(o => parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0'))
      .sort((a, b) => b - a)
    const top10Count = Math.max(1, Math.ceil(orderAmountsSorted.length * 0.1))
    const top10Revenue = sum(orderAmountsSorted.slice(0, top10Count))
    const revenueConcentration = totalRevenue > 0 ? (top10Revenue / totalRevenue) * 100 : 0

    // Top products (aggregate line items across all orders)
    // LORAMER_SHOPIFY_NET_SALES_V1 — gross product mix from originalUnitPriceSet, not net sales
    const productSales: Record<string, { name: string; revenue: number; units: number }> = {}
    for (const order of liveOrders) {
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

    // ─── LORAMER_SHOPIFY_DEPTH_2A_V1 — capture-only depth (NOT UI) ───
    // Cancelled orders EXCLUDED here too — `liveOrders` is now defined once above and the account
    // totals share it (LORAMER_SHOPIFY_CANCELLED_ACCURACY_V1), so account == Σ depth.
    // Currency rule: use shopMoney as-is; if a window spans MULTIPLE base currencies (rare — a store
    // changed currency), the net sums mix currencies — LOG LOUD and tag (currencyMixed), never silent.
    const currencies = new Set(liveOrders.map((o) => o.currentSubtotalPriceSet?.shopMoney?.currencyCode).filter(Boolean))
    const currencyCode = currencies.size ? (Array.from(currencies)[0] as string) : (orderNodes[0]?.currentSubtotalPriceSet?.shopMoney?.currencyCode || undefined)
    const currencyMixed = currencies.size > 1
    if (currencyMixed) {
      console.warn(`[shopify] MIXED CURRENCY for ${shopDomain} in ${startDate}..${endDate}: ${Array.from(currencies).join(',')} — geo/product net sums span currencies; tagged in extra`)
    }

    // Ship-to geo: net subtotal + order count per country / region. shopMoney only.
    const geoC: Record<string, { netRevenue: number; orders: number; refunded: number }> = {}
    const geoR: Record<string, { netRevenue: number; orders: number }> = {}
    let unknownGeoOrders = 0
    for (const o of liveOrders) {
      const net = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0')
      const refunded = parseFloat(o.totalRefundedSet?.shopMoney?.amount || '0')
      const country = o.shippingAddress?.countryCodeV2 || 'UNKNOWN'
      if (country === 'UNKNOWN') unknownGeoOrders += 1
      if (!geoC[country]) geoC[country] = { netRevenue: 0, orders: 0, refunded: 0 }
      geoC[country].netRevenue += net
      geoC[country].orders += 1
      geoC[country].refunded += refunded
      const region = `${country}-${o.shippingAddress?.provinceCode || 'UNKNOWN'}`
      if (!geoR[region]) geoR[region] = { netRevenue: 0, orders: 0 }
      geoR[region].netRevenue += net
      geoR[region].orders += 1
    }
    const geoCountries = Object.entries(geoC).map(([country, v]) => ({ country, ...v }))
    const geoRegions = Object.entries(geoR).map(([region, v]) => ({ region, ...v }))

    // Full product mix with NET revenue (line discountedTotalSet, after discounts) + gross.
    const prodCap: Record<string, { name: string; netRevenue: number; grossRevenue: number; units: number }> = {}
    for (const order of liveOrders) {
      for (const lineEdge of order.lineItems?.edges || []) {
        const item = lineEdge.node
        const id = String(item.product?.id || `notitle:${item.title}`)
        if (!prodCap[id]) prodCap[id] = { name: item.title, netRevenue: 0, grossRevenue: 0, units: 0 }
        prodCap[id].netRevenue += parseFloat(item.discountedTotalSet?.shopMoney?.amount || '0')
        prodCap[id].grossRevenue += parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || '0') * item.quantity
        prodCap[id].units += item.quantity
      }
    }
    const productsCapture = Object.entries(prodCap).map(([id, v]) => ({ id, ...v }))

    // LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 — separate fail-soft fetch.
    // Reuses the same date queryString as the orders query so the count is
    // scoped to the same window.
    const abandonedCheckoutCount = await fetchAbandonedCheckoutCount(endpoint, headers, queryString)

    return {
      connected: true,
      totalOrders,
      totalRevenue,
      refundedAmount,
      avgOrderValue,
      newCustomers,
      returningCustomers,
      // LORAMER_CUSTOMER_MIX_FIX_V1
      unknownCustomers,
      customerMixUnavailable,
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
      // LORAMER_SHOPIFY_DEPTH_2A_V1 — capture-only depth
      productsCapture,
      geoCountries,
      geoRegions,
      currencyCode,
      currencyMixed,
      unknownGeoOrders,
    }
  } catch (e: any) {
    // LORAMER_SHOPIFY_DIM_BACKFILL_V1 — let a throttle-budget signal propagate so the backfill can
    // stop + persist its cursor (NOT collapse to empty data).
    if (e?.throttleBudget) throw e
    console.error('Shopify intelligence error:', e)
    // Return connected:true with zeros rather than connected:false
    // so the UI shows empty data rather than an error state
    return {
      connected: true,
      totalOrders: 0,
      totalRevenue: 0,
      refundedAmount: 0,
      avgOrderValue: 0,
      newCustomers: 0,
      returningCustomers: 0,
      // LORAMER_CUSTOMER_MIX_FIX_V1 — fetch failed → mix is unavailable, NOT a fabricated split
      unknownCustomers: 0,
      customerMixUnavailable: true,
      // LORAMER_SHOPIFY_DEEPER_SIGNALS_V1
      refundedOrderCount: 0,
      refundRate: 0,
      returningRate: 0,
      newCustomerAov: 0,
      returningCustomerAov: 0,
      revenueConcentration: 0,
      topProducts: [],
      // LORAMER_SHOPIFY_DEPTH_2A_V1
      productsCapture: [],
      geoCountries: [],
      geoRegions: [],
      unknownGeoOrders: 0,
    }
  }
}
