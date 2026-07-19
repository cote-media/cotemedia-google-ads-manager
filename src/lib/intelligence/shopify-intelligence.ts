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

// LORAMER_SHOPIFY_BATCH_C_V1 — non-PII customer facts. Counts and money ONLY.
type CustomerFacts = { firstOrderAt: string | null; lifetimeOrders: number | null; lifetimeSpent: number | null }

// LORAMER_CUSTOMER_MIX_FIX_V1 — map each customer id → their TRUE first-order date via
// Customer.orders(first:1, sortKey:CREATED_AT) (the reliable first-order anchor; customer.createdAt
// can predate the first order). Bulk via nodes(ids:) in chunks of 250. Ids that error or have no
// order are left absent (→ classified UNKNOWN, never silently bucketed). Cheap (Gate A: cost ~4).
async function fetchFirstOrderDates(
  endpoint: string,
  headers: Record<string, string>,
  customerIds: string[],
  throttleDeadline?: number
): Promise<Map<string, CustomerFacts>> {
  const map = new Map<string, CustomerFacts>()
  // LORAMER_SHOPIFY_BATCH_C_V1 — WIDENED, same single nodes(ids:) request: numberOfOrders (lifetime order
  // count, used ONLY to bucket a cohort) + amountSpent (lifetime money, carried as a LABELED attribute and
  // never summed). PII LOCK HELD: id + counts + money only — no email, name, phone or address enters the
  // intelligence layer, exactly as before.
  const query = `query($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Customer { id numberOfOrders amountSpent { amount } orders(first: 1, sortKey: CREATED_AT) { edges { node { createdAt } } } } }
  }`
  for (let i = 0; i < customerIds.length; i += 250) {
    const chunk = customerIds.slice(i, i + 250)
    const json = await shopifyGraphQL(endpoint, headers, query, { ids: chunk }, throttleDeadline)
    if (json.errors) {
      console.warn('[shopify] first-order lookup errors (those customers → UNKNOWN):', JSON.stringify(json.errors).slice(0, 200))
      continue
    }
    for (const n of json.data?.nodes || []) {
      if (!n?.id) continue
      // numberOfOrders is a STRING scalar on this API (the bug LORAMER_CUSTOMER_MIX_FIX_V1 was born from) —
      // parse it, never compare it directly.
      const cnt = Number.parseInt(String(n.numberOfOrders ?? ''), 10)
      map.set(n.id, {
        firstOrderAt: n.orders?.edges?.[0]?.node?.createdAt || null,
        lifetimeOrders: Number.isFinite(cnt) ? cnt : null,
        lifetimeSpent: n.amountSpent?.amount != null ? parseFloat(n.amountSpent.amount) : null,
      })
    }
  }
  return map
}

