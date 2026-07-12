import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'
import { signInstallToken } from '@/lib/shopify-install-token' // LORAMER_SHOPIFY_INSTALL_V1
import { kickoffBackfill } from '@/lib/backfill/kickoff' // LORAMER_SELFSERVE_SPINE_V1 step 2
import { ensureOrgForOwner } from '@/lib/access/ensure-org' // LORAMER_RBAC_ORG_PROVISION_V1 — the auto-created client gets an org_id

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

  // LORAMER_SHOPIFY_TOKEN_HARDEN_V1 — FIX 2: shared token fields for both branches. Include
  // refresh_token / its expiry ONLY when Shopify returned one, so an absent rotated token never
  // nulls an existing value on a reinstall upsert. (user_email is added per-branch below.)
  const tokenFields: Record<string, unknown> = {
    shop_domain: shop,
    access_token: tokenData.access_token,
    expires_at: expiresAt,
    scope: tokenData.scope,
    updated_at: new Date().toISOString(),
  }
  if (tokenData.refresh_token) {
    tokenFields.refresh_token = tokenData.refresh_token
    tokenFields.refresh_token_expires_at = new Date(
      now + (tokenData.refresh_token_expires_in || 7776000) * 1000
    ).toISOString()
  }

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
      backfill_priority: 10,
    })

    await supabaseAdmin
      .from('shopify_tokens')
      .upsert({ user_email: userEmail, ...tokenFields }, { onConflict: 'user_email,shop_domain' })

    // LORAMER_SELFSERVE_SPINE_V1 step 2 — connect-kickoff.
    kickoffBackfill(new URL(request.url).origin, clientId, 'shopify')
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
      // Brand new install — create a client row first.
      // LORAMER_RBAC_ORG_PROVISION_V1 — resolve-or-create the merchant's org so the client is born WITH an org_id
      // (precondition for the NOT-NULL lock). defaultType 'solo' — a single store install = a single business;
      // the two-door homepage overrides org_type if the merchant later signs up as an agency. LIVE-PATH: a failure
      // here must abort the install cleanly (never insert an org-less client), same contract as the client-insert below.
      let orgId: string
      try {
        orgId = await ensureOrgForOwner(userEmail, { defaultType: 'solo', name: shopName })
      } catch (e: any) {
        console.error('Failed to provision org for Shopify install:', e?.message || e)
        return NextResponse.redirect(new URL('/?install_error=client_create_failed', request.url))
      }

      const { data: newClient, error: clientErr } = await supabaseAdmin
        .from('clients')
        .insert({ name: shopName, user_email: userEmail, org_id: orgId })
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
      backfill_priority: 10,
    })

    // Upsert tokens
    await supabaseAdmin
      .from('shopify_tokens')
      .upsert({ user_email: userEmail, ...tokenFields }, { onConflict: 'user_email,shop_domain' })

    // LORAMER_SELFSERVE_SPINE_V1 step 2 — connect-kickoff.
    kickoffBackfill(new URL(request.url).origin, clientId, 'shopify')
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
