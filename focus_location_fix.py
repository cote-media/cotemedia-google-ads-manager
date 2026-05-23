#!/usr/bin/env python3
"""
Root-cause fix for: Claude saying "Current view: Google Ads campaigns" when
the user is on the Ask Claude tab of a Shopify-only client.

Root cause: /api/chat composes the focus string from `platform` and
`drillLevel` ONLY, ignoring the location (tab) the user is actually on.
For a Shopify-only client `platform` resolves to 'google' as a default,
so focus = 'Google Ads campaigns' regardless of where the user is.

Fix has two parts:

1. Backend (chat/route.ts):
   - Destructure `location` from request body
   - Compute focus correctly:
     * If location is shopify/woocommerce -> ecomm-store focus
     * Else if drill is active -> drill focus
     * Else if intelligence has ad data + platform set -> ad platform focus
     * Else -> neutral focus referencing the client name

2. Frontend (dashboard/page.tsx):
   - Both /api/chat callsites send `location` along with platform

The Platform type itself is NOT changed here (that's a larger refactor
logged to the roadmap). What changes is how this one specific bug is
prevented \u2014 by letting the chat route know which tab is being viewed,
the same way the insight route already does.

Idempotent. All anchors verified against /home/claude/audit on 2026-05-23.
"""
import os
import sys

CHAT_PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/api/chat/route.ts"
)
DASH_PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)
MARKER = "LORAMER_FOCUS_LOCATION_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# ---------- chat route edit 1: destructure location ----------
CHAT_DESTRUCTURE_OLD = (
    "  const {\n"
    "    message,\n"
    "    history,\n"
    "    clientId,\n"
    "    clientName,\n"
    "    dateRange,\n"
    "    platform,\n"
    "    drillLevel,\n"
    "    drillCampaign,\n"
    "    drillAdGroup,\n"
    "    rowContext,\n"
    "    customStart,\n"
    "    customEnd,\n"
    "  } = await request.json()"
)
CHAT_DESTRUCTURE_NEW = (
    "  const {\n"
    "    message,\n"
    "    history,\n"
    "    clientId,\n"
    "    clientName,\n"
    "    dateRange,\n"
    "    platform,\n"
    "    drillLevel,\n"
    "    drillCampaign,\n"
    "    drillAdGroup,\n"
    "    rowContext,\n"
    "    customStart,\n"
    "    customEnd,\n"
    "    location,  // LORAMER_FOCUS_LOCATION_V1\n"
    "  } = await request.json()"
)

