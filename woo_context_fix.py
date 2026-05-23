#!/usr/bin/env python3
"""
Fix: WooCommerce block in build-claude-context.ts uses 'sections.push'
which doesn't exist. The actual variable is 'lines.push' per the Shopify
block right above it. Replace the broken block with the correct pattern.

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/lib/intelligence/build-claude-context.ts"
)


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# The exact broken block currently in the file (verified from user paste).
OLD = """  // LORAMER_WOO_INTEL_V1
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
  }"""

# New block: same shape as the Shopify block, using lines.push line by line.
NEW = """  // LORAMER_WOO_INTEL_V1
  if (intelligence.woocommerce?.connected) {
    const w = intelligence.woocommerce
    lines.push('\\n=== WOOCOMMERCE ===')
    if (w.totalRevenue) lines.push(`Total Revenue: $${w.totalRevenue.toFixed(2)}`)
    if (w.totalOrders) lines.push(`Total Orders: ${w.totalOrders}`)
    if (w.avgOrderValue) lines.push(`Avg Order Value: $${w.avgOrderValue.toFixed(2)}`)
    if (w.newCustomers) lines.push(`New Customers: ${w.newCustomers}`)
    if (w.returningCustomers) lines.push(`Returning Customers: ${w.returningCustomers}`)
    if (w.topProducts?.length) {
      lines.push('Top Products:')
      w.topProducts.slice(0, 5).forEach(prod => {
        lines.push(`  \u2022 ${prod.name}: $${prod.revenue.toFixed(2)} revenue, ${prod.units} units`)
      })
    }
  }"""


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    if NEW in text:
        print("Already applied. No-op.")
        return

    c = text.count(OLD)
    if c == 0:
        fatal("broken block not found")
    if c > 1:
        fatal(f"broken block matches {c} times, expected 1")

    text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(text)
    print("OK: replaced broken WooCommerce block with lines.push pattern")


if __name__ == "__main__":
    main()
