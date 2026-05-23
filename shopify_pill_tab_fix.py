#!/usr/bin/env python3
"""
Fix: Shopify pill on clients page must also set advar-active-tab='shopify'
before navigating, parallel to what the WooCommerce pill does.

Without this, clicking Shopify lands on whatever tab was last selected
(often WooCommerce after testing the other pill).

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/clients/page.tsx"
)


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# Anchor exactly matches the existing Shopify pill onClick.
# Note: this is the FILLED pill (when shopifyConn exists) - navigates to dashboard.
OLD = "<button onClick={(e) => { e.stopPropagation(); goToDashboard(client, 'shopify') }}"
NEW = "<button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-tab', 'shopify') } catch {}; goToDashboard(client, 'shopify') }}"


def main():
    if not os.path.exists(PATH):
        fatal("clients/page.tsx not found")

    text = open(PATH).read()

    if NEW in text:
        print("Already applied. No-op.")
        return

    c = text.count(OLD)
    if c == 0:
        fatal("Shopify pill onClick anchor not found")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1")

    text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(text)
    print("OK: Shopify pill now sets advar-active-tab='shopify' before navigating")


if __name__ == "__main__":
    main()
