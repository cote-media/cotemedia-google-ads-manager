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
import { supabaseAdmin } from '@/lib/supabase' // LORAMER_WOO_CAPTURED_E1_V1 — captured-read path
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

// LORAMER_ECOM_MONEY_SURFACE_V1 (T1.6) — Woo full-order money split beyond NET, per-day ACCOUNT grain, from
// fields ALREADY in every REST order payload (no fetch change). Cited from the WooCommerce REST v2 Orders
// schema: total("Grand total, including tax") · total_tax("Sum of all taxes") · shipping_total · shipping_tax ·
// discount_total · discount_tax · cart_tax("Sum of line item taxes only") · line_items.subtotal("excl tax,
// before discounts") · fee_lines.total · refunds.total("incl tax", negative). Woo core has NO native tip field
// → tips, when a store collects them, ride fee_lines (captured as `fees`, a proxy, NOT asserted to BE tips).
// NULL-vs-ZERO (false zeros/lows worse than absence): each component is summed ONLY from present amounts — a
// present "0.00" is a TRUE zero; if ANY sale order is missing a component, that component is null (+loud warn),
// never a false partial-zero. residual = the composed-identity gap (transparency on the on-sale-markdown /
// order-edit difference between Σ(subtotal−total) and coupon-only discount_total); null if any input is null.
// Additive-only: does NOT change account revenue (netSales here == the existing wooNetOf sum, proven byte-identical).
export function buildWooMoneySurface(saleOrders: any[]): NonNullable<IntelligenceShopify['money']> {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const num = (s: any): number | undefined => (s === undefined || s === null ? undefined : parseFloat(s))
  const lineSubtotal = (o: any) => ((o.line_items as any[]) || []).reduce((s, li) => s + parseFloat(li.subtotal || '0'), 0)
  const feesTotal = (o: any) => ((o.fee_lines as any[]) || []).reduce((s, f) => s + parseFloat(f.total || '0'), 0)
  const refundsTotal = (o: any) => ((o.refunds as any[]) || []).reduce((s, rf) => s + parseFloat(rf.total || '0'), 0)
  const sumC = (pick: (o: any) => number | undefined, label: string): number | null => {
    let s = 0
    let absent = false
    for (const o of saleOrders) {
      const v = pick(o)
      if (v === undefined || Number.isNaN(v)) { absent = true; console.warn(`[woo-money] ABSENT/NaN ${label} on order ${o?.id}`); continue }
      s += v
    }
    return absent ? null : r2(s)
  }
  const netSales = sumC((o) => wooNetOf(o), 'wooNetOf')
  const grossSales = sumC((o) => lineSubtotal(o), 'line.subtotal')
  const discounts = sumC((o) => num(o.discount_total), 'discount_total')
  const discountTax = sumC((o) => num(o.discount_tax), 'discount_tax')
  const taxes = sumC((o) => num(o.total_tax), 'total_tax')
  const cartTax = sumC((o) => num(o.cart_tax), 'cart_tax')
  const shipping = sumC((o) => num(o.shipping_total), 'shipping_total')
  const shippingTax = sumC((o) => num(o.shipping_tax), 'shipping_tax')
  const fees = sumC((o) => feesTotal(o), 'fee_lines.total')
  const totalSales = sumC((o) => num(o.total), 'total')
  const refunds = sumC((o) => refundsTotal(o), 'refunds.total')
  // residual = totalSales − [(gross − discounts) + shipping + fees + total_tax]; null if any input null (shipping_tax
  // is NOT added — it is already inside total_tax; on clean data residual ≈ 0, real stores show the markdown gap).
  const inputs = [totalSales, grossSales, discounts, shipping, fees, taxes]
  const residual = inputs.some((p) => p === null)
    ? null
    : r2((totalSales as number) - (((grossSales as number) - (discounts as number)) + (shipping as number) + (fees as number) + (taxes as number)))
  return { netSales, grossSales, discounts, discountTax, taxes, cartTax, shipping, shippingTax, fees, totalSales, refunds, residual, moneyBasis: 'woo_total_incl_shipping_tax_refundNetted' }
}

