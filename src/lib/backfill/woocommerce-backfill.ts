// LORAMER_WOO_BACKFILL_2A_V1
// Bounded historical backfill of WooCommerce account + product(top-10) rows into metrics_daily,
// reusing the Phase-1 corrected fetcher pieces (fetchWooOrdersRaw + WOO_SALE_STATUSES +
// summarizeWooOrders + buildWooMetricsRows) so rows are byte-identical to forward capture BY
// CONSTRUCTION (literally the same functions). WINDOW-fetch in backward monthly chunks (Gate A:
// ~3 orders/day avg, ~311 peak/day → a month paginates comfortably), then bucket the
// sale-filtered+net results per-day.
//
// SEPARATE cursor: sync_state platform='woocommerce_backfill' (the forward 'woocommerce' row, which
// carries last_forward_sync_date, is never touched). Resumable + time-budgeted + MAX_CHUNKS/run.
//
// FALSE-ZERO DISCIPLINE (Lessons 15/46): write a row ONLY for a day with >=1 sale order; skip empty
// days (absence = a true zero — never write a $0 row over real data). On a fetch/upsert ERROR, do NOT
// advance the cursor and do NOT write — surface loudly and resume.
// COMPLETENESS: when a chunk returns ZERO all-status orders, we've reached the start of the merchant's
// order history → mark complete. (No comparison to any account-creation/max-history date.)

import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize' // LORAMER_METRICS_NORMALIZE_V1 (§A guard)
import {
  fetchWooOrdersRaw,
  WOO_SALE_STATUSES,
  summarizeWooOrders,
} from '@/lib/intelligence/woocommerce-intelligence'
import { buildWooMetricsRows } from '@/lib/intelligence/woocommerce-metrics-row'

const CURSOR_PLATFORM = 'woocommerce_backfill' // progress key only; data rows stay platform='woocommerce'
const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const DEFAULT_DAYS = 4000 // ~11y floor; completeness normally triggers earlier on an empty chunk
const CHUNK_DAYS = 21 // big enough that low-volume windows are 1 page; small enough to bound a heavy chunk
const MAX_CHUNKS = 60 // per invocation; the time budget is the real gate; cursor bridges re-runs
const MAX_PAGES = 30 // ≤3,000 orders/chunk — above any real 21-day window here (no truncation), bounds a runaway
const DEFAULT_TIME_BUDGET_MS = 90_000 // margin under the 300s route; cursor only advances per COMPLETED chunk, so a
                                       // rare overrun self-heals on resume (idempotent, no false-zero, no cursor skip)

function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

