// LORAMER_GA_TOKEN_DIAG_V1 — TEMPORARY, READ-ONLY diagnostic for the dead-token-for-live-grant asymmetry.
//
// ⛔ DELETE THIS ROUTE once the 2026-07-30 diagnosis is banked. It exists for one reason: the ONLY way to compare
// the laptop's refresh call against the LAMBDA's refresh call is to make the lambda describe its own inputs, and
// Vercel's env is not readable from here by any other means available in this session.
//
// IT WRITES NOTHING. No ga_tokens update, no metrics_daily row, no cursor. It reads the token row, performs ONE
// refresh against Google's token endpoint, performs ONE runReport with whatever came back, and reports. The
// refreshed token is DISCARDED — deliberately, because the write-back in ga-token.ts is itself under suspicion.
//
// NO SECRETS ARE EMITTED. Tokens and the client secret appear only as sha256[:12] + length. The OAuth client_id is
// a public identifier and its suffix is printed so the two callers can be compared.
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12)
const fp = (s: string | undefined | null) => (s ? { sha: sha(s), len: s.length } : null)

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || gotToken !== envSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = new URL(request.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const { data: row } = await supabaseAdmin
    .from('ga_tokens')
    .select('access_token, refresh_token, expires_at, updated_at, ga_property_id, user_email')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'no ga_tokens row' }, { status: 404 })

  const oauthClientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID ?? ''
  const oauthSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET ?? ''

  // ── ITEM 1 + 2: what this lambda READ, and what it is about to SEND. ────────────────────────────────────────
  const read = {
    storedAccessToken: fp(row.access_token),
    storedRefreshToken: fp(row.refresh_token),
    expires_at: row.expires_at,
    updated_at: row.updated_at,
    ga_property_id: row.ga_property_id,
    user_email: row.user_email,
  }
  const sending = {
    endpoint: 'https://oauth2.googleapis.com/token',
    grant_type: 'refresh_token',
    oauthClientIdSuffix: oauthClientId.slice(-34),
    oauthClientId: fp(oauthClientId),
    oauthClientSecret: fp(oauthSecret),
    refreshTokenSent: fp(row.refresh_token),
  }
  console.warn(`[ga-token-diag] READ ${JSON.stringify(read)}`)
  console.warn(`[ga-token-diag] SENDING ${JSON.stringify(sending)}`)

  // ── The refresh. Byte-identical parameters to ga-token.ts, and NOTHING is persisted. ────────────────────────
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthClientId, client_secret: oauthSecret,
      grant_type: 'refresh_token', refresh_token: row.refresh_token,
    }).toString(),
  })
  const body = await res.json()
  const returnedAt = fp(body.access_token)
  const received = {
    httpStatus: res.status,
    accessToken: returnedAt,
    // ITEM 3: RAW expires_in. A full 3599 means a freshly minted token; a REMAINDER means Google reissued a
    // still-live cached token for this (client, user, scope) — and if the cached one is dead, so is the answer.
    expires_in_RAW: body.expires_in ?? null,
    scope: body.scope ?? null,
    token_type: body.token_type ?? null,
    error: body.error ?? null,
    error_description: body.error_description ?? null,
    identicalToStoredAccessToken: !!body.access_token && body.access_token === row.access_token,
    identicalToStoredRefreshToken: !!body.refresh_token && body.refresh_token === row.refresh_token,
    rotatedRefreshToken: body.refresh_token ? fp(body.refresh_token) : null,
  }
  console.warn(`[ga-token-diag] RECEIVED ${JSON.stringify(received)}`)

  // ── Does the token this lambda just minted actually work, from this lambda? ─────────────────────────────────
  let probe: Record<string, unknown> = { skipped: 'no access_token returned' }
  if (body.access_token) {
    const p = await fetch(`https://analyticsdata.googleapis.com/v1beta/${row.ga_property_id}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${body.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '2025-02-10', endDate: '2025-02-10' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }],
        limit: 1, returnPropertyQuota: true,
      }),
    })
    const pb = await p.json()
    probe = {
      httpStatus: p.status,
      rowCount: pb.rowCount ?? null,
      errorStatus: pb.error?.status ?? null,
      errorMessage: pb.error?.message ?? null,
      thresholdedRemaining: pb.propertyQuota?.potentiallyThresholdedRequestsPerHour?.remaining ?? null,
    }
  }
  console.warn(`[ga-token-diag] PROBE ${JSON.stringify(probe)}`)

  return NextResponse.json({
    marker: 'LORAMER_GA_TOKEN_DIAG_V1', wrote: 'NOTHING', clientId, read, sending, received, probe,
  })
}
