// LORAMER_WOO_INTEL_V1
// WooCommerce Intelligence Adapter
// Mirrors fetchShopifyIntelligence: same output shape (IntelligenceShopify)
// so the dashboard and Claude can treat both ecommerce platforms identically.
import type { IntelligenceShopify } from './intelligence-types'

function basicAuth(consumerKey: string, consumerSecret: string): string {
  return 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64')
}

function resolveDateRange(dateRange: string, customStart?: string, customEnd?: string) {
  const endDate = customEnd || new Date().toISOString().split('T')[0]
  const startDate =
    customStart ||
    (() => {
      const d = new Date()
      const days: Record<string, number> = {
        LAST_7_DAYS: 7,
        LAST_14_DAYS: 14,
        LAST_30_DAYS: 30,
        THIS_MONTH: new Date().getDate(),
        LAST_MONTH: 60,
        LAST_90_DAYS: 90,
      }
      d.setDate(d.getDate() - (days[dateRange] || 30))
      return d.toISOString().split('T')[0]
    })()
  return { startDate, endDate }
}

export async function fetchWooCommerceIntelligence(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<IntelligenceShopify> {
  const { startDate, endDate } = resolveDateRange(dateRange, customStart, customEnd)

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

    const totalOrders = allOrders.length
    const totalRevenue = allOrders.reduce(
      (s: number, o: any) => s + parseFloat(o.total || '0'),
      0
    )
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    const orderCountByCustomer: Record<string, number> = {}
    allOrders.forEach((o: any) => {
      const cid = String(o.customer_id || 'guest_' + o.id)
      orderCountByCustomer[cid] = (orderCountByCustomer[cid] || 0) + 1
    })
    let newCustomers = 0
    let returningCustomers = 0
    allOrders.forEach((o: any) => {
      const cid = String(o.customer_id || 'guest_' + o.id)
      if (orderCountByCustomer[cid] === 1) newCustomers++
      else returningCustomers++
    })

    const productSales: Record<string, { name: string; revenue: number; units: number }> = {}
    allOrders.forEach((o: any) => {
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
