// LORAMER_BACKFILL_GOOGLE_0B_V1
// Phase 0b: chunked, resumable historical backfill of Google Ads ACCOUNT-LEVEL
// daily metrics into metrics_daily. One client + one date-chunk per invocation.
// Re-invoke until the response shows { complete: true }.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getDailyMetrics } from '@/lib/google-ads'

export const maxDuration = 60

const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

// Google granular retention floor (37 months). Backfill never goes older.
const GRANULAR_MONTHS = 37

// Days of history pulled per invocation (resumable; older each call).
const CHUNK_DAYS = 365

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

  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_target_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', 'google')
    .maybeSingle()

  if (stateRow?.backfill_complete) {
    return NextResponse.json({ clientId, customerId, complete: true, note: 'already complete' })
  }

  const targetDateObj = new Date()
  targetDateObj.setUTCMonth(targetDateObj.getUTCMonth() - GRANULAR_MONTHS)
  const targetDate = stateRow?.backfill_target_date || fmt(targetDateObj)

  const yesterdayObj = new Date()
  yesterdayObj.setUTCDate(yesterdayObj.getUTCDate() - 1)
  const yesterday = fmt(yesterdayObj)

  const windowEnd = stateRow?.backfill_earliest_date
    ? addDays(stateRow.backfill_earliest_date, -1)
    : yesterday

  if (windowEnd < targetDate) {
    await supabaseAdmin
      .from('sync_state')
      .upsert(
        {
          client_id: clientId,
          platform: 'google',
          backfill_earliest_date: targetDate,
          backfill_target_date: targetDate,
          backfill_complete: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,platform' }
      )
    return NextResponse.json({ clientId, customerId, complete: true })
  }

  let windowStart = addDays(windowEnd, -(CHUNK_DAYS - 1))
  if (windowStart < targetDate) windowStart = targetDate

  // dateRange is ignored because customStart/customEnd are provided
  const daily = await getDailyMetrics(
    tokenRow.refresh_token,
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
        { error: 'metrics_daily upsert failed', detail: metricsError.message },
        { status: 500 }
      )
    }
  }

  const complete = windowStart <= targetDate
  await supabaseAdmin
    .from('sync_state')
    .upsert(
      {
        client_id: clientId,
        platform: 'google',
        backfill_earliest_date: windowStart,
        backfill_target_date: targetDate,
        backfill_complete: complete,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,platform' }
    )

  return NextResponse.json({
    clientId,
    customerId,
    windowStart,
    windowEnd,
    rowsWritten: rows.length,
    backfillEarliest: windowStart,
    targetDate,
    complete,
  })
}