export interface WooBackfillResult {
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

export async function runWooCommerceBackfill(
  clientId: string,
  opts: { days?: number; timeBudgetMs?: number; now?: string } = {}
): Promise<WooBackfillResult> {
  const days = opts.days ?? DEFAULT_DAYS
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = Date.now()

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')
    .eq('id', clientId)
    .single()
  if (clientErr || !client) {
    return { status: 404, body: { error: 'Client not found', detail: clientErr?.message } }
  }
  const conn = (client.platform_connections || []).find((c: any) => c.platform === 'woocommerce')
  if (!conn) {
    return { status: 400, body: { error: 'Client has no WooCommerce connection' } }
  }
  const userEmail = (conn.user_email || client.user_email) as string

  // Woo creds live in woocommerce_tokens keyed by (user_email, client_id). store_url there is the
  // account_id forward capture writes to metrics_daily — use it for byte-identical rows.
  const { data: tok, error: tokErr } = await supabaseAdmin
    .from('woocommerce_tokens')
    .select('store_url, consumer_key, consumer_secret')
    .eq('user_email', userEmail)
    .eq('client_id', clientId)
    .single()
  if (tokErr || !tok?.store_url || !tok?.consumer_key || !tok?.consumer_secret) {
    return { status: 400, body: { error: 'WooCommerce credentials unavailable', detail: tokErr?.message } }
  }
  const storeUrl = tok.store_url as string

  const nowIso = opts.now ?? fmt(new Date())
  const endDate = addDays(nowIso, -1) // yesterday
  const targetStart = addDays(nowIso, -days)

  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', CURSOR_PLATFORM)
    .maybeSingle()
  if (stateRow?.backfill_complete) {
    return { status: 200, body: { clientId, storeUrl, complete: true, note: 'already complete' } }
  }

  let windowEnd = stateRow?.backfill_earliest_date ? addDays(stateRow.backfill_earliest_date, -1) : endDate
  if (windowEnd < targetStart) {
    await upsertCursor(clientId, targetStart, targetStart, true)
    return { status: 200, body: { clientId, storeUrl, complete: true, note: 'window already covered' } }
  }

  let chunks = 0
  let daysWritten = 0
  let rowsWritten = 0
  let ordersSeen = 0
  let saleOrdersSeen = 0
  let reachedHistoryStart = false
  let timedOut = false
  let earliestWritten = stateRow?.backfill_earliest_date || addDays(endDate, 1)
  const errors: Array<{ window: string; message: string }> = []

  while (windowEnd >= targetStart && chunks < MAX_CHUNKS) {
    if (Date.now() - startedAt > timeBudgetMs) { timedOut = true; break }
    chunks += 1
    let windowStart = addDays(windowEnd, -(CHUNK_DAYS - 1))
    if (windowStart < targetStart) windowStart = targetStart

    let raw: any[]
    try {
      raw = await fetchWooOrdersRaw(
        storeUrl, tok.consumer_key, tok.consumer_secret,
        windowStart + 'T00:00:00', windowEnd + 'T23:59:59', MAX_PAGES
      )
    } catch (e: any) {
      console.error(`[woo-backfill] client=${clientId} window=${windowStart}..${windowEnd} FETCH FAILED:`, e?.message ?? e)
      errors.push({ window: `${windowStart}..${windowEnd}`, message: String(e?.message ?? e) })
      break // do NOT advance the cursor; do NOT write. Resume re-processes this chunk.
    }

    if (raw.length === 0) {
      // No orders of ANY status before this window → start of the merchant's order history.
      reachedHistoryStart = true
      earliestWritten = windowStart
      break
    }
    ordersSeen += raw.length

    // Bucket by date_created's calendar day (site tz — matches forward's after/before frame).
    const byDay: Record<string, any[]> = {}
    for (const o of raw) {
      const day = String(o.date_created || '').slice(0, 10)
      if (!day) continue
      if (!byDay[day]) byDay[day] = []
      byDay[day].push(o)
    }

    const rows: Record<string, unknown>[] = []
    for (const [day, dayOrders] of Object.entries(byDay)) {
      const saleDay = dayOrders.filter((o) => WOO_SALE_STATUSES.has(String(o.status || '').toLowerCase()))
      if (saleDay.length === 0) continue // false-zero discipline: no sale that day → write nothing
      saleOrdersSeen += saleDay.length
      const summary = summarizeWooOrders(saleDay)
      rows.push(...buildWooMetricsRows(clientId, userEmail, day, storeUrl, summary))
      daysWritten += 1
    }

    if (rows.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('metrics_daily')
        .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
      if (upErr) {
        console.error(`[woo-backfill] client=${clientId} window=${windowStart}..${windowEnd} UPSERT FAILED:`, upErr.message)
        errors.push({ window: `${windowStart}..${windowEnd}`, message: upErr.message })
        break // do not advance the cursor past a failed write
      }
      rowsWritten += rows.length
    }

    earliestWritten = windowStart
    windowEnd = addDays(windowStart, -1)
    await upsertCursor(clientId, earliestWritten, targetStart, false)
  }

  // Complete ONLY when we hit the start of the merchant's history (an empty chunk). A days-floor stop,
  // a timeout, or the per-run chunk cap leaves it incomplete + resumable (the next run continues).
  const complete = reachedHistoryStart
  await upsertCursor(clientId, earliestWritten, targetStart, complete)

  return {
    status: errors.length ? 502 : 200,
    body: {
      clientId,
      storeUrl,
      complete,
      reachedHistoryStart,
      timedOut,
      chunksThisRun: chunks,
      daysWritten,
      rowsWritten,
      ordersSeen,
      saleOrdersSeen,
      earliest: earliestWritten,
      target: targetStart,
      errors,
      resumeFrom: complete ? null : addDays(earliestWritten, -1),
    },
  }
}
