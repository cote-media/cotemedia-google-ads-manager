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

import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize' // LORAMER_METRICS_NORMALIZE_V1 (§A guard)
import {
  fetchWooOrdersRaw,
  WOO_SALE_STATUSES,
  summarizeWooOrders,
} from '@/lib/intelligence/woocommerce-intelligence'
import { buildWooMetricsRows } from '@/lib/intelligence/woocommerce-metrics-row'
import { adaptiveFetchWindow, type WooFetchFn } from '@/lib/backfill/woo-adaptive'

const CURSOR_PLATFORM = 'woocommerce_backfill' // progress key only; data rows stay platform='woocommerce'
const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const DEFAULT_DAYS = 4000 // ~11y floor; completeness normally triggers earlier on an empty chunk
const CHUNK_DAYS = 21 // big enough that low-volume windows are 1 page; small enough to bound a heavy chunk
const MAX_CHUNKS = 60 // per invocation; the time budget is the real gate; cursor bridges re-runs
const MAX_PAGES = 30 // ≤3,000 orders/chunk — above any real 21-day window here (no truncation), bounds a runaway
const DEFAULT_TIME_BUDGET_MS = 90_000 // margin under the 300s route; cursor only advances per COMPLETED chunk, so a
                                       // rare overrun self-heals on resume (idempotent, no false-zero, no cursor skip)
const THROTTLE_MS = 300 // LORAMER_WOO_BACKFILL_SAFE_V1 — gentle: delay between page fetches AND between windows
const BLOCK_THRESHOLD = 2 // trip the breaker after this many CONSECUTIVE per-day-floor failures at the frontier
const MAX_OUTBOUND_FETCHES = 500 // hard per-invocation backstop. The 90s time budget is the real gate (at the 300ms
                                  // throttle floor ≤ ~300 fetches fit in it); this only trips if time accounting is bypassed.

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

// Generalized cursor writer — upserts whatever fields are passed (earliest/target/complete + breaker state).
async function writeCursor(clientId: string, fields: Record<string, unknown>): Promise<void> {
  await supabaseAdmin.from('sync_state').upsert(
    { client_id: clientId, platform: CURSOR_PLATFORM, updated_at: new Date().toISOString(), ...fields },
    { onConflict: 'client_id,platform' }
  )
}

