#!/usr/bin/env python3
"""
WooCommerce intelligence wire-up v2.

Only difference from v1: corrected anchor for shopifyConn lookup.
Real code uses `connections.find(...)`, not `connections?.find(...)`.

Idempotent: if v1 partially succeeded, this picks up where it left off
by checking each anchor independently before applying.

Usage: python3 woo_intelligence_v2.py
"""
import os
import sys

PROJECT = os.path.expanduser("~/Downloads/cotemedia-ads-manager")

WOO_LIB = os.path.join(PROJECT, "src/lib/intelligence/woocommerce-intelligence.ts")
TYPES = os.path.join(PROJECT, "src/lib/intelligence/intelligence-types.ts")
INTEL_ROUTE = os.path.join(PROJECT, "src/app/api/intelligence/route.ts")
DAILY_ROUTE = os.path.join(PROJECT, "src/app/api/woocommerce/daily/route.ts")
CTX = os.path.join(PROJECT, "src/lib/intelligence/build-claude-context.ts")

MARKER = "LORAMER_WOO_INTEL_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# All replacement content is identical to v1 EXCEPT INTEL_OLD_2.
# Re-pasting for self-contained script.

WOO_LIB_CONTENT = '''// LORAMER_WOO_INTEL_V1
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

  const base = storeUrl.replace(/\\/+$/, '') + '/wp-json/wc/v3'
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
'''

TYPES_OLD = (
    "  shopify?: IntelligenceShopify\n"
    "\n"
    "  // Future platforms plug in here:"
)
TYPES_NEW = (
    "  shopify?: IntelligenceShopify\n"
    "  woocommerce?: IntelligenceShopify  // LORAMER_WOO_INTEL_V1 - same shape as Shopify\n"
    "\n"
    "  // Future platforms plug in here:"
)

INTEL_OLD_1 = "import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'"
INTEL_NEW_1 = (
    "import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'\n"
    "import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'  // LORAMER_WOO_INTEL_V1"
)

# FIXED: no optional chaining
INTEL_OLD_2 = "  const shopifyConn = connections.find(c => c.platform === 'shopify')"
INTEL_NEW_2 = (
    "  const shopifyConn = connections.find(c => c.platform === 'shopify')\n"
    "  const wooConn = connections.find(c => c.platform === 'woocommerce')  // LORAMER_WOO_INTEL_V1"
)

INTEL_OLD_3 = (
    "    shopifyConn\n"
    "      ? getValidShopifyToken(session.user.email, shopifyConn.account_id).then(tokenResult => {\n"
    "          if (!tokenResult.ok) {\n"
    "            throw new Error(`Shopify token unavailable: ${tokenResult.reason}${tokenResult.detail ? ' - ' + tokenResult.detail : ''}`)\n"
    "          }\n"
    "          return fetchShopifyIntelligence(\n"
    "            tokenResult.accessToken,\n"
    "            shopifyConn.account_id,\n"
    "            dateRange,\n"
    "            customStart,\n"
    "            customEnd\n"
    "          )\n"
    "        })\n"
    "      : Promise.resolve(null),\n"
    "  ])"
)
INTEL_NEW_3 = (
    "    shopifyConn\n"
    "      ? getValidShopifyToken(session.user.email, shopifyConn.account_id).then(tokenResult => {\n"
    "          if (!tokenResult.ok) {\n"
    "            throw new Error(`Shopify token unavailable: ${tokenResult.reason}${tokenResult.detail ? ' - ' + tokenResult.detail : ''}`)\n"
    "          }\n"
    "          return fetchShopifyIntelligence(\n"
    "            tokenResult.accessToken,\n"
    "            shopifyConn.account_id,\n"
    "            dateRange,\n"
    "            customStart,\n"
    "            customEnd\n"
    "          )\n"
    "        })\n"
    "      : Promise.resolve(null),\n"
    "    // LORAMER_WOO_INTEL_V1 - WooCommerce\n"
    "    wooConn\n"
    "      ? supabaseAdmin\n"
    "          .from('woocommerce_tokens')\n"
    "          .select('store_url, consumer_key, consumer_secret')\n"
    "          .eq('user_email', session.user.email)\n"
    "          .eq('client_id', wooConn.client_id)\n"
    "          .single()\n"
    "          .then(({ data: tok }) => {\n"
    "            if (!tok?.consumer_key || !tok?.consumer_secret || !tok?.store_url) {\n"
    "              throw new Error('No WooCommerce credentials found')\n"
    "            }\n"
    "            return fetchWooCommerceIntelligence(\n"
    "              tok.store_url,\n"
    "              tok.consumer_key,\n"
    "              tok.consumer_secret,\n"
    "              dateRange,\n"
    "              customStart,\n"
    "              customEnd\n"
    "            )\n"
    "          })\n"
    "      : Promise.resolve(null),\n"
    "  ])"
)

