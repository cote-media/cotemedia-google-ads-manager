// /api/shopify/auth
//
// NOTE TO SHOPIFY APP REVIEWERS:
// This route is NOT the Shopify App Store install path. The install path is
// /api/shopify/install (configured as application_url in shopify.app.toml),
// which is initiated from a Shopify-owned surface and does not ask the
// merchant to type a shop domain.
//
// This /api/shopify/auth route is a POST-INSTALL CONNECTION MANAGEMENT flow
// used by already-authenticated LoraMer users to connect ADDITIONAL Shopify
// stores to ADDITIONAL LoraMer clients within their account. A LoraMer user
// typically manages multiple businesses (e.g. an agency operator with many
// client stores) and uses this flow to attach each store to its own client
// record from within the app. The merchant typing the shop domain here is
// their own merchant (themselves), not an unrelated user — they already
// have an authenticated LoraMer session and are organizing connections.
//
// Per Shopify policy 2.3.1, the install path must not ask for a manual shop
// domain. This route is not an install path; it's a connection management
// path entered from /clients only after the user is signed into LoraMer.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.redirect(new URL('/auth/signin', request.url))

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const shop = searchParams.get('shop') // e.g. my-store.myshopify.com

  if (!clientId || !shop) {
    return NextResponse.json({ error: 'clientId and shop required' }, { status: 400 })
  }

  // Normalize shop domain
  const shopDomain = shop.replace('https://', '').replace('http://', '').replace(/\/$/, '')
  if (!shopDomain.includes('.myshopify.com')) {
    return NextResponse.json({ error: 'Invalid shop domain. Must be in format: your-store.myshopify.com' }, { status: 400 })
  }

  const scopes = 'read_orders,read_all_orders,read_products,read_customers'
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/shopify/callback`
  // LORAMER_NEXT_CONNECT_V1 F2 — carry an OPTIONAL returnTo in the state (Branch A only). Absent → state shape
  // identical to before; the callback validates it and falls back to /clients when absent/invalid.
  const returnTo = searchParams.get('returnTo') || undefined
  const state = Buffer.from(JSON.stringify({ clientId, userEmail: session.user.email, ...(returnTo ? { returnTo } : {}) })).toString('base64')

  const authUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`

  return NextResponse.redirect(authUrl)
}
