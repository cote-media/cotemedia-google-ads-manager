// LORAMER_BACKFILL_PROBE_V1
// Read-only diagnostic: does the Google Ads API still return DAILY data for a
// given window on a client's account? CRON_SECRET-bearer GET. No DB writes.
// Reuses the exact getDailyMetrics call the backfill uses, so the answer
// reflects what LoraMer can actually capture.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getDailyMetrics } from '@/lib/google-ads'

export const maxDuration = 60

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  if (!clientId || !start || !end) {
    return NextResponse.json(
      { error: 'Missing clientId, start, or end (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')
    .eq('id', clientId)
    .single()
  if (clientError || !client) {
    return NextResponse.json(
      { error: 'Client not found', detail: clientError?.message },
      { status: 404 }
    )
  }

  const connections = (client.platform_connections || []) as Array<{
    platform: string
    account_id: string
    user_email?: string | null
  }>
  const googleConn = connections.find(c => c.platform === 'google')
  if (!googleConn) {
    return NextResponse.json(
      { error: 'Client has no Google connection' },
      { status: 400 }
    )
  }
  const customerId = googleConn.account_id
  const userEmail = googleConn.user_email || client.user_email

  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from('google_tokens')
    .select('refresh_token')
    .eq('user_email', userEmail)
    .single()
  if (tokenError || !tokenRow?.refresh_token) {
    return NextResponse.json(
      { error: 'No Google refresh token', detail: tokenError?.message },
      { status: 400 }
    )
  }

  try {
    const daily = await getDailyMetrics(
      tokenRow.refresh_token,
      customerId,
      'LAST_30_DAYS',
      undefined,
      'day',
      start,
      end
    )
    const rows = (daily || []) as Array<{ date?: string }>
    const dates = rows.map(r => r.date).filter(Boolean).sort() as string[]
    return NextResponse.json({
      clientId,
      customerId,
      start,
      end,
      rowCount: rows.length,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
      sample: rows.slice(0, 2),
    })
  } catch (e: any) {
    return NextResponse.json({
      clientId,
      customerId,
      start,
      end,
      rowCount: 0,
      apiError: e?.message || String(e),
    })
  }
}
