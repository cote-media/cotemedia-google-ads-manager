#!/usr/bin/env python3
"""
WooCommerce flow - three changes in one atomic script:

1. PATCH /api/woocommerce/auth/route.ts
   Add &shop=... to the callback_url so WordPress echoes the shop
   back to us in the credentials POST. Without this we don't know
   which store the keys belong to.

2. CREATE /api/woocommerce/callback/route.ts
   Receive the POST from WordPress containing:
     { key_id, user_id, consumer_key, consumer_secret, key_permissions }
   Read shop from query string. Save to woocommerce_tokens, mark
   platform_connections (delete-then-insert pattern, matching Shopify).

3. CREATE /api/woocommerce/return/route.ts
   GET endpoint WordPress redirects the user to after they approve
   or deny. Bounces them back to /clients with a success or error param.

Atomic: validates everything before writing any file.

Usage: python3 woo_auth_callback_return.py
Idempotent.
"""
import os
import sys

PROJECT = os.path.expanduser("~/Downloads/cotemedia-ads-manager")
AUTH_ROUTE = os.path.join(PROJECT, "src/app/api/woocommerce/auth/route.ts")
CALLBACK_ROUTE = os.path.join(PROJECT, "src/app/api/woocommerce/callback/route.ts")
RETURN_ROUTE = os.path.join(PROJECT, "src/app/api/woocommerce/return/route.ts")

MARKER_AUTH_PATCH = "LORAMER_WOO_AUTH_V2"
MARKER_CALLBACK = "LORAMER_WOO_CALLBACK_V1"
MARKER_RETURN = "LORAMER_WOO_RETURN_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# ===========================================================================
# Replacement content
# ===========================================================================

CALLBACK_CONTENT = '''import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// LORAMER_WOO_CALLBACK_V1
// POST /api/woocommerce/callback?clientId=X&shop=https://store.com
//
// WordPress POSTs JSON after the user approves on the wc-auth page:
//   {
//     key_id:          123,
//     user_id:         'user@example.com',  // we passed this in the auth redirect
//     consumer_key:    'ck_...',
//     consumer_secret: 'cs_...',
//     key_permissions: 'read'
//   }
//
// We also passed &shop= and &clientId= through the callback_url so we
// know which client/store these keys belong to.
//
// This endpoint is publicly reachable (WordPress hits it directly, not
// from an authenticated browser). user_id is whatever we sent WordPress
// in the auth redirect, so we trust it as identity.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const shop = searchParams.get('shop')

  if (!clientId || !shop) {
    return NextResponse.json(
      { error: 'missing clientId or shop in query string' },
      { status: 400 }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const consumerKey = body?.consumer_key
  const consumerSecret = body?.consumer_secret
  const userEmail = body?.user_id
  const keyPermissions = body?.key_permissions || 'read'

  if (!consumerKey || !consumerSecret || !userEmail) {
    return NextResponse.json(
      { error: 'missing required credential fields' },
      { status: 400 }
    )
  }

  // Save the credentials. Upsert on (user_email, client_id) because
  // the table has a unique index on that pair; reconnecting overwrites.
  const tokenWrite = await supabaseAdmin
    .from('woocommerce_tokens')
    .upsert(
      {
        user_email: userEmail,
        client_id: clientId,
        store_url: shop,
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
        scope: keyPermissions,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email,client_id' }
    )

  if (tokenWrite.error) {
    console.error('[woo callback] woocommerce_tokens write failed:', tokenWrite.error)
    return NextResponse.json({ error: 'token save failed' }, { status: 500 })
  }

  // Register the platform connection so the clients list / dashboard
  // know this client has WooCommerce. Use the Shopify pattern of
  // delete-then-insert to avoid relying on unique indexes we may not have.
  await supabaseAdmin
    .from('platform_connections')
    .delete()
    .eq('client_id', clientId)
    .eq('platform', 'woocommerce')

  const insert = await supabaseAdmin.from('platform_connections').insert({
    client_id: clientId,
    user_email: userEmail,
    platform: 'woocommerce',
    account_id: shop,
    account_name: shop.replace(/^https?:\\/\\//, ''),
  })

  if (insert.error) {
    console.error('[woo callback] platform_connections insert failed:', insert.error)
    // Tokens are saved; UI will recover next sign-in. Still 200 so
    // WordPress doesn't keep retrying.
  }

  return NextResponse.json({ success: true })
}
'''


