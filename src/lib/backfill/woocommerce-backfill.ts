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
  fetchWooProductAttrs,
  makeWooProductFetcher,
  type WooProductAttrs,
  type WooProductFetchFn,
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
async function writeCursor(clientId: string, platform: string, fields: Record<string, unknown>): Promise<void> {
  await supabaseAdmin.from('sync_state').upsert(
    { client_id: clientId, platform, updated_at: new Date().toISOString(), ...fields },
    { onConflict: 'client_id,platform' }
  )
}

export async function runWooCommerceBackfill(
  clientId: string,
  opts: { days?: number; timeBudgetMs?: number; now?: string; unblock?: boolean; fetchOrders?: WooFetchFn; cursorPlatform?: string } = {}
): Promise<WooBackfillResult> {
  const days = opts.days ?? DEFAULT_DAYS
  // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — the variant drain step re-walks under a SEPARATE cursor namespace
  // ('woocommerce_variant') with its OWN claim/breaker/cursor row so an already-complete 'woocommerce_backfill'
  // client re-emits depth rows (incl. the new variant rows) idempotently. Default = the original cursor (zero
  // behavior change for the existing 'woo' step; gentle-citizen throttle + breaker carry over unchanged).
  const cursorKey = opts.cursorPlatform ?? CURSOR_PLATFORM
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

  // ── Atomic CAS claim → ALL cross-invocation state from its primary RETURNING ────────────────────
  // LORAMER_WOO_BACKFILL_ATOMIC_BREAKER_V1: no standalone SELECT drives control flow. The claim RPC
  // both takes the CAS lock AND returns the row state (claimed/blocked/block_fails/earliest/complete)
  // read in the same transaction as the write — so complete/blocked/cursor are primary-fresh, never a
  // lagging replica read. The complete/blocked gates run AFTER the claim (claim-then-release-if-blocked
  // is intentional; a blocked run still does ZERO outbound store fetches — DB ops are fine).
  const claimToken = randomUUID()
  const { data: claimRows, error: claimErr } = await supabaseAdmin.rpc('claim_backfill_cursor', {
    p_client_id: clientId, p_platform: cursorKey, p_token: claimToken,
  })
  if (claimErr) {
    return { status: 500, body: { error: 'claim check failed', detail: claimErr.message } }
  }
  const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as
    | { claimed: boolean; blocked: boolean; block_fails: number; earliest: string | null; complete: boolean; block_window: string | null; block_reason: string | null }
    | undefined
  if (!claim?.claimed) {
    return { status: 200, body: { clientId, storeUrl, status: 'skipped', skipped: true, note: 'another backfill invocation holds the claim' } }
  }
  const release = async () => {
    try {
      await supabaseAdmin.rpc('release_backfill_cursor', { p_client_id: clientId, p_platform: cursorKey, p_token: claimToken })
    } catch { /* best-effort; self-heals via the 360s staleness reclaim */ }
  }

  if (claim.complete) {
    await release()
    return { status: 200, body: { clientId, storeUrl, status: 'complete', complete: true, note: 'already complete' } }
  }
  // CIRCUIT-BREAKER (caller-proof): a blocked backfill NO-OPs with ZERO outbound store requests. The
  // blocked flag is read from the claim's primary RETURNING, so no caller (UI button, cron, script,
  // Claude Code) can re-hammer a known-bad window no matter how often it calls. Cleared only by ?unblock=true.
  if (claim.blocked && !opts.unblock) {
    await release()
    return {
      status: 200,
      body: {
        clientId, storeUrl, status: 'blocked',
        window: claim.block_window, reason: claim.block_reason,
        note: 'backfill blocked at a window the source store cannot serve; retry with ?unblock=true after the store is fixed',
      },
    }
  }

  // Deliberate unblock: clear the breaker for ONE retry from the current frontier (direct constant write).
  let blockFails = claim.block_fails ?? 0
  if (opts.unblock && claim.blocked) {
    blockFails = 0
    await writeCursor(clientId, cursorKey, { backfill_blocked: false, backfill_block_fails: 0, backfill_block_window: null, backfill_block_reason: null, backfill_block_at: null })
  }

  // Resume PURELY from the persisted cursor (the true frontier, from the claim's RETURNING). No
  // caller-specified window → a caller can never force a re-walk of already-captured windows.
  let windowEnd = claim.earliest ? addDays(claim.earliest, -1) : endDate
  if (windowEnd < targetStart) {
    await writeCursor(clientId, cursorKey, { backfill_earliest_date: targetStart, backfill_target_date: targetStart, backfill_complete: true })
    await release()
    return { status: 200, body: { clientId, storeUrl, status: 'complete', complete: true, note: 'window already covered' } }
  }

  // Injected fetcher (tests) OR the real throttled paginated fetch; counted against the outbound backstop.
  let outbound = 0
  const baseFetch: WooFetchFn =
    opts.fetchOrders ??
    ((s, e) => fetchWooOrdersRaw(storeUrl, tok.consumer_key as string, tok.consumer_secret as string, s + 'T00:00:00', e + 'T23:59:59', MAX_PAGES, THROTTLE_MS))
  // The outbound backstop is enforced at chunk-top (below); countedFetch never throws a budget signal —
  // a throw here would be caught by adaptiveFetchWindow and misread as a store failure (false breaker trip).
  const countedFetch: WooFetchFn = async (s, e) => {
    if (THROTTLE_MS > 0 && outbound > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS)) // gentle between windows
    outbound += 1
    return baseFetch(s, e)
  }
  // LORAMER_WOO_BATCH_WB_V1 — the product-attribute fetch, wrapped in the SAME accounting as countedFetch
  // directly above: it increments the SAME `outbound` counter (so it counts against MAX_OUTBOUND_FETCHES and
  // against the chunk-top budget check), waits the SAME THROTTLE_MS, runs inside the SAME CAS claim, and stops
  // the moment the lap stops. That is mitigation 4, and it is the whole reason the HTTP call is injected from
  // woocommerce-intelligence rather than made there: a raw fetch() in the intelligence module would be outside
  // every one of these controls, which is precisely the 2026-06-16 Shelley over-request incident (Lesson 51).
  // It is NOT inside woo-adaptive's ladder — that de-escalates DATE windows and an id batch has no dates;
  // fetchWooProductAttrs carries the id-space equivalent (halve-and-retry, then mark the ids and move on).
  const countedProductFetch: WooProductFetchFn = async (ids) => {
    if (THROTTLE_MS > 0 && outbound > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS))
    outbound += 1
    return makeWooProductFetcher(storeUrl, tok.consumer_key as string, tok.consumer_secret as string)(ids)
  }
  // LAP-SCOPED cache — created ONCE per invocation, shared by every chunk and every day within the lap. This is
  // mitigation 1: the product→category mapping is store-level, not daily, so a multi-year re-walk pays for each
  // product ONCE instead of once per day it sold on.
  const productAttrCache = new Map<string, WooProductAttrs | null>()
  // ...but ONLY the breadth namespace pays for it. The 'woo', 'woocommerce_variant' and 'woocommerce_money'
  // laps re-walk the SAME store, so fetching attributes on all four would quadruple the one family that costs
  // requests, to write rows the breadth lap already covers for the same history. Those laps still emit the
  // nine free W-A families; they simply pass no cache, so product_category/product_tag emit NOTHING (silence,
  // not zeros — the undefined-vs-[] distinction the row builder preserves).
  const wantsProductAttrs = cursorKey === 'woocommerce_breadth'
  let productBatches = 0
  let productIdsFetched = 0
  let productIdsFailed = 0

  let chunks = 0
  let daysWritten = 0
  let rowsWritten = 0
  let ordersSeen = 0
  let saleOrdersSeen = 0
  let reachedHistoryStart = false
  let timedOut = false
  let budgetHit = false
  let earliestWritten = claim.earliest || addDays(endDate, 1)
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
      // adaptiveFetchWindow returns ok:false on store errors and never throws on them; a throw here is a
      // truly unexpected fault → halt-and-surface (no breaker bump, next run retries the same window).
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
      // LORAMER_WOO_BATCH_WB_V1 — one attribute top-up per CHUNK (not per day), for the product ids this chunk
      // introduced that the lap has not already resolved. Soft by construction: fetchWooProductAttrs never
      // throws, so a product-lookup failure can never take the orders capture down with it.
      const chunkProductIds = [...new Set(
        res.orders
          .filter((o: any) => WOO_SALE_STATUSES.has(String(o.status || '').toLowerCase()))
          .flatMap((o: any) => ((o.line_items as any[]) || []).map((li) => String(li?.product_id ?? '')))
          .filter(Boolean)
      )]
      if (wantsProductAttrs) {
        const attrStats = await fetchWooProductAttrs(countedProductFetch, chunkProductIds, productAttrCache)
        productBatches += attrStats.batches
        productIdsFetched += attrStats.requested
        productIdsFailed += attrStats.failedIds
      }

      const rows: Record<string, unknown>[] = []
      for (const [day, dayOrders] of Object.entries(byDay)) {
        const saleDay = dayOrders.filter((o) => WOO_SALE_STATUSES.has(String(o.status || '').toLowerCase()))
        if (saleDay.length === 0) continue // false-zero discipline: no sale that day → write nothing
        saleOrdersSeen += saleDay.length
        // LORAMER_WOO_BATCH_WA_V1 — `dayOrders` is the status=any set for this day (res.orders is already
        // status=any; saleDay is the filtered anchor set). Passing BOTH is what lets order_status write the
        // failed/cancelled/pending orders this loop otherwise discards, while every other family stays keyed
        // to the sale anchor. The day key is UNCHANGED: `day` still comes from date_created.slice(0,10)
        // (site-local) exactly as before — order_time's UTC instant lives in breakdown_value, never here.
        rows.push(...buildWooMetricsRows(clientId, userEmail, day, storeUrl, summarizeWooOrders(saleDay, dayOrders, wantsProductAttrs ? productAttrCache : undefined)))
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
      // RESET path (direct constant write — a reset writer of the breaker columns, never read-then-write).
      await writeCursor(clientId, cursorKey, {
        backfill_earliest_date: earliestWritten,
        backfill_target_date: targetStart,
        backfill_complete: false,
        backfill_block_fails: 0,
        backfill_blocked: false,
        backfill_block_window: null,
        backfill_block_reason: null,
        backfill_block_at: null,
      })
    } else {
      // STORE-SIDE failure at the per-day floor → halt-and-surface. Trip the breaker via the ATOMIC bump
      // RPC: it increments block_fails, computes blocked (fails >= threshold), persists the block window
      // and the cursor frontier, and RETURNS the post-write counts — all in one primary write. The engine
      // decides halted-vs-blocked PURELY from the RETURNED values (never a standalone read).
      halted = true
      blockWindow = res.failedDay ?? `${windowStart}..${windowEnd}`
      blockReason = res.reason ?? 'window unservable at per-day floor'
      earliestWritten = res.failedDay ? addDays(res.failedDay, 1) : earliestWritten // frontier just above the broken day
      const { data: bumpRows, error: bumpErr } = await supabaseAdmin.rpc('bump_backfill_block', {
        p_client_id: clientId, p_platform: cursorKey, p_threshold: BLOCK_THRESHOLD,
        p_window: blockWindow, p_reason: blockReason, p_earliest: earliestWritten,
      })
      if (bumpErr) {
        console.error(`[woo-backfill] client=${clientId} BUMP FAILED:`, bumpErr.message)
        await release()
        return { status: 500, body: { error: 'breaker bump failed', detail: bumpErr.message, earliest: earliestWritten } }
      }
      const bump = (Array.isArray(bumpRows) ? bumpRows[0] : bumpRows) as { block_fails: number; blocked: boolean } | undefined
      blockFails = bump?.block_fails ?? blockFails + 1
      blockedNow = bump?.blocked ?? blockFails >= BLOCK_THRESHOLD
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
        productBatches, productIdsFetched, productIdsFailed, // LORAMER_WOO_BATCH_WB_V1 — attribute-fetch accounting
      },
    }
  }

  // Normal completion / incomplete-resumable path (timeout / chunk-cap / budget-backstop are all resumable).
  const complete = reachedHistoryStart
  await writeCursor(clientId, cursorKey, { backfill_earliest_date: earliestWritten, backfill_target_date: targetStart, backfill_complete: complete })
  await release()
  return {
    status: 200,
    body: {
      clientId, storeUrl,
      status: complete ? 'complete' : 'ok',
      complete, reachedHistoryStart, timedOut, budgetHit,
      chunksThisRun: chunks, daysWritten, rowsWritten, ordersSeen, saleOrdersSeen,
      earliest: earliestWritten, target: targetStart, outbound,
      productBatches, productIdsFetched, productIdsFailed, // LORAMER_WOO_BATCH_WB_V1 — attribute-fetch accounting
      resumeFrom: complete ? null : addDays(earliestWritten, -1),
    },
  }
}