// ── LORAMER_WOO_BATCH_WA_V1 — WOO BREADTH: NINE FAMILIES, ZERO NEW VENDOR REQUESTS ─────────────────────
// Every field below is ALREADY in the /wc/v3/orders payload we download today and then throw away. Measured
// live on shelleykyle.com 2026-07-19: one order is 8,935 bytes and we were reading about six fields of it.
// So this is a pure read-more-of-what-we-have change — no second endpoint, no extra load on the merchant's
// WordPress server, and nothing new for the throttle / adaptive ladder / circuit-breaker to guard.
//
// TWO ORDER SETS, DELIBERATELY. saleOrders is the anchor set (WOO_SALE_STATUSES, refund-netted) that every
// partitioning family must sum to. allOrders is the status=any set we ALSO already fetch — order_status is
// the one family that must see it, because failed/cancelled/pending orders are real demand that is currently
// written NOWHERE. allOrders defaults to saleOrders so a caller that does not have the wider set degrades to
// sale-statuses-only rather than crashing or fabricating.
//
// PII LOCK (tighter than the vendor gives us): billing carries email, phone, first_name, last_name, company,
// address_1 and address_2, and we read NONE of them. country / state / city only. Postcode is deliberately
// excluded too — at a small store's order volume a postcode is close to identifying and it buys nothing over
// city. That is a judgment and it is stated on its face rather than buried.
function r2(n: number): number {
  return Math.round(n * 100) / 100
}
const UNK = 'UNKNOWN'
function cleanStr(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s.length > 0 ? s : null
}