// LORAMER_SHOPIFY_BATCH_B_V1 — PRODUCT COLLECTIONS, fetched SEPARATELY and never on the orders query.
// Shape and failure posture are lifted from the Meta creative fix (LORAMER_META_CREATIVE_FAIL_PARTIAL_V1,
// 27470cd), for the same reason: a nested expansion that the vendor may refuse must never be able to abort
// the day's capture. Batched by explicit product id (25/batch — MEASURED requested 6 / actual 1, i.e. well
// under 1% of the 1,000-point ceiling), each batch INDEPENDENT, and on failure the batch is re-fetched one
// id at a time so the blast radius collapses to the product(s) Shopify genuinely cannot serve.
const COLLECTION_BATCH_SIZE = 25
async function fetchProductCollections(
  endpoint: string,
  headers: Record<string, string>,
  productIds: string[],
  throttleDeadline?: number
): Promise<{ byProductId: Record<string, string[]>; batchesTotal: number; batchesFailed: number; productsMissing: number }> {
  const byProductId: Record<string, string[]> = {}
  let batchesFailed = 0
  const query = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id collections(first: 5) { edges { node { title } } } } } }`
  const batches: string[][] = []
  for (let i = 0; i < productIds.length; i += COLLECTION_BATCH_SIZE) batches.push(productIds.slice(i, i + COLLECTION_BATCH_SIZE))

  const run = async (ids: string[]): Promise<void> => {
    const json = await shopifyGraphQL(endpoint, headers, query, { ids }, throttleDeadline)
    if (json.errors) throw new Error('Shopify GraphQL error: ' + JSON.stringify(json.errors).slice(0, 200))
    for (const n of json.data?.nodes || []) {
      if (!n?.id) continue
      byProductId[n.id] = (n.collections?.edges || []).map((e: any) => String(e?.node?.title || '').trim()).filter(Boolean)
    }
  }

  for (const batch of batches) {
    try {
      await run(batch)
    } catch (e: any) {
      if (e?.throttleBudget) throw e // budget signal must propagate so the backfill can persist its cursor
      batchesFailed += 1
      console.warn(`[shopify] collections batch (${batch.length} products) failed — splitting to isolate: ${String(e?.message ?? e).slice(0, 160)}`)
      for (const id of batch) {
        try { await run([id]) } catch { /* this product alone loses its collections */ }
      }
    }
  }
  const productsMissing = productIds.filter((id) => !byProductId[id]).length
  if (batchesFailed) console.warn(`[shopify] collections DEGRADED-NOT-DROPPED: ${batches.length - batchesFailed}/${batches.length} batches ok · ${productsMissing} product(s) without collections · order rows UNAFFECTED`)
  return { byProductId, batchesTotal: batches.length, batchesFailed, productsMissing }
}

// LORAMER_SHOPIFY_NET_SALES_V1
type GraphQLOrderNode = {
  id: string
  cancelledAt: string | null // LORAMER_SHOPIFY_DEPTH_2A_V1
  // LORAMER_SHOPIFY_ORDER_TIME_V1 (S-FILL#7) — the order's UTC placement timestamp, to the second, EXACTLY as
  // Shopify returns it. Captured RAW and never bucketed at write time: a later client-timezone model must be able
  // to re-bucket the whole history (shop-local hour, overnight windows) with ZERO recapture. The daily-row UTC day
  // boundary is deliberately NOT touched by this change.
  createdAt: string
  currentSubtotalPriceSet: { shopMoney: { amount: string; currencyCode?: string } }
  totalRefundedSet: { shopMoney: { amount: string } }
  // LORAMER_SHOPIFY_MONEY_SURFACE_V1 (T1.5) — full order money split (all non-null MoneyBag in 2025-01;
  // live-probed: all return on every order). currentSubtotal (net) + these decompose currentTotalPrice exactly.
  currentTotalPriceSet: { shopMoney: { amount: string } }
  currentTotalTaxSet: { shopMoney: { amount: string } }
  currentTotalDiscountsSet: { shopMoney: { amount: string } }
  currentShippingPriceSet: { shopMoney: { amount: string } }
  totalTipReceivedSet: { shopMoney: { amount: string } }
  displayFinancialStatus: string | null
  // LORAMER_SHOPIFY_BATCH_A3_V1 — fulfillment state. SNAPSHOT: like displayFinancialStatus above, this is the
  // status AS OF THE QUERY, not as of the order date. See the snapshot note on the writer.
  displayFulfillmentStatus: string | null
  // LORAMER_SHOPIFY_BATCH_A1_V1 (S-FILL#1) — the sales channel this order came through (online store, POS,
  // Meta, Google, draft). handle is the canonical value; channelName is the human label, kept in extra.
  channelInformation: { channelDefinition: { handle: string | null; channelName: string | null } | null } | null
  discountCodes: string[] | null // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3) — the code strings on the order ([String!]!; multiple allowed)
  customer: { id: string } | null // LORAMER_CUSTOMER_MIX_FIX_V1 — numberOfOrders dropped (string scalar + lifetime-only; classify by first-order date instead)
  shippingAddress: { countryCodeV2: string | null; provinceCode: string | null; city: string | null } | null // LORAMER_SHOPIFY_DEPTH_2A_V1 + city (LORAMER_SHOPIFY_BATCH_A1_V1)
  lineItems: {
    edges: Array<{
      node: {
        id: string // LORAMER_SHOPIFY_PRODUCT_REFUND_NET_V1 — match refundLineItems.lineItem.id
        title: string
        quantity: number
        // LORAMER_SHOPIFY_BATCH_A2_V1 — product ATTRIBUTES for the grouping families. Scalars + a string
        // list, so this stays a widen of the SAME node; collections is deliberately NOT here (a nested
        // connection inside paginated lineItems inside paginated orders is the payload shape that produced
        // Meta code 1/subcode 99 today — it gets its own batched call in a later flight).
        product: { id: string; productType?: string | null; vendor?: string | null; tags?: string[] | null } | null
        variant: { id: string; sku: string | null; title: string | null } | null // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant gid + sku + variant title (same node, one field-add)
        originalUnitPriceSet: { shopMoney: { amount: string } }
        discountedTotalSet: { shopMoney: { amount: string } } // LORAMER_SHOPIFY_DEPTH_2A_V1 — line net (after discounts)
        // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3) — per-allocation applied money + which application (code) it came
        // from. THIS is the exact per-code discounted amount; top-level discountApplications.value is the SPEC (a % or a
        // gross figure), NOT the applied money — wrong for percentage codes.
        discountAllocations: Array<{
          allocatedAmountSet: { shopMoney: { amount: string } }
          discountApplication: { __typename: string; code?: string | null; title?: string | null } // title = the non-code label (LORAMER_SHOPIFY_BATCH_A1_V1)
        }>
      }
    }>
  }
  // LORAMER_SHOPIFY_PRODUCT_REFUND_NET_V1 — per-line refunded SUBTOTAL (the same axis currentSubtotalPriceSet nets)
  refunds: Array<{
    refundLineItems: {
      edges: Array<{
        node: {
          lineItem: { id: string } | null
          subtotalSet: { shopMoney: { amount: string } }
        }
      }>
    }
  }>
}

// LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1
// Separate query with its own try/catch. Returns undefined on any failure
// (permission denied / network / GraphQL error) so the rest of the Shopify
// intelligence fetch keeps working. PII-LOCKED: fetches ONLY id + money
// (totalPriceSet) + createdAt — no customer, email, address, or line-item
// contents. PII never enters the intelligence layer.
// LORAMER_SHOPIFY_ABANDONED_VALUE_V1 (S-FILL#2) — FIELD-WIDEN of the count query (SAME single
// call, no new request) to also sum abandoned-checkout VALUE = Σ totalPriceSet. That value is
// POTENTIAL/LOST revenue, NEVER actual revenue — the caller persists it write-only and it is
// never summed into net sales. Single-page (first:250) exactly like the count it extends: it
// understates on huge days the same way the count already does (a known limit, not a regression).
async function fetchAbandonedCheckoutSummary(
  endpoint: string,
  headers: Record<string, string>,
  queryString: string,
): Promise<{ count: number; value: number } | undefined> {
  const gql = `
    query AbandonedInRange($query: String!) {
      abandonedCheckouts(first: 250, query: $query) {
        edges { node { id totalPriceSet { shopMoney { amount } } createdAt } }
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
      console.warn('[abandonedCheckouts] GraphQL error (likely missing read_orders / abandoned-checkout permission):',
        JSON.stringify(json.errors).slice(0, 200))
      return undefined
    }
    const nodes = json.data?.abandonedCheckouts?.edges || []
    let value = 0
    for (const e of nodes) {
      const amt = parseFloat(e?.node?.totalPriceSet?.shopMoney?.amount || '0')
      if (Number.isFinite(amt)) value += amt
    }
    return { count: nodes.length, value: Math.round(value * 100) / 100 }
  } catch (e) {
    console.warn('[abandonedCheckouts] fetch failed:', e)
    return undefined
  }
}

