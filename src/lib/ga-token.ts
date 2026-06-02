// LORAMER_GA_INTELLIGENCE_V1
// src/lib/ga-token.ts
// Fetches a valid Google Analytics access token, refreshing it when expired.
// All GA4 Data API calls should use getValidGaToken() instead of reading
// access_token directly from Supabase.

import { supabaseAdmin } from '@/lib/supabase'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export type GaTokenResult =
  | { ok: true; accessToken: string; gaPropertyId: string; gaPropertyName: string }
  | { ok: false; reason: 'no_token' | 'refresh_failed'; detail?: string }

type GaTokenRow = {
  access_token: string
  refresh_token: string
  expires_at: string
  ga_property_id: string
  ga_property_name: string | null
}

export async function getValidGaToken(
  clientId: string,
  userEmail: string
): Promise<GaTokenResult> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from('ga_tokens')
    .select('access_token, refresh_token, expires_at, ga_property_id, ga_property_name')
    .eq('client_id', clientId)
    .eq('user_email', userEmail)
    .single()

  if (error || !tokenRow?.access_token) {
    return { ok: false, reason: 'no_token', detail: error?.message }
  }

  const row = tokenRow as GaTokenRow
  const propertyId = row.ga_property_id
  const propertyName = row.ga_property_name || propertyId

  if (!propertyId) {
    return { ok: false, reason: 'no_token', detail: 'missing ga_property_id' }
  }

  const now = Date.now()
  const expiresAtMs = new Date(row.expires_at).getTime()

  if (expiresAtMs > now) {
    return {
      ok: true,
      accessToken: row.access_token,
      gaPropertyId: propertyId,
      gaPropertyName: propertyName,
    }
  }

  if (!row.refresh_token) {
    return { ok: false, reason: 'no_token', detail: 'expired with no refresh token' }
  }

  const clientIdEnv = process.env.GOOGLE_ANALYTICS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET
  if (!clientIdEnv || !clientSecret) {
    return { ok: false, reason: 'refresh_failed', detail: 'GA OAuth env vars not configured' }
  }

  const refreshRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientIdEnv,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }).toString(),
  })

  const refreshed = await refreshRes.json()

  if (!refreshed.access_token) {
    console.error('GA token refresh failed:', refreshed)
    return { ok: false, reason: 'refresh_failed', detail: JSON.stringify(refreshed) }
  }

  const refreshTime = Date.now()
  const newExpiresAt = new Date(
    refreshTime + (refreshed.expires_in || 3600) * 1000
  ).toISOString()

  const updatePayload: Record<string, string> = {
    access_token: refreshed.access_token,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }
  if (refreshed.refresh_token) {
    updatePayload.refresh_token = refreshed.refresh_token
  }

  await supabaseAdmin
    .from('ga_tokens')
    .update(updatePayload)
    .eq('client_id', clientId)
    .eq('user_email', userEmail)

  return {
    ok: true,
    accessToken: refreshed.access_token,
    gaPropertyId: propertyId,
    gaPropertyName: propertyName,
  }
}