export function buildWooBreadth(saleOrders: any[], allOrders: any[]): NonNullable<IntelligenceShopify['wooBreadth']> {
  // Accumulators. Every partitioning family keys on a bucket that EVERY sale order lands in (UNKNOWN
  // included) — dropping an unbucketable order would silently shrink a total that is supposed to reconcile,
  // which is the sales_channel rule and the reason geo reconciles at all.
  const country: Record<string, { netRevenue: number; orders: number }> = {}
  const region: Record<string, { netRevenue: number; orders: number }> = {}
  const city: Record<string, { netRevenue: number; orders: number }> = {}
  const payment: Record<string, { slug: string | null; netRevenue: number; orders: number }> = {}
  const shipMethod: Record<string, { methodId: string | null; shippingCharge: number; orders: number }> = {}
  const couponCode: Record<string, { discountAmount: number; discountTax: number; orders: number }> = {}
  const couponType: Record<string, { discountAmount: number; orders: number }> = {}
  const orderTimes: NonNullable<IntelligenceShopify['wooBreadth']>['orderTimes'] = []

  for (const o of saleOrders) {
    const net = wooNetOf(o)

    // ── GEO (billing basis) ──────────────────────────────────────────────────────────────────────────
    // BILLING, not shipping: shipping is legitimately empty for digital goods, virtual products and local
    // pickup, so a shipping basis would push those orders into UNKNOWN for no reason. Billing is collected
    // at every checkout. Composite values mirror the Shopify geo ladder so the three rungs read as one
    // hierarchy and a bare "Springfield" is never ambiguous.
    const cc = cleanStr(o.billing?.country) ?? UNK
    const st = cleanStr(o.billing?.state) ?? UNK
    const ct = cleanStr(o.billing?.city) ?? UNK
    const rKey = `${cc}-${st}`
    const cKey = `${cc}-${st}-${ct}`
    if (!country[cc]) country[cc] = { netRevenue: 0, orders: 0 }
    country[cc].netRevenue += net; country[cc].orders += 1
    if (!region[rKey]) region[rKey] = { netRevenue: 0, orders: 0 }
    region[rKey].netRevenue += net; region[rKey].orders += 1
    if (!city[cKey]) city[cKey] = { netRevenue: 0, orders: 0 }
    city[cKey].netRevenue += net; city[cKey].orders += 1

    // ── PAYMENT METHOD ───────────────────────────────────────────────────────────────────────────────
    // breakdown_value = the human title the merchant sees; the STABLE slug rides extra. payment_method_title
    // is merchant-editable free text ("Credit Card (Stripe)" → "Card") and will drift across a rename;
    // payment_method is the gateway slug and is the join key that survives it.
    const payTitle = cleanStr(o.payment_method_title) ?? cleanStr(o.payment_method) ?? UNK
    if (!payment[payTitle]) payment[payTitle] = { slug: cleanStr(o.payment_method), netRevenue: 0, orders: 0 }
    payment[payTitle].netRevenue += net; payment[payTitle].orders += 1

    // ── SHIPPING METHOD ──────────────────────────────────────────────────────────────────────────────
    // shipping_lines is an ARRAY — a split shipment produces several lines on ONE order (measured: 3 distinct
    // methods across 5 recent orders on the probe store). So the money here is the shipping CHARGE for that
    // method, NEVER the order net: attributing net would count the same order under every method it used.
    // An order is counted ONCE per distinct method even if that method appears on two lines.
    const linesByMethod: Record<string, { methodId: string | null; charge: number }> = {}
    for (const sl of (o.shipping_lines as any[]) || []) {
      const title = cleanStr(sl?.method_title) ?? cleanStr(sl?.method_id) ?? UNK
      if (!linesByMethod[title]) linesByMethod[title] = { methodId: cleanStr(sl?.method_id), charge: 0 }
      linesByMethod[title].charge += parseFloat(sl?.total || '0')
    }
    for (const [title, v] of Object.entries(linesByMethod)) {
      if (!shipMethod[title]) shipMethod[title] = { methodId: v.methodId, shippingCharge: 0, orders: 0 }
      shipMethod[title].shippingCharge += v.charge
      shipMethod[title].orders += 1
    }

    // ── COUPONS (code + type) ────────────────────────────────────────────────────────────────────────
    // MEASURED on the probe store: coupon_lines carries MORE than the published docs list — code, discount,
    // discount_tax, discount_type, free_shipping, nominal_amount. discount_type is what makes coupon_type a
    // free second family off the same array (percent / fixed_cart / fixed_product).
    // NOT the Reports API: /reports/coupons/totals takes NO date parameter, breaks down by discount TYPE not
    // by CODE, counts coupon DEFINITIONS rather than redemptions, and is transient-cached for a YEAR
    // (verified in the WC_REST_Report_Coupons_Totals_Controller source). It cannot answer a per-day question.
    // No coupon on an order → NO row. Absence of a coupon is not a bucket: this family is a subset of
    // discounting, not a partition of it, so an "UNKNOWN" bucket would imply a completeness it does not have.
    const seenTypes = new Set<string>()
    for (const cl of (o.coupon_lines as any[]) || []) {
      const code = cleanStr(cl?.code)
      if (!code) continue
      const amt = parseFloat(cl?.discount || '0')
      const tax = parseFloat(cl?.discount_tax || '0')
      if (!couponCode[code]) couponCode[code] = { discountAmount: 0, discountTax: 0, orders: 0 }
      couponCode[code].discountAmount += amt
      couponCode[code].discountTax += Number.isFinite(tax) ? tax : 0
      couponCode[code].orders += 1
      const ctype = cleanStr(cl?.discount_type) ?? UNK // older WC omits it — labelled, never guessed
      if (!couponType[ctype]) couponType[ctype] = { discountAmount: 0, orders: 0 }
      couponType[ctype].discountAmount += amt
      if (!seenTypes.has(ctype)) { couponType[ctype].orders += 1; seenTypes.add(ctype) } // once per order per type
    }

    // ── ORDER TIME ───────────────────────────────────────────────────────────────────────────────────
    // RAW timestamp, NO write-time bucketing — the S-FILL#7 pattern. Bucketing to an hour here would bake a
    // timezone into history and re-answering "what sold at 3am THEIR time" would need a full recapture; a raw
    // instant re-buckets for free under any later client-timezone model.
    //
    // WOO-SPECIFIC, AND THE REASON THIS IS NOT A COPY OF THE SHOPIFY FAMILY: Shopify's createdAt carries its
    // offset. Woo's date_created does NOT (measured: 19 chars, no suffix) — it is SITE-LOCAL against an offset
    // the payload never states, so the string alone is unusable as an instant. date_created_gmt IS present and
    // IS the unambiguous one, so it becomes the value, with 'Z' appended when the vendor omits it purely so a
    // reader calling Date.parse() gets UTC instead of silently reinterpreting it as their own local time.
    // BOTH verbatim vendor strings ride in extra, so normalizing loses nothing and hides nothing.
    const rawGmt = cleanStr(o.date_created_gmt)
    const rawLocal = cleanStr(o.date_created)
    const stamp = rawGmt ?? rawLocal
    if (stamp) {
      orderTimes.push({
        orderId: String(o.id),
        createdAtUtc: rawGmt ? (/[Zz]|[+-]\d{2}:?\d{2}$/.test(rawGmt) ? rawGmt : rawGmt + 'Z') : (rawLocal as string),
        rawGmt,
        rawSiteLocal: rawLocal,
        gmtAvailable: rawGmt !== null, // false → the value is SITE-LOCAL and says so; never mislabelled UTC
        netRevenue: r2(net),
      })
    }
  }

  // ── ORDER STATUS — the ONE family that reads the WIDER set ───────────────────────────────────────────
  // We already fetch status=any and then discard everything outside WOO_SALE_STATUSES, so failed / cancelled /
  // pending / on-hold orders are demand the platform has never written anywhere (measured: 1 of 5 recent
  // orders on the probe store is `failed`).
  //
  // WHY WRITE-ONLY AND NOT FLAG-NOT-BLOCK, spelled out because the subset is so tempting: the sale-status
  // subset {completed, processing, refunded} partitions account net EXACTLY and WOULD reconcile. But this
  // family is all statuses, which is a SUPERSET of the anchor, and the reconcile-posture law tests whether a
  // grain PARTITIONS the anchor — a superset does not. Shipping it as two families (one reconciling, one not)
  // would let them drift apart; shipping only the sale subset would throw away the failed orders, which is the
  // whole reason to build it. So: ONE family, additive:false, with isSale labelling the subset that ties.
  // ONE MONEY BASIS THROUGHOUT: wooNetOf applied to every order regardless of status. Mixing net for sales
  // with gross for non-sales would put two different quantities in the same summable column.
  const status: Record<string, { orderValue: number; orders: number; isSale: boolean }> = {}
  for (const o of allOrders) {
    const s = String(o.status || '').toLowerCase().trim() || UNK
    if (!status[s]) status[s] = { orderValue: 0, orders: 0, isSale: WOO_SALE_STATUSES.has(s) }
    status[s].orderValue += wooNetOf(o)
    status[s].orders += 1
  }

  return {
    geoCountries: Object.entries(country).map(([value, v]) => ({ value, netRevenue: r2(v.netRevenue), orders: v.orders })),
    geoRegions: Object.entries(region).map(([value, v]) => ({ value, netRevenue: r2(v.netRevenue), orders: v.orders })),
    geoCities: Object.entries(city).map(([value, v]) => ({ value, netRevenue: r2(v.netRevenue), orders: v.orders })),
    paymentMethods: Object.entries(payment).map(([value, v]) => ({ value, slug: v.slug, netRevenue: r2(v.netRevenue), orders: v.orders })),
    orderStatuses: Object.entries(status).map(([value, v]) => ({ value, orderValue: r2(v.orderValue), orders: v.orders, isSale: v.isSale })),
    shippingMethods: Object.entries(shipMethod).map(([value, v]) => ({ value, methodId: v.methodId, shippingCharge: r2(v.shippingCharge), orders: v.orders })),
    couponCodes: Object.entries(couponCode).map(([value, v]) => ({ value, discountAmount: r2(v.discountAmount), discountTax: r2(v.discountTax), orders: v.orders })),
    couponTypes: Object.entries(couponType).map(([value, v]) => ({ value, discountAmount: r2(v.discountAmount), orders: v.orders })),
    orderTimes,
  }
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
  maxPages = 10,
  throttleMs = 0 // LORAMER_WOO_BACKFILL_SAFE_V1 — backfill passes a delay between pages (gentle on a live store); forward leaves 0
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
    if (throttleMs > 0 && page > 1) await new Promise((r) => setTimeout(r, throttleMs)) // gentle: space pages
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
// LORAMER_WOO_BATCH_WA_V1 — `allOrders` is the status=any set the SAME fetch already returned. It exists for
// exactly one family (order_status, which must see the failed/cancelled/pending orders the sale filter drops)
// and DEFAULTS to saleOrders, so every existing caller keeps byte-identical behaviour on the other eight
// families and a caller without the wider set degrades to sale-statuses-only rather than fabricating.
export function summarizeWooOrders(saleOrders: any[], allOrders?: any[]): IntelligenceShopify {
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
  // topProducts = GROSS display list, top-10 (UNCHANGED — display only, mirrors Phase 1).
  const topProducts = Object.entries(productSales)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  // LORAMER_WOO_PRODUCT_REFUND_NET_FIX1B_V1 — productsCapture (the metrics_daily WRITER source) is
  // REFUND-NETTED so Σ(productsCapture.netRevenue) ≡ account NET (Σ wooNetOf), $0.00 residual.
  // Woo exposes ONLY order-level refund totals (refunds[].total, negative; no per-line detail), so we
  // distribute each order's FULL net — wooNetOf(o) = o.total (incl shipping/tax) + refunds — across its
  // product lines PRO-RATA by gross line share. Per order Σ line-net ≡ wooNetOf(o) by construction
  // (Σ share = 1), so store-wide Σ reconciles to the account grain exactly. Basing the share on the
  // ORDER net (not line gross + refund) is what absorbs shipping/tax so it reconciles to the wooNetOf
  // account basis; grossRevenue + units stay an unreconciled order-side axis (mirrors Shopify Flight 1).
  const fin = (n: number) => (Number.isFinite(n) ? n : 0)
  const prodCap: Record<string, { name: string; netRevenue: number; grossRevenue: number; units: number }> = {}
  // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain rides the SAME per-line pro-rata net as prodCap,
  // keyed by COMPOSITE `${productId}:${variationId}` (variation_id=0 = simple product → `${productId}:0`).
  const varCap: Record<string, { name: string; sku: string | null; parentProductId: string; netRevenue: number; grossRevenue: number; units: number }> = {}
  saleOrders.forEach((o: any) => {
    const items = (o.line_items || []) as any[]
    if (items.length === 0) return // no lines → nothing to attribute (order net still in account grain)
    const sumGross = fin(items.reduce((s: number, it: any) => s + parseFloat(it.total || '0'), 0))
    const orderNet = fin(wooNetOf(o)) // account-grain basis: o.total (incl shipping/tax) + negative refunds
    items.forEach((item: any) => {
      const id = String(item.product_id)
      const grossLine = fin(parseFloat(item.total || '0'))
      const share = sumGross > 0 ? grossLine / sumGross : 1 / items.length // all-$0 order → equal split
      const netContribution = fin(orderNet * share)
      if (!prodCap[id]) prodCap[id] = { name: item.name || ('product ' + id), netRevenue: 0, grossRevenue: 0, units: 0 }
      prodCap[id].netRevenue += netContribution
      prodCap[id].grossRevenue += grossLine
      prodCap[id].units += fin(Number(item.quantity || 0))
      // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain: COMPOSITE key `${productId}:${variationId}`
      // (variation_id=0 simple product → `${productId}:0`; a bare variation_id is UNSAFE — all simple products
      // share 0). Same per-line net share → Σ variant ≡ product ≡ account net (the FIX-1b invariant).
      const variationId = String(item.variation_id ?? 0)
      const varKey = `${id}:${variationId}`
      if (!varCap[varKey]) varCap[varKey] = { name: item.name || ('product ' + id), sku: item.sku ?? null, parentProductId: id, netRevenue: 0, grossRevenue: 0, units: 0 }
      varCap[varKey].netRevenue += netContribution
      varCap[varKey].grossRevenue += grossLine
      varCap[varKey].units += fin(Number(item.quantity || 0))
    })
  })
  const productsCapture = Object.entries(prodCap)
    .map(([id, v]) => ({ id, ...v, revenue: v.netRevenue })) // revenue alias = NET (writer reads .revenue)
    .sort((a, b) => b.netRevenue - a.netRevenue)

  // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant grain capture. id = composite `${productId}:${variationId}`;
  // parentProductId = product entity_id. revenue alias = NET (writer reads .revenue) → Σ variant ≡ product ≡ account.
  const variantsCapture = Object.entries(varCap)
    .map(([vid, v]) => ({ id: vid, parentProductId: v.parentProductId, name: v.name, sku: v.sku ?? undefined, units: v.units, revenue: v.netRevenue, netRevenue: v.netRevenue, grossRevenue: v.grossRevenue }))
    .sort((a, b) => b.netRevenue - a.netRevenue)

  return {
    connected: true,
    totalOrders,
    totalRevenue,
    avgOrderValue,
    newCustomers,
    returningCustomers,
    topProducts,
    productsCapture,
    variantsCapture, // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1
    money: buildWooMoneySurface(saleOrders), // LORAMER_ECOM_MONEY_SURFACE_V1 (T1.6) — full money split → account extra
    wooBreadth: buildWooBreadth(saleOrders, allOrders ?? saleOrders), // LORAMER_WOO_BATCH_WA_V1 — nine families, no new fetch
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
    // LORAMER_WOO_BATCH_WA_V1 — hand the status=any set through so order_status sees the failed/cancelled/
    // pending orders this line filters out. This ONE argument is what makes forward capture AND the catchup
    // loop (both of which enter here) carry the family — no separate wiring in either route.
    return summarizeWooOrders(saleOrders, allOrders)
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

// LORAMER_WOO_CAPTURED_E1_V1 — DASHBOARD RENDER path. Builds the SAME IntelligenceShopify shape as the
// live fetcher above, but from CAPTURED metrics_daily (account rows: revenue=NET, orders=conversions,
// AOV=extra.avgOrderValue; product rows: top-10 by revenue + extra.units). ZERO outbound store calls
// (LIVE-SOURCE PRINCIPLE). New/returning are intentionally LEFT UNSET with customerMixComingSoon=true —
// the 0-PII first-ever engine is E2; the UI renders an honest "coming soon", never a fabricated split.
// NOTE: forward/catchup capture (api/cron/sync, api/cron/catchup) + the backfill still call the LIVE
// fetchWooCommerceIntelligence above — they are the writers that POPULATE these rows.
export async function fetchWooCommerceIntelligenceCaptured(
  clientId: string,
  userEmail: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<IntelligenceShopify> {
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  try {
    // Paginate (Supabase caps a select at 1000 rows).
    const pageAll = async (level: 'account' | 'product'): Promise<any[]> => {
      const rows: any[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
          .from('metrics_daily')
          .select('date, entity_id, entity_name, revenue, conversions, extra')
          .eq('client_id', clientId)
          .eq('user_email', userEmail)
          .eq('platform', 'woocommerce')
          .eq('entity_level', level)
          .eq('breakdown_type', '')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true })
          .range(from, from + 999)
        if (error) throw new Error('metrics_daily ' + level + ' read failed: ' + error.message)
        if (!data || data.length === 0) break
        rows.push(...data)
        if (data.length < 1000) break
      }
      return rows
    }

    const accountRows = await pageAll('account')
    const totalRevenue = accountRows.reduce((s, r) => s + Number(r.revenue || 0), 0)
    const totalOrders = accountRows.reduce((s, r) => s + Number(r.conversions || 0), 0)
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    const productRows = await pageAll('product')
    const byProduct: Record<string, { id: string; name: string; revenue: number; units: number }> = {}
    productRows.forEach((r) => {
      const id = String(r.entity_id ?? r.entity_name ?? 'unknown')
      if (!byProduct[id]) byProduct[id] = { id, name: r.entity_name || ('product ' + id), revenue: 0, units: 0 }
      byProduct[id].revenue += Number(r.revenue || 0)
      byProduct[id].units += Number(r.extra?.units || 0)
    })
    const topProducts = Object.values(byProduct)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    return {
      connected: true,
      totalOrders,
      totalRevenue,
      avgOrderValue,
      topProducts,
      // New/returning intentionally UNSET — honest "coming soon" until the E2 0-PII engine ships.
      customerMixComingSoon: true,
    }
  } catch (e) {
    console.error('WooCommerce captured intelligence error:', e)
    return {
      connected: true,
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      topProducts: [],
      customerMixComingSoon: true,
    }
  }
}
