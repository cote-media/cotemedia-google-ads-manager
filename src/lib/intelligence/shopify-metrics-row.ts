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

  return rows
}
