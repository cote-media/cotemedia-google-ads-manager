#!/usr/bin/env python3
"""
Follow-up to LORAMER_FOCUS_LOCATION_V1.

V1 added location-specific shortcuts for 'shopify' and 'woocommerce' but
left 'chat' (the Ask Claude tab) falling through to platform-based focus.
For Shopify-only clients, platform falls back to 'google' as a default,
so focus = 'Google Ads campaigns' on the Ask Claude tab even though no
Google connection exists.

Fix: when location === 'chat', do NOT use platform to identify the view.
Use a neutral focus that says "Ask Claude conversation" - which is the
honest description regardless of platform connections.

The deeper fix (use intelligence object as the truth source) is larger
and logged for the post-launch Platform-type refactor.

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/api/chat/route.ts"
)
MARKER = "LORAMER_FOCUS_LOCATION_V2"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


OLD = (
    "  let focus: string\n"
    "  if (location === 'shopify') {\n"
    "    focus = 'Shopify store data'\n"
    "  } else if (location === 'woocommerce') {\n"
    "    focus = 'WooCommerce store data'\n"
    "  } else if (drillLevel === 'adgroups' && drillCampaign) {\n"
    "    focus = `ad groups within campaign: ${drillCampaign.name}`\n"
    "  } else if (drillLevel === 'ads' && drillAdGroup) {\n"
    "    focus = `ads within ad group: ${drillAdGroup.name}`\n"
    "  } else if (platform === 'combined') {\n"
    "    focus = 'combined Google + Meta view'\n"
    "  } else if (platform === 'meta') {\n"
    "    focus = 'Meta Ads campaigns'\n"
    "  } else if (platform === 'google') {\n"
    "    focus = 'Google Ads campaigns'\n"
    "  } else {\n"
    "    focus = location || 'overview'\n"
    "  }"
)

NEW = (
    "  // LORAMER_FOCUS_LOCATION_V2\n"
    "  // V1 left location='chat' falling through to platform-based focus,\n"
    "  // which lies for Shopify-only clients (platform defaults to 'google').\n"
    "  // The Ask Claude tab is platform-agnostic - use a neutral focus.\n"
    "  let focus: string\n"
    "  if (location === 'shopify') {\n"
    "    focus = 'Shopify store data'\n"
    "  } else if (location === 'woocommerce') {\n"
    "    focus = 'WooCommerce store data'\n"
    "  } else if (location === 'chat') {\n"
    "    focus = 'Ask Claude conversation (cross-platform)'\n"
    "  } else if (drillLevel === 'adgroups' && drillCampaign) {\n"
    "    focus = `ad groups within campaign: ${drillCampaign.name}`\n"
    "  } else if (drillLevel === 'ads' && drillAdGroup) {\n"
    "    focus = `ads within ad group: ${drillAdGroup.name}`\n"
    "  } else if (platform === 'combined') {\n"
    "    focus = 'combined Google + Meta view'\n"
    "  } else if (platform === 'meta') {\n"
    "    focus = 'Meta Ads campaigns'\n"
    "  } else if (platform === 'google') {\n"
    "    focus = 'Google Ads campaigns'\n"
    "  } else {\n"
    "    focus = location || 'overview'\n"
    "  }"
)


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    text = open(PATH).read()

    if MARKER in text:
        print("Already applied. No-op.")
        return

    count = text.count(OLD)
    if count == 0:
        fatal("anchor not found")
    if count > 1:
        fatal(f"anchor matches {count} times")

    open(PATH, "w").write(text.replace(OLD, NEW, 1))
    print("OK: location='chat' no longer falls through to platform-based focus")


if __name__ == "__main__":
    main()
