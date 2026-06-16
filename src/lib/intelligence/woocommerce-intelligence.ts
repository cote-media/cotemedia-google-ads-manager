// LORAMER_WOO_INTEL_V1
// WooCommerce Intelligence Adapter
// Mirrors fetchShopifyIntelligence: same output shape (IntelligenceShopify)
// so the dashboard and Claude can treat both ecommerce platforms identically.
import { resolveDateWindow } from '@/lib/date-range'
import type { IntelligenceShopify } from './intelligence-types'

function basicAuth(consumerKey: string, consumerSecret: string): string {
  return 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64')
}

export async function fetchWooCommerceIntelligence(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<IntelligenceShopify> {
  // LORAMER_DATE_RANGE_CANONICAL_V1
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)

  const base = storeUrl.replace(/\/+$/, '') + '/wp-json/wc/v3'
  const headers = {
    Authorization: basicAuth(consumerKey, consumerSecret),
    Accept: 'application/json',
  }

  const after = startDate + 'T00:00:00'
  const before = endDate + 'T23:59:59'

  try {
    let allOrders: any[] = []
    for (let page = 1; page <= 10; page++) {
      const url =
        base +
        '/orders?per_page=100&page=' + page +
        '&after=' + encodeURIComponent(after) +
        '&before=' + encodeURIComponent(before) +
        '&status=any'
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error('WooCommerce orders fetch failed: ' + res.status + ' ' + txt.slice(0, 200))
      }
      const orders = await res.json()
      if (!Array.isArray(orders) || orders.length === 0) break
      allOrders = allOrders.concat(orders)
      if (orders.length < 100) break
    }

    // LORAMER_WOO_STATUS_ACCURACY_V1 (WS3 #7 Phase 1) — count only REAL sales. Woo's status=any
    // includes failed/cancelled/pending/on-hold/etc. (on the first real store, FAILED alone was
    // 28.5% of orders) and o.total stays GROSS. Mirror the Shopify #6 client-side rebase: filter to
    // the counted set {completed, processing, refunded} and base ALL aggregations on it; net refunds
    // via the refunds[] array (negative amounts — Woo has no total_refunded field). Refunded orders
    // STAY counted (a returned sale, net ~0), parallel to Shopify refund handling.
    const SALE_STATUSES = new Set(['completed', 'processing', 'refunded'])
    const saleOrders = allOrders.filter((o: any) => SALE_STATUSES.has(String(o.status || '').toLowerCase()))
    const netOf = (o: any): number =>
      parseFloat(o.total || '0') +
      ((o.refunds as any[]) || []).reduce((s: number, rf: any) => s + parseFloat(rf.total || '0'), 0)

    const totalOrders = saleOrders.length
    const totalRevenue = saleOrders.reduce((s: number, o: any) => s + netOf(o), 0)
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    const orderCountByCustomer: Record<string, number> = {}
    saleOrders.forEach((o: any) => {
      const cid = String(o.customer_id || 'guest_' + o.id)
      orderCountByCustomer[cid] = (orderCountByCustomer[cid] || 0) + 1
    })
    let newCustomers = 0
    let returningCustomers = 0
    saleOrders.forEach((o: any) => {
      const cid = String(o.customer_id || 'guest_' + o.id)
      if (orderCountByCustomer[cid] === 1) newCustomers++
      else returningCustomers++
    })

    const productSales: Record<string, { name: string; revenue: number; units: number }> = {}
    saleOrders.forEach((o: any) => {
      (o.line_items || []).forEach((item: any) => {
        const id = String(item.product_id)
        if (!productSales[id]) {
          productSales[id] = { name: item.name || ('product ' + id), revenue: 0, units: 0 }
        }
        productSales[id].revenue += parseFloat(item.total || '0')
        productSales[id].units += Number(item.quantity || 0)
      })
    })
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
    console.error('WooCommerce intelligence error:', e)
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
