// LORAMER_SHOPIFY_ORDER_GRAIN_WRITER_V1 — Shopify ORDER GRAIN via the Bulk Operations API.
//
// WHY BULK AND NOT A FATTER QUERY: OrdersInRange already runs at 651 of the 1,000-point single-query ceiling
// (LORAMER_SHOPIFY_QUERY_COST_CEILING_V1) and that ceiling CANNOT be raised on any plan tier. Bulk operations
// are exempt from the per-query cost cap — the submitting MUTATION counts against the rate limit, the bulk
// query's EXECUTION does not — and `first:` arguments are optional and ignored, which is the whole point.
//
// WHY THE LIFECYCLE IS SPLIT ACROSS INVOCATIONS: a bulk op is asynchronous and may take minutes to hours.
// travis-r6s/shopify-bulk-export models the right SHAPE (submit → poll → download JSONL → reassemble by
// __parentId) but blocks on `await` and its own README says it is unsuitable for servers or serverless. We run
// on Vercel. So this module SUBMITS AND RETURNS — the op row in store_bulk_operations is the memory between
// invocations, the bulk_operations/finish webhook is the primary completion signal, and the cron drain is the
// fallback for a webhook that never arrives.
//
// BLAST RADIUS: writes ONLY to store_orders / store_order_line_items / store_bulk_operations. metrics_daily is
// never touched by anything in this file. A failure here is invisible to every number the product already shows.
//
// API VERSION: settled at 2026-07 (LORAMER_SHOPIFY_VERSION_PIN_2026_07_V1) — so `bulkOperation(id:)` polling is
// available and up to five concurrent ops per shop per app are allowed. We still enforce ONE, because our own
// windows would otherwise overlap and re-ingest the same orders.

import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { shopifyGraphQL } from '@/lib/intelligence/shopify-intelligence'

// ⛔ LORAMER_ORDER_GRAIN_NOSTORE_READ_V1 — READS THAT GATE A WRITE MUST NOT BE CACHED.
// FOUND THE HARD WAY during Gate-A: the one-op-per-shop check returned [] four times in a row while the exact
// same PostgREST query returned four rows to curl. Cause: Next.js 14's App Router patches global fetch and
// CACHES GET requests by default. supabase-js reads are GETs, so the FIRST answer — legitimately empty, before
// any op existed — was replayed for every later check, and the guard that exists to stop a duplicate submit
// was answering from a snapshot of the world before the first submit. Four bulk ops were started where one
// was allowed, and nothing errored: the check ran, returned a valid empty array, and was WRONG.
// This client forces `cache: 'no-store'` on every request. Correctness-critical reads use THIS client; the
// shared supabaseAdmin stays as-is for everything else.
const sbNoStore = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false }, global: { fetch: (url: any, init?: any) => fetch(url, { ...(init ?? {}), cache: 'no-store' }) } }
)

const GRAPHQL_API_VERSION = '2026-07' // LORAMER_SHOPIFY_VERSION_PIN_2026_07_V1 — all pin sites move together
const PLATFORM = 'shopify'

export type BulkPurpose = 'orders_backfill' | 'orders_change_sweep'
const IN_FLIGHT = ['CREATED', 'RUNNING'] as const

export interface SubmitResult {
  ok: boolean
  reason?: 'in_flight' | 'token' | 'user_error' | 'submit_failed'
  opRowId?: number
  operationGid?: string | null
  detail?: string
}

export interface IngestResult {
  orders: number
  lineItems: number
  lineItemsDeleted: number
  days: string[]
}

