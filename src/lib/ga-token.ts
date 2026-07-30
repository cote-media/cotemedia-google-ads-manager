// LORAMER_GA_INTELLIGENCE_V1
// src/lib/ga-token.ts
// Fetches a valid Google Analytics access token, refreshing it when expired.
// All GA4 Data API calls should use getValidGaToken() instead of reading
// access_token directly from Supabase.

import { supabaseAdmin } from '@/lib/supabase'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export type GaTokenResult =
  | { ok: true; accessToken: string; gaPropertyId: string; gaPropertyName: string; refreshed: boolean }
  // 'reconnect_required' is DISTINCT from 'refresh_failed' on purpose: refresh_failed is transient (Google
  // was unreachable, the response was malformed, we could not validate) and the caller should retry later;
  // reconnect_required means the grant produced a token Google itself rejects, and no amount of retrying
  // fixes it — a human has to re-authorize. Collapsing them would send an operator round the retry loop
  // forever, which is the shape of the 2026-07-30 outage.
  | { ok: false; reason: 'no_token' | 'refresh_failed' | 'reconnect_required'; detail?: string }

const GOOGLE_TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo'

// LORAMER_TOKEN_VALIDATE_BEFORE_PERSIST_V1 — prove a token before storing it.
// tokeninfo is the right validator here and that is measured, not assumed: on 2026-07-30 it returned
// HTTP 400 `invalid_token / "Invalid Value"` for the exact dead token the Data API was 401-ing on, and
// HTTP 200 for the working one. It costs ZERO GA4 property quota — which matters, because this runs on
// every refresh and the thresholded-requests cap is the binding constraint on this fleet.
// THREE OUTCOMES, and the third is the one that keeps this safe:
//   200      → live. Persist.
//   4xx      → Google says the token is invalid. Do NOT persist; the caller must re-authorize.
//   anything else (network error, 5xx) → UNKNOWN. Do NOT persist either. We cannot prove the new token is
//     better than the one we hold, and the mandate is that a refresh may never downgrade a working
//     credential. Refusing to write on an unprovable result is the only direction that honours that.
async function proveAccessTokenLive(accessToken: string): Promise<{ live: boolean; verdict: 'live' | 'rejected' | 'unknown'; detail: string }> {
  try {
    const res = await fetch(`${GOOGLE_TOKENINFO_ENDPOINT}?access_token=${encodeURIComponent(accessToken)}`)
    if (res.status === 200) return { live: true, verdict: 'live', detail: 'tokeninfo 200' }
    if (res.status >= 400 && res.status < 500) {
      let body = ''
      try { body = JSON.stringify(await res.json()) } catch { body = `HTTP ${res.status}` }
      return { live: false, verdict: 'rejected', detail: `tokeninfo ${res.status}: ${body}` }
    }
    return { live: false, verdict: 'unknown', detail: `tokeninfo HTTP ${res.status} — cannot prove` }
  } catch (e: any) {
    return { live: false, verdict: 'unknown', detail: `tokeninfo unreachable: ${String(e?.message ?? e)}` }
  }
}

type GaTokenRow = {
  access_token: string
  refresh_token: string
  expires_at: string
  ga_property_id: string
  ga_property_name: string | null
}

// LORAMER_GA_TOKEN_LIVENESS_V1 — `forceRefresh` is the LIVENESS PATH, and it exists because expires_at is not one.
// MEASURED 2026-07-30, Foam OH: the stored access_token was DEAD (tokeninfo `invalid_token / "Invalid Value"`, GA
// Data API 401 UNAUTHENTICATED) while expires_at read 17:46:05Z — an hour in the FUTURE. The early return below
// therefore handed back a corpse on every call and never refreshed, so the failure was self-perpetuating rather
// than self-healing: six chained probes, twelve 401s each, zero rows, for 25 minutes.
// ⛔ THE RULE: expires_at can prove a token is DEAD. It can NEVER prove one is ALIVE. The only test that proves
// liveness is USING the token, so the real check lives at the call site (a 401 forces a refresh and retries once —
// see fetchGaDimensionalRows' onAuthRetry hook) and this flag is what lets that call site ask for a new one.
export async function getValidGaToken(
  clientId: string,
  userEmail: string,
  opts: { forceRefresh?: boolean } = {}
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

  // A CHEAP PRE-FILTER, NOT A VALIDITY CLAIM. It skips a token-endpoint round trip on the common path; it does not
  // assert the token works. `forceRefresh` is how a caller that has SEEN a 401 overrides it — without that override
  // this branch is a trap, because a dead-but-unexpired token satisfies it forever (see the header).
  if (!opts.forceRefresh && expiresAtMs > now) {
    return {
      ok: true,
      accessToken: row.access_token,
      gaPropertyId: propertyId,
      gaPropertyName: propertyName,
      refreshed: false,
    }
  }

  if (!row.refresh_token) {
    return {
      ok: false,
      reason: 'no_token',
      detail: opts.forceRefresh ? 'GA rejected the stored token and there is no refresh token to recover with' : 'expired with no refresh token',
    }
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

  // ⛔ GUARD 1 — IDENTICAL TOKEN IS A FAILED REFRESH, NOT A SUCCESSFUL ONE.
  // MEASURED 2026-07-30: this path received the byte-identical stored access token back from the token
  // endpoint and wrote it over a freshly re-authorized credential, stamping a brand-new one-hour
  // expires_at on a corpse. That is what made the outage self-perpetuating — every later caller saw a
  // healthy-looking row. A refresh that hands back what we already had has bought us nothing; treating it
  // as success is how "nothing changed" became "everything looks fine".
  if (refreshed.access_token === row.access_token) {
    console.error(`[ga-token] client=${clientId} refresh returned the BYTE-IDENTICAL stored token — treating as a FAILED refresh and leaving the row untouched.`)
    return { ok: false, reason: 'refresh_failed', detail: 'token endpoint returned the byte-identical stored access token — nothing was refreshed, row left untouched' }
  }

  // ⛔ GUARD 2 — PROVE IT BEFORE PERSISTING. A refresh must never be able to downgrade a working credential.
  const proof = await proveAccessTokenLive(refreshed.access_token)
  if (!proof.live) {
    console.error(`[ga-token] client=${clientId} refreshed token FAILED validation (${proof.verdict}): ${proof.detail}. Row left UNTOUCHED.`)
    return {
      ok: false,
      reason: proof.verdict === 'rejected' ? 'reconnect_required' : 'refresh_failed',
      detail: proof.detail,
    }
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

  // Only reached with a token that is DIFFERENT from the stored one AND proven live by Google itself.
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
    refreshed: true,
  }
}
