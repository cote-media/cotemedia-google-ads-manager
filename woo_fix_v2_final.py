#!/usr/bin/env python3
"""
Two fixes:

1. dashboard/page.tsx - strip stray '// LORAMER_WOO_TAB_V1' that renders
   as visible JSX text.

2. clients/page.tsx - WooCommerce pill sets loramer-active-tab to
   'woocommerce' BEFORE navigating, so dashboard opens to the right tab.

Atomic, idempotent.
"""
import os
import sys

PROJECT = os.path.expanduser("~/Downloads/cotemedia-ads-manager")
DASH = os.path.join(PROJECT, "src/app/dashboard/page.tsx")
CLIENTS = os.path.join(PROJECT, "src/app/clients/page.tsx")


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


DASH_OLD = '      <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={undefined} customEnd={undefined} apiPath={apiPath} />  // LORAMER_WOO_TAB_V1'
DASH_NEW = '      {/* LORAMER_WOO_FIX_V2 */}\n      <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={undefined} customEnd={undefined} apiPath={apiPath} />'


CLI_OLD = (
    '{wooConn ? (\n'
    '                              <button onClick={(e) => { e.stopPropagation(); goToDashboard(client) }}'
)
CLI_NEW = (
    '{wooConn ? (\n'
    "                              <button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('loramer-active-tab', 'woocommerce') } catch {}; goToDashboard(client) }}  /* LORAMER_WOO_FIX_V2 */"
)


def safe_replace(text, old, new, label):
    if new in text:
        print(f"skip: {label} already applied")
        return text
    c = text.count(old)
    if c == 0:
        fatal(f"anchor missing: {label}")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1: {label}")
    print(f"ok: {label}")
    return text.replace(old, new, 1)


def main():
    for p in (DASH, CLIENTS):
        if not os.path.exists(p):
            fatal(f"file missing: {p}")

    d = open(DASH).read()
    d = safe_replace(d, DASH_OLD, DASH_NEW, "dashboard: strip stray // comment")
    with open(DASH, "w") as f:
        f.write(d)

    c = open(CLIENTS).read()
    c = safe_replace(c, CLI_OLD, CLI_NEW, "clients: WooCommerce pill sets active-tab")
    with open(CLIENTS, "w") as f:
        f.write(c)

    print()
    print("Done. Test the WooCommerce pill - should now land directly on the WooCommerce tab.")


if __name__ == "__main__":
    main()
