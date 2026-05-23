#!/usr/bin/env python3
"""
Fix: goToDashboard writes 'loramer-active-client' and 'loramer-active-platform'
but the dashboard reads from 'advar-active-client' and 'advar-active-platform'.

Result: clicking any pill from /clients doesn't change which client the
dashboard loads.

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


OLD = """      localStorage.setItem('loramer-active-client', client.id)
      if (platform) localStorage.setItem('loramer-active-platform', platform)"""

NEW = """      localStorage.setItem('advar-active-client', client.id)
      if (platform) localStorage.setItem('advar-active-platform', platform)"""


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    if NEW in text:
        print("Already applied. No-op.")
        return

    c = text.count(OLD)
    if c == 0:
        fatal("goToDashboard localStorage writes not found in expected form")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1")

    text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(text)
    print("OK: goToDashboard now writes advar- keys (matches the rest of the codebase)")


if __name__ == "__main__":
    main()
