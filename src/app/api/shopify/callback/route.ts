import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'
import { signInstallToken } from '@/lib/shopify-install-token' // LORAMER_SHOPIFY_INSTALL_V1

const GRAPHQL_API_VERSION = '2025-01' // LORAMER_GRAPHQL_MIGRATION_V1

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

  // Decode state. We support TWO shapes:
  //   A) Existing in-app flow:  { clientId, userEmail }
  //   B) Shopify-initiated:     { shopify_initiated: true, shop, nonce }
  let decodedState: any
  try {
    decodedState = JSON.parse(Buffer.from(state, 'base64').toString())
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
    const errorTarget = decodedState?.shopify_initiated ? '/?install_error=token_exchange_failed' : '/clients?shopify_error=token_exchange_failed'
    return NextResponse.redirect(new URL(errorTarget, request.url))
  }

  // Compute absolute expiration timestamps
  const now = Date.now()
  const expiresAt = new Date(now + (tokenData.expires_in || 3600) * 1000).toISOString()
  const refreshTokenExpiresAt = new Date(
    now + (tokenData.refresh_token_expires_in || 7776000) * 1000
  ).toISOString()

  // LORAMER_GRAPHQL_MIGRATION_V1 — fetch shop name via GraphQL (was REST shop.json)
  let shopName = shop
  try {
    const shopRes = await fetch(`https://${shop}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': tokenData.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ shop { name } }' }),
    })
    const shopJson = await shopRes.json()
    if (shopJson.data?.shop?.name) shopName = shopJson.data.shop.name
  } catch (e) {
    // Non-fatal — fall back to using the shop domain as the account name
    console.error('Shop name GraphQL lookup failed:', e)
  }

  // ─── BRANCH A: existing in-app flow ──────────────────────────────────────
  // Triggered by the "+ Shopify" modal in /clients. State has {clientId, userEmail}.
  // Behavior preserved exactly as before.
  if (decodedState?.clientId && decodedState?.userEmail) {
    const clientId: string = decodedState.clientId
    const userEmail: string = decodedState.userEmail

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

  // ─── BRANCH B: Shopify-initiated install (LORAMER_SHOPIFY_INSTALL_V1) ────
  // Triggered by clicking "Install" in the Shopify App Store. State has
  // {shopify_initiated: true, shop, nonce}. We auto-create the user + client
  // if they don't exist yet, attach tokens, then sign a JWT and redirect to
  // /install/complete which signs the user in client-side.
  if (decodedState?.shopify_initiated === true) {
    // Derive a stable userEmail from the shop handle.
    // shop = "foo-bar.myshopify.com" → handle = "foo-bar"
    const shopHandle = shop.replace(/\.myshopify\.com$/i, '').toLowerCase()
    const userEmail = `shopify+${shopHandle}@loramer.app`

    // Find-or-create the install mapping. If this shop has been installed
    // before, we reuse the existing user/client; only the tokens get refreshed.
    let clientId: string
    const { data: existingInstall } = await supabaseAdmin
      .from('shopify_installs')
      .select('user_email, client_id')
      .eq('shop_domain', shop)
      .maybeSingle()

    if (existingInstall?.client_id) {
      clientId = existingInstall.client_id
    } else {
      // Brand new install — create a client row first
      const { data: newClient, error: clientErr } = await supabaseAdmin
        .from('clients')
        .insert({ name: shopName, user_email: userEmail })
        .select('id')
        .single()

      if (clientErr || !newClient?.id) {
        console.error('Failed to create client for Shopify install:', clientErr)
        return NextResponse.redirect(new URL('/?install_error=client_create_failed', request.url))
      }

      clientId = newClient.id

      // Record the install mapping so future reinstalls are idempotent
      const { error: installErr } = await supabaseAdmin
        .from('shopify_installs')
        .insert({
          shop_domain: shop,
          user_email: userEmail,
          client_id: clientId,
        })

      if (installErr) {
        console.error('Failed to record shopify_installs row:', installErr)
        // Continue anyway — the install can still succeed even if mapping write failed
      }
    }

    // Upsert platform_connections (replace any prior Shopify connection for this client)
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

    // Upsert tokens
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

    // Sign a short-lived install token and redirect to /install/complete,
    // which calls signIn('shopify-install', { token }) to create the session.
    const installToken = signInstallToken(userEmail)
    const completeUrl = new URL('/install/complete', request.url)
    completeUrl.searchParams.set('token', installToken)
    return NextResponse.redirect(completeUrl)
  }

  // Unknown state shape — fail safe
  return NextResponse.redirect(new URL('/clients?shopify_error=invalid_state', request.url))
}
