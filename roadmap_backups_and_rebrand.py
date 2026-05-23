#!/usr/bin/env python3
"""
Add two roadmap items:
1. Supabase backup strategy (Project 8 - Tech Debt)
2. Finish advar->loramer localStorage prefix rebrand (Project 8 - Tech Debt)

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/ROADMAP.md"
)

MARKER = "Supabase backups (logged May 22)"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    s = open(PATH).read()

    if MARKER in s:
        print("Already applied. No-op.")
        return

    # Anchor on the existing admin page roadmap item from earlier tonight
    anchor = "- [ ] **Admin page for user management (logged May 22)**"

    addition = """- [ ] **Supabase backups (logged May 22)** \u2014 currently on Supabase free tier with NO automated backups. Every piece of customer data (client profiles, OAuth tokens for every connected platform, conversations, intelligence cache, spend logs) lives only in production with no recovery path if anything goes wrong. Options to evaluate: (a) upgrade to Pro tier ($25/mo) which includes 7-day point-in-time recovery, (b) write a nightly `pg_dump` script via GitHub Actions that pushes encrypted SQL dumps to S3/R2, (c) both. Decision needed before App Store launch and definitely before paying customers exist. Priority: HIGH.
- [ ] **Finish advar \u2192 loramer localStorage prefix rebrand (logged May 22)** \u2014 codebase has 51 references to keys like `advar-active-tab`, `advar-active-client`, `advar-drill-state`, etc. These work fine but are inconsistent with the LoraMer brand and confused at least one fix session tonight (a WooCommerce pill fix wrote to `loramer-active-tab` and nothing happened because the app reads `advar-active-tab`). Proper fix: rename all 51 keys to `loramer-` in code, AND add a one-time migration on first load that copies any existing `advar-` value to its `loramer-` counterpart so existing users don't lose state. Single contained sprint, ~1 hour of careful work. Roadmap before any other major refactor touches storage.
"""

    if anchor not in s:
        fatal("admin page anchor not found")

    s = s.replace(anchor, addition + anchor, 1)

    with open(PATH, "w") as f:
        f.write(s)

    print("OK: two roadmap items added under Project 8")


if __name__ == "__main__":
    main()