RETURN_CONTENT = '''import { NextResponse } from 'next/server'

// LORAMER_WOO_RETURN_V1
// GET /api/woocommerce/return?clientId=X&success=1   (after approval)
// GET /api/woocommerce/return?clientId=X&success=0   (if user denied)
//
// WordPress redirects the user here AFTER it has POSTed the credentials
// to our callback. The keys are already saved at this point. We just
// route the user back to /clients with a status param the UI can show.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || ''
  const success = searchParams.get('success')

  const target = new URL('/clients', request.url)

  if (success === '0') {
    target.searchParams.set('woo_error', 'denied')
  } else {
    target.searchParams.set('woo_connected', clientId)
  }

  return NextResponse.redirect(target)
}
'''


# ===========================================================================
# Auth route patch: replace the callbackUrl + returnUrl construction so the
# callback URL includes &shop=, and the return URL points at our new return
# route (was /clients before).
# ===========================================================================

# Build old/new as raw strings so no shell interpretation has happened.
OLD_AUTH_BLOCK = (
    "  const callbackUrl = origin + '/api/woocommerce/callback?clientId=' +\n"
    "    encodeURIComponent(clientId)\n"
    "\n"
    "  const returnUrl = origin + '/clients?woo_pending=' +\n"
    "    encodeURIComponent(clientId)\n"
)

NEW_AUTH_BLOCK = (
    "  // LORAMER_WOO_AUTH_V2 - shop is round-tripped through callback so the\n"
    "  // callback route knows which store the credentials belong to (WordPress\n"
    "  // does not include the shop URL in the credentials POST body).\n"
    "  const callbackUrl =\n"
    "    origin + '/api/woocommerce/callback?clientId=' +\n"
    "    encodeURIComponent(clientId) +\n"
    "    '&shop=' + encodeURIComponent(shop)\n"
    "\n"
    "  const returnUrl =\n"
    "    origin + '/api/woocommerce/return?clientId=' +\n"
    "    encodeURIComponent(clientId)\n"
)


def main():
    # ---- Pre-flight: confirm we can do every step before writing anything ----
    if not os.path.exists(AUTH_ROUTE):
        fatal(
            f"auth route not found at {AUTH_ROUTE}\n"
            f"Run woocommerce_auth_route.py first."
        )

    auth_text = open(AUTH_ROUTE).read()
    auth_already_patched = MARKER_AUTH_PATCH in auth_text

    if not auth_already_patched and OLD_AUTH_BLOCK not in auth_text:
        fatal(
            "auth route exists but its callback/return block doesn't match what\n"
            "we expected to patch. Refusing to risk breaking it."
        )

    callback_exists = os.path.exists(CALLBACK_ROUTE)
    return_exists = os.path.exists(RETURN_ROUTE)

    if callback_exists:
        existing = open(CALLBACK_ROUTE).read()
        if MARKER_CALLBACK not in existing:
            fatal(f"{CALLBACK_ROUTE} exists without our marker; refusing to overwrite")
    if return_exists:
        existing = open(RETURN_ROUTE).read()
        if MARKER_RETURN not in existing:
            fatal(f"{RETURN_ROUTE} exists without our marker; refusing to overwrite")

    # ---- All checks passed; now write ----

    # 1. Patch auth route (if not already patched)
    if auth_already_patched:
        print("auth route: already patched, skipping")
    else:
        new_auth_text = auth_text.replace(OLD_AUTH_BLOCK, NEW_AUTH_BLOCK, 1)
        with open(AUTH_ROUTE, "w") as f:
            f.write(new_auth_text)
        print("auth route patched: callback URL now passes &shop=, return URL points at /api/woocommerce/return")

    # 2. Create callback route (if not already there)
    if callback_exists and MARKER_CALLBACK in open(CALLBACK_ROUTE).read():
        print("callback route: already present, skipping")
    else:
        os.makedirs(os.path.dirname(CALLBACK_ROUTE), exist_ok=True)
        with open(CALLBACK_ROUTE, "w") as f:
            f.write(CALLBACK_CONTENT)
        print(f"callback route created at {CALLBACK_ROUTE}")

    # 3. Create return route (if not already there)
    if return_exists and MARKER_RETURN in open(RETURN_ROUTE).read():
        print("return route: already present, skipping")
    else:
        os.makedirs(os.path.dirname(RETURN_ROUTE), exist_ok=True)
        with open(RETURN_ROUTE, "w") as f:
            f.write(RETURN_CONTENT)
        print(f"return route created at {RETURN_ROUTE}")

    print()
    print("=" * 50)
    print("WooCommerce auth + callback + return wired up.")
    print("Next: add Connect WooCommerce UI to /clients page.")
    print("=" * 50)


if __name__ == "__main__":
    main()
