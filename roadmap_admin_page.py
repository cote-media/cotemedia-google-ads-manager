#!/usr/bin/env python3
"""
Add admin page item to roadmap under Project 8 (Tech Debt & Operational).

Usage: python3 roadmap_admin_page.py
Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/ROADMAP.md"
)

MARKER = "Admin page for user management (logged May 22)"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    with open(PATH) as f:
        s = f.read()

    if MARKER in s:
        print("Already applied. No-op.")
        return

    # Anchor on the existing Refresh Connection UX item we logged earlier
    anchor = "- [ ] **Refresh connection UX (found May 22):**"

    addition = """- [ ] **Admin page for user management (logged May 22)** \u2014 currently the only way to add a beta tester, change a user's tier, or see who is in the system is via Supabase SQL. Build a simple `/admin` route (gated to Russ's email or a super_admin tier) that lists every user, their tier, signup date, last login, and spend-to-date. Allow tier changes, beta_unlimited toggle, and a one-click "invite new tester" flow that adds their email. Foundation for everything from manual support to the eventual "talk to a human" workflow.
"""

    if anchor not in s:
        fatal("Refresh connection UX anchor not found")

    s = s.replace(anchor, addition + anchor, 1)

    with open(PATH, "w") as f:
        f.write(s)

    print("OK: admin page item added under Project 8")


if __name__ == "__main__":
    main()
