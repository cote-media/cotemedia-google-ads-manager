#!/usr/bin/env python3
"""
WooCommerce connect UI on /clients page - v2 with corrected anchors.

Same as woo_connect_ui.py but with the URL-param anchor fixed to match
the actual file (which uses fetchClients()/router.replace, not
window.history.replaceState).

Usage: python3 woo_connect_ui_v2.py
Idempotent.
"""
import os
import sys

PROJECT = os.path.expanduser("~/Downloads/cotemedia-ads-manager")
CLIENTS = os.path.join(PROJECT, "src/app/clients/page.tsx")

MARKER = "LORAMER_WOO_CONNECT_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# Edit 1: state declarations
OLD_1 = "  const [shopifySuccess, setShopifySuccess] = useState(false)"
NEW_1 = (
    "  const [shopifySuccess, setShopifySuccess] = useState(false)\n"
    "  // LORAMER_WOO_CONNECT_V1\n"
    "  const [wooModal, setWooModal] = useState<string | null>(null) // clientId\n"
    "  const [wooDomain, setWooDomain] = useState('')\n"
    "  const [wooSuccess, setWooSuccess] = useState(false)"
)

# Edit 2: URL param handling - REAL anchor this time (verified from file)
OLD_2 = (
    "    if (shopifyConnected === 'true') {\n"
    "      setShopifySuccess(true)\n"
    "      fetchClients()\n"
    "      router.replace('/clients')\n"
    "      setTimeout(() => setShopifySuccess(false), 4000)\n"
    "      return\n"
    "    }"
)
NEW_2 = (
    "    if (shopifyConnected === 'true') {\n"
    "      setShopifySuccess(true)\n"
    "      fetchClients()\n"
    "      router.replace('/clients')\n"
    "      setTimeout(() => setShopifySuccess(false), 4000)\n"
    "      return\n"
    "    }\n"
    "    // LORAMER_WOO_CONNECT_V1 - WooCommerce return params\n"
    "    const wooConnected = searchParams.get('woo_connected')\n"
    "    const wooErr = searchParams.get('woo_error')\n"
    "    if (wooErr) { setMetaError('WooCommerce connection failed: ' + wooErr); return }\n"
    "    if (wooConnected) {\n"
    "      setWooSuccess(true)\n"
    "      fetchClients()\n"
    "      router.replace('/clients')\n"
    "      setTimeout(() => setWooSuccess(false), 4000)\n"
    "      return\n"
    "    }"
)

# Edit 3: shopifyConn variable
OLD_3 = "                const shopifyConn = client.platform_connections.find(p => p.platform === 'shopify')"
NEW_3 = (
    "                const shopifyConn = client.platform_connections.find(p => p.platform === 'shopify')\n"
    "                const wooConn = client.platform_connections.find(p => p.platform === 'woocommerce')  // LORAMER_WOO_CONNECT_V1"
)

# Edit 4A: hasConn check in row open handler
OLD_4A = "                            const hasConn = !!(googleConn || metaConn || shopifyConn)"
NEW_4A = "                            const hasConn = !!(googleConn || metaConn || shopifyConn || wooConn)"

# Edit 4B: hasConn check in row click handler
OLD_4B = "                        <button onClick={(e) => { e.stopPropagation(); const hasConn = !!(googleConn || metaConn || shopifyConn); if (hasConn) { goToDashboard(client) } else { setExpandedProfile(isExpanded ? null : client.id) } }}"
NEW_4B = "                        <button onClick={(e) => { e.stopPropagation(); const hasConn = !!(googleConn || metaConn || shopifyConn || wooConn); if (hasConn) { goToDashboard(client) } else { setExpandedProfile(isExpanded ? null : client.id) } }}"

