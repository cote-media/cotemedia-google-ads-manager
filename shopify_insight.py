#!/usr/bin/env python3
"""
Add the InsightChat Claude analysis banner to the top of ShopifyTab.
Because ShopifyTab is reused for WooCommerce via WooCommerceTabWrapper,
this single change covers both tabs.

Matches the rendering pattern used in Overview, Campaigns, and Keywords tabs:
InsightChat sits at the top of the tab content, above charts and tiles.

The `location` field is set from `platformLabel.toLowerCase()` so the
Shopify tab and WooCommerce tab have distinct insight caches.

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)
MARKER = "LORAMER_SHOPIFY_INSIGHT_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


OLD = '''  return (
    <div className="space-y-4 md:space-y-6">
      {/* Revenue over time chart */}
      {/* LORAMER_WOO_FIX_V2 */}
      <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={undefined} customEnd={undefined} apiPath={apiPath} />'''

NEW = '''  return (
    <div className="space-y-4 md:space-y-6">
      {/* LORAMER_SHOPIFY_INSIGHT_V1 - Claude analysis banner, matches Overview/Campaigns/Keywords pattern */}
      {clientId && (
        <InsightChat
          clientId={clientId}
          clientName={clientName}
          dateRange={dateRange}
          location={platformLabel.toLowerCase()}
          shopify={shopify}
        />
      )}
      {/* Revenue over time chart */}
      {/* LORAMER_WOO_FIX_V2 */}
      <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={undefined} customEnd={undefined} apiPath={apiPath} />'''


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    if MARKER in text:
        print("Already applied. No-op.")
        return

    count = text.count(OLD)
    if count == 0:
        fatal("anchor not found - ShopifyTab return block may have changed")
    if count > 1:
        fatal(f"anchor matches {count} times, expected exactly 1")

    new_text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(new_text)

    print("OK: InsightChat banner now renders at top of ShopifyTab.")
    print("    WooCommerce tab also gets it (shared component via WooCommerceTabWrapper).")
    print("    Cache key uses platformLabel.toLowerCase() so the two tabs have distinct caches.")


if __name__ == "__main__":
    main()
