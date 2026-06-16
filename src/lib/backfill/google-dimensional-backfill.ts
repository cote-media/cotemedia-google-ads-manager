// LORAMER_SEARCH_TERMS_BACKFILL_V1
// Bounded one-time-per-client recovery of the last ~90 days of Google search-term + keyword history
// into metrics_daily, using the SAME shared builder as forward capture (byte-identical rows).
//
// SEPARATE from the V2 account-level engine (run-backfill.ts): that engine is account-level + windowed
// (chunkDays=365); this is per-day-bucketed dimensional capture. Keeping it standalone means the proven
// account backfill and its platform='google' sync_state row are NEVER touched.
//
// Strategy: Option B (one windowed query per type → bucket by date → per-day top-N) by default; on a
// row-cap overflow, fall back to Option A (per-day queries) LOUDLY. Progress is tracked under a
// SYNTHETIC sync_state key platform='google_dimensional' (the metrics_daily rows stay platform='google'),
// so re-runs resume and never collide with the account backfill cursor.

import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize' // LORAMER_METRICS_NORMALIZE_V1
import {
  fetchGoogleDimensional,
  fetchGoogleDimensionalWindow,
  bucketWindowByDate,
  buildGoogleDimensionalRows,
  type GoogleDimensional,
} from '@/lib/intelligence/google-dimensional'

const CURSOR_PLATFORM = 'google_dimensional' // sync_state progress key only; data rows are platform='google'
const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const DEFAULT_DAYS = 90
const DEFAULT_TIME_BUDGET_MS = 45_000 // stay under the route's 60s maxDuration; cursor bridges re-runs

function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

export interface DimBackfillResult {
  status: number
  body: Record<string, any>
}

