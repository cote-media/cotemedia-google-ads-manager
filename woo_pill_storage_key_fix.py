#!/usr/bin/env python3
"""
WooCommerce pill fix v3.

The codebase uses 'advar-' as the localStorage prefix (51 refs vs 0 for
'loramer-'). My earlier fix wrote 'loramer-active-tab' which the app
never reads. Switch to 'advar-active-tab'.

Idempotent.
"""
import os
import sys

CLIENTS = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/clients/page.tsx"
)


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


OLD = "localStorage.setItem('loramer-active-tab', 'woocommerce')"
NEW = "localStorage.setItem('advar-active-tab', 'woocommerce')"


def main():
    if not os.path.exists(CLIENTS):
        fatal("clients/page.tsx not found")

    text = open(CLIENTS).read()

    if NEW in text:
        print("Already applied. No-op.")
        return

    c = text.count(OLD)
    if c == 0:
        fatal("anchor missing - the loramer-active-tab localStorage write")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1")

    text = text.replace(OLD, NEW, 1)
    with open(CLIENTS, "w") as f:
        f.write(text)
    print("OK: WooCommerce pill now writes advar-active-tab (matches the rest of the codebase)")


if __name__ == "__main__":
    main()
