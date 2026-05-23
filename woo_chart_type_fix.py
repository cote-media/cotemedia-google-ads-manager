#!/usr/bin/env python3
"""
Fix: ShopifyChart's prop type is missing apiPath. TypeScript build failed.

Single line change. Idempotent.

Usage: python3 woo_chart_type_fix.py
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    old = "  clientId: string; dateRange: string; customStart?: string; customEnd?: string\n}) {"
    new = "  clientId: string; dateRange: string; customStart?: string; customEnd?: string; apiPath?: string  // LORAMER_WOO_TAB_V1\n}) {"

    if new in text:
        print("Already applied. No-op.")
        return

    c = text.count(old)
    if c == 0:
        fatal("anchor missing - ShopifyChart prop type line")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1")

    text = text.replace(old, new, 1)
    with open(PATH, "w") as f:
        f.write(text)
    print("OK: added apiPath?: string to ShopifyChart prop type")


if __name__ == "__main__":
    main()