export async function runWooCommerceBackfill(
  clientId: string,
  opts: { days?: number; timeBudgetMs?: number; now?: string; unblock?: boolean; fetchOrders?: WooFetchFn } = {}
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

  // ── Read state (cursor + circuit-breaker) BEFORE any claim or store call ───────────────────────
  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_complete, backfill_blocked, backfill_block_window, backfill_block_reason, backfill_block_fails')
    .eq('client_id', clientId)
    .eq('platform', CURSOR_PLATFORM)
    .maybeSingle()

  if (stateRow?.backfill_complete) {
    return { status: 200, body: { clientId, storeUrl, status: 'complete', complete: true, note: 'already complete' } }
  }
  // CIRCUIT-BREAKER (caller-proof): a blocked backfill NO-OPs with ZERO outbound store requests, and
  // before the claim — so no caller (UI button, cron, script, Claude Code) can re-hammer a known-bad
  // window no matter how often it calls. Cleared only by a deliberate ?unblock=true.
  if (stateRow?.backfill_blocked && !opts.unblock) {
    return {
      status: 200,
      body: {
        clientId, storeUrl, status: 'blocked',
        window: stateRow.backfill_block_window, reason: stateRow.backfill_block_reason,
        note: 'backfill blocked at a window the source store cannot serve; retry with ?unblock=true after the store is fixed',
      },
    }
  }

  // ── Concurrency claim (CAS) — only after the cheap complete/blocked short-circuits ─────────────
  const claimToken = randomUUID()
  const { data: claimed, error: claimErr } = await supabaseAdmin.rpc('claim_backfill_cursor', {
    p_client_id: clientId, p_platform: CURSOR_PLATFORM, p_token: claimToken,
  })
  if (claimErr) {
    return { status: 500, body: { error: 'claim check failed', detail: claimErr.message } }
  }
  if (!claimed) {
    return { status: 200, body: { clientId, storeUrl, status: 'skipped', skipped: true, note: 'another backfill invocation holds the claim' } }
  }
  const release = async () => {
    try {
      await supabaseAdmin.rpc('release_backfill_cursor', { p_client_id: clientId, p_platform: CURSOR_PLATFORM, p_token: claimToken })
    } catch { /* best-effort; self-heals via the 360s staleness reclaim */ }
  }

  // Deliberate unblock: clear the breaker for ONE retry from the current frontier.
  let blockFails = stateRow?.backfill_block_fails ?? 0
  if (opts.unblock && stateRow?.backfill_blocked) {
    blockFails = 0
    await writeCursor(clientId, { backfill_blocked: false, backfill_block_fails: 0, backfill_block_window: null, backfill_block_reason: null })
  }

  // Resume PURELY from the persisted cursor (the true frontier). No caller-specified window → a caller
  // can never force a re-walk of already-captured windows.
  let windowEnd = stateRow?.backfill_earliest_date ? addDays(stateRow.backfill_earliest_date, -1) : endDate
  if (windowEnd < targetStart) {
    await writeCursor(clientId, { backfill_earliest_date: targetStart, backfill_target_date: targetStart, backfill_complete: true })
    await release()
    return { status: 200, body: { clientId, storeUrl, status: 'complete', complete: true, note: 'window already covered' } }
  }

  // Injected fetcher (tests) OR the real throttled paginated fetch; counted against the outbound backstop.
  let outbound = 0
  const baseFetch: WooFetchFn =
    opts.fetchOrders ??
    ((s, e) => fetchWooOrdersRaw(storeUrl, tok.consumer_key as string, tok.consumer_secret as string, s + 'T00:00:00', e + 'T23:59:59', MAX_PAGES, THROTTLE_MS))
  const countedFetch: WooFetchFn = async (s, e) => {
    if (outbound >= MAX_OUTBOUND_FETCHES) throw new Error('__BUDGET__')
    if (THROTTLE_MS > 0 && outbound > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS)) // gentle between windows
    outbound += 1
    return baseFetch(s, e)
  }

  let chunks = 0
  let daysWritten = 0
  let rowsWritten = 0
  let ordersSeen = 0
  let saleOrdersSeen = 0
  let reachedHistoryStart = false
  let timedOut = false
  let budgetHit = false
  let earliestWritten = stateRow?.backfill_earliest_date || addDays(endDate, 1)
  // store-side halt/block outcome (graceful, NOT a 5xx)
  let halted = false
  let blockedNow = false
  let blockWindow: string | null = null
  let blockReason: string | null = null

  while (windowEnd >= targetStart && chunks < MAX_CHUNKS) {
    if (Date.now() - startedAt > timeBudgetMs) { timedOut = true; break }
    if (outbound >= MAX_OUTBOUND_FETCHES) { budgetHit = true; break }
    chunks += 1
    let windowStart = addDays(windowEnd, -(CHUNK_DAYS - 1))
    if (windowStart < targetStart) windowStart = targetStart

    let res
    try {
      res = await adaptiveFetchWindow(countedFetch, windowStart, windowEnd)
    } catch (e: any) {
      if (String(e?.message) === '__BUDGET__') { budgetHit = true; break }
      console.error(`[woo-backfill] client=${clientId} window=${windowStart}..${windowEnd} ADAPTIVE THREW:`, e?.message ?? e)
      halted = true; blockWindow = `${windowStart}..${windowEnd}`; blockReason = String(e?.message ?? e); break
    }

    // Write whatever was captured (contiguous newest range) — even on a partial (!ok) result.
    if (res.orders.length > 0) {
      ordersSeen += res.orders.length
      const byDay: Record<string, any[]> = {}
      for (const o of res.orders) {
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
        rows.push(...buildWooMetricsRows(clientId, userEmail, day, storeUrl, summarizeWooOrders(saleDay)))
        daysWritten += 1
      }
      if (rows.length > 0) {
        const { error: upErr } = await supabaseAdmin
          .from('metrics_daily')
          .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
        if (upErr) {
          // INFRA error (our DB) → a genuine 5xx; do NOT advance the cursor.
          console.error(`[woo-backfill] client=${clientId} UPSERT FAILED:`, upErr.message)
          await release()
          return { status: 500, body: { error: 'metrics_daily upsert failed', detail: upErr.message, earliest: earliestWritten } }
        }
        rowsWritten += rows.length
      }
    }

    if (res.ok) {
      if (res.orders.length === 0) {
        // a fully-fetched window with ZERO all-status orders → start of the merchant's history
        reachedHistoryStart = true
        earliestWritten = windowStart
        break
      }
      earliestWritten = windowStart
      windowEnd = addDays(windowStart, -1)
      blockFails = 0 // success at this frontier resets the consecutive-failure counter
      await writeCursor(clientId, { backfill_earliest_date: earliestWritten, backfill_target_date: targetStart, backfill_complete: false, backfill_block_fails: 0 })
    } else {
      // STORE-SIDE failure at the per-day floor → halt-and-surface; trip the breaker on the Nth time.
      halted = true
      blockWindow = res.failedDay ?? `${windowStart}..${windowEnd}`
      blockReason = res.reason ?? 'window unservable at per-day floor'
      earliestWritten = res.failedDay ? addDays(res.failedDay, 1) : earliestWritten // frontier just above the broken day
      blockFails += 1
      blockedNow = blockFails >= BLOCK_THRESHOLD
      await writeCursor(clientId, {
        backfill_earliest_date: earliestWritten,
        backfill_target_date: targetStart,
        backfill_complete: false,
        backfill_block_fails: blockFails,
        backfill_blocked: blockedNow,
        backfill_block_window: blockedNow ? blockWindow : null,
        backfill_block_reason: blockedNow ? blockReason : null,
        backfill_block_at: blockedNow ? new Date().toISOString() : null,
      })
      break
    }
  }

  // STORE-SIDE halt/block → graceful 200 (NEVER a 5xx). Cursor + breaker state already persisted above.
  if (halted) {
    await release()
    return {
      status: 200,
      body: {
        clientId, storeUrl,
        status: blockedNow ? 'blocked' : 'halted',
        window: blockWindow, reason: blockReason, blockFails,
        chunksThisRun: chunks, daysWritten, rowsWritten, ordersSeen, saleOrdersSeen,
        earliest: earliestWritten, target: targetStart, outbound,
      },
    }
  }

  // Normal completion / incomplete-resumable path (timeout / chunk-cap / budget-backstop are all resumable).
  const complete = reachedHistoryStart
  await writeCursor(clientId, { backfill_earliest_date: earliestWritten, backfill_target_date: targetStart, backfill_complete: complete })
  await release()
  return {
    status: 200,
    body: {
      clientId, storeUrl,
      status: complete ? 'complete' : 'ok',
      complete, reachedHistoryStart, timedOut, budgetHit,
      chunksThisRun: chunks, daysWritten, rowsWritten, ordersSeen, saleOrdersSeen,
      earliest: earliestWritten, target: targetStart, outbound,
      resumeFrom: complete ? null : addDays(earliestWritten, -1),
    },
  }
}