INTEL_OLD_4 = (
    "  if (shopifyResult.status === 'fulfilled' && shopifyResult.value) {\n"
    "    intelligence.shopify = shopifyResult.value\n"
    "  } else if (shopifyConn) {\n"
    "    console.error('Shopify intelligence failed:', shopifyResult.status === 'rejected' ? shopifyResult.reason?.message : 'unknown')\n"
    "    intelligence.shopify = { connected: false }\n"
    "  }"
)
INTEL_NEW_4 = (
    "  if (shopifyResult.status === 'fulfilled' && shopifyResult.value) {\n"
    "    intelligence.shopify = shopifyResult.value\n"
    "  } else if (shopifyConn) {\n"
    "    console.error('Shopify intelligence failed:', shopifyResult.status === 'rejected' ? shopifyResult.reason?.message : 'unknown')\n"
    "    intelligence.shopify = { connected: false }\n"
    "  }\n"
    "  // LORAMER_WOO_INTEL_V1\n"
    "  if (wooResult.status === 'fulfilled' && wooResult.value) {\n"
    "    intelligence.woocommerce = wooResult.value\n"
    "  } else if (wooConn) {\n"
    "    console.error('WooCommerce intelligence failed:', wooResult.status === 'rejected' ? wooResult.reason?.message : 'unknown')\n"
    "    intelligence.woocommerce = { connected: false }\n"
    "  }"
)

INTEL_OLD_5 = "  const [googleResult, metaResult, shopifyResult] = await Promise.allSettled(["
INTEL_NEW_5 = "  const [googleResult, metaResult, shopifyResult, wooResult] = await Promise.allSettled(["


DAILY_CONTENT = '''// LORAMER_WOO_INTEL_V1
// /api/woocommerce/daily - daily orders/revenue/AOV for the dashboard chart
// Matches the shape returned by /api/shopify/daily so the dashboard renders
// the same chart without modification.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

function basicAuth(k: string, s: string): string {
  return 'Basic ' + Buffer.from(k + ':' + s).toString('base64')
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  const { data: tok } = await supabaseAdmin
    .from('woocommerce_tokens')
    .select('store_url, consumer_key, consumer_secret')
    .eq('user_email', session.user.email)
    .eq('client_id', clientId)
    .single()

  if (!tok?.consumer_key || !tok?.consumer_secret || !tok?.store_url) {
    return NextResponse.json({ error: 'No WooCommerce credentials' }, { status: 404 })
  }

  const end = customEnd || new Date().toISOString().split('T')[0]
  const start =
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

  const base = tok.store_url.replace(/\\/+$/, '') + '/wp-json/wc/v3'
  const headers = {
    Authorization: basicAuth(tok.consumer_key, tok.consumer_secret),
    Accept: 'application/json',
  }

  const after = start + 'T00:00:00'
  const before = end + 'T23:59:59'

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
      if (!res.ok) break
      const orders = await res.json()
      if (!Array.isArray(orders) || orders.length === 0) break
      allOrders = allOrders.concat(orders)
      if (orders.length < 100) break
    }

    const byDate: Record<string, { date: string; orders: number; revenue: number; avgOrderValue: number }> = {}
    const startD = new Date(start)
    const endD = new Date(end)
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0]
      byDate[key] = { date: key.slice(5), orders: 0, revenue: 0, avgOrderValue: 0 }
    }

    allOrders.forEach((order: any) => {
      const key = (order.date_created || '').split('T')[0]
      if (byDate[key]) {
        byDate[key].orders += 1
        byDate[key].revenue += parseFloat(order.total || '0')
      }
    })

    Object.values(byDate).forEach(d => {
      d.avgOrderValue = d.orders > 0 ? d.revenue / d.orders : 0
      d.revenue = parseFloat(d.revenue.toFixed(2))
      d.avgOrderValue = parseFloat(d.avgOrderValue.toFixed(2))
    })

    const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
    return NextResponse.json({ daily })
  } catch (e: any) {
    console.error('WooCommerce daily error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
'''


CTX_INJECT_AFTER_LINE = "  if (intelligence.shopify?.connected) {"


