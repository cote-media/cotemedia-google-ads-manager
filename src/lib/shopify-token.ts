// src/lib/shopify-token.ts
// Fetches a valid Shopify access token, refreshing it if expired or near-expired.
// All Shopify API calls should go through getValidShopifyToken() instead of reading
// access_token directly from Supabase.
//
// Per Shopify docs (Dec 2025+):
// - Access tokens expire after 1 hour
// - Refresh tokens expire after 90 days
// - Each refresh ROTATES the refresh token — must save the new one
// - If refresh token is expired, merchant must reinstall the app

import { supabaseAdmin } from '@/lib/supabase'

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before expiry

export type ShopifyTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'no_token' | 'refresh_expired' | 'refresh_failed'; detail?: string }

export async function getValidShopifyToken(
  userEmail: string,
  shopDomain: string
): Promise<ShopifyTokenResult> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from('shopify_tokens')
    .select('access_token, refresh_token, expires_at, refresh_token_expires_at')
    .eq('user_email', userEmail)
    .eq('shop_domain', shopDomain)
    .single()

  if (error || !tokenRow?.access_token) {
    return { ok: false, reason: 'no_token', detail: error?.message }
  }

  // Legacy non-expiring token (no expires_at set) — just return it, the migration
  // endpoint will handle upgrading these. Until migration, they still work.
  if (!tokenRow.expires_at) {
    return { ok: true, accessToken: tokenRow.access_token }
  }

  const now = Date.now()
  const expiresAtMs = new Date(tokenRow.expires_at).getTime()

  // Token is still valid (with buffer)
  if (expiresAtMs - now > REFRESH_BUFFER_MS) {
    return { ok: true, accessToken: tokenRow.access_token }
  }

  // Token expired or near-expired — need to refresh
  if (!tokenRow.refresh_token) {
    return { ok: false, reason: 'no_token', detail: 'expired with no refresh token' }
  }

  // Check refresh token expiration
  if (tokenRow.refresh_token_expires_at) {
    const refreshExpiresAtMs = new Date(tokenRow.refresh_token_expires_at).getTime()
    if (refreshExpiresAtMs <= now) {
      return { ok: false, reason: 'refresh_expired' }
    }
  }

  // Perform refresh
  const refreshRes = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id: process.env.SHOPIFY_CLIENT_ID!,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
    }).toString(),
  })

  const refreshed = await refreshRes.json()

  if (!refreshed.access_token) {
    console.error('Shopify token refresh failed:', refreshed)
    return { ok: false, reason: 'refresh_failed', detail: JSON.stringify(refreshed) }
  }

  // Compute new expirations
  const refreshTime = Date.now()
  const newExpiresAt = new Date(refreshTime + (refreshed.expires_in || 3600) * 1000).toISOString()
  const newRefreshExpiresAt = new Date(
    refreshTime + (refreshed.refresh_token_expires_in || 7776000) * 1000
  ).toISOString()

  // CRITICAL: save the new refresh token — old one is now invalidated
  await supabaseAdmin
    .from('shopify_tokens')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: newExpiresAt,
      refresh_token_expires_at: newRefreshExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_email', userEmail)
    .eq('shop_domain', shopDomain)

  return { ok: true, accessToken: refreshed.access_token }
}
