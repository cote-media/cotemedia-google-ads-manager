// LORAMER_BACKFILL_SHARED_LIB_V1
// Phase 1: shared engine for resumable historical backfill of ACCOUNT-LEVEL
// daily metrics into metrics_daily. Extracted (no behavior change) from the
// google + meta backfill routes so (a) the CRON GET routes are thin wrappers
// and (b) a session-authed trigger can call the same engine.
// Auth is the CALLER's responsibility — this engine assumes clientId is
// already authorized.

import { supabaseAdmin } from '@/lib/supabase'

export interface DailyRow {
  date: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
}

export interface BackfillAdapter {
  platform: string
  accountIdKey: string
  chunkDays: number
  connectionMissingError: string
  tokenMissingError: string
  loadToken: (userEmail: string) => Promise<{ token?: string; error?: string }>
  fetchDaily: (
    token: string,
    accountId: string,
    windowStart: string,
    windowEnd: string
  ) => Promise<DailyRow[]>
}

export interface BackfillResult {
  status: number
  body: Record<string, any>
}

const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const GRANULAR_MONTHS = 36
const MAX_CHUNKS = 60

function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

export async function runBackfill(
  clientId: string,
  adapter: BackfillAdapter
): Promise<BackfillResult> {
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')
    .eq('id', clientId)
    .single()
  if (clientError || !client) {
    return {
      status: 404,
      body: { error: 'Client not found', detail: clientError?.message },
    }
  }

  const connections = (client.platform_connections || []) as Array<{
    platform: string
    account_id: string
    account_name?: string | null
    user_email?: string | null
  }>
  const conn = connections.find(c => c.platform === adapter.platform)
  if (!conn) {
    return { status: 400, body: { error: adapter.connectionMissingError } }
  }

  const accountId = conn.account_id
  const accountName = conn.account_name || accountId
  const userEmail = conn.user_email || client.user_email

  const tokenResult = await adapter.loadToken(userEmail)
  if (!tokenResult.token) {
    return {
      status: 400,
      body: { error: adapter.tokenMissingError, detail: tokenResult.error },
    }
  }
  const token = tokenResult.token

  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_target_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', adapter.platform)
    .maybeSingle()

  if (stateRow?.backfill_complete) {
    return {
      status: 200,
      body: {
        clientId,
        [adapter.accountIdKey]: accountId,
        complete: true,
        note: 'already complete',
      },
    }
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
    let windowStart = addDays(windowEnd, -(adapter.chunkDays - 1))
    if (windowStart < targetDate) windowStart = targetDate

    const daily = await adapter.fetchDaily(token, accountId, windowStart, windowEnd)

    const rows = (daily || []).map(d => ({
      client_id: clientId,
      user_email: userEmail,
      platform: adapter.platform,
      entity_level: 'account',
      entity_id: accountId,
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
        return {
          status: 500,
          body: {
            error: 'metrics_daily upsert failed',
            detail: metricsError.message,
            earliest,
            totalRows,
          },
        }
      }
      totalRows += rows.length
    }

    earliest = windowStart

    const { error: stateError } = await supabaseAdmin
      .from('sync_state')
      .upsert(
        {
          client_id: clientId,
          platform: adapter.platform,
          backfill_earliest_date: earliest,
          backfill_target_date: targetDate,
          backfill_complete: windowStart <= targetDate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,platform' }
      )
    if (stateError) {
      return {
        status: 500,
        body: {
          error: 'sync_state upsert failed',
          detail: stateError.message,
          earliest,
          totalRows,
        },
      }
    }

    if (windowStart <= targetDate) {
      complete = true
      break
    }
    windowEnd = addDays(windowStart, -1)
  }

  return {
    status: 200,
    body: {
      clientId,
      [adapter.accountIdKey]: accountId,
      targetDate,
      earliest,
      chunks,
      totalRows,
      complete,
    },
  }
}