def patch_claude_context(text: str) -> tuple[str, bool]:
    start_idx = text.find(CTX_INJECT_AFTER_LINE)
    if start_idx == -1:
        return text, False
    open_braces = 0
    i = start_idx
    while i < len(text):
        ch = text[i]
        if ch == '{':
            open_braces += 1
        elif ch == '}':
            open_braces -= 1
            if open_braces == 0:
                nl = text.find('\n', i)
                if nl == -1:
                    return text, False
                woo_block = '''

  // LORAMER_WOO_INTEL_V1
  if (intelligence.woocommerce?.connected) {
    const w = intelligence.woocommerce
    sections.push(
      '## WOOCOMMERCE STORE\\n' +
      'Total orders: ' + (w.totalOrders || 0) + '\\n' +
      'Total revenue: $' + (w.totalRevenue?.toFixed(2) || '0.00') + '\\n' +
      'Avg order value: $' + (w.avgOrderValue?.toFixed(2) || '0.00') + '\\n' +
      'New customers: ' + (w.newCustomers || 0) + '\\n' +
      'Returning customers: ' + (w.returningCustomers || 0) + '\\n' +
      (w.topProducts && w.topProducts.length
        ? 'Top products: ' + w.topProducts.slice(0, 5).map(p => p.name + ' ($' + p.revenue.toFixed(0) + ')').join(', ')
        : '')
    )
  }'''
                return text[: nl + 1] + woo_block + text[nl + 1:], True
        i += 1
    return text, False


def safe_replace(text, old, new, label):
    if MARKER in text and ("LORAMER_WOO_INTEL_V1" in new or "woocommerce" in new.lower()):
        # Already done at some prior partial run. Check whether `new` is in text.
        if new in text:
            print(f"skip: {label} already applied")
            return text
    c = text.count(old)
    if c == 0:
        # Maybe already applied (new is in there)
        if new in text:
            print(f"skip: {label} already applied")
            return text
        fatal(f"anchor missing: {label}")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1: {label}")
    print(f"ok: applying {label}")
    return text.replace(old, new, 1)


def main():
    for p in (TYPES, INTEL_ROUTE, CTX):
        if not os.path.exists(p):
            fatal(f"required file missing: {p}")

    # ── Types ──
    types_text = open(TYPES).read()
    types_text = safe_replace(types_text, TYPES_OLD, TYPES_NEW, "types: add woocommerce field")
    with open(TYPES, "w") as f:
        f.write(types_text)

    # ── Intel route ──
    t = open(INTEL_ROUTE).read()
    t = safe_replace(t, INTEL_OLD_1, INTEL_NEW_1, "intel: import")
    t = safe_replace(t, INTEL_OLD_2, INTEL_NEW_2, "intel: wooConn lookup")
    t = safe_replace(t, INTEL_OLD_5, INTEL_NEW_5, "intel: destructure adds wooResult")
    t = safe_replace(t, INTEL_OLD_3, INTEL_NEW_3, "intel: Promise.allSettled adds Woo fetch")
    t = safe_replace(t, INTEL_OLD_4, INTEL_NEW_4, "intel: result handling for Woo")
    with open(INTEL_ROUTE, "w") as f:
        f.write(t)

    # ── Lib file ──
    if os.path.exists(WOO_LIB):
        existing = open(WOO_LIB).read()
        if MARKER not in existing:
            fatal(f"{WOO_LIB} exists without marker, refusing to overwrite")
        print("skip: woocommerce-intelligence.ts already in place")
    else:
        os.makedirs(os.path.dirname(WOO_LIB), exist_ok=True)
        with open(WOO_LIB, "w") as f:
            f.write(WOO_LIB_CONTENT)
        print("ok: created woocommerce-intelligence.ts")

    # ── Daily route ──
    if os.path.exists(DAILY_ROUTE):
        existing = open(DAILY_ROUTE).read()
        if MARKER not in existing:
            fatal(f"{DAILY_ROUTE} exists without marker, refusing to overwrite")
        print("skip: woocommerce daily route already in place")
    else:
        os.makedirs(os.path.dirname(DAILY_ROUTE), exist_ok=True)
        with open(DAILY_ROUTE, "w") as f:
            f.write(DAILY_CONTENT)
        print("ok: created /api/woocommerce/daily/route.ts")

    # ── Claude context ──
    ctx_text = open(CTX).read()
    if MARKER in ctx_text:
        print("skip: build-claude-context.ts already patched")
    else:
        new_ctx, ok = patch_claude_context(ctx_text)
        if ok:
            with open(CTX, "w") as f:
                f.write(new_ctx)
            print("ok: build-claude-context.ts patched")
        else:
            print("warn: could not auto-patch build-claude-context.ts")
            print("      Data still flows to dashboard. Tell Claude to fix the")
            print("      Claude-context patch separately.")

    print()
    print("=" * 50)
    print("WooCommerce intelligence wired up. Dashboard tab is next.")
    print("=" * 50)


if __name__ == "__main__":
    main()
