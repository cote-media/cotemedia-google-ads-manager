#!/usr/bin/env python3
"""
Fix: Keywords nav tab was visible to Shopify-only clients.

Root cause: NAV_ITEMS filter checks `activePlatform !== 'google'` to hide
the googleOnly Keywords tab. But for a Shopify-only client, the resolved
platform falls through to 'google' as a default even though the client
has no Google connection. activePlatform becomes 'google', so Keywords
shows in the sidebar despite there being no Google account behind it.

Fix: gate on `!hasGoogle` directly. If the client doesn't have a Google
connection, Keywords is hidden \u2014 regardless of what activePlatform
resolved to.

This also correctly hides Keywords for Meta-only clients (which the old
check did handle, but only as a side effect).

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)
MARKER = "LORAMER_KEYWORDS_NAV_GATE_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


OLD = "    if (item.googleOnly && activePlatform !== 'google') return false"
NEW = "    if (item.googleOnly && !hasGoogle) return false  // LORAMER_KEYWORDS_NAV_GATE_V1"


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    if MARKER in text:
        print("Already applied. No-op.")
        return

    count = text.count(OLD)
    if count == 0:
        fatal("anchor not found in expected form")
    if count > 1:
        fatal(f"anchor matches {count} times, expected exactly 1")

    new_text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(new_text)

    print("OK: Keywords tab now hidden for clients without a Google connection.")


if __name__ == "__main__":
    main()