async function upsertCursor(clientId: string, earliest: string, target: string, complete: boolean): Promise<void> {
  await supabaseAdmin.from('sync_state').upsert(
    {
      client_id: clientId,
      platform: CURSOR_PLATFORM,
      backfill_earliest_date: earliest,
      backfill_target_date: target,
      backfill_complete: complete,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,platform' }
  )
}

export async function runGoogleDimensionalBackfill(
  clientId: string,
  opts: { days?: number; timeBudgetMs?: number; now?: string } = {}
): Promise<DimBackfillResult> {
  const days = opts.days ?? DEFAULT_DAYS
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = Date.now()

  // Resolve client + Google connection + token (mirrors forward capture's resolution).
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')
    .eq('id', clientId)
    .single()
  if (clientErr || !client) {
    return { status: 404, body: { error: 'Client not found', detail: clientErr?.message } }
  }
  const conn = (client.platform_connections || []).find((c: any) => c.platform === 'google')
  if (!conn) {
    return { status: 400, body: { error: 'Client has no Google connection' } }
  }
  const customerId = conn.account_id as string
  const userEmail = (conn.user_email || client.user_email) as string

  const { data: tokRow, error: tokErr } = await supabaseAdmin
    .from('google_tokens')
    .select('refresh_token')
    .eq('user_email', userEmail)
    .single()
  if (tokErr || !tokRow?.refresh_token) {
    return { status: 400, body: { error: 'No Google refresh token', detail: tokErr?.message } }
  }
  const refreshToken = tokRow.refresh_token as string

  // Window [targetStart, endDate]; endDate = yesterday UTC (last fully-closed day, like forward capture).
  const nowIso = opts.now ?? fmt(new Date())
  const endDate = addDays(nowIso, -1)
  const targetStart = addDays(nowIso, -days)

  // Resume cursor (synthetic platform — never reads/writes the real 'google' row).
  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', CURSOR_PLATFORM)
    .maybeSingle()
  if (stateRow?.backfill_complete) {
    return { status: 200, body: { clientId, customerId, complete: true, note: 'already complete' } }
  }

  // Process backward (recent first). On resume, continue below the earliest covered day.
  const windowEnd = stateRow?.backfill_earliest_date ? addDays(stateRow.backfill_earliest_date, -1) : endDate
  if (windowEnd < targetStart) {
    await upsertCursor(clientId, targetStart, targetStart, true)
    return { status: 200, body: { clientId, customerId, complete: true, note: 'window already covered' } }
  }

  // Option B: one windowed query per type → bucket by date. Fall back to per-day (Option A) on overflow.
  let useOptionA = false
  let buckets: Map<string, GoogleDimensional> = new Map()
  try {
    const win = await fetchGoogleDimensionalWindow(refreshToken, customerId, targetStart, windowEnd)
    if (win.overflow) {
      useOptionA = true
      console.warn(
        `[dim-backfill] client=${clientId} cust=${customerId} OPTION-B OVERFLOW (>= row cap) — falling back to per-day (Option A) for ${targetStart}..${windowEnd}`
      )
    } else {
      buckets = bucketWindowByDate(win)
    }
  } catch (e: any) {
    console.error(`[dim-backfill] client=${clientId} windowed fetch FAILED:`, e?.message ?? e)
    return { status: 502, body: { error: 'windowed fetch failed', detail: String(e?.message ?? e), resumeFrom: windowEnd } }
  }

  // Per-day loop, backward, time-budgeted. Partial-day honesty: a day advances the cursor only after
  // its upsert (or confirmed-empty) succeeds; a failed day is left for the resume pass.
  let daysWritten = 0
  let rowsWritten = 0
  let emptyDays = 0
  let timedOut = false
  const errors: Array<{ date: string; message: string }> = []
  let earliestWritten = stateRow?.backfill_earliest_date || addDays(endDate, 1)

  for (let cursor = windowEnd; cursor >= targetStart; cursor = addDays(cursor, -1)) {
    if (Date.now() - startedAt > timeBudgetMs) {
      timedOut = true
      break
    }
    try {
      const dim: GoogleDimensional = useOptionA
        ? await fetchGoogleDimensional(refreshToken, customerId, cursor, cursor)
        : buckets.get(cursor) || { searchTerms: [], keywords: [], searchTermsTruncated: false, keywordsTruncated: false }

      if (dim.searchTermsTruncated || dim.keywordsTruncated) {
        console.warn(
          `[dim-backfill] client=${clientId} date=${cursor} TRUNCATED searchTerms@cap=${dim.searchTermsTruncated} keywords@cap=${dim.keywordsTruncated}`
        )
      }

      const rows = buildGoogleDimensionalRows(clientId, userEmail, cursor, customerId, dim)
      if (rows.length === 0) {
        emptyDays += 1 // empty = retention floor / no activity — normal, still a covered day
      } else {
        const { error: upErr } = await supabaseAdmin
          .from('metrics_daily')
          .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT }) // LORAMER_METRICS_NORMALIZE_V1
        if (upErr) throw upErr
        daysWritten += 1
        rowsWritten += rows.length
      }
      if (cursor < earliestWritten) earliestWritten = cursor
    } catch (e: any) {
      console.error(`[dim-backfill] client=${clientId} date=${cursor} FAILED:`, e?.message ?? e)
      errors.push({ date: cursor, message: String(e?.message ?? e) })
      break // stop loud; cursor not advanced for this day → resume re-processes it
    }
  }

  const done = earliestWritten <= targetStart && errors.length === 0 && !timedOut
  await upsertCursor(clientId, earliestWritten, targetStart, done)

  const resumeFrom = done
    ? null
    : errors.length
      ? errors[0].date
      : addDays(earliestWritten, -1)

  return {
    status: errors.length ? 207 : 200,
    body: {
      clientId,
      customerId,
      option: useOptionA ? 'A(per-day)' : 'B(windowed)',
      dateRange: { start: targetStart, end: endDate },
      processedThrough: earliestWritten,
      daysWritten,
      rowsWritten,
      emptyDays,
      done,
      resumeFrom,
      errors,
    },
  }
}