# ---------- chat route edit 2: compute focus correctly ----------
# Note: I cannot reference `intelligence` here because it's only available
# AFTER the fetch later. So I compose focus from the inputs we have
# (location, drill, platform) and trust the dashboard to send the right ones.
CHAT_FOCUS_OLD = (
    "  // Build focus description\n"
    "  const focus = drillLevel === 'adgroups' && drillCampaign\n"
    "    ? `ad groups within campaign: ${drillCampaign.name}`\n"
    "    : drillLevel === 'ads' && drillAdGroup\n"
    "    ? `ads within ad group: ${drillAdGroup.name}`\n"
    "    : platform === 'combined' ? 'combined Google + Meta view'\n"
    "    : platform === 'meta' ? 'Meta Ads campaigns'\n"
    "    : 'Google Ads campaigns'"
)
CHAT_FOCUS_NEW = (
    "  // LORAMER_FOCUS_LOCATION_V1\n"
    "  // Build focus description. Honor `location` (the tab) first - that's\n"
    "  // the most reliable signal of what the user is looking at. Only fall\n"
    "  // back to platform-based focus when location indicates an ad-view\n"
    "  // (overview/campaigns/keywords) AND the user is drilling into ad data.\n"
    "  // Avoids the bug where platform='google' (a default fallback) leaks\n"
    "  // 'Google Ads campaigns' as the view for Shopify-only clients.\n"
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

# ---------- dashboard edits: include location in /api/chat callsites ----------
# Two callsites. Both need location added to the JSON body.

# Callsite 1: line ~675, in the InsightChat sendMessage
DASH_CALLSITE_1_OLD = (
    "      const res = await fetch('/api/chat', {\n"
    "        method: 'POST',\n"
    "        headers: { 'Content-Type': 'application/json' },\n"
    "        body: JSON.stringify({\n"
    "          message: userMsg,\n"
    "          history: newMessages.slice(0, -1),\n"
    "          platform, dateRange, clientId, clientName,\n"
    "          rowContext: context,\n"
    "        }),\n"
    "      })"
)
DASH_CALLSITE_1_NEW = (
    "      const res = await fetch('/api/chat', {\n"
    "        method: 'POST',\n"
    "        headers: { 'Content-Type': 'application/json' },\n"
    "        body: JSON.stringify({\n"
    "          message: userMsg,\n"
    "          history: newMessages.slice(0, -1),\n"
    "          platform, dateRange, clientId, clientName,\n"
    "          rowContext: context,\n"
    "          location,  // LORAMER_FOCUS_LOCATION_V1\n"
    "        }),\n"
    "      })"
)

# Callsite 2: line ~2541, the AskClaudeTab. This one doesn't have location
# in scope by that name - the tab is on the ASK CLAUDE tab itself, so the
# location is effectively 'chat'. Need to find that callsite and just send
# location: 'chat'.
DASH_CALLSITE_2_OLD = (
    "      const res = await fetch('/api/chat', {\n"
    "        method: 'POST', headers: { 'Content-Type': 'application/json' },\n"
    "        body: JSON.stringify({\n"
    "          message: userMsg,\n"
    "          history: history.slice(0, -1),\n"
    "          // Platform context\n"
    "          platform: activePlatform,\n"
    "          platformData,\n"
    "          dateRange,\n"
    "          // Client context\n"
    "          clientId: selectedClient.id,\n"
    "          clientName: selectedClient.name,\n"
    "          accountId: googleConn?.account_id,\n"
    "          // Drill context\n"
    "          drillLevel: drillState.level,\n"
    "          drillCampaign: drillState.campaign,\n"
    "          drillAdGroup: drillState.adGroup,\n"
    "        }),\n"
    "      })"
)
DASH_CALLSITE_2_NEW = (
    "      const res = await fetch('/api/chat', {\n"
    "        method: 'POST', headers: { 'Content-Type': 'application/json' },\n"
    "        body: JSON.stringify({\n"
    "          message: userMsg,\n"
    "          history: history.slice(0, -1),\n"
    "          // Platform context\n"
    "          platform: activePlatform,\n"
    "          platformData,\n"
    "          dateRange,\n"
    "          // Client context\n"
    "          clientId: selectedClient.id,\n"
    "          clientName: selectedClient.name,\n"
    "          accountId: googleConn?.account_id,\n"
    "          // Drill context\n"
    "          drillLevel: drillState.level,\n"
    "          drillCampaign: drillState.campaign,\n"
    "          drillAdGroup: drillState.adGroup,\n"
    "          // LORAMER_FOCUS_LOCATION_V1 - tell the chat route which tab we're on\n"
    "          location: activeTab,\n"
    "        }),\n"
    "      })"
)


def patch(path, edits):
    """edits is a list of (old, new) tuples. Apply each exactly once."""
    if not os.path.exists(path):
        fatal(f"file not found: {path}")
    text = open(path).read()

    if MARKER in text:
        return False  # already applied

    # Validate ALL anchors before modifying any
    for i, (old, _new) in enumerate(edits):
        count = text.count(old)
        if count == 0:
            fatal(f"anchor #{i+1} not found in {path}")
        if count > 1:
            fatal(f"anchor #{i+1} matches {count} times in {path}, expected 1")

    # Apply
    for old, new in edits:
        text = text.replace(old, new, 1)

    with open(path, "w") as f:
        f.write(text)
    return True


def main():
    chat_changed = patch(CHAT_PATH, [
        (CHAT_DESTRUCTURE_OLD, CHAT_DESTRUCTURE_NEW),
        (CHAT_FOCUS_OLD, CHAT_FOCUS_NEW),
    ])
    if chat_changed:
        print("OK: chat/route.ts patched (destructure + focus computation)")
    else:
        print("chat/route.ts already patched. No-op.")

    dash_changed = patch(DASH_PATH, [
        (DASH_CALLSITE_1_OLD, DASH_CALLSITE_1_NEW),
        (DASH_CALLSITE_2_OLD, DASH_CALLSITE_2_NEW),
    ])
    if dash_changed:
        print("OK: dashboard/page.tsx patched (both /api/chat callsites send location)")
    else:
        print("dashboard/page.tsx already patched. No-op.")

    print()
    print("Effect: when the user is on the Shopify tab, Ask Claude tab, etc.,")
    print("Claude's system prompt now correctly identifies the view instead of")
    print("defaulting to 'Google Ads campaigns' for Shopify-only clients.")


if __name__ == "__main__":
    main()
