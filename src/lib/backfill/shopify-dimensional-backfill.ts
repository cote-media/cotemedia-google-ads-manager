// LORAMER_SHOPIFY_DIM_BACKFILL_V1
// Bounded backfill of the Shopify depth grains (geo_country / geo_region + product NET) into
// metrics_daily, reusing the SAME fetchShopifyIntelligence + buildShopifyDepthRows as forward
// capture — so rows are byte-identical BY CONSTRUCTION (literally the same functions). Per-day loop.
//
// SEPARATE from any account path: progress cursor lives under a SYNTHETIC sync_state
// platform='shopify_dimensional' (the real 'shopify' forward/account row is never touched). Idempotent
// under the conflict key; partial-day honesty; empty days (pre-activity / all-cancelled) logged not
// errored; throttle-budget-aware (a THROTTLED wait that would blow the run budget stops + resumes).
//
// getValidShopifyToken is called ONCE at start (fresh ~1h token); the LORAMER_SHOPIFY_REFRESH_RACE_V1
// CAS claim loop makes a concurrent dashboard/cron refresh safe (win the claim or ride the published
// token) — no interaction.

import { supabaseAdmin } from '@/lib/supabase'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'
import { buildShopifyDepthRows } from '@/lib/intelligence/shopify-metrics-row'

const CURSOR_PLATFORM = 'shopify_dimensional' // sync_state progress key only; data rows are platform='shopify'
const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const DEFAULT_DAYS = 90
const DEFAULT_TIME_BUDGET_MS = 45_000 // under the 60s route; cursor bridges re-runs

function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

export interface ShopifyDimBackfillResult {
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

export async function runShopifyDimensionalBackfill(
  clientId: string,
  opts: { days?: number; timeBudgetMs?: number; now?: string } = {}
): Promise<ShopifyDimBackfillResult> {
  const days = opts.days ?? DEFAULT_DAYS
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = Date.now()
  const throttleDeadline = startedAt + timeBudgetMs

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')
    .eq('id', clientId)
    .single()
  if (clientErr || !client) {
    return { status: 404, body: { error: 'Client not found', detail: clientErr?.message } }
  }
  const conn = (client.platform_connections || []).find((c: any) => c.platform === 'shopify')
  if (!conn) {
    return { status: 400, body: { error: 'Client has no Shopify connection' } }
  }
  const shopDomain = conn.account_id as string
  const userEmail = (conn.user_email || client.user_email) as string

  const tokenResult = await getValidShopifyToken(userEmail, shopDomain)
  if (!tokenResult.ok) {
    return { status: 400, body: { error: 'Shopify token unavailable', detail: `${tokenResult.reason}${tokenResult.detail ? ' - ' + tokenResult.detail : ''}` } }
  }
  const accessToken = tokenResult.accessToken

  const nowIso = opts.now ?? fmt(new Date())
  const endDate = addDays(nowIso, -1)
  const targetStart = addDays(nowIso, -days)

  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', CURSOR_PLATFORM)
    .maybeSingle()
  if (stateRow?.backfill_complete) {
    return { status: 200, body: { clientId, shopDomain, complete: true, note: 'already complete' } }
  }

  const windowEnd = stateRow?.backfill_earliest_date ? addDays(stateRow.backfill_earliest_date, -1) : endDate
  if (windowEnd < targetStart) {
    await upsertCursor(clientId, targetStart, targetStart, true)
    return { status: 200, body: { clientId, shopDomain, complete: true, note: 'window already covered' } }
  }

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
      const intel = await fetchShopifyIntelligence(accessToken, shopDomain, 'CUSTOM', cursor, cursor, { throttleDeadline })
      const rows = buildShopifyDepthRows(clientId, userEmail, cursor, shopDomain, intel)
      if (rows.length === 0) {
        emptyDays += 1 // pre-activity / all-cancelled / no orders — normal, still a covered day
      } else {
        const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })
        if (upErr) throw upErr
        daysWritten += 1
        rowsWritten += rows.length
      }
      if (cursor < earliestWritten) earliestWritten = cursor
    } catch (e: any) {
      if (e?.throttleBudget) {
        // a throttle wait would blow the budget — stop and resume next invocation (NOT an error)
        timedOut = true
        break
      }
      console.error(`[shopify-dim-backfill] client=${clientId} shop=${shopDomain} date=${cursor} FAILED:`, e?.message ?? e)
      errors.push({ date: cursor, message: String(e?.message ?? e) })
      break
    }
  }

  const done = earliestWritten <= targetStart && errors.length === 0 && !timedOut
  await upsertCursor(clientId, earliestWritten, targetStart, done)

  const resumeFrom = done ? null : errors.length ? errors[0].date : addDays(earliestWritten, -1)

  return {
    status: errors.length ? 207 : 200,
    body: {
      clientId,
      shopDomain,
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
