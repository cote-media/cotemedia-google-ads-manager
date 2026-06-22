// LORAMER_WOO_METRICS_ROW_V1
// WooCommerce -> metrics_daily row builder, extracted verbatim from the cron route so
// it is independently testable and reusable by the catch-up loop (mirrors
// ga-metrics-row.ts / shopify-metrics-row.ts). No logic change from cron/sync.
import type { IntelligenceShopify } from './intelligence-types'
import { shopifyAccountExtra } from './shopify-metrics-row'

export function buildWooMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  storeUrl: string,
  data: IntelligenceShopify
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  rows.push({
    client_id: clientId,
    user_email: userEmail,
    platform: 'woocommerce',
    account_id: storeUrl, // LORAMER_MULTIACCOUNT_PHASE2A_V1
    entity_level: 'account',
    entity_id: storeUrl,
    entity_name: storeUrl,
    date: captureDate,
    breakdown_type: '',
    breakdown_value: '',
    revenue: data.totalRevenue ?? 0,
    conversions: data.totalOrders ?? 0,
    extra: shopifyAccountExtra(data),
  })

  // LORAMER_WOO_ALLPRODUCTS_FIX1A_V1 — write ALL products from the uncapped productsCapture.
  // Fall back to the 10-row topProducts ONLY if productsCapture is undefined (an older cached
  // shape can't drop product rows to zero). `??` keeps an intentional empty [] as empty.
  const productList = data.productsCapture ?? data.topProducts ?? []
  for (const product of productList) {
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'woocommerce',
      account_id: storeUrl, // LORAMER_MULTIACCOUNT_PHASE2A_V1
      entity_level: 'product',
      entity_id: product.id,
      entity_name: product.name,
      parent_entity_id: storeUrl,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      revenue: product.revenue, // LORAMER_WOO_PRODUCT_REFUND_NET_FIX1B_V1 — NET (productsCapture sets revenue=netRevenue)
      conversions: product.units,
      extra: { units: product.units, netBasis: 'account_net_incl_shipping_tax_prorata_by_gross_share' },
    })
  }

  return rows
}
