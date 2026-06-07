// LORAMER_META_COMPLIANCE_ENDPOINTS_V1
// Meta Deauthorize Callback. Meta POSTs signed_request (form-encoded) when a
// user removes the app on Facebook. The token is already invalidated by Meta
// at this point — we delete our copy + the user's Meta connections so the UI
// shows "not connected" and cron/backfill skip cleanly. metrics_daily history
// is KEPT (deauthorize ≠ data-deletion request; the user may reconnect).
// Always answers 200 after a verified request (Shopify-webhook pattern);
// only an invalid/missing signature gets 401. DORMANT until the URL is
// registered in the Meta App Dashboard.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { parseSignedRequest, extractSignedRequest } from '@/lib/meta-signed-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rawBody = await request.text()

  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.error('Meta deauthorize: META_APP_SECRET not set')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  const signedRequest = extractSignedRequest(rawBody)
  const parsed = signedRequest
    ? parseSignedRequest(signedRequest, appSecret)
    : ({ ok: false, reason: 'missing signed_request' } as const)

  if (!parsed.ok) {
    // Never log the payload as if trusted — body length only.
    console.warn('Meta deauthorize: rejected', { reason: parsed.reason, bodyLength: rawBody.length })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fbUserId = parsed.payload.user_id ? String(parsed.payload.user_id) : null

  try {
    let userEmail: string | null = null
    let status = 'no_match'
    const detail: Record<string, unknown> = { issued_at: parsed.payload.issued_at ?? null }

    if (fbUserId) {
      const { data: tokenRow } = await supabaseAdmin
        .from('meta_tokens')
        .select('user_email')
        .eq('fb_user_id', fbUserId)
        .maybeSingle()
      userEmail = tokenRow?.user_email ?? null
    }

    if (userEmail) {
      // Delete the user's Meta connections (UI/cron source of truth)…
      const { count: connCount, error: connError } = await supabaseAdmin
        .from('platform_connections')
        .delete({ count: 'exact' })
        .eq('platform', 'meta')
        .eq('user_email', userEmail)

      // …then the token row (last, so a retry can still map fb_user_id).
      const { count: tokenCount, error: tokenError } = await supabaseAdmin
        .from('meta_tokens')
        .delete({ count: 'exact' })
        .eq('user_email', userEmail)

      detail.connections_deleted = connError ? `ERROR: ${connError.message}` : connCount ?? 0
      detail.tokens_deleted = tokenError ? `ERROR: ${tokenError.message}` : tokenCount ?? 0
      status = connError || tokenError ? 'partial' : 'complete'
    }

    await supabaseAdmin.from('meta_compliance_log').insert({
      kind: 'deauthorize',
      fb_user_id: fbUserId,
      user_email: userEmail,
      status,
      detail,
      received_at: new Date().toISOString(),
    })

    return new NextResponse('OK', { status: 200 })
  } catch (e) {
    console.error('Meta deauthorize handler error:', e)
    // Signature already verified — log and answer 200 to stop retry storms.
    return new NextResponse('OK', { status: 200 })
  }
}
