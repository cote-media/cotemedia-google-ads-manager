#!/usr/bin/env python3
"""
Add the mobile right-panel sizing concern to the roadmap under Project 13.
Idempotent.

Usage: python3 roadmap_mobile_panel_sizing.py
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/ROADMAP.md"
)

MARKER = "Mobile right-panel takes full screen (logged May 22)"


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

    anchor = "### Triggers for unscheduled mobile passes"

    addition = """### Right panel sizing on mobile (logged May 22)

- [ ] **Mobile right-panel takes full screen (logged May 22)** — when a diamond is tapped on mobile, the RightPanel now opens full-width (`w-full md:w-96`). This was a quick mobile fix during the popover-to-panel migration. The full-screen takeover loses the dashboard context behind it and feels heavy. Likely better: panel takes maybe 85-90% of the viewport height as a bottom sheet, OR a slightly inset side panel (e.g. `w-[90vw] max-w-md`) so a sliver of the dashboard stays visible. Decide visual treatment, then implement as a single component (no `md:` position-mode toggles — same lesson from Project 17).

"""

    if anchor not in s:
        fatal(f"anchor not found: {anchor}")

    s = s.replace(anchor, addition + anchor, 1)

    with open(PATH, "w") as f:
        f.write(s)

    print("OK: mobile right-panel sizing item added under Project 13")


if __name__ == "__main__":
    main()