// LORAMER_SHOPIFY_MONEY_SURFACE_V1 (T1.5) — Shopify full-order money split beyond NET, per-day ACCOUNT grain,
// from the widened OrdersInRange fields (no extra call). Basis: net = currentSubtotal (EXCLUDES shipping/tax,
// after refunds); the additive parts decompose currentTotalPrice. Fields cited from the Shopify 2025-01 Order
// schema (all non-null MoneyBag; live-probed dreamboard1: all 6 return, residual $0.00). NULL-vs-ZERO (false
// zeros worse than absence): each component sums ONLY from present amounts — a present "0.00" is a TRUE zero; if
// ANY live order is missing a component, that component is null (+loud warn), never a false partial-zero.
// Additive-only: netSales == the existing account revenue (Σ currentSubtotalPriceSet), byte-identical.
export function buildShopifyMoneySurface(liveOrders: GraphQLOrderNode[]): NonNullable<IntelligenceShopify['money']> {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const amt = (set: { shopMoney?: { amount?: string } } | undefined): number | undefined => {
    const a = set?.shopMoney?.amount
    return a === undefined || a === null ? undefined : parseFloat(a)
  }
  const lineGross = (o: GraphQLOrderNode) =>
    (o.lineItems?.edges || []).reduce((s, e) => s + parseFloat(e.node.originalUnitPriceSet?.shopMoney?.amount || '0') * e.node.quantity, 0)
  const sumC = (pick: (o: GraphQLOrderNode) => number | undefined, label: string): number | null => {
    let s = 0
    let absent = false
    for (const o of liveOrders) {
      const v = pick(o)
      if (v === undefined || Number.isNaN(v)) { absent = true; console.warn(`[shopify-money] ABSENT/NaN ${label} on order ${o?.id}`); continue }
      s += v
    }
    return absent ? null : r2(s)
  }
  const netSales = sumC((o) => amt(o.currentSubtotalPriceSet), 'currentSubtotal')
  const grossSales = sumC((o) => lineGross(o), 'lineGross')
  const discounts = sumC((o) => amt(o.currentTotalDiscountsSet), 'currentTotalDiscounts')
  const taxes = sumC((o) => amt(o.currentTotalTaxSet), 'currentTotalTax')
  const shipping = sumC((o) => amt(o.currentShippingPriceSet), 'currentShipping')
  const tips = sumC((o) => amt(o.totalTipReceivedSet), 'totalTipReceived')
  const totalSales = sumC((o) => amt(o.currentTotalPriceSet), 'currentTotalPrice')
  const refunds = sumC((o) => amt(o.totalRefundedSet), 'totalRefunded')
  // residual = totalSales − [net + tax + ship + tip]; null if any input null (on real data this is $0.00 — Shopify
  // net already nets discounts + returns, so the parts decompose the current total exactly).
  const inputs = [totalSales, netSales, taxes, shipping, tips]
  const residual = inputs.some((p) => p === null)
    ? null
    : r2((totalSales as number) - ((netSales as number) + (taxes as number) + (shipping as number) + (tips as number)))
  return { netSales, grossSales, discounts, taxes, shipping, tips, totalSales, refunds, residual, moneyBasis: 'shopify_current_refundAdjusted' }
}

