// LORAMER_BACKFILL_GOOGLE_0B_V2
// Phase 0b: resumable historical backfill of Google Ads ACCOUNT-LEVEL daily
// metrics into metrics_daily. Processes the full remaining window in ONE
// invocation via an in-memory chunk loop, so there is no cross-request cursor
// read (which caused V1 to restart from yesterday each call).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getDailyMetrics } from '@/lib/google-ads'

export const maxDuration = 60

const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const GRANULAR_MONTHS = 36
const CHUNK_DAYS = 365
const MAX_CHUNKS = 60

function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

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
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
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
    account_name?: string | null
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
  const accountName = googleConn.account_name || customerId
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
  const refreshToken = tokenRow.refresh_token

  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_target_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', 'google')
    .maybeSingle()

  if (stateRow?.backfill_complete) {
    return NextResponse.json({ clientId, customerId, complete: true, note: 'already complete' })
  }

  const targetObj = new Date()
  targetObj.setUTCMonth(targetObj.getUTCMonth() - GRANULAR_MONTHS)
  const targetDate = stateRow?.backfill_target_date || fmt(targetObj)

  const yObj = new Date()
  yObj.setUTCDate(yObj.getUTCDate() - 1)
  const yesterday = fmt(yObj)

  let windowEnd = stateRow?.backfill_earliest_date
    ? addDays(stateRow.backfill_earliest_date, -1)
    : yesterday

  let totalRows = 0
  let earliest = stateRow?.backfill_earliest_date || addDays(yesterday, 1)
  let chunks = 0
  let complete = false

  while (windowEnd >= targetDate && chunks < MAX_CHUNKS) {
    chunks += 1
    let windowStart = addDays(windowEnd, -(CHUNK_DAYS - 1))
    if (windowStart < targetDate) windowStart = targetDate

    const daily = await getDailyMetrics(
      refreshToken,
      customerId,
      'LAST_30_DAYS',
      undefined,
      'day',
      windowStart,
      windowEnd
    )

    const rows = (daily || []).map(d => ({
      client_id: clientId,
      user_email: userEmail,
      platform: 'google',
      entity_level: 'account',
      entity_id: customerId,
      entity_name: accountName,
      date: d.date,
      breakdown_type: '',
      breakdown_value: '',
      spend: d.cost,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
      conversion_value: d.conversionValue,
      revenue: 0,
      extra: {},
    }))

    if (rows.length > 0) {
      const { error: metricsError } = await supabaseAdmin
        .from('metrics_daily')
        .upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })
      if (metricsError) {
        return NextResponse.json(
          { error: 'metrics_daily upsert failed', detail: metricsError.message, earliest, totalRows },
          { status: 500 }
        )
      }
      totalRows += rows.length
    }

    earliest = windowStart

    const { error: stateError } = await supabaseAdmin
      .from('sync_state')
      .upsert(
        {
          client_id: clientId,
          platform: 'google',
          backfill_earliest_date: earliest,
          backfill_target_date: targetDate,
          backfill_complete: windowStart <= targetDate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,platform' }
      )
    if (stateError) {
      return NextResponse.json(
        { error: 'sync_state upsert failed', detail: stateError.message, earliest, totalRows },
        { status: 500 }
      )
    }

    if (windowStart <= targetDate) {
      complete = true
      break
    }
    windowEnd = addDays(windowStart, -1)
  }

  return NextResponse.json({
    clientId,
    customerId,
    targetDate,
    earliest,
    chunks,
    totalRows,
    complete,
  })
}
