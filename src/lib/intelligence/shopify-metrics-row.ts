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
