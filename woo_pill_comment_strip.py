#!/usr/bin/env python3
"""
Fix: WooCommerce pill has a JSX block comment sitting between attributes,
breaking the onClick. Remove the comment.

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


# The broken line as it exists right now (per user's grep at line 444).
# We strip the comment fragment that's mid-attribute-list.
OLD = "<button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-tab', 'woocommerce') } catch {}; goToDashboard(client) }}  /* LORAMER_WOO_FIX_V2 */ className="

NEW = "<button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-tab', 'woocommerce') } catch {}; goToDashboard(client) }} className="


def main():
    if not os.path.exists(PATH):
        fatal("clients/page.tsx not found")

    text = open(PATH).read()

    if NEW in text and OLD not in text:
        print("Already applied. No-op.")
        return

    c = text.count(OLD)
    if c == 0:
        fatal("anchor missing - broken comment not in expected position")
    if c > 1:
        fatal(f"anchor matches {c} times")

    text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(text)
    print("OK: removed broken /* comment */ between onClick and className")


if __name__ == "__main__":
    main()
