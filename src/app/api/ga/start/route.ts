// LORAMER_GA_OAUTH_V1
// GA Phase 2 — OAuth initiation.
// Redirects the user to Google's consent screen for the analytics.readonly scope.
// Sets a CSRF nonce cookie that the callback route validates.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

function base64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID
  const redirectUri = process.env.GOOGLE_ANALYTICS_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'GA OAuth env vars are not configured' },
      { status: 500 }
    )
  }

  const targetClientId = request.nextUrl.searchParams.get('clientId') || ''
  const nonce = randomUUID()
  const statePayload = JSON.stringify({ n: nonce, c: targetClientId })
  const state = base64url(statePayload)

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', GA_SCOPE)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('include_granted_scopes', 'false')
  authUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set('ga_oauth_state', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return response
}
