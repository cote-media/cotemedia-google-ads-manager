// LORAMER_NEXT_CONNECT_V1 F3 — Google-Ads DECOUPLER (callback). Exchanges the code → tokens → UPSERTS google_tokens
// for the SESSION email, mirroring auth.ts's login jwt write EXACTLY (user_email, refresh_token, access_token,
// expires_at, updated_at; onConflict 'user_email') so a decoupler-connected user is INDISTINGUISHABLE downstream
// from a login-connected one. refresh_token is PRESERVED on reconnect; a tokenless row is NEVER written. The login
// provider is untouched. Open-redirect guarded (safeReturnTo, /dashboard-next/ only).
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { safeReturnTo } from '@/lib/access/return-to'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

function dest(request: Request, rt: string | null, qs: string): string {
  const origin = process.env.NEXTAUTH_URL || new URL(request.url).origin
  const safe = safeReturnTo(rt) // /dashboard-next/ only; else /clients (default, mirrors the other connectors)
  const base = safe ? origin + safe : origin + '/clients'
  return base + (base.includes('?') ? '&' : '?') + qs
}

export async function GET(request: NextRequest) {
  const session = (await getServerSession(authOptions)) as any
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const err = searchParams.get('error')

  let decoded: { n?: string; email?: string; r?: string } = {}
  try { if (stateParam) decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString()) } catch { decoded = {} }
  const rt = decoded.r || null

  if (err || !code || !stateParam) return NextResponse.redirect(dest(request, rt, 'gads_error=denied'))

  // CSRF: state nonce must match the cookie set by /start.
  const cookieNonce = request.cookies.get('gads_connect_state')?.value
  if (!decoded.n || !cookieNonce || decoded.n !== cookieNonce) return NextResponse.redirect(dest(request, rt, 'gads_error=state'))

  // Identity: the token belongs to the CURRENT logged-in session (state email must equal the session email).
  const email = session?.user?.email
  if (!email || email !== decoded.email) return NextResponse.redirect(dest(request, rt, 'gads_error=session'))

  try {
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.NEXTAUTH_URL + '/api/google-ads/connect/callback',
      grant_type: 'authorization_code',
    })
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!tokenRes.ok) return NextResponse.redirect(dest(request, rt, 'gads_error=token'))
    const t = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!t.access_token) return NextResponse.redirect(dest(request, rt, 'gads_error=token'))

    // refresh_token preservation: prompt=consent should always return one; if it doesn't, keep the EXISTING refresh
    // token (never overwrite a good token with a blank). If none anywhere → surface an error, NEVER a tokenless row.
    let refreshToken = t.refresh_token || ''
    if (!refreshToken) {
      const { data: existing } = await supabaseAdmin.from('google_tokens').select('refresh_token').eq('user_email', email).maybeSingle()
      refreshToken = (existing?.refresh_token as string) || ''
    }
    if (!refreshToken) return NextResponse.redirect(dest(request, rt, 'gads_error=no_refresh'))

    // Mirror auth.ts's login write EXACTLY (same columns, same onConflict) → indistinguishable downstream.
    const row: Record<string, string | null> = {
      user_email: email,
      refresh_token: refreshToken,
      access_token: t.access_token,
      expires_at: typeof t.expires_in === 'number' ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabaseAdmin.from('google_tokens').upsert(row, { onConflict: 'user_email' })
    if (error) {
      console.error('[gads-decoupler] google_tokens upsert failed:', error)
      return NextResponse.redirect(dest(request, rt, 'gads_error=save'))
    }

    const res = NextResponse.redirect(dest(request, rt, 'gads_connected=true'))
    res.cookies.set('gads_connect_state', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
    return res
  } catch (e: any) {
    console.error('[gads-decoupler] error:', e?.message || e)
    return NextResponse.redirect(dest(request, rt, 'gads_error=oauth_failed'))
  }
}
