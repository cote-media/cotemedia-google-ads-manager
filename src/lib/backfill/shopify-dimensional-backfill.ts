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
import { normalizeMetricsRows } from '@/lib/metrics-normalize' // LORAMER_METRICS_NORMALIZE_V1
import { getValidShopifyToken } from '@/lib/shopify-token'
import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'
import { buildShopifyMetricsRows, buildShopifyDepthRows } from '@/lib/intelligence/shopify-metrics-row'

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
      // LORAMER_CUSTOMER_MIX_FIX_V1 — write the account MAIN row too, so a re-backfill CORRECTS the
      // account-extra (incl. customer mix) for historical days; depth rows ride alongside.
      const accountRows = buildShopifyMetricsRows(clientId, userEmail, cursor, shopDomain, intel)
      const depthRows = buildShopifyDepthRows(clientId, userEmail, cursor, shopDomain, intel)
      const rows = [...accountRows, ...depthRows] // always >= 1 (the account row)
      const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT }) // LORAMER_METRICS_NORMALIZE_V1
      if (upErr) throw upErr
      daysWritten += 1
      rowsWritten += rows.length
      if (depthRows.length === 0) emptyDays += 1 // no orders that day (account row still written, zeros)
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

// ─── LORAMER_SHOPIFY_DEEP_BACKFILL_V1 — FULL-HISTORY Shopify backfill ────────────────────────────────
// Same proven per-DAY loop + byte-identical forward builders (buildShopifyMetricsRows +
// Flight-1-corrected buildShopifyDepthRows) as runShopifyDimensionalBackfill, with NO 90-day floor:
// the floor is each store's FIRST ORDER, found by a one-shot oldest-order probe at engine start. SEPARATE
// cursor sync_state platform='shopify_deep' (the dimensional + forward 'shopify' rows are never touched);
// a fresh cursor starts at yesterday and sweeps the WHOLE history, which also OVERWRITES the recent
// pre-Flight-1 product rows (intended cleanup). PERMANENT-HISTORY GUARD: every day self-reconciles
// Σ product == account before write — any mismatch HALTS (no write, no cursor advance) and surfaces.
const CURSOR_PLATFORM_DEEP = 'shopify_deep'
const GRAPHQL_API_VERSION = '2025-01' // matches fetchShopifyIntelligence
const DEEP_TIME_BUDGET_MS = 45_000 // under the 60s /api/backfill/run route; cursor bridges laps
const RECONCILE_TOLERANCE = 0.01 // 1 cent — absorbs FP noise; a real basis regression is dollars

