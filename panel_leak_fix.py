#!/usr/bin/env python3
"""
Strip the internal panelKey leak from Claude's system prompt.

Before: each past message had `[shopify-google]` or similar internal labels
prepended, and Claude would echo these back at users when asked about
past conversations.

After: messages still appear in chronological order, but without internal
channel markers. System-prompt language now explicitly tells Claude to
refer to past conversations in natural English, not internal labels.

This is the user-facing leak fix only. The deeper structural issue \u2014
that the locationKey concatenates the ad-platform selector even on the
Shopify and WooCommerce tabs where it has no meaning \u2014 is logged to
LAUNCH_PARKING.md for after launch.

Idempotent.
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/lib/intelligence/build-claude-context.ts"
)
MARKER = "LORAMER_PANEL_LEAK_FIX_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# IMPORTANT: \\n in the original .ts file is the literal two characters
# backslash-n (the source code of the string, not a newline). In Python
# source, "\\n" represents those same two characters. Triple-double-quote
# is fine here since the source has no embedded triple quotes.
OLD = (
    "  const lines = ['\\n=== PREVIOUS CONVERSATIONS (across all panels for this client) ===']\n"
    "  lines.push('(All discussions the user has had about this client. Treat these as binding context.)')\n"
    "\n"
    "  const recent = flat.slice(-20)\n"
    "  recent.forEach((m) => {\n"
    "    const truncated = m.content.length > 800 ? m.content.slice(0, 797) + '...' : m.content\n"
    "    lines.push(`  [${m.panelKey}] ${m.role === 'user' ? 'User' : 'Claude'}: ${truncated}`)\n"
    "  })"
)

NEW = (
    "  // LORAMER_PANEL_LEAK_FIX_V1 - strip internal panelKey from messages so 'shopify-google' style labels never leak to users\n"
    "  const lines = ['\\n=== PREVIOUS CONVERSATIONS WITH THIS USER ===']\n"
    "  lines.push('(All earlier discussions about this client. Treat these as binding context. Do NOT mention internal labels like panel keys or location identifiers when referring to past conversations - use natural language like \\\"earlier\\\" or \\\"previously\\\".)')\n"
    "\n"
    "  const recent = flat.slice(-20)\n"
    "  recent.forEach((m) => {\n"
    "    const truncated = m.content.length > 800 ? m.content.slice(0, 797) + '...' : m.content\n"
    "    lines.push(`  ${m.role === 'user' ? 'User' : 'Claude'}: ${truncated}`)\n"
    "  })"
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
        fatal("anchor not found - dump first 20 chars of OLD: " + repr(OLD[:80]))
    if count > 1:
        fatal(f"anchor matches {count} times, expected 1")

    new_text = text.replace(OLD, NEW, 1)
    with open(PATH, "w") as f:
        f.write(new_text)

    print("OK: panel keys removed from past-conversation context.")
    print("    Claude will no longer leak strings like 'shopify-google' to users.")


if __name__ == "__main__":
    main()
