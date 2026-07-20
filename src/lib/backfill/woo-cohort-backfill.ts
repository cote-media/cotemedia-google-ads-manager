// LORAMER_WOO_COHORT_V1 — WooCommerce customer_cohort: ONE-SHOT FULL-HISTORY PASS
//
// WHY THIS IS NOT A CHUNKED LAP, AND COULD NOT BE.
// Every other Woo family is computed from a 21-day window because every other family is a property OF that
// window. A cohort is not: bucketing an order by its customer's LIFETIME order count requires knowing every
// order that customer ever placed, and a backward-walking lap only ever holds 21 days. Measured on the real
// store: a full-history sweep is 109 pages at ~1.7s each = ~215s, which is 239% of the chunked engine's 90s
// lap budget. Three ways around that were considered and all three are rejected in code review terms:
//   · one request per customer — 5,284 registered + guests; that is the 2026-06-16 Shelley over-request
//     incident (Lesson 51) with extra steps.
//   · accumulate the identity map across lap invocations — requires PERSISTING hash→count, and a stored hash
//     is a stored pseudonymous identifier. The PII rule here is that identity is transient; "never stored"
//     cannot be quietly reinterpreted as "stored somewhere else".
//   · bucket from what the backward walk has seen so far — a WITHIN-WINDOW count wearing a LIFETIME label.
//     That is exactly the LORAMER_CUSTOMER_MIX_FIX_V1 trap, and it is the defect this file exists to end.
// So: one sweep, one in-memory identity map built from the COMPLETE order set, every day's cohort rows
// written in a single idempotent pass. True lifetime BY CONSTRUCTION rather than by assumption.
//
// IDENTITY — EMAIL, HASHED IN MEMORY, NEVER STORED.
// WooCommerce sets customer_id=0 for GUEST checkout, and guests are the MAJORITY on a real store (measured
// 86% of orders on a historic window, 60% on a recent one). A registered-only cohort would therefore have
// been 86% UNKNOWN — technically reconciling and analytically useless. Email is present on effectively every
// order (measured 100/100) and is how Triple Whale matches customers too, which is the behaviour merchants
// already expect. So identity = sha256(trim(lowercase(billing.email))), computed in memory, used only to
// group orders, and DISCARDED when the pass returns.
// WHAT LANDS IN metrics_daily: breakdown_type, bucket, revenue, orders. No email. No hash. No name. No
// address. The sweep does not even RECEIVE the rest of the customer record — nested field trimming reduces
// `billing` to exactly one key (measured), so name/phone/street never cross the wire.
//
// CEILING — FAIL LOUD, NEVER PARTIAL. Cost is linear in total orders, so a big enough store cannot be swept
// inside any route. Both a predicted ceiling (order count) and a hard runtime deadline are enforced, and
// BOTH emit NOTHING and refuse to mark complete. A partial sweep would silently under-count lifetimes and
// mislabel loyal customers as first-timers — worse than no family at all.

