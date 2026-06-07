// LORAMER_META_COMPLIANCE_ENDPOINTS_V1
// Meta Data Deletion Request Callback. Meta POSTs signed_request
// (form-encoded) when a user asks Facebook to delete their data from this
// app. meta_tokens is USER-scoped, so the correct scope is ALL Meta-sourced
// data across ALL of that LoraMer user's clients — it was all fetched under
// that one user's authorization. Deletion order keeps the fb_user_id→email
// mapping (the token row) alive until last so a mid-flight retry can still
// map. Must ALWAYS return Meta's required { url, confirmation_code } shape
// after a verified request — even when we hold no data. DORMANT until the
// URL is registered in the Meta App Dashboard.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { parseSignedRequest, extractSignedRequest } from '@/lib/meta-signed-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STATUS_URL_BASE = 'https://app.loramer.com/meta/deletion-status?code='

export async function POST(request: Request) {
  const rawBody = await request.text()

  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.error('Meta data-deletion: META_APP_SECRET not set')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  const signedRequest = extractSignedRequest(rawBody)
  const parsed = signedRequest
    ? parseSignedRequest(signedRequest, appSecret)
    : ({ ok: false, reason: 'missing signed_request' } as const)

  if (!parsed.ok) {
    // Never log the payload as if trusted — body length only.
    console.warn('Meta data-deletion: rejected', { reason: parsed.reason, bodyLength: rawBody.length })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fbUserId = parsed.payload.user_id ? String(parsed.payload.user_id) : null

  // IDEMPOTENCY FIRST: Meta retries, users can re-request. A finished prior
  // request answers with its original code instead of re-running.
  if (fbUserId) {
    const { data: prior } = await supabaseAdmin
      .from('meta_compliance_log')
      .select('confirmation_code, status')
      .eq('kind', 'data_deletion')
      .eq('fb_user_id', fbUserId)
      .in('status', ['complete', 'no_data'])
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (prior?.confirmation_code) {
      return NextResponse.json({
        url: STATUS_URL_BASE + prior.confirmation_code,
        confirmation_code: prior.confirmation_code,
      })
    }
  }

  const confirmationCode = crypto.randomUUID()
  const detail: Record<string, unknown> = { issued_at: parsed.payload.issued_at ?? null }
  let status = 'no_data'
  let userEmail: string | null = null

  try {
    if (fbUserId) {
      const { data: tokenRow } = await supabaseAdmin
        .from('meta_tokens')
        .select('user_email')
        .eq('fb_user_id', fbUserId)
        .maybeSingle()
      userEmail = tokenRow?.user_email ?? null
    }

    // Open the log row before deleting so a crash mid-wipe leaves a trace.
    await supabaseAdmin.from('meta_compliance_log').insert({
      kind: 'data_deletion',
      fb_user_id: fbUserId,
      user_email: userEmail,
      confirmation_code: confirmationCode,
      status: userEmail ? 'processing' : 'no_data',
      detail,
      received_at: new Date().toISOString(),
    })

    if (userEmail) {
      // CIDS: every client of this user with a Meta connection.
      const { data: connRows } = await supabaseAdmin
        .from('platform_connections')
        .select('client_id')
        .eq('platform', 'meta')
        .eq('user_email', userEmail)
      const cids = Array.from(new Set((connRows ?? []).map(r => r.client_id)))
      detail.client_ids = cids

      let anyFailed = false

      // 1. metrics_daily — Meta rows for those clients only.
      if (cids.length > 0) {
        const { count, error } = await supabaseAdmin
          .from('metrics_daily')
          .delete({ count: 'exact' })
          .eq('platform', 'meta')
          .in('client_id', cids)
        detail.metrics_daily_deleted = error ? `ERROR: ${error.message}` : count ?? 0
        if (error) anyFailed = true

        // 2. sync_state — Meta backfill cursors for those clients.
        const { count: syncCount, error: syncError } = await supabaseAdmin
          .from('sync_state')
          .delete({ count: 'exact' })
          .eq('platform', 'meta')
          .in('client_id', cids)
        detail.sync_state_deleted = syncError ? `ERROR: ${syncError.message}` : syncCount ?? 0
        if (syncError) anyFailed = true

        // 3. intelligence_cache — entries bundle all platforms per entry, so
        // null the whole cache for these clients (regenerates in ≤15 min).
        const { count: ctxCount, error: ctxError } = await supabaseAdmin
          .from('client_context')
          .update({ intelligence_cache: null }, { count: 'exact' })
          .eq('user_email', userEmail)
          .in('client_id', cids)
        detail.intelligence_cache_nulled = ctxError ? `ERROR: ${ctxError.message}` : ctxCount ?? 0
        if (ctxError) anyFailed = true
      } else {
        detail.metrics_daily_deleted = 0
        detail.sync_state_deleted = 0
        detail.intelligence_cache_nulled = 0
      }

      // 4. platform_connections — the user's Meta connections.
      const { count: connCount, error: connError } = await supabaseAdmin
        .from('platform_connections')
        .delete({ count: 'exact' })
        .eq('platform', 'meta')
        .eq('user_email', userEmail)
      detail.connections_deleted = connError ? `ERROR: ${connError.message}` : connCount ?? 0
      if (connError) anyFailed = true

      // 5. meta_tokens — LAST, so retries can still map fb_user_id → email.
      const { count: tokenCount, error: tokenError } = await supabaseAdmin
        .from('meta_tokens')
        .delete({ count: 'exact' })
        .eq('user_email', userEmail)
      detail.tokens_deleted = tokenError ? `ERROR: ${tokenError.message}` : tokenCount ?? 0
      if (tokenError) anyFailed = true

      status = anyFailed ? 'partial' : 'complete'
    }

    await supabaseAdmin
      .from('meta_compliance_log')
      .update({ status, detail, user_email: userEmail })
      .eq('confirmation_code', confirmationCode)
  } catch (e: any) {
    console.error('Meta data-deletion handler error:', e)
    detail.fatal = e?.message || 'unknown'
    await supabaseAdmin
      .from('meta_compliance_log')
      .update({ status: 'partial', detail })
      .eq('confirmation_code', confirmationCode)
      .then(() => {}, () => {})
  }

  // Meta requires this shape unconditionally after a verified request.
  return NextResponse.json({
    url: STATUS_URL_BASE + confirmationCode,
    confirmation_code: confirmationCode,
  })
}
