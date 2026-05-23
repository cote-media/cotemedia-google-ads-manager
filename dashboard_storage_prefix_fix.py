#!/usr/bin/env python3
"""
Root-cause fix: all 'loramer-' localStorage keys in the dashboard read/write
the WRONG keyspace. The codebase uses 'advar-' as the prefix everywhere else
(51 references). Today's earlier scripts introduced new 'loramer-' writes
that the rest of the app doesn't read.

Strategy: rename every 'loramer-XXX' literal string in dashboard/page.tsx
to 'advar-XXX'. This is a global text substitution and idempotent.

Usage: python3 dashboard_storage_prefix_fix.py
"""
import os
import re
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


def main():
    if not os.path.exists(PATH):
        fatal("dashboard/page.tsx not found")

    text = open(PATH).read()

    # Find every 'loramer-XXX' string literal (single-quoted)
    pattern = re.compile(r"'loramer-([a-z0-9-]+)'")
    matches = pattern.findall(text)

    if not matches:
        print("No 'loramer-' keys found. No-op.")
        return

    # Unique counts for reporting
    from collections import Counter
    counts = Counter(matches)

    print(f"Found {sum(counts.values())} 'loramer-' string literals across {len(counts)} unique keys:")
    for key, count in sorted(counts.items()):
        print(f"  loramer-{key}  ({count}x)")

    new_text = pattern.sub(lambda m: f"'advar-{m.group(1)}'", text)

    if new_text == text:
        print("No changes needed.")
        return

    # Sanity check: count loramer- before, advar- after
    after_loramer = len(pattern.findall(new_text))
    if after_loramer != 0:
        fatal(f"Unexpected: {after_loramer} loramer- keys remain after substitution")

    with open(PATH, "w") as f:
        f.write(new_text)

    print()
    print(f"OK: renamed all 'loramer-' keys to 'advar-' in {os.path.basename(PATH)}")
    print("Dashboard now reads/writes the same keyspace as the rest of the app.")


if __name__ == "__main__":
    main()
