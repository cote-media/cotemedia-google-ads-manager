#!/usr/bin/env python3
"""
Fix: activeTab's useState type union doesn't include 'woocommerce'.

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


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    old = "  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat' | 'shopify'>"
    new = "  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat' | 'shopify' | 'woocommerce'>"

    if new in text:
        print("Already applied. No-op.")
        return

    c = text.count(old)
    if c == 0:
        fatal("anchor missing - activeTab useState declaration")
    if c > 1:
        fatal(f"anchor matches {c} times")

    text = text.replace(old, new, 1)
    with open(PATH, "w") as f:
        f.write(text)
    print("OK: added 'woocommerce' to activeTab type union")


if __name__ == "__main__":
    main()