async function upsertDeepCursor(clientId: string, earliest: string, target: string, complete: boolean): Promise<void> {
  await supabaseAdmin.from('sync_state').upsert(
    {
      client_id: clientId,
      platform: CURSOR_PLATFORM_DEEP,
      backfill_earliest_date: earliest,
      backfill_target_date: target,
      backfill_complete: complete,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,platform' }
  )
}

// One-shot oldest-order probe → the store's first-order UTC date (the exact floor), or null if no orders.
async function probeFirstOrderDate(shopDomain: string, accessToken: string): Promise<string | null> {
  const endpoint = `https://${shopDomain}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`
  const query = `{ orders(first: 1, sortKey: CREATED_AT) { edges { node { createdAt } } } }` // ascending → oldest
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const json = await resp.json()
  if (json.errors) throw new Error('oldest-order probe failed: ' + JSON.stringify(json.errors).slice(0, 200))
  const createdAt = json.data?.orders?.edges?.[0]?.node?.createdAt
  if (!createdAt) return null
  return new Date(createdAt).toISOString().slice(0, 10) // UTC date of the first order
}

export async function runShopifyDeepBackfill(
  clientId: string,
  opts: { timeBudgetMs?: number; now?: string } = {}
): Promise<ShopifyDimBackfillResult> {
  const timeBudgetMs = opts.timeBudgetMs ?? DEEP_TIME_BUDGET_MS
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
  // COHORT-OWNER token disambiguation (Escential duplicate-row edge): key the token by (conn.user_email,
  // shopDomain). conn.user_email is the user who connected THIS client's store (the cohort owner), never the
  // reviewer-install email — so getValidShopifyToken selects the valid cohort row, not the expired reviewer row.
  const userEmail = (conn.user_email || client.user_email) as string

  const tokenResult = await getValidShopifyToken(userEmail, shopDomain)
  if (!tokenResult.ok) {
    return { status: 400, body: { error: 'Shopify token unavailable', detail: `${tokenResult.reason}${tokenResult.detail ? ' - ' + tokenResult.detail : ''}` } }
  }
  const accessToken = tokenResult.accessToken

  const nowIso = opts.now ?? fmt(new Date())
  const endDate = addDays(nowIso, -1) // yesterday

  // FLOOR = exact first-order date (NO retention cap).
  let firstOrderDate: string | null
  try {
    firstOrderDate = await probeFirstOrderDate(shopDomain, accessToken)
  } catch (e: any) {
    console.error(`[shopify-deep-backfill] client=${clientId} shop=${shopDomain} PROBE FAILED:`, e?.message ?? e)
    return { status: 200, body: { clientId, shopDomain, complete: false, error: String(e?.message ?? e), note: 'oldest-order probe failed; nothing written' } }
  }
  if (!firstOrderDate) {
    await upsertDeepCursor(clientId, endDate, endDate, true)
    return { status: 200, body: { clientId, shopDomain, complete: true, earliest: endDate, note: 'store has no orders' } }
  }
  const targetStart = firstOrderDate

  const { data: stateRow } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', CURSOR_PLATFORM_DEEP)
    .maybeSingle()
  if (stateRow?.backfill_complete) {
    return { status: 200, body: { clientId, shopDomain, complete: true, earliest: targetStart, note: 'already complete' } }
  }

  // Fresh cursor → windowEnd = yesterday (sweeps whole history incl. the recent window). Resume → just below
  // the deepest captured day.
  const windowEnd = stateRow?.backfill_earliest_date ? addDays(stateRow.backfill_earliest_date, -1) : endDate
  if (windowEnd < targetStart) {
    await upsertDeepCursor(clientId, targetStart, targetStart, true)
    return { status: 200, body: { clientId, shopDomain, complete: true, earliest: targetStart, note: 'window already covered' } }
  }

  let daysWritten = 0
  let rowsWritten = 0
  let emptyDays = 0
  let timedOut = false
  const errors: Array<{ date: string; message: string }> = []
  let earliestWritten = stateRow?.backfill_earliest_date || addDays(endDate, 1)
  let reconcileHalt: { date: string; account: number; product: number; residual: number } | null = null

  for (let cursor = windowEnd; cursor >= targetStart; cursor = addDays(cursor, -1)) {
    if (Date.now() - startedAt > timeBudgetMs) {
      timedOut = true
      break
    }
    try {
      const intel = await fetchShopifyIntelligence(accessToken, shopDomain, 'CUSTOM', cursor, cursor, { throttleDeadline })
      const accountRows = buildShopifyMetricsRows(clientId, userEmail, cursor, shopDomain, intel)
      const depthRows = buildShopifyDepthRows(clientId, userEmail, cursor, shopDomain, intel)

      // ── PERMANENT-HISTORY GUARD ── Σ product == account for THIS day (the Flight-1 invariant). Any
      // mismatch HALTS: do NOT write this day, do NOT advance the cursor, surface date + residual.
      const accountRev = Number(accountRows[0]?.revenue) || 0
      const productSum = depthRows
        .filter((r) => r.entity_level === 'product')
        .reduce((s, r) => s + (Number(r.revenue) || 0), 0)
      if (Math.abs(productSum - accountRev) > RECONCILE_TOLERANCE) {
        reconcileHalt = { date: cursor, account: accountRev, product: productSum, residual: Math.round((productSum - accountRev) * 100) / 100 }
        console.error(`[shopify-deep-backfill] RECONCILE HALT client=${clientId} shop=${shopDomain} date=${cursor} product=${productSum} account=${accountRev}`)
        break
      }

      const rows = [...accountRows, ...depthRows] // account row always present (zeros on empty days)
      const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
      if (upErr) throw upErr
      daysWritten += 1
      rowsWritten += rows.length
      if (depthRows.filter((r) => r.entity_level === 'product').length === 0) emptyDays += 1
      if (cursor < earliestWritten) earliestWritten = cursor
    } catch (e: any) {
      if (e?.throttleBudget) {
        timedOut = true // a throttle wait would blow the lap budget → stop + resume (NOT an error)
        break
      }
      console.error(`[shopify-deep-backfill] client=${clientId} shop=${shopDomain} date=${cursor} FAILED:`, e?.message ?? e)
      errors.push({ date: cursor, message: String(e?.message ?? e) })
      break
    }
  }

  // RECONCILE HALT → surface loudly; cursor NOT advanced (next lap re-walks idempotently + re-halts until fixed).
  if (reconcileHalt) {
    return {
      status: 200,
      body: {
        clientId, shopDomain, complete: false, earliest: earliestWritten,
        error: `RECONCILE HALT date=${reconcileHalt.date} product=$${reconcileHalt.product} account=$${reconcileHalt.account} residual=$${reconcileHalt.residual} — day NOT written, cursor NOT advanced`,
        reconcileHalt,
      },
    }
  }

  const done = earliestWritten <= targetStart && errors.length === 0 && !timedOut
  await upsertDeepCursor(clientId, earliestWritten, targetStart, done)
  const resumeFrom = done ? null : errors.length ? errors[0].date : addDays(earliestWritten, -1)

  return {
    status: errors.length ? 207 : 200,
    body: {
      clientId, shopDomain,
      dateRange: { start: targetStart, end: endDate },
      complete: done,
      earliest: earliestWritten,
      target: targetStart,
      daysWritten, rowsWritten, emptyDays, timedOut, resumeFrom, errors,
    },
  }
}
