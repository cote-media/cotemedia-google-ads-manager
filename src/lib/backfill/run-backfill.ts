// LORAMER_BACKFILL_SHARED_LIB_V3
// Phase 1: shared engine for resumable historical backfill of ACCOUNT-LEVEL
// daily metrics into metrics_daily. Auth is the CALLER's responsibility —
// this engine assumes clientId is already authorized.
//
// V2 (deep history): the floor is 132 months (Google's 11-year retention
// ceiling) instead of a fixed 36-month cap, so we capture as far back as the
// platform will serve. For accounts younger than the floor, the older chunks
// simply return no rows. Each chunk fetch is wrapped so that if a platform
// throws a retention/date-range error going backward, we stop gracefully at
// the deepest point captured rather than failing the whole run.
//
// V3 (platform-agnostic): three OPTIONAL adapter hooks let non-ads platforms
// ride the same engine without changing ads behavior:
//   - resolveContext: override the default platform_connections + loadToken
//     resolution (e.g. GA's token + property live in ga_tokens, keyed by
//     clientId, and getValidGaToken returns both the access token and the
//     property id together).
//   - buildRows: override the default ACCOUNT-LEVEL ads row mapping (e.g. GA
//     writes revenue + an extra blob, not spend/impressions/clicks).
//   - floorDate: a per-adapter hard floor (e.g. the GA Data API refuses any
//     start date earlier than 2015-08-14).
// Adapters that set none of these (Google, Meta) behave EXACTLY as in V2.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize' // LORAMER_METRICS_NORMALIZE_V1

export interface DailyRow {
  date: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
}

export interface BackfillRowContext {
  clientId: string
  userEmail: string
  accountId: string
  accountName: string
}

export interface BackfillContextResult {
  ok: boolean
  status?: number
  error?: string
  detail?: string
  token?: string
  accountId?: string
  accountName?: string
  userEmail?: string
}

export interface BackfillAdapter<TRow = DailyRow> {
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
  ) => Promise<TRow[]>
  resolveContext?: (
    clientId: string,
    client: { user_email?: string | null; platform_connections?: any[] }
  ) => Promise<BackfillContextResult>
  buildRows?: (
    daily: TRow[],
    ctx: BackfillRowContext
  ) => Record<string, unknown>[]
  floorDate?: string
  // Per-adapter retention depth in months (default 132 = Google's 11-yr ceiling). Meta serves only ~37mo,
  // so it sets 36 (safety margin) — otherwise the engine descends past retention and Meta THROWS at the
  // boundary instead of returning empty, which used to stop the step short of "complete".
  granularMonths?: number
}

export interface BackfillResult {
  status: number
  body: Record<string, any>
}

const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
// 132 months = 11 years = Google's maximum reporting retention. We sweep back
// to here; younger accounts return empty for the older chunks (harmless).
const GRANULAR_MONTHS = 132
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
  adapter: BackfillAdapter<any>
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

  let token: string
  let accountId: string
  let accountName: string
  let userEmail: string

  if (adapter.resolveContext) {
    const ctx = await adapter.resolveContext(clientId, client)
    if (!ctx.ok || !ctx.token || !ctx.accountId) {
      return {
        status: ctx.status ?? 400,
        body: {
          error: ctx.error || adapter.connectionMissingError,
          detail: ctx.detail,
        },
      }
    }
    token = ctx.token
    accountId = ctx.accountId
    accountName = ctx.accountName || ctx.accountId
    userEmail = ctx.userEmail || client.user_email
  } else {
    const conn = connections.find(c => c.platform === adapter.platform)
    if (!conn) {
      return { status: 400, body: { error: adapter.connectionMissingError } }
    }
    accountId = conn.account_id
    accountName = conn.account_name || accountId
    userEmail = conn.user_email || client.user_email
    const tokenResult = await adapter.loadToken(userEmail)
    if (!tokenResult.token) {
      return {
        status: 400,
        body: { error: adapter.tokenMissingError, detail: tokenResult.error },
      }
    }
    token = tokenResult.token
  }

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
  // Always compute the floor fresh (deepest the platform allows), so deepening
  // takes effect even if an older shallower target was stored before. A
  // per-adapter floorDate clamps it (e.g. GA refuses dates before 2015-08-14).
  const targetObj = new Date()
  targetObj.setUTCMonth(targetObj.getUTCMonth() - (adapter.granularMonths ?? GRANULAR_MONTHS))
  let targetDate = fmt(targetObj)
  if (adapter.floorDate && targetDate < adapter.floorDate) {
    targetDate = adapter.floorDate
  }
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
  let stoppedOnError = false
  let stopCode: number | null = null
  let stopSubcode: number | null = null
  let stopDetail: string | null = null
  while (windowEnd >= targetDate && chunks < MAX_CHUNKS) {
    chunks += 1
    let windowStart = addDays(windowEnd, -(adapter.chunkDays - 1))
    if (windowStart < targetDate) windowStart = targetDate
    let daily: any[] = []
    try {
      daily = await adapter.fetchDaily(token, accountId, windowStart, windowEnd)
    } catch (e: any) {
      // (c) NEVER SWALLOW (Lesson 15): surface the error so the caller can tell a retention floor from a
      // transient from a query-too-heavy. The cursor stays at the last successful chunk so a re-run resumes.
      // We do NOT mark complete on an error — only an empty-success descent to targetDate is "complete".
      stoppedOnError = true
      stopCode = Number.isFinite(Number(e?.code)) ? Number(e.code) : null
      stopSubcode = Number.isFinite(Number(e?.error_subcode)) ? Number(e.error_subcode) : null
      stopDetail = String(e?.message ?? e ?? 'unknown error')
      break
    }
    const rows = adapter.buildRows
      ? adapter.buildRows(daily || [], { clientId, userEmail, accountId, accountName })
      : (daily || []).map((d: DailyRow) => ({
          client_id: clientId,
          user_email: userEmail,
          platform: adapter.platform,
          account_id: accountId, // LORAMER_MULTIACCOUNT_PHASE2A_V1
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
        .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT }) // LORAMER_METRICS_NORMALIZE_V1
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
  // Coarse label for the surfaced error (verified Meta taxonomy; harmless for other platforms whose errors
  // carry no .code → 'transient_or_other'). The drain interprets this to decide done-vs-retry.
  const stopReason = !stoppedOnError
    ? null
    : stopCode === 100 && stopSubcode === 1487534
      ? 'query_too_heavy'
      : stopCode === 190
        ? 'token'
        : stopCode === 368
          ? 'account_disabled'
          : stopCode === 100
            ? 'invalid_parameter'
            : 'transient_or_other'
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
      stoppedOnError,
      stopReason,
      stopCode,
      stopSubcode,
      stopDetail,
    },
  }
}
