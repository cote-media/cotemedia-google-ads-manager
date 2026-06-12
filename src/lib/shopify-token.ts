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
//
// LORAMER_SHOPIFY_REFRESH_RACE_V1 — concurrent callers (dashboard /api/intelligence, cron/sync,
// shopify/daily) can all hit an expired token at once. We serialize the refresh with a persisted
// compare-and-swap CLAIM on the row (shopify_tokens.refresh_claimed_at + claim_shopify_refresh
// RPC, migration 009): exactly ONE caller refreshes against Shopify; losers wait for the winner's
// published token. An advisory lock can't be used here — the app reaches Postgres only via
// supabase-js/PostgREST behind Supavisor transaction pooling, so a lock dies when the RPC's
// transaction returns, before the Shopify fetch. A persisted claim survives across the fetch.

import { supabaseAdmin } from '@/lib/supabase'

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before expiry
const CLAIM_TTL_SECONDS = 60 // a refresh+persist completes in seconds; after this a claim is stale (crashed winner) and takeable. MUST be > LOSER_DEADLINE_MS so a healthy winner is never preempted.
const LOSER_DEADLINE_MS = 10 * 1000 // a loser waits at most this long for the winner's token, then fails LOUD
const POLL_INTERVAL_MS = 300 // loser re-read cadence
const FETCH_TIMEOUT_MS = 10 * 1000 // abort a hung Shopify refresh so it can't pin the claim

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type ShopifyTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'no_token' | 'refresh_expired' | 'refresh_failed'; detail?: string }

// Best-effort release of the refresh claim so the row is reclaimable after a failure.
async function releaseClaim(userEmail: string, shopDomain: string): Promise<void> {
  await supabaseAdmin
    .from('shopify_tokens')
    .update({ refresh_claimed_at: null })
    .eq('user_email', userEmail)
    .eq('shop_domain', shopDomain)
}

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

  // Token expired or near-expired — need to refresh.
  if (!tokenRow.refresh_token) {
    return { ok: false, reason: 'no_token', detail: 'expired with no refresh token' }
  }
  if (tokenRow.refresh_token_expires_at) {
    const refreshExpiresAtMs = new Date(tokenRow.refresh_token_expires_at).getTime()
    if (refreshExpiresAtMs <= now) {
      return { ok: false, reason: 'refresh_expired' }
    }
  }

  // ── Serialized refresh (LORAMER_SHOPIFY_REFRESH_RACE_V1) ──
  // Try to claim the refresh. Winner refreshes; losers wait for the published token.
  const deadline = Date.now() + LOSER_DEADLINE_MS
  while (true) {
    const { data: claimed, error: claimErr } = await supabaseAdmin.rpc('claim_shopify_refresh', {
      p_user_email: userEmail,
      p_shop_domain: shopDomain,
      p_ttl_seconds: CLAIM_TTL_SECONDS,
    })

    if (claimErr) {
      // The claim itself failed — fail LOUD rather than risk an unserialized refresh.
      console.error(
        `[shopify-token] claim RPC failed shop=${shopDomain} user=${userEmail}: ${claimErr.message}`
      )
      return { ok: false, reason: 'refresh_failed', detail: `claim failed: ${claimErr.message}` }
    }

    if (claimed === true) {
      // WINNER (first claim, or stale/crashed-winner takeover). refreshAsWinner re-reads the row
      // first (amendment): if a fresh token was published meanwhile it returns that without a
      // Shopify call; otherwise it refreshes using the RE-READ refresh_token, never a stale one.
      return await refreshAsWinner(userEmail, shopDomain)
    }

    // LOSER — another caller holds the claim. Wait for their published token.
    if (Date.now() > deadline) {
      console.error(
        `[shopify-token] concurrent refresh did not publish in time shop=${shopDomain} user=${userEmail}`
      )
      return { ok: false, reason: 'refresh_failed', detail: 'concurrent refresh did not publish in time' }
    }
    await sleep(POLL_INTERVAL_MS)
    const { data: fresh } = await supabaseAdmin
      .from('shopify_tokens')
      .select('access_token, expires_at')
      .eq('user_email', userEmail)
      .eq('shop_domain', shopDomain)
      .single()
    if (fresh?.expires_at && new Date(fresh.expires_at).getTime() - Date.now() > REFRESH_BUFFER_MS) {
      return { ok: true, accessToken: fresh.access_token }
    }
    // else loop: winner may have failed/crashed → the next claim_shopify_refresh wins once the
    // claim is null (released) or stale (older than CLAIM_TTL_SECONDS).
  }
}