# Edit 5: WooCommerce pill after Shopify pill block
OLD_5 = (
    "                                + Shopify\n"
    "                              </button>\n"
    "                            )}"
)
NEW_5 = (
    "                                + Shopify\n"
    "                              </button>\n"
    "                            )}\n"
    "                            {/* WooCommerce pill - LORAMER_WOO_CONNECT_V1 */}\n"
    "                            {wooConn ? (\n"
    "                              <button onClick={(e) => { e.stopPropagation(); goToDashboard(client) }} className=\"inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-white hover:opacity-90 transition-opacity\" style={{ background: '#96588A' }}>\n"
    "                                <svg width=\"10\" height=\"10\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M2.4 4.8h19.2c1.32 0 2.4 1.08 2.4 2.4v10.32c0 1.32-1.08 2.4-2.4 2.4H14.4l3.36 5.04L8.4 19.92H2.4c-1.32 0-2.4-1.08-2.4-2.4V7.2c0-1.32 1.08-2.4 2.4-2.4zM3.84 6.6c-.6 0-.96.36-.96.84 0 .12 0 .24.12.48l3 9.6c.12.36.36.48.6.48.36 0 .48-.12.6-.48l1.32-5.28 1.92 5.04c.12.36.24.6.6.6s.48-.24.6-.6c1.32-3.6 2.04-5.4 2.04-5.4l1.32 4.8c.12.36.36.6.6.6.24 0 .48-.24.6-.48l3.12-9.6c.12-.24.12-.48.12-.6 0-.48-.36-.84-.96-.84-.48 0-.84.36-.96.84l-2.04 6.36-1.32-4.32c-.12-.36-.36-.6-.72-.6s-.6.24-.72.6l-1.92 5.4-1.68-5.4c-.12-.36-.36-.6-.72-.6s-.6.24-.72.6l-1.32 4.32-2.04-6.36c-.12-.48-.48-.84-.96-.84z\"/></svg>\n"
    "                                WooCommerce\n"
    "                              </button>\n"
    "                            ) : (\n"
    "                              <button\n"
    "                                onClick={(e) => { e.stopPropagation(); setWooModal(client.id); setWooDomain('') }}\n"
    "                                className=\"inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-muted border border-dashed border-border hover:border-ink hover:text-ink transition-colors\">\n"
    "                                + WooCommerce\n"
    "                              </button>\n"
    "                            )}"
)

# Edit 6: Expanded Connections section
OLD_6 = "                            {!googleConn && !metaConn && !shopifyConn && ("
NEW_6 = (
    "                            {wooConn && (  /* LORAMER_WOO_CONNECT_V1 */\n"
    "                              <div className=\"flex items-center justify-between p-3 bg-surface rounded-lg\">\n"
    "                                <div className=\"flex items-center gap-3 min-w-0\">\n"
    "                                  <div className=\"w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0\" style={{ background: '#96588A' }}>\n"
    "                                    <svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"white\"><path d=\"M2.4 4.8h19.2c1.32 0 2.4 1.08 2.4 2.4v10.32c0 1.32-1.08 2.4-2.4 2.4H14.4l3.36 5.04L8.4 19.92H2.4c-1.32 0-2.4-1.08-2.4-2.4V7.2c0-1.32 1.08-2.4 2.4-2.4z\"/></svg>\n"
    "                                  </div>\n"
    "                                  <div className=\"min-w-0\">\n"
    "                                    <p className=\"text-xs font-sans font-medium text-ink\">WooCommerce</p>\n"
    "                                    <p className=\"text-xs text-muted font-sans truncate\">{wooConn.account_name}</p>\n"
    "                                  </div>\n"
    "                                </div>\n"
    "                                <button onClick={async (e) => {\n"
    "                                  e.stopPropagation()\n"
    "                                  if (!confirm('Disconnect WooCommerce from this client?')) return\n"
    "                                  await fetch('/api/clients/connections?id=' + wooConn.id, { method: 'DELETE' })\n"
    "                                  fetchClients()\n"
    "                                }} className=\"text-xs text-muted hover:text-red-600 transition-colors font-sans\">Disconnect</button>\n"
    "                              </div>\n"
    "                            )}\n"
    "                            {!googleConn && !metaConn && !shopifyConn && !wooConn && ("
)

