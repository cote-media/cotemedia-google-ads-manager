#!/usr/bin/env python3
"""
WooCommerce dashboard tab - final piece of the WooCommerce wire-up.

Atomic script with 11 edits to src/app/dashboard/page.tsx:

  1. ShopifyChart signature: add optional apiPath prop
  2. ShopifyChart URL construction: use apiPath instead of hardcoded path
  3. ShopifyTab signature: add optional platformLabel and apiPath props
  4. ShopifyTab "data unavailable" header label: parametrize
  5. ShopifyTab "data unavailable" detail label: parametrize
  6. ShopifyTab context string label: parametrize
  7. ShopifyTab passes apiPath through to ShopifyChart
  8. Add WooCommerceTabWrapper component (right after ShopifyTabWrapper)
  9. Add hasWoo derived state
 10. Add 'woocommerce' to navItems with wooOnly flag
 11. Add wooOnly + multi-ecom filter handling in nav filter
 12. Add render branch for activeTab === 'woocommerce'
 13. Add 'woocommerce' to valid-tab lists (two places from LORAMER_DEFAULT_TAB_V1)

Atomic, idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)

MARKER = "LORAMER_WOO_TAB_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# ========== 1: ShopifyChart signature ==========
OLD_1 = "function ShopifyChart({ clientId, dateRange, customStart, customEnd }: {"
NEW_1 = "function ShopifyChart({ clientId, dateRange, customStart, customEnd, apiPath = '/api/shopify/daily' }: {  // LORAMER_WOO_TAB_V1"

# ========== 2: ShopifyChart URL construction ==========
OLD_2 = "    let url = `/api/shopify/daily?clientId=${clientId}&dateRange=${dateRange}`"
NEW_2 = "    let url = `${apiPath}?clientId=${clientId}&dateRange=${dateRange}`  // LORAMER_WOO_TAB_V1"

# ========== 3: ShopifyTab signature ==========
OLD_3 = (
    "function ShopifyTab({ shopify, clientId, clientName, dateRange, platform, openPanel }: {\n"
    "  shopify: ShopifyData\n"
    "  clientId: string\n"
    "  clientName: string\n"
    "  dateRange: string\n"
    "  platform: Platform\n"
    "  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void\n"
    "}) {"
)
NEW_3 = (
    "function ShopifyTab({ shopify, clientId, clientName, dateRange, platform, openPanel, platformLabel = 'Shopify', apiPath = '/api/shopify/daily' }: {  // LORAMER_WOO_TAB_V1\n"
    "  shopify: ShopifyData\n"
    "  clientId: string\n"
    "  clientName: string\n"
    "  dateRange: string\n"
    "  platform: Platform\n"
    "  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void\n"
    "  platformLabel?: string  // LORAMER_WOO_TAB_V1\n"
    "  apiPath?: string  // LORAMER_WOO_TAB_V1\n"
    "}) {"
)

# ========== 4: 'Shopify data unavailable' ==========
OLD_4 = '        <p className="text-ink font-medium">Shopify data unavailable</p>'
NEW_4 = '        <p className="text-ink font-medium">{platformLabel} data unavailable</p>'

# ========== 5: 'Could not fetch ... Shopify connection.' ==========
OLD_5 = '        <p className="text-muted font-mono text-sm">Could not fetch store data. Check your Shopify connection.</p>'
NEW_5 = '        <p className="text-muted font-mono text-sm">Could not fetch store data. Check your {platformLabel} connection.</p>'

# ========== 6: context-string Shopify label ==========
OLD_6 = "  const shopifyContext = `Shopify store data for ${clientName}:"
NEW_6 = "  const shopifyContext = `${platformLabel} store data for ${clientName}:"

# ========== 7: ShopifyChart usage passes apiPath ==========
OLD_7 = "      <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={undefined} customEnd={undefined} />"
NEW_7 = "      <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={undefined} customEnd={undefined} apiPath={apiPath} />  // LORAMER_WOO_TAB_V1"

# ========== 8: WooCommerceTabWrapper component (inserted RIGHT AFTER ShopifyTabWrapper) ==========
# We anchor on the line that returns the ShopifyTab from the wrapper.
# After the wrapper's closing brace we insert our new wrapper.
# Easiest: insert after the line `  return <ShopifyTab shopify={shopifyData} ...` plus its trailing `}` for ShopifyTabWrapper.
# We pick up everything from that ShopifyTab return statement and its containing brace.
OLD_8 = "  return <ShopifyTab shopify={shopifyData} clientId={clientId} clientName={clientName} dateRange={dateRange} platform={platform} openPanel={openPanel} />\n}"
NEW_8 = (
    "  return <ShopifyTab shopify={shopifyData} clientId={clientId} clientName={clientName} dateRange={dateRange} platform={platform} openPanel={openPanel} />\n"
    "}\n"
    "\n"
    "// LORAMER_WOO_TAB_V1\n"
    "// ─── WooCommerce Tab Wrapper ──────────────────────────────────────────────────\n"
    "function WooCommerceTabWrapper({ clientId, clientName, dateRange, platform, openPanel, customStart, customEnd }: {\n"
    "  clientId: string; clientName: string; dateRange: string; platform: Platform\n"
    "  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void\n"
    "  customStart?: string; customEnd?: string\n"
    "}) {\n"
    "  const [wooData, setWooData] = useState<any>(null)\n"
    "  useEffect(() => {\n"
    "    if (!clientId) return\n"
    "    const params = new URLSearchParams({ clientId, dateRange })\n"
    "    if (customStart) params.set('customStart', customStart)\n"
    "    if (customEnd) params.set('customEnd', customEnd)\n"
    "    fetch('/api/intelligence?' + params.toString())\n"
    "      .then(r => r.json())\n"
    "      .then(d => { if (d.intelligence?.woocommerce) setWooData(d.intelligence.woocommerce) })\n"
    "      .catch(() => {})\n"
    "  }, [clientId, dateRange, customStart, customEnd])\n"
    "  return (\n"
    "    <ShopifyTab\n"
    "      shopify={wooData}\n"
    "      clientId={clientId}\n"
    "      clientName={clientName}\n"
    "      dateRange={dateRange}\n"
    "      platform={platform}\n"
    "      openPanel={openPanel}\n"
    "      platformLabel=\"WooCommerce\"\n"
    "      apiPath=\"/api/woocommerce/daily\"\n"
    "    />\n"
    "  )\n"
    "}"
)

# ========== 9: Add hasWoo derived state, right after hasShopify ==========
OLD_9 = "  const hasShopify = !!selectedClient?.platform_connections.find(p => p.platform === 'shopify')"
NEW_9 = (
    "  const hasShopify = !!selectedClient?.platform_connections.find(p => p.platform === 'shopify')\n"
    "  const hasWoo = !!selectedClient?.platform_connections.find(p => p.platform === 'woocommerce')  // LORAMER_WOO_TAB_V1"
)

# ========== 10: Add WooCommerce nav item ==========
OLD_10 = "  { id: 'shopify', label: 'Shopify', icon: '🛍', shopifyOnly: true },"
NEW_10 = (
    "  { id: 'shopify', label: 'Shopify', icon: '🛍', shopifyOnly: true },\n"
    "  { id: 'woocommerce', label: 'WooCommerce', icon: '🛒', wooOnly: true },  // LORAMER_WOO_TAB_V1"
)

# ========== 11: Nav filter for wooOnly + multi-ecom ==========
OLD_11 = (
    "    if (item.shopifyOnly && !hasShopify) return false\n"
    "    if (item.hideForShopifyOnly && !hasGoogle && !hasMeta && hasShopify) return false"
)
NEW_11 = (
    "    if (item.shopifyOnly && !hasShopify) return false\n"
    "    if (item.wooOnly && !hasWoo) return false  // LORAMER_WOO_TAB_V1\n"
    "    if (item.hideForShopifyOnly && !hasGoogle && !hasMeta && (hasShopify || hasWoo)) return false  // LORAMER_WOO_TAB_V1"
)

# ========== 12: Render branch for WooCommerce tab ==========
OLD_12 = (
    "          {activeTab === 'shopify' && hasShopify && (\n"
    "            <ShopifyTabWrapper clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} dateRange={dateRange} platform={activePlatform} openPanel={openPanel} customStart={customStart} customEnd={customEnd} />\n"
    "          )}"
)
NEW_12 = (
    "          {activeTab === 'shopify' && hasShopify && (\n"
    "            <ShopifyTabWrapper clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} dateRange={dateRange} platform={activePlatform} openPanel={openPanel} customStart={customStart} customEnd={customEnd} />\n"
    "          )}\n"
    "          {/* LORAMER_WOO_TAB_V1 */}\n"
    "          {activeTab === 'woocommerce' && hasWoo && (\n"
    "            <WooCommerceTabWrapper clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} dateRange={dateRange} platform={activePlatform} openPanel={openPanel} customStart={customStart} customEnd={customEnd} />\n"
    "          )}"
)

# ========== 13: Valid-tab arrays (two places from LORAMER_DEFAULT_TAB_V1) ==========
OLD_13A = "    const valid = ['overview', 'campaigns', 'keywords', 'chat', 'shopify']"
NEW_13A = "    const valid = ['overview', 'campaigns', 'keywords', 'chat', 'shopify', 'woocommerce']  // LORAMER_WOO_TAB_V1"

OLD_13B = "    const validTabs = ['overview', 'campaigns', 'keywords', 'chat', 'shopify']"
NEW_13B = "    const validTabs = ['overview', 'campaigns', 'keywords', 'chat', 'shopify', 'woocommerce']  // LORAMER_WOO_TAB_V1"


def safe_replace(text, old, new, label):
    if new in text:
        print(f"skip: {label} already applied")
        return text
    c = text.count(old)
    if c == 0:
        fatal(f"anchor missing: {label}")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1: {label}")
    print(f"ok: applying {label}")
    return text.replace(old, new, 1)


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    if MARKER in text:
        print("Already applied. No-op.")
        return

    text = safe_replace(text, OLD_1, NEW_1, "1: ShopifyChart signature")
    text = safe_replace(text, OLD_2, NEW_2, "2: ShopifyChart URL")
    text = safe_replace(text, OLD_3, NEW_3, "3: ShopifyTab signature")
    text = safe_replace(text, OLD_4, NEW_4, "4: 'data unavailable' header")
    text = safe_replace(text, OLD_5, NEW_5, "5: 'data unavailable' detail")
    text = safe_replace(text, OLD_6, NEW_6, "6: context string label")
    text = safe_replace(text, OLD_7, NEW_7, "7: ShopifyChart usage with apiPath")
    text = safe_replace(text, OLD_8, NEW_8, "8: WooCommerceTabWrapper inserted")
    text = safe_replace(text, OLD_9, NEW_9, "9: hasWoo state")
    text = safe_replace(text, OLD_10, NEW_10, "10: WooCommerce nav item")
    text = safe_replace(text, OLD_11, NEW_11, "11: nav filter for wooOnly")
    text = safe_replace(text, OLD_12, NEW_12, "12: WooCommerce render branch")
    text = safe_replace(text, OLD_13A, NEW_13A, "13A: valid tabs (useState init)")
    text = safe_replace(text, OLD_13B, NEW_13B, "13B: valid tabs (selectClient)")

    with open(PATH, "w") as f:
        f.write(text)

    print()
    print("=" * 50)
    print("WooCommerce dashboard tab wired up.")
    print("=" * 50)


if __name__ == "__main__":
    main()
