import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const shop = searchParams.get('shop')
  const state = searchParams.get('state')
  const hmac = searchParams.get('hmac')

  if (!code || !shop || !state) {
    return NextResponse.redirect(new URL('/clients?shopify_error=missing_params', request.url))
  }

  // Verify HMAC signature from Shopify
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
    return NextResponse.redirect(new URL('/clients?shopify_error=invalid_hmac', request.url))
  }

  // Decode state
  let clientId: string
  let userEmail: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString())
    clientId = decoded.clientId
    userEmail = decoded.userEmail
  } catch {
    return NextResponse.redirect(new URL('/clients?shopify_error=invalid_state', request.url))
  }

  // Exchange code for EXPIRING offline access token (Shopify Dec 2025+ standard)
  // Note: Shopify requires application/x-www-form-urlencoded for this endpoint
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id: process.env.SHOPIFY_CLIENT_ID!,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
      code,
      expiring: '1',
    }).toString(),
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    console.error('Shopify token exchange failed:', tokenData)
    return NextResponse.redirect(new URL('/clients?shopify_error=token_exchange_failed', request.url))
  }

  // Compute absolute expiration timestamps
  // expires_in = 3600 (1 hour), refresh_token_expires_in = 7776000 (90 days)
  const now = Date.now()
  const expiresAt = new Date(now + (tokenData.expires_in || 3600) * 1000).toISOString()
  const refreshTokenExpiresAt = new Date(
    now + (tokenData.refresh_token_expires_in || 7776000) * 1000
  ).toISOString()

  // Get shop details for account name
  const shopRes = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
    headers: { 'X-Shopify-Access-Token': tokenData.access_token },
  })
  const shopData = await shopRes.json()
  const shopName = shopData.shop?.name || shop

  // Store connection in platform_connections
  await supabaseAdmin
    .from('platform_connections')
    .delete()
    .eq('client_id', clientId)
    .eq('platform', 'shopify')

  await supabaseAdmin.from('platform_connections').insert({
    client_id: clientId,
    user_email: userEmail,
    platform: 'shopify',
    account_id: shop,
    account_name: shopName,
  })

  // Store tokens (access + refresh + expirations) in shopify_tokens table
  await supabaseAdmin
    .from('shopify_tokens')
    .upsert(
      {
        user_email: userEmail,
        shop_domain: shop,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        refresh_token_expires_at: refreshTokenExpiresAt,
        scope: tokenData.scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email,shop_domain' }
    )

  return NextResponse.redirect(new URL('/clients?shopify_connected=true', request.url))
}
