// LORAMER_SHOPIFY_DEPTH_2A_V1
// Shopify -> metrics_daily row builders, extracted from the cron route so they are
// independently testable (mirrors ga-metrics-row.ts).
//
// buildShopifyMetricsRows = the irreducible MAIN row (account totals). Always written.
// buildShopifyDepthRows   = the depth emission (product net + ship-to geo breakdowns).
//   Written in its OWN try/catch by the caller so a depth failure NEVER drops the
//   account row. Cancelled orders are excluded from depth (computed upstream in
//   fetchShopifyIntelligence); the account row keeps its existing calculation.

import type { IntelligenceShopify } from './intelligence-types'

export function shopifyAccountExtra(data: IntelligenceShopify): Record<string, unknown> {
  return {
    avgOrderValue: data.avgOrderValue,
    refundedAmount: data.refundedAmount,
    newCustomers: data.newCustomers,
    returningCustomers: data.returningCustomers,
    unknownCustomers: data.unknownCustomers, // LORAMER_CUSTOMER_MIX_FIX_V1
    customerMixUnavailable: data.customerMixUnavailable,
    refundedOrderCount: data.refundedOrderCount,
    refundRate: data.refundRate,
    returningRate: data.returningRate,
    newCustomerAov: data.newCustomerAov,
    returningCustomerAov: data.returningCustomerAov,
    revenueConcentration: data.revenueConcentration,
    abandonedCheckoutCount: data.abandonedCheckoutCount,
    abandonedCheckoutValue: data.abandonedCheckoutValue, // LORAMER_SHOPIFY_ABANDONED_VALUE_V1 (S-FILL#2) — potential/LOST, never actual
    currencyCode: data.currencyCode, // LORAMER_SHOPIFY_DEPTH_2A_V1
    // LORAMER_ECOM_MONEY_SURFACE_V1 (T1.5/T1.6) — full order money split, namespaced under extra.money when the
    // fetcher computed it. Additive-only: never touches revenue/conversions. Shared by Shopify + Woo (Woo's
    // buildWooMetricsRows also builds its account extra via this fn). Absent → key omitted (no empty object).
    ...(data.money ? { money: data.money } : {}),
  }
}

// MAIN row — account totals only (unchanged calculation; product moved to depth).
export function buildShopifyMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  shopDomain: string,
  data: IntelligenceShopify
): Record<string, unknown>[] {
  return [
    {
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      entity_name: shopDomain,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      revenue: data.totalRevenue ?? 0,
      conversions: data.totalOrders ?? 0,
      extra: shopifyAccountExtra(data),
    },
  ]
}

