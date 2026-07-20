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

  // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain (entity_level='variant'): COMPOSITE entity_id
  // `${productId}:${variationId}` (variation_id=0 simple product → `${productId}:0`), parent_entity_id=product id,
  // sku in extra. NET (FIX-1b pro-rata per line) so Σ variant ≡ product ≡ account.
  for (const variant of data.variantsCapture ?? []) {
    if (!variant?.id) continue
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'woocommerce',
      account_id: storeUrl, // LORAMER_MULTIACCOUNT_PHASE2A_V1
      entity_level: 'variant',
      entity_id: variant.id,
      entity_name: variant.name,
      parent_entity_id: variant.parentProductId,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      revenue: variant.revenue ?? variant.netRevenue ?? 0,
      conversions: variant.units,
      extra: { units: variant.units, sku: variant.sku, netBasis: 'account_net_incl_shipping_tax_prorata_by_gross_share' },
    })
  }

  // ── LORAMER_WOO_BATCH_WA_V1 — NINE BREAKDOWN FAMILIES ────────────────────────────────────────────────
  // All nine are emitted HERE, from the ONE shared row builder that cron/sync, cron/catchup and the backfill
  // engine all call. That is not a convenience — it is why the G1 defect class (a dimension wired into the
  // backfill only, which then silently freezes at its ship date the moment forward capture moves on) is
  // structurally impossible on WooCommerce. One edit, three writers, byte-identical rows.
  //
  // Every family is account-grain: an order is an account-level event. product/variant are LINE grains and
  // carry no billing address, no payment method and no order status, so declaring them would over-declare a
  // surface the vendor does not serve at that level.
  //
  // NO MIGRATION: each row is a (breakdown_type, breakdown_value) pair inside the existing 7-column conflict
  // key (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value).
  const wb = data.wooBreadth
  if (wb) {
    const acct = {
      client_id: clientId,
      user_email: userEmail,
      platform: 'woocommerce',
      account_id: storeUrl,
      entity_level: 'account',
      entity_id: storeUrl,
      entity_name: storeUrl,
      parent_entity_id: storeUrl,
      date: captureDate,
    }

    // GEO ×3 — PARTITION the day net. Money is wooNetOf, the SAME basis as the account row directly above,
    // so Σ geo_country ≡ Σ geo_region ≡ Σ geo_city ≡ account net for the day and all three reconcile
    // FLAG-NOT-BLOCK. UNKNOWN buckets are IN the partition by design: an order with no billing country is an
    // order whose country we do not know, not an order that stops existing.
    // BASIS = BILLING address (see buildWooBreadth for why billing beats ship-to on Woo).
    const geoFamilies: [string, { value: string; netRevenue: number; orders: number }[]][] = [
      ['geo_country', wb.geoCountries],
      ['geo_region', wb.geoRegions],
      ['geo_city', wb.geoCities],
    ]
    for (const [bt, list] of geoFamilies) {
      for (const g of list) {
        if (!g?.value) continue
        rows.push({
          ...acct,
          breakdown_type: bt,
          breakdown_value: g.value, // country: ISO code | region: '<cc>-<state>' | city: '<cc>-<state>-<city>'
          revenue: g.netRevenue,
          conversions: g.orders,
          extra: { orders: g.orders, geoBasis: 'billing_address', netBasis: 'woo_total_incl_shipping_tax_refundNetted' },
        })
      }
    }

    // PAYMENT METHOD — PARTITIONS the day net (exactly one gateway per order). breakdown_value is the title
    // the merchant recognises; the stable gateway slug rides extra so a title rename does not orphan history.
    for (const p of wb.paymentMethods) {
      if (!p?.value) continue
      rows.push({
        ...acct,
        breakdown_type: 'payment_method',
        breakdown_value: p.value,
        revenue: p.netRevenue,
        conversions: p.orders,
        extra: { orders: p.orders, paymentMethodSlug: p.slug, netBasis: 'woo_total_incl_shipping_tax_refundNetted' },
      })
    }

    // ORDER STATUS — WRITE-ONLY, non-additive, ALL statuses. revenue carries the order value on ONE basis
    // (wooNetOf, uniformly, sale or not) so nothing mixed ever lands in a summable column; isSale marks the
    // {completed,processing,refunded} subset that DOES sum to account net by construction. The non-sale rows
    // are demand this platform has never recorded anywhere — that is the point of the family.
    for (const s of wb.orderStatuses) {
      if (!s?.value) continue
      rows.push({
        ...acct,
        breakdown_type: 'order_status',
        breakdown_value: s.value,
        revenue: s.orderValue,
        conversions: s.orders,
        extra: {
          orders: s.orders,
          isSale: s.isSale,
          saleStatuses: ['completed', 'processing', 'refunded'],
          netBasis: 'woo_total_incl_shipping_tax_refundNetted',
          caveat: 'ALL statuses incl. failed/cancelled/pending — a SUPERSET of account net, never a partition of it. Only the isSale=true subset {completed,processing,refunded} sums to account net.',
        },
      })
    }

    // SHIPPING METHOD — WRITE-ONLY, non-additive. Money is the shipping CHARGE (Σ shipping_lines.total) in
    // conversion_value with revenue FORCED 0, the discount_code shape: shipping_lines is an array, so a split
    // shipment puts one order under two methods and attributing order net would double-count it.
    for (const s of wb.shippingMethods) {
      if (!s?.value) continue
      rows.push({
        ...acct,
        breakdown_type: 'shipping_method',
        breakdown_value: s.value,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: s.orders,                 // orders using this method (counted once per order per method)
        conversion_value: s.shippingCharge,    // the shipping CHARGE for this method
        revenue: 0,                            // NEVER order net — split shipments would double-count it
        extra: {
          orders: s.orders,
          shippingCharge: s.shippingCharge,
          shippingMethodId: s.methodId,
          basis: 'shipping_lines_total',
          caveat: 'money here is the SHIPPING CHARGE, not order revenue; an order with a split shipment appears under every method it used, so never sum shipping_method into net sales or order counts',
        },
      })
    }

    // COUPON CODE + COUPON TYPE — WRITE-ONLY, non-additive, both. Discount money in conversion_value, orders
    // carrying it in conversions, revenue FORCED 0. A coupon's discount is discount money, NOT a share of net,
    // and orders with no coupon are absent entirely: a subset, not a partition (the Shopify discount_code
    // posture, reached independently from the same law). No coupon → no row; there is no UNKNOWN bucket
    // because absence of a coupon is not a value.
    for (const c of wb.couponCodes) {
      if (!c?.value) continue
      rows.push({
        ...acct,
        breakdown_type: 'coupon_code',
        breakdown_value: c.value,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: c.orders,
        conversion_value: c.discountAmount,
        revenue: 0,
        extra: {
          orders: c.orders,
          discountAmount: c.discountAmount,
          discountTax: c.discountTax,
          basis: 'coupon_lines_discount',
          caveat: 'coupon discount is discount MONEY, not a share of net sales; orders without a coupon are not represented — never sum or reconcile into net sales or the order discount total',
        },
      })
    }
    for (const c of wb.couponTypes) {
      if (!c?.value) continue
      rows.push({
        ...acct,
        breakdown_type: 'coupon_type',
        breakdown_value: c.value, // percent | fixed_cart | fixed_product | UNKNOWN (older WC omits discount_type)
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: c.orders,
        conversion_value: c.discountAmount,
        revenue: 0,
        extra: {
          orders: c.orders,
          discountAmount: c.discountAmount,
          basis: 'coupon_lines_discount_type',
          caveat: 'the TYPE axis of the same money coupon_code carries per CODE — a subset of discounting, never summed into net sales',
        },
      })
    }

    // ORDER TIME — one row PER ORDER. entity_id = the order id so two orders placed in the same second cannot
    // collide on the 7-col key and silently overwrite each other. ADDITIVE: revenue is the order's net on the
    // account basis, so Σ order_time ≡ account net for the day.
    //
    // THE DAY KEY IS UNCHANGED AND MUST STAY UNCHANGED. `date` is still captureDate — the site-local day the
    // backfill buckets by (woocommerce-backfill.ts date_created.slice(0,10)) and the window day forward capture
    // keys off. The UTC instant lands in breakdown_value only. A late-evening site-local order can therefore
    // carry a UTC timestamp on the NEXT calendar day; that is correct and expected. Re-keying the day to GMT
    // would shift rows across midnight and break both byte-identity with forward capture and the idempotency
    // of 7.5 years of already-captured history.
    for (const o of wb.orderTimes) {
      if (!o?.orderId || !o?.createdAtUtc) continue // no fabricated timestamp, ever
      rows.push({
        client_id: clientId,
        user_email: userEmail,
        platform: 'woocommerce',
        account_id: storeUrl,
        entity_level: 'account',
        entity_id: o.orderId,
        entity_name: storeUrl,
        parent_entity_id: storeUrl,
        date: captureDate, // the SITE-LOCAL capture day — deliberately NOT re-derived from the UTC stamp
        breakdown_type: 'order_time',
        breakdown_value: o.createdAtUtc,
        revenue: o.netRevenue,
        conversions: 1, // exactly one order per row
        extra: {
          orderId: o.orderId,
          createdAtGmtRaw: o.rawGmt,          // verbatim vendor string, offset-less
          createdAtSiteLocalRaw: o.rawSiteLocal, // verbatim vendor string, site-local, offset UNSTATED by Woo
          netRevenue: o.netRevenue,
          netBasis: 'woo_total_incl_shipping_tax_refundNetted',
          tzBasis: o.gmtAvailable ? 'woo_date_created_gmt_UTC' : 'woo_date_created_SITE_LOCAL_no_gmt_field',
          caveat: o.gmtAvailable
            ? 'value is the RAW UTC instant to the second (Z appended by us because Woo omits the offset); bucket to an hour ONLY at read time against the client timezone. The row date is the SITE-LOCAL capture day and may differ from the UTC day.'
            : 'this store returned no date_created_gmt — the value is SITE-LOCAL against an offset Woo does not state, and must NOT be read as UTC',
        },
      })
    }
  }

  // ── LORAMER_WOO_BATCH_WB_V1 — PRODUCT CATEGORY + TAG ─────────────────────────────────────────────────
  // The only two Woo families sourced from a SECOND endpoint. `undefined` means no attribute cache was
  // supplied for this capture (forward without the fetch, or an older cached intel shape) and MUST emit
  // nothing — silence, not zeros. `[]` means we DID ask and the store has none, which also emits nothing but
  // for the opposite reason; the distinction is preserved upstream and matters when reading coverage.
  //
  // NON-ADDITIVE, and the over-count is the whole shape of the family: a product sits in MANY categories, so
  // its net is added under every one of them. Σ product_category EXCEEDS the day's net sales. A row answers
  // "how much revenue touched this category", never "what share of the day was this category".
  const attrCapturedAt = data.wooProductAttrsCapturedAt ?? null
  const attrFamilies: [string, { value: string; netRevenue: number; units: number; products: number }[] | undefined][] = [
    ['product_category', data.wooProductCategoryCapture],
    ['product_tag', data.wooProductTagCapture],
  ]
  for (const [bt, list] of attrFamilies) {
    for (const a of list || []) {
      if (!a?.value) continue
      rows.push({
        client_id: clientId,
        user_email: userEmail,
        platform: 'woocommerce',
        account_id: storeUrl,
        entity_level: 'account',
        entity_id: storeUrl,
        entity_name: storeUrl,
        parent_entity_id: storeUrl,
        date: captureDate,
        breakdown_type: bt,
        breakdown_value: a.value,
        revenue: a.netRevenue,
        conversions: a.units,
        extra: {
          units: a.units,
          products: a.products,
          netBasis: 'woo_total_incl_shipping_tax_refundNetted_perline_prorata',
          semantics: 'CAPTURE_TIME_SNAPSHOT',
          captured_at: attrCapturedAt,
          caveat: `a product belongs to MANY ${bt === 'product_category' ? 'categories' : 'tags'}, so its full net is counted under each — Σ ${bt} EXCEEDS net sales and must never be summed or reconciled. Membership is what the store says TODAY, not as of the order date.`,
        },
      })
    }
  }

  return rows
}