// ── THE BULK QUERY ────────────────────────────────────────────────────────────────────────────────────────
// Field-for-field the same order surface the live path already reads (shopify-intelligence OrdersInRange), so
// the two capture paths describe the SAME order. `first:` is deliberately absent — bulk ignores it. Connection
// count is 2 (orders, lineItems), nesting depth 2, both inside the bulk limits (max 5 connections, 2 deep).
// The window filter is INLINED because bulkOperationRunQuery takes the query as a string, not with variables.
export function buildBulkOrdersQuery(startDate: string, endDate: string): string {
  return `{
  orders(query: "created_at:>=${startDate}T00:00:00Z AND created_at:<=${endDate}T23:59:59Z") {
    edges {
      node {
        id
        name
        createdAt
        updatedAt
        processedAt
        cancelledAt
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount } }
        currentTotalPriceSet { shopMoney { amount } }
        currentTotalTaxSet { shopMoney { amount } }
        currentTotalDiscountsSet { shopMoney { amount } }
        currentShippingPriceSet { shopMoney { amount } }
        totalTipReceivedSet { shopMoney { amount } }
        displayFinancialStatus
        displayFulfillmentStatus
        channelInformation { channelDefinition { handle channelName } }
        discountCodes
        customer { id }
        shippingAddress { countryCodeV2 provinceCode city }
        lineItems {
          edges {
            node {
              id
              title
              quantity
              product { id productType vendor tags }
              variant { id sku title }
              originalUnitPriceSet { shopMoney { amount } }
              discountedTotalSet { shopMoney { amount } }
            }
          }
        }
      }
    }
  }
}`
}

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const money = (set: any): number | null => num(set?.shopMoney?.amount)

// ⛔ THE DAY KEY. Written HERE, by the adapter, from the SHOP-LOCAL date — byte-identical to how forward
// capture buckets a day (shopify-intelligence.ts:938, `String(o.createdAt).slice(0,10)`). Shopify returns
// createdAt with the SHOP's UTC offset, so a `generated always as ((created_at at time zone 'UTC')::date)`
// column would disagree by one day for every late-evening order and every recompute-from-local would then
// contradict rows forward capture already wrote. Byte-identical-to-forward-capture is banked law.
// created_at_raw preserves the vendor string so any disagreement is provable rather than assumed away.
export function shopLocalCreatedDate(createdAtRaw: string): string {
  return String(createdAtRaw || '').slice(0, 10)
}

function buildOrderRow(clientId: string, accountId: string, o: any, sweepAt: string) {
  const raw = String(o.createdAt || '')
  return {
    client_id: clientId,
    platform: PLATFORM,
    account_id: accountId,
    order_id: String(o.id),
    order_number: o.name ?? null,
    created_at: raw || null,
    created_at_raw: raw,
    created_date: shopLocalCreatedDate(raw),
    updated_at_remote: o.updatedAt ?? null,
    processed_at: o.processedAt ?? null,
    cancelled_at: o.cancelledAt ?? null,
    currency: o.currentSubtotalPriceSet?.shopMoney?.currencyCode ?? null,
    financial_status: o.displayFinancialStatus ?? null,
    fulfillment_status: o.displayFulfillmentStatus ?? null,
    subtotal_current: money(o.currentSubtotalPriceSet),
    total_current: money(o.currentTotalPriceSet),
    total_tax: money(o.currentTotalTaxSet),
    total_discounts: money(o.currentTotalDiscountsSet),
    total_shipping: money(o.currentShippingPriceSet),
    total_refunded: money(o.totalRefundedSet),
    total_tip: money(o.totalTipReceivedSet),
    customer_ref: o.customer?.id ?? null,
    channel_handle: o.channelInformation?.channelDefinition?.handle ?? null,
    channel_name: o.channelInformation?.channelDefinition?.channelName ?? null,
    discount_codes: Array.isArray(o.discountCodes) ? o.discountCodes : null,
    ship_country: o.shippingAddress?.countryCodeV2 ?? null,
    ship_province: o.shippingAddress?.provinceCode ?? null,
    ship_city: o.shippingAddress?.city ?? null,
    raw: o,
    // LORAMER_SHOPIFY_ORDER_GRAIN_WRITER_V1 — stamped on EVERY sweep. Disappearance detection (tombstoning via
    // deleted_upstream_at) is deliberately NOT implemented here: it needs a FULL sweep to compare against, and
    // a partial-window sweep would tombstone orders that simply fall outside the window. It ships with backfill.
    last_seen_at: sweepAt,
  }
}

function buildLineRow(clientId: string, accountId: string, orderId: string, createdDate: string, li: any) {
  return {
    client_id: clientId,
    platform: PLATFORM,
    account_id: accountId,
    order_id: orderId,
    line_item_id: String(li.id),
    created_date: createdDate, // denormalized from the parent — the SAME value, never re-derived
    product_ref: li.product?.id ?? null,
    variant_ref: li.variant?.id ?? null,
    title: li.title ?? null,
    variant_title: li.variant?.title ?? null,
    product_type: li.product?.productType ?? null,
    vendor: li.product?.vendor ?? null,
    tags: Array.isArray(li.product?.tags) ? li.product.tags : null,
    quantity: Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
    unit_price: money(li.originalUnitPriceSet),
    line_discount: null as number | null,
    line_total: money(li.discountedTotalSet),
    raw: li,
  }
}

// ── SUBMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// ORDER OF OPERATIONS IS LOAD-BEARING: the op row is INSERTED BEFORE the mutation is sent. If the process dies
// between insert and submit we are left with a CREATED row and no gid — recoverable, and visible. The reverse
// order would leave a running bulk op on Shopify's side that we have no record of, which is exactly the state
// the one-op-per-shop check exists to prevent.
export async function submitOrdersBulkOp(opts: {
  clientId: string
  accountId: string
  userEmail: string
  startDate: string
  endDate: string
  purpose?: BulkPurpose
}): Promise<SubmitResult> {
  const { clientId, accountId, userEmail, startDate, endDate } = opts
  const purpose: BulkPurpose = opts.purpose ?? 'orders_backfill'

  // ONE OP PER SHOP. This is the reason store_bulk_operations exists: serverless has no memory between
  // invocations, so "is an op already running for this shop" is a question only the database can answer.
  const { data: inFlight, error: inFlightErr } = await sbNoStore
    .from('store_bulk_operations')
    .select('id, operation_gid, status')
    .eq('client_id', clientId).eq('platform', PLATFORM).eq('account_id', accountId)
    .in('status', IN_FLIGHT as unknown as string[])
    .limit(1)
  if (inFlightErr) return { ok: false, reason: 'submit_failed', detail: inFlightErr.message }
  if (inFlight && inFlight.length > 0) {
    return { ok: false, reason: 'in_flight', opRowId: inFlight[0].id, operationGid: inFlight[0].operation_gid, detail: `op ${inFlight[0].operation_gid ?? '(no gid yet)'} is ${inFlight[0].status}` }
  }

  const tokenResult = await getValidShopifyToken(userEmail, accountId)
  if (!tokenResult.ok) return { ok: false, reason: 'token', detail: tokenResult.reason }

  const queryText = buildBulkOrdersQuery(startDate, endDate)

  const { data: opRow, error: insErr } = await supabaseAdmin
    .from('store_bulk_operations')
    .insert({
      client_id: clientId, platform: PLATFORM, account_id: accountId,
      purpose, status: 'CREATED', query_text: queryText,
      window_start: startDate, window_end: endDate,
    })
    .select('id').single()
  if (insErr || !opRow) return { ok: false, reason: 'submit_failed', detail: insErr?.message ?? 'no op row' }

  const endpoint = `https://${accountId}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`
  const headers = { 'X-Shopify-Access-Token': tokenResult.accessToken, 'Content-Type': 'application/json' }
  const mutation = `mutation bulkRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`

  let json: any
  try {
    json = await shopifyGraphQL(endpoint, headers, mutation, { query: queryText })
  } catch (e: any) {
    await supabaseAdmin.from('store_bulk_operations')
      .update({ status: 'FAILED', error_code: 'SUBMIT_THREW', finished_at: new Date().toISOString() })
      .eq('id', opRow.id)
    return { ok: false, reason: 'submit_failed', opRowId: opRow.id, detail: String(e?.message ?? e).slice(0, 200) }
  }

  const userErrors = json?.data?.bulkOperationRunQuery?.userErrors ?? []
  const bulkOp = json?.data?.bulkOperationRunQuery?.bulkOperation
  if (userErrors.length || !bulkOp?.id) {
    const detail = JSON.stringify(userErrors.length ? userErrors : json?.errors ?? json).slice(0, 300)
    await supabaseAdmin.from('store_bulk_operations')
      .update({ status: 'FAILED', error_code: 'USER_ERROR', finished_at: new Date().toISOString() })
      .eq('id', opRow.id)
    return { ok: false, reason: 'user_error', opRowId: opRow.id, detail }
  }

  await supabaseAdmin.from('store_bulk_operations')
    .update({ operation_gid: bulkOp.id, status: bulkOp.status ?? 'CREATED' })
    .eq('id', opRow.id)

  return { ok: true, opRowId: opRow.id, operationGid: bulkOp.id }
}