import { createHash, randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { WOO_SALE_STATUSES, wooNetOf } from '@/lib/intelligence/woocommerce-intelligence'

const CURSOR_PLATFORM = 'woocommerce_cohort'
const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const PER_PAGE = 100                    // WP REST ceiling
const THROTTLE_MS = 300                 // identical to the chunked engine — gentle on a live self-hosted box
// The trimmed sweep field set. billing.email uses WP REST NESTED field trimming, verified live: the response
// carries `billing` with EXACTLY ONE key. refunds[] survives the trim too (verified: entries carry `total`,
// negative), which is what lets this pass compute the SAME wooNetOf basis the account row uses — without it
// the cohort would be gross and could never reconcile.
const SWEEP_FIELDS = 'id,billing.email,date_created,status,total,refunds'
// CEILING, derived from measurement rather than taste: 1.7s/page fetch + 0.3s throttle ≈ 2.0s/page, so the
// 400s sweep budget below covers ~200 pages = ~20,000 orders. The real store (Shelley) is 10,886 orders /
// 109 pages / ~215s — 54% of the ceiling, a 1.8× margin. The drain fire allows 680s with an 800s route
// maxDuration, so 400s leaves the rest of the fire intact.
const MAX_ORDERS_FOR_COHORT = 20_000
const SWEEP_BUDGET_MS = 400_000
const MAX_PAGES = Math.ceil(MAX_ORDERS_FOR_COHORT / PER_PAGE)

// Shopify's COHORT_OF, verbatim (LORAMER_SHOPIFY_BATCH_C_V1) so the two platforms bucket identically.
const COHORT_OF = (n: number | null): string => {
  if (n == null || !Number.isFinite(n) || n <= 0) return 'UNKNOWN'
  if (n === 1) return '1'
  if (n <= 3) return '2-3'
  if (n <= 9) return '4-9'
  return '10+'
}

// Identity: transient, in-memory only. Never persisted, never returned, never logged.
const identityOf = (email: unknown): string | null => {
  const e = String(email ?? '').trim().toLowerCase()
  if (!e || !e.includes('@')) return null
  return createHash('sha256').update(e).digest('hex')
}

export interface WooCohortResult {
  status: number
  body: Record<string, any>
}

export async function runWooCohortPass(
  clientId: string,
  opts: { dryRun?: boolean; budgetMs?: number; maxOrders?: number } = {}
): Promise<WooCohortResult> {
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? SWEEP_BUDGET_MS
  const maxOrders = opts.maxOrders ?? MAX_ORDERS_FOR_COHORT

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')
    .eq('id', clientId)
    .single()
  if (clientErr || !client) return { status: 404, body: { error: 'Client not found', detail: clientErr?.message } }
  const conn = (client.platform_connections || []).find((c: any) => c.platform === 'woocommerce')
  if (!conn) return { status: 400, body: { error: 'Client has no WooCommerce connection' } }
  const userEmail = (conn.user_email || client.user_email) as string

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
  const base = storeUrl.replace(/\/+$/, '') + '/wp-json/wc/v3'
  const headers = {
    Authorization: 'Basic ' + Buffer.from(tok.consumer_key + ':' + tok.consumer_secret).toString('base64'),
    Accept: 'application/json',
  }

  // CAS claim (dry-run skips it — a read-only rehearsal must not contend with a live pass).
  const claimToken = randomUUID()
  let claimed = false
  if (!opts.dryRun) {
    const { data: claimRows, error: claimErr } = await supabaseAdmin.rpc('claim_backfill_cursor', {
      p_client_id: clientId, p_platform: CURSOR_PLATFORM, p_token: claimToken,
    })
    if (claimErr) return { status: 500, body: { error: 'claim check failed', detail: claimErr.message } }
    const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as { claimed: boolean; complete: boolean } | undefined
    if (!claim?.claimed) return { status: 200, body: { clientId, storeUrl, status: 'skipped', skipped: true, note: 'another cohort pass holds the claim' } }
    if (claim.complete) {
      await supabaseAdmin.rpc('release_backfill_cursor', { p_client_id: clientId, p_platform: CURSOR_PLATFORM, p_token: claimToken })
      return { status: 200, body: { clientId, storeUrl, status: 'complete', complete: true, note: 'already complete' } }
    }
    claimed = true
  }
  const release = async () => {
    if (!claimed) return
    try { await supabaseAdmin.rpc('release_backfill_cursor', { p_client_id: clientId, p_platform: CURSOR_PLATFORM, p_token: claimToken }) } catch { /* self-heals */ }
  }

  // Counted + throttled fetch. EVERY outbound request in this file goes through here — same rate control the
  // chunked engine applies, so the cohort pass can never become an unmetered second door onto the store.
  let outbound = 0
  const countedGet = async (path: string): Promise<{ res: Response; body: any }> => {
    if (THROTTLE_MS > 0 && outbound > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS))
    outbound += 1
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 35_000)
    try {
      const res = await fetch(base + path, { headers, signal: ctrl.signal })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error('woo cohort fetch failed: ' + res.status + ' ' + txt.slice(0, 160))
      }
      return { res, body: await res.json() }
    } finally {
      clearTimeout(timer)
    }
  }

  // ── PREFLIGHT: how big is this store? ──────────────────────────────────────────────────────────────────
  let totalOrders = 0
  try {
    const { res } = await countedGet(`/orders?per_page=1&status=any&_fields=id`)
    totalOrders = Number(res.headers.get('x-wp-total') || '0')
  } catch (e: any) {
    await release()
    return { status: 200, body: { clientId, storeUrl, status: 'halted', reason: `preflight failed: ${e?.message ?? e}`, outbound } }
  }
  const estPages = Math.ceil(totalOrders / PER_PAGE)

  // CEILING — predicted. Emits NOTHING and does NOT mark complete, so the family is honestly absent for this
  // store rather than wrong. Loud on the way out: a silent skip here would read as "this store has no repeat
  // customers", which is the worst possible lie for this particular family.
  if (totalOrders > maxOrders) {
    console.error(
      `[woo-cohort] client=${clientId} OVER CEILING — ${totalOrders} orders (${estPages} pages) exceeds ` +
      `MAX_ORDERS_FOR_COHORT=${maxOrders}. customer_cohort NOT emitted for this store: a full-history sweep ` +
      `cannot complete inside the ${Math.round(budgetMs / 1000)}s budget, and a PARTIAL sweep would under-count ` +
      `lifetimes and mislabel loyal customers as first-timers. Absence is the honest answer here.`
    )
    if (!opts.dryRun) {
      await supabaseAdmin.from('sync_state').upsert(
        { client_id: clientId, platform: CURSOR_PLATFORM, updated_at: new Date().toISOString(),
          backfill_complete: false, backfill_block_reason: `over ceiling: ${totalOrders} orders > ${maxOrders}` },
        { onConflict: 'client_id,platform' }
      )
    }
    await release()
    return {
      status: 200,
      body: { clientId, storeUrl, status: 'over_ceiling', complete: false, totalOrders, estPages, maxOrders, outbound,
              note: 'customer_cohort not emitted — store too large to sweep in one pass; nothing partial was written' },
    }
  }

  // ── SWEEP: every order, once, trimmed ──────────────────────────────────────────────────────────────────
  type SweptOrder = { id: string; day: string; status: string; net: number; identity: string | null }
  const swept: SweptOrder[] = []
  let pages = 0
  for (let page = 1; page <= MAX_PAGES; page++) {
    // HARD RUNTIME DEADLINE. The order-count ceiling above is a PREDICTION; this is the truth. Blowing it
    // aborts with ZERO rows written and complete=false — never a partial identity map.
    if (Date.now() - startedAt > budgetMs) {
      console.error(
        `[woo-cohort] client=${clientId} SWEEP BUDGET EXCEEDED at page ${page}/${estPages} ` +
        `(${Math.round((Date.now() - startedAt) / 1000)}s > ${Math.round(budgetMs / 1000)}s). Emitting NOTHING — a ` +
        `partial sweep produces WRONG lifetime counts, not incomplete ones.`
      )
      await release()
      return { status: 200, body: { clientId, storeUrl, status: 'budget_exceeded', complete: false, pagesFetched: pages, estPages, outbound,
                                    note: 'aborted mid-sweep; nothing written (a partial identity map mislabels repeat customers as new)' } }
    }
    let body: any
    try {
      ({ body } = await countedGet(`/orders?per_page=${PER_PAGE}&page=${page}&status=any&orderby=id&order=asc&_fields=${SWEEP_FIELDS}`))
    } catch (e: any) {
      console.error(`[woo-cohort] client=${clientId} sweep page ${page} FAILED: ${e?.message ?? e} — emitting nothing`)
      await release()
      return { status: 200, body: { clientId, storeUrl, status: 'halted', complete: false, reason: String(e?.message ?? e), pagesFetched: pages, outbound } }
    }
    if (!Array.isArray(body) || body.length === 0) break
    pages += 1
    for (const o of body) {
      swept.push({
        id: String(o.id),
        day: String(o.date_created || '').slice(0, 10), // SITE-LOCAL day — identical key to every other Woo family
        status: String(o.status || '').toLowerCase().trim(),
        net: wooNetOf(o), // o.total + Σ refunds[].total — the SAME basis as the account row
        identity: identityOf(o?.billing?.email),
      })
    }
    if (body.length < PER_PAGE) break
  }

  // ── TRUE LIFETIME, BY CONSTRUCTION ─────────────────────────────────────────────────────────────────────
  // Counted over the COMPLETE swept set, so a customer whose first order predates any particular window is
  // still counted from it. Lifetime = SALE orders only: a failed or cancelled attempt is not a purchase, and
  // counting it would inflate a customer into a higher loyalty bucket than they earned.
  const lifetime = new Map<string, number>()
  for (const o of swept) {
    if (!o.identity || !WOO_SALE_STATUSES.has(o.status)) continue
    lifetime.set(o.identity, (lifetime.get(o.identity) || 0) + 1)
  }

  // ── BUCKET + AGGREGATE PER DAY ─────────────────────────────────────────────────────────────────────────
  // PARTITIONS the day's net: every sale order lands in exactly ONE bucket, UNKNOWN included, so Σ cohort ≡
  // account net and the family reconciles FLAG-NOT-BLOCK. An order with no usable email buckets UNKNOWN and
  // STAYS IN the partition — dropping it would shrink a total that is supposed to tie (the sales_channel rule).
  const byDay = new Map<string, Map<string, { net: number; orders: number; customers: Set<string> }>>()
  for (const o of swept) {
    if (!WOO_SALE_STATUSES.has(o.status) || !o.day) continue
    const bucket = o.identity ? COHORT_OF(lifetime.get(o.identity) ?? null) : 'UNKNOWN'
    if (!byDay.has(o.day)) byDay.set(o.day, new Map())
    const day = byDay.get(o.day)!
    if (!day.has(bucket)) day.set(bucket, { net: 0, orders: 0, customers: new Set() })
    const b = day.get(bucket)!
    b.net += o.net
    b.orders += 1
    if (o.identity) b.customers.add(o.identity) // Set of hashes, in memory, for a COUNT only — never written
  }

  const rows: Record<string, unknown>[] = []
  for (const [day, buckets] of byDay) {
    for (const [bucket, v] of buckets) {
      rows.push({
        client_id: clientId,
        user_email: userEmail,
        platform: 'woocommerce',
        account_id: storeUrl,
        entity_level: 'account',
        entity_id: storeUrl,
        entity_name: storeUrl,
        parent_entity_id: storeUrl,
        date: day,
        breakdown_type: 'customer_cohort',
        breakdown_value: bucket,
        revenue: Math.round(v.net * 100) / 100,
        conversions: v.orders,
        // extra carries COUNTS ONLY. `customers` is the SIZE of a Set of hashes — the hashes themselves are
        // never serialised, and the Set is garbage when this function returns.
        extra: {
          orders: v.orders,
          customers: v.customers.size,
          netBasis: 'woo_total_incl_shipping_tax_refundNetted',
          identityBasis: 'email_hash_transient_in_memory_never_stored',
          lifetimeBasis: 'TRUE_LIFETIME_full_history_sweep',
          caveat: 'bucket = the customer\'s lifetime SALE-order count across the store\'s entire history, matched by email so guest checkouts count too. UNKNOWN = the order carried no usable email. Buckets partition the day net.',
        },
      })
    }
  }

  // Identity map is dropped here — nothing downstream can see an email or a hash.
  lifetime.clear()

  let written = 0
  if (!opts.dryRun) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabaseAdmin
        .from('metrics_daily')
        .upsert(normalizeMetricsRows(rows.slice(i, i + 500)), { onConflict: METRICS_DAILY_CONFLICT })
      if (error) {
        console.error(`[woo-cohort] client=${clientId} UPSERT FAILED: ${error.message}`)
        await release()
        return { status: 500, body: { error: 'metrics_daily upsert failed', detail: error.message, written } }
      }
      written += rows.slice(i, i + 500).length
    }
    await supabaseAdmin.from('sync_state').upsert(
      { client_id: clientId, platform: CURSOR_PLATFORM, updated_at: new Date().toISOString(),
        backfill_complete: true, backfill_block_reason: null,
        backfill_earliest_date: [...byDay.keys()].sort()[0] ?? null },
      { onConflict: 'client_id,platform' }
    )
  }
  await release()

  const distinctCustomers = new Set(swept.filter((o) => o.identity && WOO_SALE_STATUSES.has(o.status)).map((o) => o.identity)).size
  return {
    status: 200,
    body: {
      clientId, storeUrl, status: 'complete', complete: true, dryRun: !!opts.dryRun,
      totalOrders, pagesFetched: pages, outbound,
      sweepSeconds: Math.round((Date.now() - startedAt) / 1000),
      saleOrders: swept.filter((o) => WOO_SALE_STATUSES.has(o.status)).length,
      distinctCustomers, days: byDay.size, rowsBuilt: rows.length, rowsWritten: written,
      ceiling: { maxOrders, budgetMs, marginPct: Math.round((totalOrders / maxOrders) * 100) },
      rows: opts.dryRun ? rows : undefined, // dry-run hands the built rows back for Gate-A assertions
    },
  }
}