# Edit 7: Modal + success toast before Shopify success toast
OLD_7 = "      {/* Shopify success notification */}"
NEW_7 = (
    "      {/* WooCommerce connect modal - LORAMER_WOO_CONNECT_V1 */}\n"
    "      {wooModal && (\n"
    "        <div className=\"fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4\">\n"
    "          <div className=\"bg-white rounded-2xl p-6 max-w-md w-full\">\n"
    "            <h3 className=\"font-display text-xl text-ink mb-2\">Connect WooCommerce Store</h3>\n"
    "            <p className=\"text-sm text-muted font-mono mb-6\">Enter the store URL. You'll be sent to WordPress to approve access, then bounced back here connected.</p>\n"
    "            <div className=\"mb-4\">\n"
    "              <input type=\"text\" value={wooDomain} onChange={e => setWooDomain(e.target.value)}\n"
    "                placeholder=\"https://yourstore.com\"\n"
    "                className=\"w-full text-sm border border-border rounded-lg px-3 py-2 bg-paper focus:outline-none focus:border-accent font-sans\" />\n"
    "              <p className=\"text-xs text-muted mt-1 font-mono\">Must be HTTPS. WooCommerce 3.4+ required.</p>\n"
    "            </div>\n"
    "            <div className=\"flex flex-col gap-2\">\n"
    "              <a href={wooDomain.trim() ? '/api/woocommerce/auth?clientId=' + wooModal + '&shop=' + encodeURIComponent(wooDomain.trim()) : '#'}\n"
    "                onClick={e => { if (!wooDomain.trim()) e.preventDefault() }}\n"
    "                className={'btn-primary text-center ' + (!wooDomain.trim() ? 'opacity-50 pointer-events-none' : '')}>\n"
    "                Connect WooCommerce\n"
    "              </a>\n"
    "              <button onClick={() => setWooModal(null)}\n"
    "                className=\"text-sm text-muted hover:text-ink transition-colors font-sans\">Cancel</button>\n"
    "            </div>\n"
    "          </div>\n"
    "        </div>\n"
    "      )}\n"
    "\n"
    "      {/* WooCommerce success notification - LORAMER_WOO_CONNECT_V1 */}\n"
    "      {wooSuccess && (\n"
    "        <div className=\"fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-sans\" style={{ background: '#96588A' }}>\n"
    "          \u2713 WooCommerce connected successfully\n"
    "        </div>\n"
    "      )}\n"
    "\n"
    "      {/* Shopify success notification */}"
)


def main():
    if not os.path.exists(CLIENTS):
        fatal(f"clients page not found: {CLIENTS}")

    text = open(CLIENTS).read()

    if MARKER in text:
        print("Already applied. No-op.")
        return

    anchors = [
        ("state", OLD_1),
        ("URL param handling", OLD_2),
        ("shopifyConn variable", OLD_3),
        ("hasConn check (4A)", OLD_4A),
        ("hasConn check (4B)", OLD_4B),
        ("Shopify outlined pill (5)", OLD_5),
        ("'No platforms connected' check (6)", OLD_6),
        ("Shopify success notification (7)", OLD_7),
    ]
    for label, anchor in anchors:
        c = text.count(anchor)
        if c == 0:
            fatal(f"anchor missing: {label}")
        if c > 1:
            fatal(f"anchor matches {c} times, expected 1: {label}")

    text = text.replace(OLD_1, NEW_1, 1)
    text = text.replace(OLD_2, NEW_2, 1)
    text = text.replace(OLD_3, NEW_3, 1)
    text = text.replace(OLD_4A, NEW_4A, 1)
    text = text.replace(OLD_4B, NEW_4B, 1)
    text = text.replace(OLD_5, NEW_5, 1)
    text = text.replace(OLD_6, NEW_6, 1)
    text = text.replace(OLD_7, NEW_7, 1)

    with open(CLIENTS, "w") as f:
        f.write(text)

    print("OK: WooCommerce connect UI added to /clients page")


if __name__ == "__main__":
    main()