// ── POLL ──────────────────────────────────────────────────────────────────────────────────────────────────
// 2026-07 supports `bulkOperation(id:)`. On older versions this would have to be `currentBulkOperation`, which
// is one of the two reasons the version pin had to be settled before this adapter could be written.
export async function pollBulkOp(row: { id: number; client_id: string; account_id: string; operation_gid: string | null }, userEmail: string) {
  if (!row.operation_gid) return { ok: false as const, detail: 'op row has no gid — it never reached Shopify' }
  const tokenResult = await getValidShopifyToken(userEmail, row.account_id)
  if (!tokenResult.ok) return { ok: false as const, detail: `token: ${tokenResult.reason}` }
  const endpoint = `https://${row.account_id}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`
  const headers = { 'X-Shopify-Access-Token': tokenResult.accessToken, 'Content-Type': 'application/json' }
  const q = `query poll($id: ID!) { bulkOperation(id: $id) { id status errorCode objectCount url partialDataUrl } }`
  const json = await shopifyGraphQL(endpoint, headers, q, { id: row.operation_gid })
  const op = json?.data?.bulkOperation
  if (!op) return { ok: false as const, detail: JSON.stringify(json?.errors ?? json).slice(0, 200) }
  await supabaseAdmin.from('store_bulk_operations')
    .update({
      status: op.status, error_code: op.errorCode ?? null,
      object_count: op.objectCount != null ? Number(op.objectCount) : null,
      result_url: op.url ?? null, partial_url: op.partialDataUrl ?? null,
      polled_at: new Date().toISOString(),
      finished_at: ['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED'].includes(op.status) ? new Date().toISOString() : null,
    })
    .eq('id', row.id)
  return { ok: true as const, op }
}

// ── INGEST ────────────────────────────────────────────────────────────────────────────────────────────────
// JSONL: one JSON object per line. Children of a nested connection carry `__parentId` naming their parent —
// a field that does not exist in the schema and cannot be queried, so it is the ONLY way to reassemble the
// hierarchy. Shopify does not guarantee a child follows its parent, so both passes complete before any write.
export async function ingestBulkJsonl(opts: {
  opRowId: number
  clientId: string
  accountId: string
  url: string
}): Promise<IngestResult> {
  const { opRowId, clientId, accountId, url } = opts
  const sweepAt = new Date().toISOString()

  const res = await fetch(url)
  if (!res.ok) throw new Error(`JSONL download failed: HTTP ${res.status}`)
  const text = await res.text()

  const orders: any[] = []
  const linesByOrder = new Map<string, any[]>()
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    let node: any
    try { node = JSON.parse(s) } catch { continue }
    const parent = node.__parentId
    if (parent) {
      const arr = linesByOrder.get(String(parent))
      if (arr) arr.push(node); else linesByOrder.set(String(parent), [node])
    } else if (typeof node.id === 'string' && node.id.includes('/Order/')) {
      orders.push(node)
    }
  }

  const days = new Set<string>()
  let lineCount = 0
  let deleted = 0

  // Orders first: the line-item FK points at them, so an order must exist before its lines can land.
  for (let i = 0; i < orders.length; i += 500) {
    const chunk = orders.slice(i, i + 500).map((o) => buildOrderRow(clientId, accountId, o, sweepAt))
    chunk.forEach((r) => days.add(r.created_date))
    const { error } = await supabaseAdmin
      .from('store_orders')
      .upsert(chunk, { onConflict: 'client_id,platform,account_id,order_id' })
    if (error) throw new Error(`store_orders upsert failed: ${error.message}`)
  }

  // ⛔ LINE ITEMS ARE REPLACED PER ORDER, NEVER BARE-UPSERTED. An order edit can REMOVE a line, and an upsert
  // only overwrites keys that RECUR — a removed line would survive forever and inflate every product aggregate
  // built from it. That is the stale-key trap already live in the metrics_daily day-REPLACE (cron/sync:319 is
  // upsert-only with no delete) and we are not reproducing it at the new grain.
  //
  // ORDERING, stated because it is deliberate and it is NOT the obvious one: we UPSERT the current set FIRST,
  // then DELETE this order's lines whose line_item_id is not in that set. PostgREST gives us no cross-statement
  // transaction, so one of the two states is unavoidable mid-flight; delete-then-insert would briefly leave an
  // order with NO lines (a false zero, the worst failure this repo has), while upsert-then-prune can only
  // briefly leave an EXTRA stale line — which is the state we are already in today. Strictly the safer half.
  for (const o of orders) {
    const orderId = String(o.id)
    const createdDate = shopLocalCreatedDate(String(o.createdAt || ''))
    const nodes = linesByOrder.get(orderId) ?? []
    const rows = nodes.map((li) => buildLineRow(clientId, accountId, orderId, createdDate, li))
    const keepIds = rows.map((r) => r.line_item_id)

    if (rows.length) {
      const { error } = await supabaseAdmin
        .from('store_order_line_items')
        .upsert(rows, { onConflict: 'client_id,platform,account_id,order_id,line_item_id' })
      if (error) throw new Error(`store_order_line_items upsert failed (order ${orderId}): ${error.message}`)
      lineCount += rows.length
    }

    const prune = supabaseAdmin
      .from('store_order_line_items')
      .delete()
      .eq('client_id', clientId).eq('platform', PLATFORM).eq('account_id', accountId).eq('order_id', orderId)
    const { data: removed, error: delErr } = keepIds.length
      ? await prune.not('line_item_id', 'in', `(${keepIds.map((id) => `"${id}"`).join(',')})`).select('line_item_id')
      : await prune.select('line_item_id')
    if (delErr) throw new Error(`store_order_line_items prune failed (order ${orderId}): ${delErr.message}`)
    deleted += removed?.length ?? 0
  }

  await supabaseAdmin.from('store_bulk_operations')
    .update({ rows_ingested: orders.length + lineCount, ingested_at: sweepAt })
    .eq('id', opRowId)

  return { orders: orders.length, lineItems: lineCount, lineItemsDeleted: deleted, days: [...days].sort() }
}