export async function fetchShopifyIntelligence(
  accessToken: string,
  shopDomain: string,   // e.g. "my-store.myshopify.com"
  dateRange: string,
  customStart?: string,
  customEnd?: string,
  opts?: {
    throttleDeadline?: number // LORAMER_SHOPIFY_DIM_BACKFILL_V1 — backfill budget for throttle waits
    // LORAMER_SHOPIFY_SWALLOW_FIX_V1 — WRITERS pass true → a real fetch/GraphQL error RE-THROWS (caller halts +
    // persists its cursor, like Woo) instead of collapsing to an empty/zero day. Default (undefined/false) keeps
    // the swallow-to-empty for the reviewer path (/api/intelligence) → reviewer render byte-identical.
    throwOnError?: boolean
  }
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
  // ⛔ DO NOT ADD product.collections (OR ANY NESTED CONNECTION) TO THIS QUERY — LORAMER_SHOPIFY_BATCH_B_V1.
  // MEASURED 2026-07-19 against the live API: this query as it stands costs 651 of the 1,000-point single-query
  // ceiling (actual 134). Adding product { collections(first: 5) { … } } takes it to 1,036 and Shopify REJECTS it
  // BEFORE EXECUTION with MAX_COST_EXCEEDED — "Query cost is 1036, which exceeds the single query max cost limit
  // (1000)". Not a throttle, not a degradation: a hard refusal on every store, every time. Because this ONE call
  // also produces base/product/variant/geo/sales_channel/discount/order_time/status/cohort rows, that field would
  // take the ENTIRE Shopify capture down for every client.
  // WHY SCALARS ARE FINE AND CONNECTIONS ARE NOT: scalar fields cost 0 points; a connection costs 2 + 1 per item
  // AND MULTIPLIES through nesting (first × (1 + nested)). Today's widens (productType, vendor, tags, city,
  // channelInformation, displayFulfillmentStatus, createdAt) were free for exactly that reason.
  // ~349 points of headroom remain. Anything nested goes in its OWN batched call — see fetchProductCollections.
  const gqlQuery = `
    query OrdersInRange($query: String!, $after: String) {
      orders(first: 250, after: $after, query: $query) {
        edges {
          node {
            id
            cancelledAt
            createdAt
            currentSubtotalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount } }
            currentTotalPriceSet { shopMoney { amount } }
            currentTotalTaxSet { shopMoney { amount } }
            currentTotalDiscountsSet { shopMoney { amount } }
            currentShippingPriceSet { shopMoney { amount } }
            totalTipReceivedSet { shopMoney { amount } }
            displayFinancialStatus
            displayFulfillmentStatus
            channelInformation { channelDefinition { handle channelName } }
            discountCodes
            customer { id }
            shippingAddress { countryCodeV2 provinceCode city }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  product { id productType vendor tags }
                  variant { id sku title }
                  originalUnitPriceSet { shopMoney { amount } }
                  discountedTotalSet { shopMoney { amount } }
                  discountAllocations { allocatedAmountSet { shopMoney { amount } } discountApplication { __typename ... on DiscountCodeApplication { code } ... on ManualDiscountApplication { title } ... on AutomaticDiscountApplication { title } ... on ScriptDiscountApplication { title } } }
                }
              }
            }
            refunds {
              refundLineItems(first: 50) {
                edges {
                  node {
                    lineItem { id }
                    subtotalSet { shopMoney { amount } }
                  }
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
      : new Map<string, CustomerFacts>()
    const bucketOf = (o: GraphQLOrderNode): 'new' | 'returning' | 'unknown' => {
      const id = o.customer?.id
      if (!id) return 'unknown'
      const fo = firstOrderByCustomer.get(id)?.firstOrderAt
      if (!fo) return 'unknown'
      return new Date(fo).getTime() >= windowStartMs ? 'new' : 'returning'
    }
    let newCustomers = 0
    let returningCustomers = 0
    let unknownCustomers = 0
    for (const id of customerIds) {
      // LORAMER_SHOPIFY_BATCH_C_V1 — the map now holds CustomerFacts, not a bare date string. Read
      // .firstOrderAt; the new-vs-returning classification is otherwise BYTE-IDENTICAL to before.
      const fo = firstOrderByCustomer.get(id)?.firstOrderAt
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

    // ── LORAMER_SHOPIFY_BATCH_A1_V1 ────────────────────────────────────────────────────────────────────
    // Three families off the SAME widened OrdersInRange response. No second request, no new fetch path.
    //
    // geo_city — the third rung of the geo ladder, same composite convention as geo_region
    // ('<country>-<province>' → '<country>-<province>-<city>') so the family reads as one hierarchy.
    // PARTITIONS the day's net exactly like country/region: one shipping address per order. Missing city
    // buckets as UNKNOWN, never dropped (same rule the country/region loops already follow).
    //
    // sales_channel — PARTITIONS: an order arrives through exactly one channel, so Σ channel ≡ account net.
    // Canonical value = channelDefinition.handle (stable, machine-readable); channelName is the human label
    // and rides extra. Orders with no channelInformation bucket as UNKNOWN rather than vanishing — a
    // missing channel is a fact about the order, not a reason to lose its revenue from the partition.
    //
    // discount_type — the TYPE axis of discounting, the sibling of discount_code's per-code axis. Captures
    // ALL application subtypes including code (so the axis is complete and self-describing), keyed by the
    // GraphQL __typename mapped to a short label. WRITE-ONLY and NON-ADDITIVE for exactly the reasons
    // already banked on discount_code: allocations overlap, they are a SUBSET of total discounting, and a
    // single allocation can exceed an order's current discount total. NEVER summed into net sales.
    const geoCity: Record<string, { netRevenue: number; orders: number }> = {}
    const chan: Record<string, { netRevenue: number; orders: number; channelName: string | null }> = {}
    const discT: Record<string, { discountedAmount: number; orders: number; label: string | null }> = {}
    const TYPE_LABEL: Record<string, string> = {
      DiscountCodeApplication: 'code',
      ManualDiscountApplication: 'manual',
      AutomaticDiscountApplication: 'automatic',
      ScriptDiscountApplication: 'script',
    }
    for (const o of liveOrders) {
      const net = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || "0") // SAME basis as the country/region loop above
      const country = o.shippingAddress?.countryCodeV2 || 'UNKNOWN'
      const province = o.shippingAddress?.provinceCode || 'UNKNOWN'
      const cityKey = `${country}-${province}-${o.shippingAddress?.city || 'UNKNOWN'}`
      if (!geoCity[cityKey]) geoCity[cityKey] = { netRevenue: 0, orders: 0 }
      geoCity[cityKey].netRevenue += net
      geoCity[cityKey].orders += 1

      const def = o.channelInformation?.channelDefinition
      const handle = def?.handle || 'UNKNOWN'
      if (!chan[handle]) chan[handle] = { netRevenue: 0, orders: 0, channelName: def?.channelName ?? null }
      chan[handle].netRevenue += net
      chan[handle].orders += 1

      const seenTypesOnOrder = new Set<string>()
      for (const le of o.lineItems?.edges || []) {
        for (const a of le.node.discountAllocations || []) {
          const tn = a.discountApplication?.__typename
          if (!tn) continue
          const key = TYPE_LABEL[tn] || tn
          if (!discT[key]) discT[key] = { discountedAmount: 0, orders: 0, label: a.discountApplication?.title ?? null }
          discT[key].discountedAmount += parseFloat(a.allocatedAmountSet?.shopMoney?.amount || '0')
          if (!discT[key].label && a.discountApplication?.title) discT[key].label = a.discountApplication.title
          seenTypesOnOrder.add(key) // orders counted ONCE per type per order, not once per allocation
        }
      }
      for (const k of seenTypesOnOrder) discT[k].orders += 1
    }
    // ── LORAMER_SHOPIFY_BATCH_A3_V1 — ORDER STATUS, A CAPTURE-TIME SNAPSHOT ───────────────────────────
    // These two PARTITION the day's net at query time (an order has exactly one financial and one
    // fulfillment status), so Σ status ≡ account net and they reconcile FLAG-NOT-BLOCK like geo.
    //
    // BUT THE SEMANTICS ARE DIFFERENT FROM EVERY OTHER FAMILY WE CAPTURE, and that difference is the
    // whole point of this flight: STATUS IS MUTABLE. A pending order becomes paid; an unfulfilled order
    // ships. So a row records the status AS OF THE MOMENT WE ASKED, not as of the order date, and a
    // re-walk of the SAME day will legitimately produce DIFFERENT values. The upsert stays idempotent —
    // the same key is overwritten — but the MEANING is a snapshot, not a historical fact.
    // TWO CONSEQUENCES a reader must know, or they will draw a false conclusion:
    //   1. Backfilled history is systematically MORE SETTLED than recent days: old orders have long since
    //      resolved to PAID/FULFILLED, while the last week still holds PENDING/UNFULFILLED. A chart of
    //      "% paid over time" therefore slopes upward toward the past — that is an artifact of WHEN we
    //      captured, not a trend in the business.
    //   2. Comparing a status distribution across periods compares two different observation ages.
    // The caveat is carried to Lora at query time in metrics-query.ts (the hour-0 note pattern), not just
    // in this comment — a comment nobody reads is exactly how a snapshot becomes a "trend".
    const finStat: Record<string, { netRevenue: number; orders: number }> = {}
    const fulStat: Record<string, { netRevenue: number; orders: number }> = {}
    for (const o of liveOrders) {
      const net = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0')
      const f = (o.displayFinancialStatus || '').trim().toUpperCase() || 'UNKNOWN'
      if (!finStat[f]) finStat[f] = { netRevenue: 0, orders: 0 }
      finStat[f].netRevenue += net; finStat[f].orders += 1
      const u = (o.displayFulfillmentStatus || '').trim().toUpperCase() || 'UNKNOWN'
      if (!fulStat[u]) fulStat[u] = { netRevenue: 0, orders: 0 }
      fulStat[u].netRevenue += net; fulStat[u].orders += 1
    }
    const financialStatusCapture = Object.entries(finStat).map(([status, v]) => ({ status, netRevenue: Math.round(v.netRevenue * 100) / 100, orders: v.orders }))
    const fulfillmentStatusCapture = Object.entries(fulStat).map(([status, v]) => ({ status, netRevenue: Math.round(v.netRevenue * 100) / 100, orders: v.orders }))

    // ── LORAMER_SHOPIFY_BATCH_C_V1 — CUSTOMER COHORT + LIFETIME VALUE ────────────────────────────────
    // Rides the customer call that ALREADY runs for the new-vs-returning mix — two extra scalars on the
    // same nodes(ids:) request, no new round trip.
    //
    // customer_cohort PARTITIONS the day's net: every order maps to exactly ONE bucket via its customer's
    // lifetime order count, so Σ cohort ≡ account net. Orders with no linked customer (guest checkout,
    // deleted customer, failed lookup) bucket UNKNOWN and STAY IN THE PARTITION — dropping them would
    // silently shrink a total that is supposed to reconcile, the same rule sales_channel follows.
    //
    // LTV IS DELIBERATELY NOT A ROW OF ITS OWN. amountSpent is a LIFETIME figure: a customer who orders on
    // ten days would have their whole lifetime value counted on all ten. Summing it per day is meaningless
    // and actively misleading — the same trap that made numberOfOrders unusable for the new-vs-returning
    // classification (see LORAMER_CUSTOMER_MIX_FIX_V1 above). So it rides in extra as a LABELED lifetime
    // attribute: the average lifetime spend of the customers who ordered that day, plus the cohort's
    // customer count, and it is never placed in a summable column.
    //
    // PII LOCK: buckets and aggregates only. No per-customer rows are emitted — that would be both a
    // cardinality explosion and a PII-adjacency we deliberately avoid. No email, name, phone or address is
    // ever read.
    const COHORT_OF = (n: number | null): string => {
      if (n == null || !Number.isFinite(n) || n <= 0) return 'UNKNOWN'
      if (n === 1) return '1'
      if (n <= 3) return '2-3'
      if (n <= 9) return '4-9'
      return '10+'
    }
    const cohort: Record<string, { netRevenue: number; orders: number; customers: Set<string>; ltvSum: number; ltvCount: number }> = {}
    for (const o of liveOrders) {
      const net = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0')
      const cid = o.customer?.id || null
      const facts = cid ? firstOrderByCustomer.get(cid) : undefined
      const key = cid ? COHORT_OF(facts?.lifetimeOrders ?? null) : 'UNKNOWN'
      if (!cohort[key]) cohort[key] = { netRevenue: 0, orders: 0, customers: new Set(), ltvSum: 0, ltvCount: 0 }
      const c = cohort[key]
      c.netRevenue += net
      c.orders += 1
      if (cid && !c.customers.has(cid)) {
        c.customers.add(cid)
        if (facts?.lifetimeSpent != null && Number.isFinite(facts.lifetimeSpent)) { c.ltvSum += facts.lifetimeSpent; c.ltvCount += 1 }
      }
    }
    const customerCohortCapture = Object.entries(cohort).map(([bucket, v]) => ({
      bucket,
      netRevenue: Math.round(v.netRevenue * 100) / 100,
      orders: v.orders,
      customers: v.customers.size,
      avgLifetimeSpent: v.ltvCount > 0 ? Math.round((v.ltvSum / v.ltvCount) * 100) / 100 : null,
    }))

    const geoCities = Object.entries(geoCity).map(([city, v]) => ({ city, ...v }))
    const salesChannelCapture = Object.entries(chan).map(([channel, v]) => ({ channel, netRevenue: Math.round(v.netRevenue * 100) / 100, orders: v.orders, channelName: v.channelName }))
    const discountTypeCapture = Object.entries(discT).map(([type, v]) => ({ type, discountedAmount: Math.round(v.discountedAmount * 100) / 100, orders: v.orders, label: v.label }))

    // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3) — per discount-code capture. orders = count of orders carrying the
    // code (order.discountCodes). discountedAmount = Σ line-item allocatedAmountSet whose allocation came from a
    // DiscountCodeApplication for that code — the EXACT applied money (handles % + fixed; top-level applications.value
    // is the spec, not the applied amount). WRITE-ONLY, NON-ADDITIVE: codes are a SUBSET of total discounting (manual/
    // automatic non-code discounts are excluded here) and per-code amounts do NOT reconcile to currentTotalDiscountsSet
    // (probed: a $1,400 code allocation on an order whose current discount total is $0) — never summed into net sales
    // or the order discount total. A code that appears with no allocation (e.g. a manual label) → orders>0, amount 0.
    const discC: Record<string, { discountedAmount: number; orders: number }> = {}
    for (const o of liveOrders) {
      for (const code of o.discountCodes || []) {
        if (!code) continue
        if (!discC[code]) discC[code] = { discountedAmount: 0, orders: 0 }
        discC[code].orders += 1
      }
      for (const le of o.lineItems?.edges || []) {
        for (const a of le.node.discountAllocations || []) {
          const code = a.discountApplication?.__typename === 'DiscountCodeApplication' ? a.discountApplication.code : null
          if (!code) continue
          if (!discC[code]) discC[code] = { discountedAmount: 0, orders: 0 }
          discC[code].discountedAmount += parseFloat(a.allocatedAmountSet?.shopMoney?.amount || '0')
        }
      }
    }
    const discountCodeCapture = Object.entries(discC).map(([code, v]) => ({ code, discountedAmount: Math.round(v.discountedAmount * 100) / 100, orders: v.orders }))

    // LORAMER_SHOPIFY_ORDER_TIME_V1 (S-FILL#7) — ORDER TIME-OF-DAY, captured RAW. One entry per live order:
    // the full UTC createdAt (to the second, verbatim from Shopify) + that order's NET revenue (the same
    // currentSubtotalPriceSet basis the account row uses, so Σ order_time revenue ≡ account net for the day).
    // NO BUCKETING HERE, BY DESIGN: bucketing to an hour at write time would bake in UTC and make a later
    // client-timezone model (DIGEST-WINDOW-MODEL — timezone is a property of the CLIENT) require a full
    // recapture to re-answer "what happened at 3am THEIR time". Raw timestamps re-bucket for free, forever.
    // Cancelled orders are already excluded upstream (liveOrders), same as every other depth grain.
    const orderTimesCapture = liveOrders.map((o) => ({
      orderId: String(o.id),
      createdAt: o.createdAt, // ISO-8601 UTC, e.g. '2024-11-29T14:03:27Z' — stored verbatim, never parsed into an hour
      netRevenue: Math.round(parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || '0') * 100) / 100,
    }))

    // Full product mix with NET revenue. LORAMER_SHOPIFY_PRODUCT_REFUND_NET_V1 — REFUND-NET per line so
    // Σ product net == account net (currentSubtotalPriceSet) EXACTLY, with per-SKU refunds landing on the
    // refunded SKU. Per line: discountedTotal − that line's refunded SUBTOTAL (from refundLineItems.subtotalSet,
    // the same axis currentSubtotalPriceSet nets). Any order-level residual not attributable to a line
    // (order edits / shipping-tax-only refund discrepancies) is allocated pro-rata across the order's lines by
    // discountedTotal share, so per order Σ line-net ≡ currentSubtotal exactly. grossRevenue + units stay
    // order-side (gross product mix / ordered units — a separate axis, not reconciled to net).
    const prodCap: Record<string, { name: string; netRevenue: number; grossRevenue: number; units: number }> = {}
    // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain rides the SAME per-line nets as prodCap (each order
    // line is exactly one variant), keyed by the bare variant gid → Σ variant ≡ Σ product ≡ account by construction.
    // LORAMER_SHOPIFY_BATCH_A2_V1 — product grouping accumulators (net keyed by attribute value)
    const typeCap: Record<string, number> = {}
    const vendorCap: Record<string, number> = {}
    const tagCap: Record<string, number> = {}
    const tagUnits: Record<string, number> = {}
    const varCap: Record<string, { name: string; sku: string | null; variantTitle: string | null; parentProductId: string; netRevenue: number; grossRevenue: number; units: number }> = {}
    for (const order of liveOrders) {
      // refunded SUBTOTAL per lineItem id (sum across all refunds on the order)
      const refundByLine: Record<string, number> = {}
      for (const ref of order.refunds || []) {
        for (const rliEdge of ref.refundLineItems?.edges || []) {
          const rli = rliEdge.node
          const lid = rli.lineItem?.id
          if (!lid) continue
          refundByLine[lid] = (refundByLine[lid] || 0) + parseFloat(rli.subtotalSet?.shopMoney?.amount || '0')
        }
      }
      // pass 1: line net = discountedTotal − line refund; track sums for residual allocation
      const lines = (order.lineItems?.edges || []).map((e) => {
        const item = e.node
        const id = String(item.product?.id || `notitle:${item.title}`)
        const disc = parseFloat(item.discountedTotalSet?.shopMoney?.amount || '0')
        const refunded = item.id ? refundByLine[item.id] || 0 : 0
        return { item, id, disc, net: disc - refunded }
      })
      const sumDisc = lines.reduce((s, l) => s + l.disc, 0)
      const sumNet = lines.reduce((s, l) => s + l.net, 0)
      const orderNet = parseFloat(order.currentSubtotalPriceSet?.shopMoney?.amount || '0')
      const residual = orderNet - sumNet // order-level refund/adjustment not tied to a specific line
      // pass 2: allocate residual pro-rata by discountedTotal share (equal split if all lines are $0)
      for (const l of lines) {
        const share = sumDisc > 0 ? l.disc / sumDisc : lines.length ? 1 / lines.length : 0
        const net = l.net + residual * share
        const lineGross = parseFloat(l.item.originalUnitPriceSet?.shopMoney?.amount || '0') * l.item.quantity
        if (!prodCap[l.id]) prodCap[l.id] = { name: l.item.title, netRevenue: 0, grossRevenue: 0, units: 0 }
        prodCap[l.id].netRevenue += net
        prodCap[l.id].grossRevenue += lineGross
        prodCap[l.id].units += l.item.quantity
        // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain: bare variant gid (globally unique); fold a
        // variant-less line (deleted/custom line item, variant=null) to `${productId}::novar` so per-product Σ variant ≡ product.
        const variant = l.item.variant
        const varKey = variant?.id || `${l.id}::novar`
        if (!varCap[varKey]) varCap[varKey] = { name: variant?.title || l.item.title, sku: variant?.sku ?? null, variantTitle: variant?.title ?? null, parentProductId: l.id, netRevenue: 0, grossRevenue: 0, units: 0 }
        varCap[varKey].netRevenue += net
        varCap[varKey].grossRevenue += lineGross
        varCap[varKey].units += l.item.quantity

        // LORAMER_SHOPIFY_BATCH_A2_V1 — product GROUPING attributes, accumulated off the SAME per-line net
        // that product/variant already use, so type and vendor inherit the exact reconciliation the product
        // grain has (Σ ≡ account net, residual allocated pro-rata) with no second basis to drift from.
        // type + vendor: each line's product has exactly ONE of each → they PARTITION the day's net.
        // tag: a product carries MANY tags, so the SAME net is added to EVERY tag it holds. That is a
        // deliberate over-count and it is why the family is additive:false — a tag row answers "how much
        // revenue touched this tag", never "what share of the day was this tag".
        const pt = (l.item.product?.productType || '').trim() || 'UNKNOWN'
        typeCap[pt] = (typeCap[pt] || 0) + net
        const vd = (l.item.product?.vendor || '').trim() || 'UNKNOWN'
        vendorCap[vd] = (vendorCap[vd] || 0) + net
        const tags = (l.item.product?.tags || []).map((t) => String(t).trim()).filter(Boolean)
        if (!tags.length) tagCap['UNTAGGED'] = (tagCap['UNTAGGED'] || 0) + net
        else for (const tg of tags) tagCap[tg] = (tagCap[tg] || 0) + net
        for (const tg of tags.length ? tags : ['UNTAGGED']) tagUnits[tg] = (tagUnits[tg] || 0) + l.item.quantity
      }
    }
    const productsCapture = Object.entries(prodCap).map(([id, v]) => ({ id, ...v }))
    // LORAMER_SHOPIFY_BATCH_B_V1 — product_collection. Product ids are DEDUPLICATED (prodCap is already keyed
    // by product id, so each product is fetched ONCE per day regardless of how many line items referenced it),
    // then collections come from the SEPARATE batched call — never from the orders query, which Shopify hard-
    // rejects at 1,036 points with that field attached. Each product's net is projected onto EVERY collection
    // it belongs to, so this OVER-COUNTS by design exactly like product_tag: additive:false is mandatory.
    const collectionProductIds = Object.keys(prodCap).filter((id) => id.startsWith('gid://'))
    const collectionsResult = collectionProductIds.length
      ? await fetchProductCollections(endpoint, headers, collectionProductIds, opts?.throttleDeadline)
      : { byProductId: {} as Record<string, string[]>, batchesTotal: 0, batchesFailed: 0, productsMissing: 0 }
    const collCap: Record<string, { netRevenue: number; products: Set<string> }> = {}
    for (const [pid, v] of Object.entries(prodCap)) {
      const titles = collectionsResult.byProductId[pid] || []
      if (!titles.length) continue // no collections (or degraded) → NO row; never a fabricated 'UNCOLLECTED' bucket
      for (const t of titles) {
        if (!collCap[t]) collCap[t] = { netRevenue: 0, products: new Set() }
        collCap[t].netRevenue += v.netRevenue
        collCap[t].products.add(pid)
      }
    }
    const productCollectionCapture = Object.entries(collCap).map(([collection, v]) => ({
      collection,
      netRevenue: Math.round(v.netRevenue * 100) / 100,
      products: v.products.size,
    }))
    const r2 = (n: number) => Math.round(n * 100) / 100
    const productTypeCapture = Object.entries(typeCap).map(([productType, netRevenue]) => ({ productType, netRevenue: r2(netRevenue) }))
    const productVendorCapture = Object.entries(vendorCap).map(([vendor, netRevenue]) => ({ vendor, netRevenue: r2(netRevenue) }))
    const productTagCapture = Object.entries(tagCap).map(([tag, netRevenue]) => ({ tag, netRevenue: r2(netRevenue), units: tagUnits[tag] || 0 }))
    // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain capture. id = bare variant gid; parentProductId = the
    // product entity_id (written as parent_entity_id). Same per-line nets as productsCapture → Σ variant ≡ Σ product ≡ account net.
    const variantsCapture = Object.entries(varCap).map(([id, v]) => ({
      id,
      parentProductId: v.parentProductId,
      name: v.name,
      sku: v.sku ?? undefined,
      variantTitle: v.variantTitle ?? undefined,
      units: v.units,
      netRevenue: v.netRevenue,
      grossRevenue: v.grossRevenue,
    }))

    // LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 / _VALUE_V1 (S-FILL#2) — separate fail-soft fetch.
    // Reuses the same date queryString as the orders query so count + value are
    // scoped to the same window. undefined ⟺ permission/network failure.
    const abandonedSummary = await fetchAbandonedCheckoutSummary(endpoint, headers, queryString)

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
      // LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 / _VALUE_V1 — undefined when permission or network failed
      abandonedCheckoutCount: abandonedSummary?.count,
      abandonedCheckoutValue: abandonedSummary?.value, // S-FILL#2 — potential/LOST revenue, never actual
      topProducts,
      // LORAMER_SHOPIFY_DEPTH_2A_V1 — capture-only depth
      productsCapture,
      variantsCapture, // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1
      geoCountries,
      geoRegions,
      productTypeCapture, // LORAMER_SHOPIFY_BATCH_A2_V1
      productVendorCapture, // LORAMER_SHOPIFY_BATCH_A2_V1
      productTagCapture, // LORAMER_SHOPIFY_BATCH_A2_V1
      productCollectionCapture, // LORAMER_SHOPIFY_BATCH_B_V1 (separate batched call)
      customerCohortCapture, // LORAMER_SHOPIFY_BATCH_C_V1
      financialStatusCapture, // LORAMER_SHOPIFY_BATCH_A3_V1 (capture-time SNAPSHOT)
      fulfillmentStatusCapture, // LORAMER_SHOPIFY_BATCH_A3_V1 (capture-time SNAPSHOT)
      geoCities, // LORAMER_SHOPIFY_BATCH_A1_V1
      salesChannelCapture, // LORAMER_SHOPIFY_BATCH_A1_V1 (S-FILL#1)
      discountTypeCapture, // LORAMER_SHOPIFY_BATCH_A1_V1
      discountCodeCapture, // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3)
      orderTimesCapture, // LORAMER_SHOPIFY_ORDER_TIME_V1 (S-FILL#7) — raw UTC order timestamps, unbucketed
      currencyCode,
      currencyMixed,
      unknownGeoOrders,
      money: buildShopifyMoneySurface(liveOrders), // LORAMER_SHOPIFY_MONEY_SURFACE_V1 (T1.5) — full money split → account extra
    }
  } catch (e: any) {
    // LORAMER_SHOPIFY_DIM_BACKFILL_V1 — let a throttle-budget signal propagate so the backfill can
    // stop + persist its cursor (NOT collapse to empty data).
    if (e?.throttleBudget) throw e
    // LORAMER_SHOPIFY_SWALLOW_FIX_V1 — WRITERS (throwOnError) RE-THROW a real fetch/GraphQL error so they HALT
    // instead of writing a false-zero day (mirrors Woo + the fixed Meta fetchAll). This also covers the
    // "still throttled after retries" plain throw (scope-a). The reviewer path (/api/intelligence) passes no
    // throwOnError → falls through to the swallow-to-empty below → its render stays BYTE-IDENTICAL.
    if (opts?.throwOnError) throw e
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
      productTypeCapture: [], // LORAMER_SHOPIFY_BATCH_A2_V1
      productVendorCapture: [],
      productTagCapture: [],
      productCollectionCapture: [], // LORAMER_SHOPIFY_BATCH_B_V1
      customerCohortCapture: [], // LORAMER_SHOPIFY_BATCH_C_V1
      financialStatusCapture: [], // LORAMER_SHOPIFY_BATCH_A3_V1
      fulfillmentStatusCapture: [],
      geoCities: [], // LORAMER_SHOPIFY_BATCH_A1_V1 — fetch failed → no rows, never a fabricated bucket
      salesChannelCapture: [],
      discountTypeCapture: [],
      discountCodeCapture: [], // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3)
      orderTimesCapture: [], // LORAMER_SHOPIFY_ORDER_TIME_V1 (S-FILL#7) — fetch failed → NO timestamps, never a fabricated one
      unknownGeoOrders: 0,
    }
  }
}
