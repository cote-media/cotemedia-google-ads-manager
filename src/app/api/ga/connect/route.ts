// LORAMER_GA_PROPERTY_PICKER_V1
// GA Phase 3 — persist the chosen Google Analytics property for a client.
// Reads the tokens stashed in the ga_oauth_tokens cookie (and the clientId carried
// through the OAuth state), writes the ga_tokens row (upsert on client_id) plus a
// platform_connections row, then clears the cookie. Mirrors the existing
// connections write pattern (supabaseAdmin, session.user.email).

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { kickoffBackfill } from '@/lib/backfill/kickoff' // LORAMER_SELFSERVE_SPINE_V1 step 2

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StashedTokens = {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  scope?: string
  clientId?: string
}

type ConnectBody = {
  clientId?: string
  property_id?: string
  property_name?: string
  account_id?: string
  account_name?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = (await getServerSession(authOptions)) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userEmail = session.user.email as string

  const cookie = request.cookies.get('ga_oauth_tokens')?.value
  if (!cookie) {
    return NextResponse.json(
      { error: 'No pending Google Analytics authorization. Please reconnect.' },
      { status: 400 }
    )
  }

  let tokens: StashedTokens
  try {
    tokens = JSON.parse(cookie) as StashedTokens
  } catch {
    return NextResponse.json(
      { error: 'Authorization expired. Please reconnect.' },
      { status: 400 }
    )
  }

  const accessToken = tokens.access_token || ''
  const refreshToken = tokens.refresh_token || ''
  const expiresAtMs =
    typeof tokens.expires_at === 'number' ? tokens.expires_at : Date.now()
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Authorization expired. Please reconnect.' },
      { status: 400 }
    )
  }

  const body = (await request.json()) as ConnectBody
  const clientId = tokens.clientId || body.clientId || ''
  const propertyId = body.property_id || ''
  if (!clientId) {
    return NextResponse.json(
      { error: 'No client specified for this connection.' },
      { status: 400 }
    )
  }
  if (!propertyId) {
    return NextResponse.json(
      { error: 'No Google Analytics property selected.' },
      { status: 400 }
    )
  }

  const propertyName = body.property_name || propertyId
  const accountId = body.account_id || ''
  const accountName = body.account_name || ''

  const { error: tokenError } = await supabase.from('ga_tokens').upsert(
    {
      user_email: userEmail,
      client_id: clientId,
      ga_property_id: propertyId,
      ga_account_id: accountId || null,
      ga_property_name: propertyName,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(expiresAtMs).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' }
  )
  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  await supabase
    .from('platform_connections')
    .delete()
    .eq('client_id', clientId)
    .eq('platform', 'ga')
    .eq('user_email', userEmail)

  const { error: connError } = await supabase.from('platform_connections').insert({
    client_id: clientId,
    platform: 'ga',
    account_id: propertyId,
    account_name: propertyName,
    user_email: userEmail,
    backfill_priority: 10,
  })
  if (connError) {
    return NextResponse.json({ error: connError.message }, { status: 500 })
  }
  // LORAMER_SELFSERVE_SPINE_V1 step 2 — connect-kickoff.
  kickoffBackfill(new URL(request.url).origin, clientId, 'ga')

  const response = NextResponse.json({ success: true, account_name: accountName })
  response.cookies.set('ga_oauth_tokens', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
