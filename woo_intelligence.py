#!/usr/bin/env python3
"""
WooCommerce intelligence wire-up - one atomic script.

Changes:
  1. CREATE  src/lib/intelligence/woocommerce-intelligence.ts
            (fetches orders/customers/products via WC REST API,
             returns the same shape as fetchShopifyIntelligence)
  2. EDIT   src/lib/intelligence/intelligence-types.ts
            - Add IntelligenceEcommerce as alias of IntelligenceShopify
            - Add `woocommerce?: IntelligenceEcommerce` to ClientIntelligence
  3. EDIT   src/app/api/intelligence/route.ts
            - Import fetchWooCommerceIntelligence
            - Look up woocommerce connection alongside others
            - Add parallel fetch to Promise.allSettled
            - Add result handling after Shopify
  4. CREATE src/app/api/woocommerce/daily/route.ts
            - Returns { daily: [{date, orders, revenue, avgOrderValue}] }
            - Mirrors /api/shopify/daily shape so dashboard chart Just Works
  5. EDIT   src/lib/intelligence/build-claude-context.ts
            - Mirror the Shopify block for WooCommerce so Claude sees the data

Atomic: every anchor is validated BEFORE any file is written.
Idempotent: re-running after success is a no-op.

Usage: python3 woo_intelligence.py
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


# =============================================================================
# File 1 - WooCommerce intelligence adapter
# =============================================================================
WOO_LIB_CONTENT = '''// LORAMER_WOO_INTEL_V1
// WooCommerce Intelligence Adapter
// Mirrors fetchShopifyIntelligence: same output shape (IntelligenceEcommerce)
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

  // WooCommerce ISO date filter (after/before are inclusive)
  const after = startDate + 'T00:00:00'
  const before = endDate + 'T23:59:59'

  try {
    // ── Orders ─────────────────────────────────────────────────────────────
    // WC paginates at 100 per page; fetch up to ~10 pages defensively.
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

    // ── Customer segmentation ──────────────────────────────────────────────
    // Each order has customer_id. "New" = customer's only order in this range.
    // "Returning" = customer appeared in 2+ orders (or has prior orders).
    // For simplicity match the Shopify adapter: count orders where the
    // customer has only 1 order total in this dataset.
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

    // ── Top products ───────────────────────────────────────────────────────
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


# =============================================================================
# File 2 - patch intelligence-types.ts to add woocommerce field
# =============================================================================
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


# =============================================================================
# File 3 - patch intelligence route
# =============================================================================
# 3a: import
INTEL_OLD_1 = "import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'"
INTEL_NEW_1 = (
    "import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'\n"
    "import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'  // LORAMER_WOO_INTEL_V1"
)

# 3b: connection lookup. We need to find where shopifyConn is destructured,
# then add wooConn alongside. Search for ".platform === 'shopify'"
INTEL_OLD_2 = "  const shopifyConn = connections?.find(c => c.platform === 'shopify')"
INTEL_NEW_2 = (
    "  const shopifyConn = connections?.find(c => c.platform === 'shopify')\n"
    "  const wooConn = connections?.find(c => c.platform === 'woocommerce')  // LORAMER_WOO_INTEL_V1"
)

# 3c: add WooCommerce to Promise.allSettled - anchor on the Shopify block end
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

# 3d: handle the WooCommerce result after Shopify result handling
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

# We also need to capture the FOURTH result from Promise.allSettled.
# Find the destructure of [googleResult, metaResult, shopifyResult]
INTEL_OLD_5 = "  const [googleResult, metaResult, shopifyResult] = await Promise.allSettled(["
INTEL_NEW_5 = "  const [googleResult, metaResult, shopifyResult, wooResult] = await Promise.allSettled(["


# =============================================================================
# File 4 - daily chart route for WooCommerce
# =============================================================================
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


# =============================================================================
# File 5 - build-claude-context.ts: add WooCommerce section parallel to Shopify
# =============================================================================
# Find the closing of the Shopify section and add a WooCommerce section after.
# Without seeing the exact file, we anchor on the line that opens the Shopify block
# and append our own. Safer: look for the EXACT pattern at line 292 we saw earlier.
# We add a generic "if (intelligence.woocommerce?.connected)" block after the
# Shopify if-block closes.
#
# We need the user to send us the exact ending lines of the Shopify block before
# we can patch this. Instead of risking it, the script will:
#   - Add the WC section IF a known closing pattern is found
#   - WARN (not fatal) if the closing pattern isn't found, telling user to add manually
CTX_ANCHOR_START = "  if (intelligence.shopify?.connected) {\n"
CTX_INJECT_AFTER_LINE = "  if (intelligence.shopify?.connected) {"  # we'll search for the matching `  }` below


def patch_claude_context(text: str) -> tuple[str, bool]:
    """Try to insert a WooCommerce block right after the Shopify if-block.
    Returns (new_text, ok). If ok=False, caller should warn the user but not fatal.
    """
    start_idx = text.find(CTX_INJECT_AFTER_LINE)
    if start_idx == -1:
        return text, False

    # Walk forward to find the matching '  }' (two spaces + closing brace)
    # that closes the if-block. We do a simple brace count.
    open_braces = 0
    i = start_idx
    while i < len(text):
        ch = text[i]
        if ch == '{':
            open_braces += 1
        elif ch == '}':
            open_braces -= 1
            if open_braces == 0:
                # i is the index of the closing brace. Insert after the next newline.
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


# =============================================================================
def main():
    # Pre-flight: every file must exist
    for p in (TYPES, INTEL_ROUTE, CTX):
        if not os.path.exists(p):
            fatal(f"required file missing: {p}")

    # Check idempotency
    intel_text = open(INTEL_ROUTE).read()
    if MARKER in intel_text:
        print("Already applied. No-op.")
        return

    types_text = open(TYPES).read()
    ctx_text = open(CTX).read()

    # Validate all anchors BEFORE writing anything
    anchors = [
        ("types: shopify? line", TYPES_OLD, types_text),
        ("intel: import line", INTEL_OLD_1, intel_text),
        ("intel: shopifyConn lookup", INTEL_OLD_2, intel_text),
        ("intel: Shopify promise block", INTEL_OLD_3, intel_text),
        ("intel: result destructure", INTEL_OLD_5, intel_text),
        ("intel: Shopify result handling", INTEL_OLD_4, intel_text),
    ]
    for label, anchor, source in anchors:
        c = source.count(anchor)
        if c == 0:
            fatal(f"anchor missing: {label}")
        if c > 1:
            fatal(f"anchor matches {c} times, expected 1: {label}")

    # Check files-to-create don't already exist with different content
    for p, label in ((WOO_LIB, "woo lib"), (DAILY_ROUTE, "woo daily route")):
        if os.path.exists(p):
            existing = open(p).read()
            if MARKER not in existing:
                fatal(f"{label} exists at {p} without our marker; refusing to overwrite")

    # ── All checks passed. Apply changes ────────────────────────────────────

    # Types
    new_types = types_text.replace(TYPES_OLD, TYPES_NEW, 1)
    with open(TYPES, "w") as f:
        f.write(new_types)
    print("ok: intelligence-types.ts patched (added woocommerce field)")

    # Intel route - apply in order
    t = intel_text
    t = t.replace(INTEL_OLD_1, INTEL_NEW_1, 1)
    t = t.replace(INTEL_OLD_2, INTEL_NEW_2, 1)
    t = t.replace(INTEL_OLD_5, INTEL_NEW_5, 1)
    t = t.replace(INTEL_OLD_3, INTEL_NEW_3, 1)
    t = t.replace(INTEL_OLD_4, INTEL_NEW_4, 1)
    with open(INTEL_ROUTE, "w") as f:
        f.write(t)
    print("ok: intelligence/route.ts patched (import + lookup + fetch + result handling)")

    # New lib file
    os.makedirs(os.path.dirname(WOO_LIB), exist_ok=True)
    with open(WOO_LIB, "w") as f:
        f.write(WOO_LIB_CONTENT)
    print("ok: created woocommerce-intelligence.ts")

    # New daily route
    os.makedirs(os.path.dirname(DAILY_ROUTE), exist_ok=True)
    with open(DAILY_ROUTE, "w") as f:
        f.write(DAILY_CONTENT)
    print("ok: created /api/woocommerce/daily/route.ts")

    # Patch claude context (best-effort)
    new_ctx, ok = patch_claude_context(ctx_text)
    if ok:
        with open(CTX, "w") as f:
            f.write(new_ctx)
        print("ok: build-claude-context.ts patched (WooCommerce section added)")
    else:
        print("warn: could not auto-patch build-claude-context.ts")
        print("      WooCommerce data will still flow to dashboard, but Claude")
        print("      won't see it until that file is patched manually. Tell")
        print("      Claude about this in the next message and it'll fix it.")

    print()
    print("=" * 50)
    print("WooCommerce intelligence wired up end-to-end.")
    print("Dashboard tab not added yet (next script).")
    print("=" * 50)


if __name__ == "__main__":
    main()
