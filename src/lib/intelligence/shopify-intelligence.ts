// ─── Shopify Intelligence Adapter ─────────────────────────────────────────────
// Ready to plug in when Shopify is connected.
// Output conforms to IntelligenceShopify schema.
// This file is a template — fill in when OAuth + store URL are available.

import type { IntelligenceShopify } from './intelligence-types'

export async function fetchShopifyIntelligence(
  accessToken: string,
  shopDomain: string,   // e.g. "my-store.myshopify.com"
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<IntelligenceShopify> {
  const SHOPIFY_API = `https://${shopDomain}/admin/api/2024-01`
  const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' }

  // Build date filter
  const endDate = customEnd || new Date().toISOString().split('T')[0]
  const startDate = customStart || (() => {
    const d = new Date()
    // LORAMER_THIS_MONTH_FIX_V1 - THIS_MONTH means back to the 1st of the current month, matching /api/shopify/daily and woocommerce-intelligence
    const days: Record<string, number> = { LAST_7_DAYS: 7, LAST_14_DAYS: 14, LAST_30_DAYS: 30, THIS_MONTH: new Date().getDate(), LAST_MONTH: 60 }
    d.setDate(d.getDate() - (days[dateRange] || 30))
    return d.toISOString().split('T')[0]
  })()

  const dateQuery = `created_at_min=${startDate}T00:00:00Z&created_at_max=${endDate}T23:59:59Z`

  try {
    // Fetch orders
    const ordersRes = await fetch(`${SHOPIFY_API}/orders.json?status=any&${dateQuery}&limit=250&fields=id,total_price,financial_status,customer`, { headers })
    const ordersData = await ordersRes.json()
    const orders = ordersData.orders || []

    const totalRevenue = orders.reduce((s: number, o: any) => s + parseFloat(o.total_price || '0'), 0)
    const totalOrders = orders.length
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // Customer segmentation
    const customerIds = new Set(orders.map((o: any) => o.customer?.id).filter(Boolean))
    const newCustomers = orders.filter((o: any) => o.customer?.orders_count === 1).length
    const returningCustomers = totalOrders - newCustomers

    // Top products
    const productSales: Record<string, { name: string; revenue: number; units: number }> = {}
    const lineItemsRes = await fetch(`${SHOPIFY_API}/orders.json?status=any&${dateQuery}&limit=250&fields=line_items`, { headers })
    const lineItemsData = await lineItemsRes.json()
    ;(lineItemsData.orders || []).forEach((o: any) => {
      ;(o.line_items || []).forEach((item: any) => {
        const id = String(item.product_id)
        if (!productSales[id]) productSales[id] = { name: item.title, revenue: 0, units: 0 }
        productSales[id].revenue += parseFloat(item.price) * item.quantity
        productSales[id].units += item.quantity
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
      topProducts: [],
    }
  }
}