// DEPTH rows (LORAMER_SHOPIFY_DEPTH_2A_V1):
//  - product (base entity_level='product'): NET revenue (after discounts), ALL products
//    (not just top-N), stable product.id key, gross + units + currency in extra.
//  - geo_country / geo_region (breakdown rows on the account): NET revenue + order count
//    per ship-to country/region; missing addresses bucket as 'UNKNOWN' (never dropped).
// All exclude cancelled orders (done upstream). Read back: products via
// query_metrics(level='product'); geo via query_breakdown(breakdownType='geo_country'|'geo_region').
export function buildShopifyDepthRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  shopDomain: string,
  data: IntelligenceShopify
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const cur = data.currencyCode
  const curMixed = data.currencyMixed || undefined // LORAMER_SHOPIFY_DIM_BACKFILL_V1 — tag untrustworthy cross-currency sums

  for (const p of data.productsCapture || []) {
    if (!p?.id) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'product',
      entity_id: p.id,
      entity_name: p.name,
      parent_entity_id: shopDomain,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      revenue: p.netRevenue, // NET (after discounts); gross kept in extra
      conversions: p.units,
      extra: { units: p.units, grossRevenue: p.grossRevenue, currencyCode: cur, currencyMixed: curMixed, netBasis: 'discountedTotal_excl_refunds' },
    })
  }

  // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain (entity_level='variant'): bare variant gid,
  // parent_entity_id=product id, sku+variantTitle in extra. NET (refund-netted per line) so Σ variant ≡ product.
  for (const v of data.variantsCapture || []) {
    if (!v?.id) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'variant',
      entity_id: v.id,
      entity_name: v.name,
      parent_entity_id: v.parentProductId,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      revenue: v.netRevenue ?? v.revenue ?? 0,
      conversions: v.units,
      extra: { units: v.units, sku: v.sku, variantTitle: v.variantTitle, grossRevenue: v.grossRevenue, currencyCode: cur, currencyMixed: curMixed, netBasis: 'discountedTotal_refundNetted_perLine' },
    })
  }

  for (const g of data.geoCountries || []) {
    if (!g?.country) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      entity_name: shopDomain,
      date: captureDate,
      breakdown_type: 'geo_country',
      breakdown_value: g.country, // ISO country code, or 'UNKNOWN'
      revenue: g.netRevenue,
      conversions: g.orders,
      extra: { orders: g.orders, refunded: g.refunded, currencyCode: cur, currencyMixed: curMixed },
    })
  }

  for (const g of data.geoRegions || []) {
    if (!g?.region) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      date: captureDate,
      breakdown_type: 'geo_region',
      breakdown_value: g.region, // e.g. 'US-CA', or '<country>-UNKNOWN'
      revenue: g.netRevenue,
      conversions: g.orders,
      extra: { orders: g.orders, currencyCode: cur, currencyMixed: curMixed },
    })
  }

  // LORAMER_SHOPIFY_BATCH_C_V1 — customer_cohort. PARTITIONS the day net (each order maps to exactly one
  // bucket through its customer's lifetime order count), so Σ cohort ≡ account net and it reconciles
  // FLAG-NOT-BLOCK. Orders with no linked customer bucket UNKNOWN and stay IN the partition.
  // LTV RIDES IN extra, NEVER IN A SUMMABLE COLUMN: avgLifetimeSpent is the average LIFETIME spend of the
  // customers who ordered that day. Lifetime figures cannot be summed across days — a customer ordering on
  // ten days would contribute their whole lifetime value ten times. That is the same trap that made
  // numberOfOrders unusable for new-vs-returning (LORAMER_CUSTOMER_MIX_FIX_V1); it is labelled here and
  // caveated to Lora in metrics-query.ts so it cannot be mistaken for windowed revenue.
  // PII: buckets and counts only — no per-customer rows, no email/name/address anywhere in this path.
  for (const c of data.customerCohortCapture || []) {
    if (!c?.bucket) continue
    rows.push({
      client_id: clientId, user_email: userEmail, platform: 'shopify', account_id: shopDomain,
      entity_level: 'account', entity_id: shopDomain, entity_name: shopDomain, parent_entity_id: shopDomain,
      date: captureDate, breakdown_type: 'customer_cohort', breakdown_value: c.bucket,
      revenue: c.netRevenue, conversions: c.orders,
      extra: {
        orders: c.orders,
        customers: c.customers,
        avgLifetimeSpent: c.avgLifetimeSpent,
        ltvSemantics: 'LIFETIME_NOT_WINDOWED',
        currencyCode: cur, currencyMixed: curMixed,
        basis: 'currentSubtotalPriceSet_net',
        caveat: 'avgLifetimeSpent is a LIFETIME figure for the customers who ordered this day — never sum it across days and never treat it as revenue in the window; revenue/conversions on this row ARE windowed and do partition the day.',
      },
    })
  }

  // LORAMER_SHOPIFY_BATCH_A3_V1 — ORDER STATUS. Both PARTITION the day's net (one financial and one
  // fulfillment status per order), so Σ status ≡ account net and they reconcile FLAG-NOT-BLOCK like geo.
  // SNAPSHOT SEMANTICS — the reason this family got its own flight: status is MUTABLE. These rows record
  // what was true WHEN WE ASKED, not as of the order date. A re-walk of the same day can legitimately
  // return different values, and backfilled history is systematically more settled than recent days
  // (old orders have resolved to PAID/FULFILLED; this week's have not). extra.semantics carries that on
  // every row, and metrics-query.ts attaches the same warning to Lora's query results — a caveat that
  // lives only in a comment is how a capture artifact becomes a reported "trend".
  for (const [fam, list] of [
    ['financial_status', data.financialStatusCapture || []],
    ['fulfillment_status', data.fulfillmentStatusCapture || []],
  ] as [string, { status: string; netRevenue: number; orders: number }[]][]) {
    for (const s of list) {
      if (!s?.status) continue
      rows.push({
        client_id: clientId, user_email: userEmail, platform: 'shopify', account_id: shopDomain,
        entity_level: 'account', entity_id: shopDomain, entity_name: shopDomain, parent_entity_id: shopDomain,
        date: captureDate, breakdown_type: fam, breakdown_value: s.status,
        revenue: s.netRevenue, conversions: s.orders,
        extra: {
          orders: s.orders, currencyCode: cur, currencyMixed: curMixed,
          basis: 'currentSubtotalPriceSet_net',
          semantics: 'CAPTURE_TIME_SNAPSHOT',
          captured_at: new Date().toISOString(),
          caveat: 'order status is MUTABLE — this row records the status as of CAPTURE, not as of the order date. Re-walking the same day can return different values, and older history is systematically more settled than recent days. Never read a status distribution over time as a trend.',
        },
      })
    }
  }

  // LORAMER_SHOPIFY_BATCH_A2_V1 — product GROUPING families. All three project the SAME per-line net the
  // product/variant grains already use, so type and vendor inherit the product grain's exact reconciliation
  // (Σ ≡ account net, order-level residual allocated pro-rata) with no second basis to drift from.
  // entity_level is 'account': these are ATTRIBUTES of revenue, not a deeper entity — the product grain
  // already exists at entity_level='product' and answers a different question.
  for (const t of data.productTypeCapture || []) {
    if (!t?.productType) continue
    rows.push({
      client_id: clientId, user_email: userEmail, platform: 'shopify', account_id: shopDomain,
      entity_level: 'account', entity_id: shopDomain, entity_name: shopDomain, parent_entity_id: shopDomain,
      date: captureDate, breakdown_type: 'product_type', breakdown_value: t.productType,
      revenue: t.netRevenue,
      extra: { currencyCode: cur, currencyMixed: curMixed, basis: 'perline_net_same_as_product_grain' },
    })
  }
  for (const v of data.productVendorCapture || []) {
    if (!v?.vendor) continue
    rows.push({
      client_id: clientId, user_email: userEmail, platform: 'shopify', account_id: shopDomain,
      entity_level: 'account', entity_id: shopDomain, entity_name: shopDomain, parent_entity_id: shopDomain,
      date: captureDate, breakdown_type: 'product_vendor', breakdown_value: v.vendor,
      revenue: v.netRevenue,
      extra: { currencyCode: cur, currencyMixed: curMixed, basis: 'perline_net_same_as_product_grain' },
    })
  }
  // product_tag — OVER-COUNTS BY DESIGN and that is the whole point of additive:false. A product with 5
  // tags adds its full net to all 5 buckets, so Σ product_tag EXCEEDS the day's net by exactly the average
  // tags-per-product multiple. A tag row answers "how much revenue touched this tag", NEVER "what share of
  // the day was this tag". Summing tags to compare against net sales is the misuse this flag exists to stop.
  for (const t of data.productTagCapture || []) {
    if (!t?.tag) continue
    rows.push({
      client_id: clientId, user_email: userEmail, platform: 'shopify', account_id: shopDomain,
      entity_level: 'account', entity_id: shopDomain, entity_name: shopDomain, parent_entity_id: shopDomain,
      date: captureDate, breakdown_type: 'product_tag', breakdown_value: t.tag,
      revenue: t.netRevenue, conversions: t.units,
      extra: {
        units: t.units, currencyCode: cur, currencyMixed: curMixed,
        basis: 'perline_net_same_as_product_grain',
        caveat: 'a product carries MANY tags, so the same revenue is counted under every tag it holds — NEVER sum product_tag across values or compare the sum to net sales',
      },
    })
  }

  // LORAMER_SHOPIFY_BATCH_A1_V1 — geo_city: the third rung of the geo ladder, same shape and same net basis
  // as the country/region loops directly above. breakdown_value keeps the family's composite convention
  // ('<country>-<province>' → '<country>-<province>-<city>') so all three read as one hierarchy. PARTITIONS
  // the day's net (one shipping address per order); missing city buckets UNKNOWN, never dropped.
  for (const g of data.geoCities || []) {
    if (!g?.city) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      date: captureDate,
      breakdown_type: 'geo_city',
      breakdown_value: g.city,
      revenue: g.netRevenue,
      conversions: g.orders,
      extra: { orders: g.orders, currencyCode: cur, currencyMixed: curMixed },
    })
  }

  // LORAMER_SHOPIFY_BATCH_A1_V1 (S-FILL#1) — sales_channel: which channel the order came through.
  // PARTITIONS the day's net — an order arrives through exactly ONE channel, so Σ sales_channel ≡ account
  // net and it reconciles FLAG-NOT-BLOCK against the account anchor, exactly like geo. breakdown_value =
  // channelDefinition.handle (stable, machine-readable); the human channelName rides extra. An order with
  // no channelInformation buckets as UNKNOWN — a missing channel is a fact about the order, never a reason
  // to drop its revenue out of the partition.
  for (const c of data.salesChannelCapture || []) {
    if (!c?.channel) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      entity_name: shopDomain,
      parent_entity_id: shopDomain,
      date: captureDate,
      breakdown_type: 'sales_channel',
      breakdown_value: c.channel,
      revenue: c.netRevenue,
      conversions: c.orders,
      extra: { orders: c.orders, channelName: c.channelName, currencyCode: cur, currencyMixed: curMixed, basis: 'currentSubtotalPriceSet_net' },
    })
  }

  // LORAMER_SHOPIFY_BATCH_A1_V1 — discount_type: the TYPE axis of discounting (code / manual / automatic /
  // script), sibling to discount_code's per-CODE axis. Captures ALL application subtypes including code so
  // the axis is complete and self-describing. WRITE-ONLY + NON-ADDITIVE for the SAME reasons already banked
  // on discount_code: allocations OVERLAP, they are a SUBSET of total discounting, and one allocation can
  // exceed an order's current discount total. Money lands in conversion_value, orders-carrying-that-type in
  // conversions, revenue FORCED 0 — NEVER summed or reconciled into net sales or the order discount total.
  // Orders are counted ONCE per type per order (not once per allocation), so the count means "orders that
  // used this kind of discount".
  for (const d of data.discountTypeCapture || []) {
    if (!d?.type) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      entity_name: shopDomain,
      parent_entity_id: shopDomain,
      date: captureDate,
      breakdown_type: 'discount_type',
      breakdown_value: d.type,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: d.orders,
      conversion_value: d.discountedAmount,
      revenue: 0,
      extra: {
        discounted_amount: d.discountedAmount,
        orders: d.orders,
        label: d.label,
        currencyCode: cur,
        currencyMixed: curMixed,
        basis: 'lineitem_allocations',
        caveat: 'discount TYPE amounts are a subset of total discounting and overlap; never sum/reconcile into net sales or the order discount total',
      },
    })
  }

  // LORAMER_SHOPIFY_ABANDONED_VALUE_V1 (S-FILL#2) — abandoned-checkout POTENTIAL/LOST revenue, first-class
  // breakdown_type='abandoned_checkout', account-day grain, single 'all' bucket. WRITE-ONLY + NON-ADDITIVE:
  // it is NOT order revenue and must NEVER be summed into or reconciled against net sales — so the money lives
  // in conversion_value (NEVER `revenue`, which stays 0) and the count in conversions. Emitted ONLY when
  // count>0: a pre-retention / purged day returns 0 abandoned from Shopify → NO row (never a FALSE ZERO), which
  // makes the ~90-day Shopify retention floor an emergent property (forward-first, not full history like orders).
  // undefined count (permission denied / fetch failed) → also no row (fail-soft undefined-never-0 preserved).
  if (data.abandonedCheckoutCount != null && data.abandonedCheckoutCount > 0) {
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      entity_name: shopDomain,
      parent_entity_id: shopDomain,
      date: captureDate,
      breakdown_type: 'abandoned_checkout',
      breakdown_value: 'all',
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: data.abandonedCheckoutCount,           // COUNT of abandoned checkouts (queryable)
      conversion_value: data.abandonedCheckoutValue ?? 0, // POTENTIAL/LOST value = Σ totalPriceSet (queryable)
      revenue: 0,                                         // NEVER net sales — potential revenue is not actual revenue
      extra: {
        potential_value: data.abandonedCheckoutValue ?? 0,
        count: data.abandonedCheckoutCount,
        currencyCode: cur,
        currencyMixed: curMixed,
        basis: 'sum_totalPriceSet',
        retention_floor_days: 90,
        caveat: 'abandoned-checkout value = potential/lost revenue, never actual; never sum/reconcile into net sales',
      },
    })
  }

  // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3) — one row per discount code, account-day grain, breakdown_value=code.
  // WRITE-ONLY + NON-ADDITIVE: discounted_amount is the EXACT per-code applied money (Σ line-item allocations), a SUBSET
  // of total discounting (manual/automatic non-code discounts are NOT captured here) — money in conversion_value, orders
  // carrying the code in conversions, revenue FORCED 0. NEVER sum/reconcile into net sales OR the order discount total
  // (currentTotalDiscountsSet): a single code's allocation can exceed an order's current discount total, and codes overlap
  // with non-code discounts. No code on an order → no row (absence of a code is not a partition, so no 'unknown' bucket).
  for (const d of data.discountCodeCapture || []) {
    if (!d?.code) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: shopDomain,
      entity_name: shopDomain,
      parent_entity_id: shopDomain,
      date: captureDate,
      breakdown_type: 'discount_code',
      breakdown_value: d.code,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: d.orders,               // orders carrying this code
      conversion_value: d.discountedAmount, // exact applied money for this code (line-item allocations)
      revenue: 0,                           // NEVER net sales
      extra: {
        discounted_amount: d.discountedAmount,
        orders: d.orders,
        currencyCode: cur,
        currencyMixed: curMixed,
        basis: 'lineitem_allocations',
        caveat: 'discount-code amount is a subset of total discounting (excludes manual/automatic non-code discounts); never sum/reconcile into the order discount total or net sales',
      },
    })
  }

  // LORAMER_SHOPIFY_ORDER_TIME_V1 (S-FILL#7) — ORDER TIME-OF-DAY, one row per order, breakdown_type='order_time'.
  // breakdown_value = the RAW Shopify UTC timestamp, to the second, VERBATIM. Deliberately NOT bucketed to an hour
  // here: bucketing at write time would bake UTC into history, and re-answering "what sold at 3am THEIR time" would
  // then need a full recapture. Raw timestamps re-bucket for free under any later client-timezone model
  // (DIGEST-WINDOW-MODEL: the timezone is a property of the CLIENT, not of the capture).
  // KEY SHAPE: entity_id = the order id, so the conflict key (…, entity_id, date, breakdown_type, breakdown_value)
  // is unique PER ORDER — two orders placed in the SAME second cannot collide and silently overwrite each other.
  // ADDITIVE: revenue is the order's NET on the SAME currentSubtotalPriceSet basis as the account row, so
  // Σ order_time revenue for a day ≡ that day's account net. No new entity_level, no schema change, no migration.
  // The daily row's UTC day boundary is UNCHANGED by this change (separate, gated item).
  for (const o of data.orderTimesCapture || []) {
    if (!o?.orderId || !o?.createdAt) continue // no fabricated timestamp, ever
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      account_id: shopDomain,
      entity_level: 'account',
      entity_id: o.orderId,
      entity_name: shopDomain,
      parent_entity_id: shopDomain,
      date: captureDate,
      breakdown_type: 'order_time',
      breakdown_value: o.createdAt, // e.g. '2024-11-29T14:03:27Z' — RAW UTC, unbucketed
      revenue: o.netRevenue,
      conversions: 1, // exactly one order per row
      extra: {
        orderId: o.orderId,
        createdAtUtc: o.createdAt,
        netRevenue: o.netRevenue,
        currencyCode: cur,
        currencyMixed: curMixed,
        basis: 'currentSubtotalPriceSet_net',
        tzBasis: 'UTC_raw_unbucketed',
        caveat: 'timestamp is RAW UTC to the second; bucket to an hour ONLY at read time, against the client timezone — never assume UTC is the merchant clock',
      },
    })
  }

  return rows
}
