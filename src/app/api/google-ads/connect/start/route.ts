// LORAMER_NEXT_CONNECT_V1 F3 — Google-Ads DECOUPLER (start). A standalone POST-LOGIN adwords OAuth connector so a
// NATIVE (email/password) user can capture the owner-level adwords refresh_token WITHOUT signIn('google') — which
// would SWITCH their session identity to the Google account. Reuses GOOGLE_CLIENT_ID with a NEW redirect_uri
// (/api/google-ads/connect/callback — MUST be registered in the Google Cloud Console OAuth client). The login
// provider (auth.ts GoogleProvider + its jwt google_tokens write) is UNTOUCHED — this is an additive isolated route.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
// Mirror the login scope so the captured token is indistinguishable downstream (the capture path needs adwords).
const ADWORDS_SCOPE = 'openid email profile https://www.googleapis.com/auth/adwords'

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  // Must be authenticated — by ANY method (Google OR native email/password). This is NOT the login flow.
  if (!session?.user?.email) return NextResponse.redirect(new URL('/', request.url))

  const { searchParams } = new URL(request.url)
  const returnTo = searchParams.get('returnTo') || ''
  const nonce = randomUUID()
  // State carries the SERVER-VERIFIED session email (never a client-supplied one) + optional returnTo.
  const state = Buffer.from(JSON.stringify({ n: nonce, email: session.user.email, r: returnTo })).toString('base64url')

  const redirectUri = process.env.NEXTAUTH_URL + '/api/google-ads/connect/callback'
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', ADWORDS_SCOPE)
  url.searchParams.set('access_type', 'offline') // → refresh_token
  url.searchParams.set('prompt', 'consent') // → force a refresh_token even on re-auth
  url.searchParams.set('include_granted_scopes', 'false')
  url.searchParams.set('state', state)

  const res = NextResponse.redirect(url.toString())
  res.cookies.set('gads_connect_state', nonce, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
  return res
}
