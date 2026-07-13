// LORAMER_GA_OAUTH_V1
// GA Phase 2 — OAuth callback.
// Validates the CSRF state, exchanges the authorization code for tokens, then
// stashes the tokens in a short-lived httpOnly cookie for the Phase 3 property
// picker. Does NOT write to ga_tokens yet (that is Phase 3).

import { NextRequest, NextResponse } from 'next/server'
import { safeReturnTo } from '@/lib/access/return-to' // LORAMER_NEXT_CONNECT_V1 F2b — same open-redirect guard as F2

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

type DecodedState = {
  n: string
  c: string
  r?: string // LORAMER_NEXT_CONNECT_V1 F2b — optional returnTo
}

function decodeState(state: string): DecodedState | null {
  try {
    const b64 = state.replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as { n?: unknown; c?: unknown; r?: unknown }
    if (typeof parsed.n === 'string') {
      return {
        n: parsed.n,
        c: typeof parsed.c === 'string' ? parsed.c : '',
        r: typeof parsed.r === 'string' ? parsed.r : '',
      }
    }
    return null
  } catch {
    return null
  }
}

// LORAMER_NEXT_CONNECT_V1 F2b — honor a valid -next returnTo (guarded); absent/invalid → /clients, byte-identical.
function redirectClients(request: NextRequest, status: string, returnTo?: string | null): NextResponse {
  const safe = safeReturnTo(returnTo)
  const url = safe ? new URL(safe, request.nextUrl.origin) : new URL('/clients', request.nextUrl.origin)
  url.searchParams.set('ga_oauth', status)
  return NextResponse.redirect(url.toString())
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams

  if (params.get('error')) {
    return redirectClients(request, 'denied')
  }

  const code = params.get('code')
  const stateParam = params.get('state')
  if (!code || !stateParam) {
    return redirectClients(request, 'error')
  }

  const decoded = decodeState(stateParam)
  const cookieNonce = request.cookies.get('ga_oauth_state')?.value
  if (!decoded || !cookieNonce || decoded.n !== cookieNonce) {
    return redirectClients(request, 'error', decoded?.r)
  }

  const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_ANALYTICS_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    return redirectClients(request, 'error', decoded?.r)
  }

  const body = new URLSearchParams()
  body.set('code', code)
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  body.set('redirect_uri', redirectUri)
  body.set('grant_type', 'authorization_code')

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!tokenRes.ok) {
      return redirectClients(request, 'error', decoded?.r)
    }

    const tokenJson = (await tokenRes.json()) as GoogleTokenResponse
    const accessToken = tokenJson.access_token
    if (!accessToken) {
      return redirectClients(request, 'error', decoded?.r)
    }

    const refreshToken = tokenJson.refresh_token || ''
    const expiresIn =
      typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 3600

    const pending = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + expiresIn * 1000,
      scope: tokenJson.scope || '',
      clientId: decoded.c || '',
    }

    const response = redirectClients(request, 'success', decoded?.r)
    response.cookies.set('ga_oauth_tokens', JSON.stringify(pending), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    response.cookies.set('ga_oauth_state', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return response
  } catch {
    return redirectClients(request, 'error', decoded?.r)
  }
}
