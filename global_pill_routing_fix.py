#!/usr/bin/env python3
"""
Global pill fix for clients/page.tsx.

The Platform type is 'google' | 'meta' | 'combined' only. Shopify and
WooCommerce are TABS, not platforms. Passing 'shopify' through
goToDashboard's platform parameter results in 'shopify' being written
to advar-active-platform, where the dashboard treats it as garbage.

Fix:
- Google pill: continues to pass 'google' to goToDashboard (correct, no change)
- Meta pill:   continues to pass 'meta'   to goToDashboard (correct, no change)
- Shopify pill:    sets advar-active-client + advar-active-tab='shopify' directly,
                   then router-pushes. Does NOT touch advar-active-platform.
- WooCommerce pill: same pattern with 'woocommerce'.

This means clicking Shopify or WooCommerce never clobbers the user's
last-used ad platform (Google/Meta/Combined), which is right - those
are independent selectors.

Also tighten goToDashboard's signature back to only the platforms it
should accept.

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


# ── Shopify pill onClick — current (broken) form ──
OLD_SHOPIFY_PILL = "<button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-tab', 'shopify') } catch {}; goToDashboard(client, 'shopify') }}"

# ── Shopify pill — new form (writes client+tab, not platform) ──
NEW_SHOPIFY_PILL = "<button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-client', client.id); localStorage.setItem('advar-active-tab', 'shopify') } catch {}; router.push('/dashboard') }}"

# ── WooCommerce pill onClick — current (broken) form ──
OLD_WOO_PILL = "<button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-tab', 'woocommerce') } catch {}; goToDashboard(client) }}"

# ── WooCommerce pill — new form ──
NEW_WOO_PILL = "<button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-client', client.id); localStorage.setItem('advar-active-tab', 'woocommerce') } catch {}; router.push('/dashboard') }}"

# ── goToDashboard signature: tighten back to platform values only ──
# (Shopify is no longer passed through here.)
OLD_SIG = "  function goToDashboard(client: Client, platform?: 'google' | 'meta' | 'shopify') {"
NEW_SIG = "  function goToDashboard(client: Client, platform?: 'google' | 'meta') {  // LORAMER_PILL_ROUTING_V2"


def safe_replace(text, old, new, label):
    if new in text:
        print(f"skip: {label} already applied")
        return text
    c = text.count(old)
    if c == 0:
        fatal(f"anchor missing: {label}")
    if c > 1:
        fatal(f"anchor matches {c} times, expected 1: {label}")
    print(f"ok: {label}")
    return text.replace(old, new, 1)


def main():
    if not os.path.exists(PATH):
        fatal("clients/page.tsx not found")

    text = open(PATH).read()
    text = safe_replace(text, OLD_SHOPIFY_PILL, NEW_SHOPIFY_PILL, "Shopify pill writes client+tab directly")
    text = safe_replace(text, OLD_WOO_PILL, NEW_WOO_PILL, "WooCommerce pill writes client+tab directly")
    text = safe_replace(text, OLD_SIG, NEW_SIG, "goToDashboard signature tightened")

    with open(PATH, "w") as f:
        f.write(text)

    print()
    print("All pills now route correctly:")
    print("  - Google pill   -> writes client + 'google' platform")
    print("  - Meta pill     -> writes client + 'meta' platform")
    print("  - Shopify pill  -> writes client + 'shopify' tab (platform unchanged)")
    print("  - WooCommerce   -> writes client + 'woocommerce' tab (platform unchanged)")


if __name__ == "__main__":
    main()