// Runs only after winning the claim. Re-reads the row (amendment), short-circuits to an
// already-published token, else performs the Shopify refresh + guarded persist.
async function refreshAsWinner(userEmail: string, shopDomain: string): Promise<ShopifyTokenResult> {
  const { data: row, error: reReadErr } = await supabaseAdmin
    .from('shopify_tokens')
    .select('access_token, refresh_token, expires_at, refresh_token_expires_at')
    .eq('user_email', userEmail)
    .eq('shop_domain', shopDomain)
    .single()

  if (reReadErr || !row?.access_token) {
    await releaseClaim(userEmail, shopDomain)
    return { ok: false, reason: 'no_token', detail: reReadErr?.message }
  }

  const now = Date.now()

  // AMENDMENT (a): a concurrent winner published a fresh token after we won the claim — use it,
  // release our claim, and skip the redundant Shopify call.
  if (row.expires_at && new Date(row.expires_at).getTime() - now > REFRESH_BUFFER_MS) {
    await releaseClaim(userEmail, shopDomain)
    return { ok: true, accessToken: row.access_token }
  }

  // AMENDMENT (b): refresh using the RE-READ refresh_token, never a stale captured value.
  if (!row.refresh_token) {
    await releaseClaim(userEmail, shopDomain)
    return { ok: false, reason: 'no_token', detail: 'expired with no refresh token' }
  }
  if (row.refresh_token_expires_at && new Date(row.refresh_token_expires_at).getTime() <= now) {
    await releaseClaim(userEmail, shopDomain)
    return { ok: false, reason: 'refresh_expired' }
  }

  // Perform refresh (with a timeout so a hung fetch can't pin the claim).
  let refreshed: any
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let refreshRes: Response
    try {
      refreshRes = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: process.env.SHOPIFY_CLIENT_ID!,
          client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: row.refresh_token,
        }).toString(),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    refreshed = await refreshRes.json()
  } catch (e: any) {
    await releaseClaim(userEmail, shopDomain)
    console.error(
      `[shopify-token] refresh fetch failed (winner) shop=${shopDomain} user=${userEmail}: ${e?.message ?? e}`
    )
    return { ok: false, reason: 'refresh_failed', detail: String(e?.message ?? e) }
  }

  if (!refreshed.access_token) {
    await releaseClaim(userEmail, shopDomain)
    console.error('Shopify token refresh failed:', refreshed)
    return { ok: false, reason: 'refresh_failed', detail: JSON.stringify(refreshed) }
  }

  // Compute new expirations
  const refreshTime = Date.now()
  const newExpiresAt = new Date(refreshTime + (refreshed.expires_in || 3600) * 1000).toISOString()

  // LORAMER_SHOPIFY_TOKEN_HARDEN_V1 — FIX 2: only write refresh_token / its expiry when Shopify
  // returned a rotated one; otherwise omit so the existing value survives. Clear the claim in the
  // SAME write so success publishes the token and releases the claim atomically.
  const updatePayload: Record<string, unknown> = {
    access_token: refreshed.access_token,
    expires_at: newExpiresAt,
    refresh_claimed_at: null,
    updated_at: new Date().toISOString(),
  }
  if (refreshed.refresh_token) {
    updatePayload.refresh_token = refreshed.refresh_token
    updatePayload.refresh_token_expires_at = new Date(
      refreshTime + (refreshed.refresh_token_expires_in || 7776000) * 1000
    ).toISOString()
  }

  // LORAMER_SHOPIFY_TOKEN_HARDEN_V1 — FIX 1: guarded persist. Shopify already rotated+invalidated
  // the old refresh token, so a silent save miss leaves a DEAD refresh token → forced reinstall.
  // Capture {error} AND affected-row count (Lesson 39: 0 rows == failure), retry once, and refuse
  // to hand back a token we couldn't persist.
  const persist = () =>
    supabaseAdmin
      .from('shopify_tokens')
      .update(updatePayload)
      .eq('user_email', userEmail)
      .eq('shop_domain', shopDomain)
      .select('id')

  let { data: saved, error: saveError } = await persist()
  if (saveError || !saved || saved.length === 0) {
    // Retry exactly once before giving up.
    ;({ data: saved, error: saveError } = await persist())
  }
  if (saveError || !saved || saved.length === 0) {
    console.error(
      `[shopify-token] CRITICAL: refresh succeeded but persist FAILED — shop=${shopDomain} user=${userEmail} matched=${saved?.length ?? 0} error=${saveError?.message ?? 'none'}`
    )
    await releaseClaim(userEmail, shopDomain)
    return { ok: false, reason: 'refresh_failed', detail: 'token refreshed but persist failed' }
  }

  return { ok: true, accessToken: refreshed.access_token }
}