// ── DRAIN (the cron fallback for a webhook that never arrived) ─────────────────────────────────────────────
// A webhook is a delivery, not a guarantee. Every op that is still in flight — or COMPLETED but never
// ingested, which is what a dropped webhook looks like from our side — gets picked up on the next cron fire.
export async function drainInFlightBulkOps(limit = 10): Promise<Array<Record<string, unknown>>> {
  const { data: rows, error } = await sbNoStore
    .from('store_bulk_operations')
    .select('id, client_id, platform, account_id, operation_gid, status, result_url, ingested_at')
    .eq('platform', PLATFORM)
    .or('status.in.(CREATED,RUNNING),and(status.eq.COMPLETED,ingested_at.is.null)')
    .order('started_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`drain query failed: ${error.message}`)

  const out: Array<Record<string, unknown>> = []
  for (const row of rows ?? []) {
    const { data: conn } = await sbNoStore
      .from('platform_connections')
      .select('user_email')
      .eq('platform', PLATFORM).eq('client_id', row.client_id).eq('account_id', row.account_id)
      .limit(1).single()
    const userEmail = conn?.user_email
    if (!userEmail) { out.push({ opRowId: row.id, skipped: 'no connection user_email' }); continue }

    try {
      // A COMPLETED-but-uningested row already has its URL; re-polling would only burn a request.
      let status = row.status as string
      let url = row.result_url as string | null
      if (!(status === 'COMPLETED' && url)) {
        const polled = await pollBulkOp(row as any, userEmail)
        if (!polled.ok) { out.push({ opRowId: row.id, polled: false, detail: polled.detail }); continue }
        status = polled.op.status
        url = polled.op.url ?? null
      }
      if (status !== 'COMPLETED' || !url) { out.push({ opRowId: row.id, status, ingested: false }); continue }
      const ing = await ingestBulkJsonl({ opRowId: row.id, clientId: row.client_id, accountId: row.account_id, url })
      out.push({ opRowId: row.id, status, ingested: true, ...ing })
    } catch (e: any) {
      console.error(`[order-grain] drain failed op=${row.id}:`, e?.message ?? e)
      out.push({ opRowId: row.id, error: String(e?.message ?? e).slice(0, 200) })
    }
  }
  return out
}

// Used by the webhook: find the op row for a gid the shop just told us finished.
export async function findOpByGid(gid: string) {
  const { data } = await sbNoStore
    .from('store_bulk_operations')
    .select('id, client_id, platform, account_id, operation_gid, status, result_url, ingested_at')
    .eq('operation_gid', gid).limit(1).single()
  return data ?? null
}
