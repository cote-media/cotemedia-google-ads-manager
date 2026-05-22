#!/usr/bin/env python3
"""
Create the WooCommerce auth initiation route.

GET /api/woocommerce/auth?clientId=X&shop=https://store.com
  -> Builds the WordPress wc-auth/v1/authorize URL
  -> Redirects the browser to the user's WordPress store

The WordPress page shows "LoraMer wants access" and on approve,
WordPress POSTs the generated keys to our callback endpoint.

Usage: python3 woocommerce_auth_route.py
Idempotent.
"""
import os
import sys

PROJECT = os.path.expanduser("~/Downloads/cotemedia-ads-manager")
ROUTE = os.path.join(PROJECT, "src/app/api/woocommerce/auth/route.ts")


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


ROUTE_CONTENT = '''import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// LORAMER_WOO_AUTH_V1
// GET /api/woocommerce/auth?clientId=X&shop=https://store.example.com
//
// Kicks off the WooCommerce auto-key flow. We send the user to their
// WordPress store's wc-auth/v1/authorize page; on approve, WordPress
// POSTs the generated consumer_key + consumer_secret to our callback,
// then redirects the user back to return_url.
//
// Auto-key flow docs: https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication-over-http
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  let shop = searchParams.get('shop')

  if (!clientId || !shop) {
    return NextResponse.redirect(
      new URL('/clients?woo_error=missing_params', request.url)
    )
  }

  // Normalize the shop URL:
  //  - Strip any trailing slash
  //  - Ensure https:// scheme
  shop = shop.trim().replace(/\\/+$/, '')
  if (!/^https?:\\/\\//i.test(shop)) shop = 'https://' + shop
  // Force https for security (consumer secret travels through this redirect)
  shop = shop.replace(/^http:\\/\\//i, 'https://')

  // Build absolute callback + return URLs.
  // Use NEXTAUTH_URL as the canonical app origin (this is what NextAuth
  // also uses, so we know it's set in env).
  const origin = process.env.NEXTAUTH_URL || new URL(request.url).origin

  const callbackUrl = origin + '/api/woocommerce/callback?clientId=' +
    encodeURIComponent(clientId)

  const returnUrl = origin + '/clients?woo_pending=' +
    encodeURIComponent(clientId)

  const params = new URLSearchParams({
    app_name: 'LoraMer',
    scope: 'read',
    user_id: session.user.email,
    return_url: returnUrl,
    callback_url: callbackUrl,
  })

  const authUrl = shop + '/wc-auth/v1/authorize?' + params.toString()

  return NextResponse.redirect(authUrl)
}
'''


def main():
    if os.path.exists(ROUTE):
        existing = open(ROUTE).read()
        if "LORAMER_WOO_AUTH_V1" in existing:
            print("Already applied. No-op.")
            return
        fatal(f"file exists but lacks marker, refusing to overwrite: {ROUTE}")

    os.makedirs(os.path.dirname(ROUTE), exist_ok=True)
    with open(ROUTE, "w") as f:
        f.write(ROUTE_CONTENT)

    print("OK: created", ROUTE)
    print()
    print("Auth route lives at /api/woocommerce/auth")
    print("Next steps will build the callback and return endpoints.")


if __name__ == "__main__":
    main()
