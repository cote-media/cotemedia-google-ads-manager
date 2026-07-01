// LORAMER_META_TOKEN_WRITE_V1 — freeze-safe out-of-band Meta token refresh (NEW isolated file).
// Routes AROUND the broken callback: src/app/api/meta/callback/route.ts:100 upserts meta_tokens with NO
// onConflict:'user_email' and swallows the returned error, so on an EXISTING row the upsert becomes an INSERT →
// UNIQUE(user_email) violation → silent no-op. This route touches NO reviewer-path file and NO Meta app config.
//
// FLOW: Russ mints a SHORT-lived Meta user token out-of-band (Graph API Explorer — no redirect URI, no app-config
// change). This CRON_SECRET-gated POST takes that token in the JSON BODY (never a URL param), exchanges it
// server-side for the ~60-day long-lived token (the SAME fb_exchange_token call the callback uses), verifies the
// token belongs to the expected cote@ FB user, then writes it with the CORRECT conflict-target + a CHECKED error.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const META_API = 'https://graph.facebook.com/v18.0'
const TARGET_EMAIL = 'cotebrandmarketing@gmail.com' // the cote@ meta_tokens row we are refreshing
const EXPECTED_FB_USER_ID = '10242550452717848'     // the app-role FB person that owns the 12 ad accounts

export async function POST(request: Request) {
  // 1) CRON_SECRET gate (Bearer) — same posture as the backfill routes.
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2) short-lived token from the JSON BODY (NEVER a URL param — so it can't land in access logs).
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }) }
  const shortToken = typeof body?.shortToken === 'string' ? body.shortToken.trim() : ''
  if (!shortToken) return NextResponse.json({ error: 'missing shortToken in body' }, { status: 400 })

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return NextResponse.json({ error: 'META_APP_ID/META_APP_SECRET not configured' }, { status: 500 })

  try {
    // 3) SHORT → LONG-lived exchange (identical fb_exchange_token call to callback/route.ts:78; no redirect_uri).
    const llRes = await fetch(`${META_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`)
    const llData = await llRes.json()
    const longToken: string | undefined = llData?.access_token
    if (!longToken) {
      return NextResponse.json({ error: 'long-lived exchange failed', detail: llData?.error?.message ?? 'no access_token returned' }, { status: 400 })
    }
    const expiresInSec = Number(llData?.expires_in) || 0
    const expiresInDays = expiresInSec ? Math.round(expiresInSec / 86400) : null

    // 4) IDENTITY GUARD: the new token MUST belong to the expected cote@ FB user, or we'd overwrite cote@'s row with
    //    the wrong person's token. GET /me?fields=id (matches how the callback captures fb_user_id) and ABORT on mismatch.
    const meRes = await fetch(`${META_API}/me?fields=id&access_token=${encodeURIComponent(longToken)}`)
    const meData = await meRes.json()
    const fbUserId = meData?.id ? String(meData.id) : ''
    if (!fbUserId) {
      return NextResponse.json({ error: 'could not read fb_user_id (/me failed)', detail: meData?.error?.message ?? null }, { status: 400 })
    }
    if (fbUserId !== EXPECTED_FB_USER_ID) {
      return NextResponse.json({ error: 'fb_user_id mismatch — refusing to overwrite cote@ token', expected: EXPECTED_FB_USER_ID, got: fbUserId }, { status: 409 })
    }

    // 5) CORRECT upsert — onConflict:'user_email' (the exact fix the callback is missing) + CHECK the error (fail loud).
    const { error: upErr } = await supabaseAdmin.from('meta_tokens').upsert(
      { user_email: TARGET_EMAIL, access_token: longToken, fb_user_id: fbUserId, updated_at: new Date().toISOString() },
      { onConflict: 'user_email' }
    )
    if (upErr) {
      return NextResponse.json({ error: 'meta_tokens upsert failed', detail: upErr.message }, { status: 500 })
    }

    // 6) NEVER echo the token.
    return NextResponse.json({ ok: true, updated_email: TARGET_EMAIL, fb_user_id: fbUserId, expires_in_days: expiresInDays }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ error: 'refresh failed', detail: String(e?.message ?? e) }, { status: 500 })
  }
}
