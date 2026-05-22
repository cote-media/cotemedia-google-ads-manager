#!/usr/bin/env python3
"""
Fix the zero-spend launch blocker: OverviewTab's hasAdData check
treats empty campaigns array as 'no data,' which makes the dashboard
go completely blank when a date range has zero spend.

Change: data?.campaigns?.length  ->  data?.campaigns

Usage: python3 zero_spend_fix.py
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

    with open(PATH) as f:
        s = f.read()

    # The OverviewTab uses ?.length, InsightChat does not.
    # We want to change only the OverviewTab one.
    old = "  const hasAdData = !!(data?.totals && data?.campaigns?.length)"
    new = "  const hasAdData = !!(data?.totals && data?.campaigns)  // empty array = zero-spend, render zeros"

    count = s.count(old)
    if count == 0:
        # Maybe already applied
        if "  const hasAdData = !!(data?.totals && data?.campaigns)  // empty array" in s:
            print("Already applied. No-op.")
            return
        fatal("OverviewTab hasAdData anchor not found")
    if count > 1:
        fatal(f"OverviewTab hasAdData anchor matched {count} times; expected exactly 1")

    s = s.replace(old, new, 1)

    with open(PATH, "w") as f:
        f.write(s)

    print("OK: OverviewTab now renders zeros when campaigns array is empty")


if __name__ == "__main__":
    main()
