#!/usr/bin/env python3
"""
Guarantee Overview is the default tab when nothing valid is selected.

Two small changes:
1. The initial useState reads from localStorage but doesn't validate.
   Anything other than the 5 valid tabs falls through to 'overview'.
2. selectClient reads localStorage again and applies it without validation;
   restrict to known-valid tabs only.

Usage: python3 default_tab_overview.py
Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)

MARKER = "LORAMER_DEFAULT_TAB_V1"


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

    # Change 1: validate initial useState value
    old1 = "  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat' | 'shopify'>(() => (ls('loramer-active-tab') as any) || 'overview')"
    new1 = (
        "  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat' | 'shopify'>(() => {\n"
        "    // LORAMER_DEFAULT_TAB_V1 - validate against known tabs, default to overview\n"
        "    const saved = ls('loramer-active-tab') as any\n"
        "    const valid = ['overview', 'campaigns', 'keywords', 'chat', 'shopify']\n"
        "    return valid.includes(saved) ? saved : 'overview'\n"
        "  })"
    )
    if old1 not in s:
        fatal("activeTab initial state anchor missing")
    s = s.replace(old1, new1, 1)
    print("step 1 ok: initial activeTab validated against known tabs")

    # Change 2: selectClient also validates savedTab before applying
    old2 = (
        "    // Restore saved tab\n"
        "    const savedTab = ls('loramer-active-tab') as any\n"
        "    if (savedTab) setActiveTab(savedTab)"
    )
    new2 = (
        "    // Restore saved tab (LORAMER_DEFAULT_TAB_V1 - validate)\n"
        "    const savedTab = ls('loramer-active-tab') as any\n"
        "    const validTabs = ['overview', 'campaigns', 'keywords', 'chat', 'shopify']\n"
        "    if (validTabs.includes(savedTab)) setActiveTab(savedTab)\n"
        "    else setActiveTab('overview')"
    )
    if old2 not in s:
        fatal("selectClient savedTab restore anchor missing")
    s = s.replace(old2, new2, 1)
    print("step 2 ok: selectClient validates savedTab")

    with open(PATH, "w") as f:
        f.write(s)

    print()
    print("Default tab will always be a valid value. Overview if anything weird.")


if __name__ == "__main__":
    main()
