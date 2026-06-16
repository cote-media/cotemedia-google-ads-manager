// LORAMER_WOO_INTEL_V1
// WooCommerce Intelligence Adapter
// Mirrors fetchShopifyIntelligence: same output shape (IntelligenceShopify)
// so the dashboard and Claude can treat both ecommerce platforms identically.
//
// LORAMER_WOO_STATUS_ACCURACY_V1 (WS3 #7 Phase 1) — count only REAL sales {completed, processing,
// refunded}; revenue is NET (o.total is gross; refunds[] carries negative amounts; no total_refunded
// field). The sale-status set, the refund-netting fn, the raw window fetch, and the aggregation are
// EXPORTED so the Phase-2 backfill applies byte-identical rules (LORAMER_WOO_BACKFILL_2A_V1).
import { resolveDateWindow } from '@/lib/date-range'
import type { IntelligenceShopify } from './intelligence-types'

function basicAuth(consumerKey: string, consumerSecret: string): string {
  return 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64')
}

// Counted-as-a-sale statuses (locked from Gate A on the first real store). on-hold/pending/cancelled/
// failed/trash/checkout-draft/faire-* are NOT sales. Refunded stays counted (a returned sale, net ~0).
export const WOO_SALE_STATUSES = new Set(['completed', 'processing', 'refunded'])

// NET per order: gross o.total plus the refunds[] amounts (which are NEGATIVE in Woo). No total_refunded.
export function wooNetOf(order: any): number {
  return (
    parseFloat(order.total || '0') +
    ((order.refunds as any[]) || []).reduce((s: number, rf: any) => s + parseFloat(rf.total || '0'), 0)
  )
}

// Raw window fetch (status=any) with a PARAMETRIZED page cap: forward keeps the default (10); the
// backfill passes a high cap so large windows don't truncate. Throws on a non-OK response (Lesson 15 —
// never swallow a fetch failure into empty data).
export async function fetchWooOrdersRaw(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  after: string,
  before: string,
  maxPages = 10
): Promise<any[]> {
  const base = storeUrl.replace(/\/+$/, '') + '/wp-json/wc/v3'
  const headers = {
    Authorization: basicAuth(consumerKey, consumerSecret),
    Accept: 'application/json',
  }
  // LORAMER_WOO_BACKFILL_CLAIM_V1 — per-page timeout + retry (hang resilience): the merchant's host
  // can hang a request indefinitely. Abort a page after PAGE_TIMEOUT_MS, retry a few times; if it
  // STILL fails, THROW (halt-and-surface, Lesson 15) — never silently skip a page (would gap a window).
  const PAGE_TIMEOUT_MS = 35_000
  const PAGE_RETRIES = 3
  const all: any[] = []
  for (let page = 1; page <= maxPages; page++) {
    const url =
      base +
      '/orders?per_page=100&page=' + page +
      '&after=' + encodeURIComponent(after) +
      '&before=' + encodeURIComponent(before) +
      '&status=any'
    let res: Response | undefined
    let lastErr: unknown
    for (let attempt = 1; attempt <= PAGE_RETRIES; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS)
      try {
        res = await fetch(url, { headers, signal: ctrl.signal })
        break
      } catch (e) {
        lastErr = e
        res = undefined
      } finally {
        clearTimeout(timer)
      }
    }
    if (!res) {
      throw new Error(
        'WooCommerce page fetch failed after ' + PAGE_RETRIES + ' attempts (timeout/network): ' +
        String((lastErr as any)?.message ?? lastErr)
      )
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error('WooCommerce orders fetch failed: ' + res.status + ' ' + txt.slice(0, 200))
    }
    const orders = await res.json()
    if (!Array.isArray(orders) || orders.length === 0) break
    all.push(...orders)
    if (orders.length < 100) break
  }
  return all
}

// Aggregate a set of SALE orders into the IntelligenceShopify shape. Shared by forward (per window) and
// backfill (per day) so both produce byte-identical rows. Revenue uses wooNetOf (refund-netted);
// topProducts use line-item gross (unchanged from Phase 1).
export function summarizeWooOrders(saleOrders: any[]): IntelligenceShopify {
  const totalOrders = saleOrders.length
  const totalRevenue = saleOrders.reduce((s: number, o: any) => s + wooNetOf(o), 0)
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
}

export async function fetchWooCommerceIntelligence(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string,
  opts?: { maxPages?: number } // LORAMER_WOO_BACKFILL_2A_V1 — forward defaults to 10; backfill raises it
): Promise<IntelligenceShopify> {
  // LORAMER_DATE_RANGE_CANONICAL_V1
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const after = startDate + 'T00:00:00'
  const before = endDate + 'T23:59:59'

  try {
    const allOrders = await fetchWooOrdersRaw(storeUrl, consumerKey, consumerSecret, after, before, opts?.maxPages ?? 10)
    // LORAMER_WOO_STATUS_ACCURACY_V1 — sale-only + refund-netting (see summarizeWooOrders).
    const saleOrders = allOrders.filter((o: any) => WOO_SALE_STATUSES.has(String(o.status || '').toLowerCase()))
    return summarizeWooOrders(saleOrders)
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
