#!/usr/bin/env python3
"""
Fix the Shopify-only tab auto-default that overrides explicit tab choice.

When a client has only ecommerce (no Google/Meta), selectClient currently
forces activeTab='shopify' regardless of what the user just clicked.
WooCommerce-only clients also need this default. And clicking the
WooCommerce pill should be respected even when Shopify is also connected.

Logic change: only auto-default to shopify if the saved tab isn't already
a valid ecommerce-or-overview tab. If the user explicitly set 'woocommerce'
or any other valid tab, leave it alone.

Also fixes: the auto-default writes 'loramer-active-tab' but the codebase
uses 'advar-' prefix everywhere else.

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


OLD = """    // Default to shopify tab for Shopify-only clients
    if (!hasGoogle && !hasMeta && hasShopifyLocal) {
      setActiveTab('shopify')
      lsSet('loramer-active-tab', 'shopify')
    }"""

NEW = """    // LORAMER_ECOM_TAB_DEFAULT_V1
    // Auto-default tab ONLY if the user hasn't explicitly chosen one for this session.
    // hasWooLocal duplicates the hasWoo derivation but we don't have it in scope here.
    const hasWooLocal = client.platform_connections.some(p => p.platform === 'woocommerce')
    const explicitTab = ls('advar-active-tab')
    const hasExplicitEcomChoice = explicitTab === 'shopify' || explicitTab === 'woocommerce'
    if (!hasGoogle && !hasMeta && !hasExplicitEcomChoice) {
      // Pick the ecommerce platform that exists
      if (hasShopifyLocal) {
        setActiveTab('shopify')
        lsSet('advar-active-tab', 'shopify')
      } else if (hasWooLocal) {
        setActiveTab('woocommerce')
        lsSet('advar-active-tab', 'woocommerce')
      }
    }"""


def main():
    if not os.path.exists(PATH):
        fatal("dashboard/page.tsx not found")

    text = open(PATH).read()

    if NEW in text:
        print("Already applied. No-op.")
        return

    c = text.count(OLD)
    if c == 0:
        fatal("anchor missing - the Shopify-only auto-default block")
    if c > 1:
        fatal(f"anchor matches {c} times")

    text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(text)
    print("OK: Shopify-only auto-default now respects explicit tab choice and handles WooCommerce-only")


if __name__ == "__main__":
    main()
