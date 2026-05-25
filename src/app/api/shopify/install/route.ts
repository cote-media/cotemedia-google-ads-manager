// LORAMER_SHOPIFY_INSTALL_V1
// src/app/api/shopify/install/route.ts
//
// Entry point for Shopify-initiated installs (App Store "Install" button).
// Shopify redirects here with: ?shop=<store>.myshopify.com&host=<base64>&hmac=...&timestamp=...
//
// We verify the HMAC, then redirect to Shopify OAuth with a state marker
// that the callback uses to distinguish Shopify-initiated installs from
// in-app installs (the existing /api/shopify/auth flow).
//
// This route does NOT require an existing NextAuth session — that's the
// whole point. Merchant clicks Install on Shopify → lands here → OAuth
// fires immediately. Compliance with App Store requirements 2.3.1 + 2.3.2.

import { NextResponse } from 'next/server'
import crypto from 'crypto'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const shop = searchParams.get('shop')
  const hmac = searchParams.get('hmac')

  if (!shop) {
    return NextResponse.redirect(new URL('/?install_error=missing_shop', request.url))
  }

  // Normalize and validate shop domain
  const shopDomain = shop.replace('https://', '').replace('http://', '').replace(/\/$/, '')
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) {
    return NextResponse.redirect(new URL('/?install_error=invalid_shop', request.url))
  }

  // Verify HMAC if present (Shopify includes it on App Store installs).
  // If missing, this might be a direct test hit — accept in development only.
  if (hmac) {
    const params = new URLSearchParams(searchParams)
    params.delete('hmac')
    params.delete('signature')
    const sortedParams = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
    const computedHmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET!)
      .update(sortedParams)
      .digest('hex')

    if (computedHmac !== hmac) {
      return NextResponse.redirect(new URL('/?install_error=invalid_hmac', request.url))
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.redirect(new URL('/?install_error=missing_hmac', request.url))
  }

  // Build state with marker indicating this is a Shopify-initiated install.
  // The callback branches on this marker to create user/client automatically.
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = Buffer.from(
    JSON.stringify({
      shopify_initiated: true,
      shop: shopDomain,
      nonce,
    })
  ).toString('base64')

  const scopes = 'read_orders,read_products,read_customers'
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/shopify/callback`
  const authUrl =
    `https://${shopDomain}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_CLIENT_ID}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`

  return NextResponse.redirect(authUrl)
}
