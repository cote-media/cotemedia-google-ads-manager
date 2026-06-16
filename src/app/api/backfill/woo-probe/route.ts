// LORAMER_WOO_PROBE_TEMP — TEMPORARY Gate-A diagnostic for WS3 #7 (WooCommerce backfill).
// CRON_SECRET-gated, READ-ONLY. Loads woocommerce_tokens creds at runtime, probes the live
// store's order schema/volume/refund shape, and returns SUMMARY ONLY — never the creds, never
// customer PII (no names/emails/addresses/line-item titles; only statuses, dates, money amounts,
// currency, counts). REMOVE this route after the Gate-A read (it is not part of the product).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const maxDuration = 60

function fmt(d: Date) {
  return d.toISOString().split('T')[0]
}

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = new URL(request.url).searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const { data: tok, error } = await supabaseAdmin
    .from('woocommerce_tokens')
    .select('store_url, consumer_key, consumer_secret')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !tok?.store_url || !tok?.consumer_key || !tok?.consumer_secret) {
    return NextResponse.json({ error: 'No Woo creds for client', detail: error?.message }, { status: 404 })
  }

  const base = tok.store_url.replace(/\/+$/, '') + '/wp-json/wc/v3'
  const headers = {
    Authorization: 'Basic ' + Buffer.from(tok.consumer_key + ':' + tok.consumer_secret).toString('base64'),
    Accept: 'application/json',
  }
  // ↑ creds used ONLY to build the header; never logged, never returned past this point.

  const out: Record<string, unknown> = { storeHost: (() => { try { return new URL(tok.store_url).host } catch { return null } })() }

  // 1. STATUS CENSUS — counts per status, PII-free.
  try {
    const r = await fetch(base + '/reports/orders/totals', { headers })
    if (r.ok) {
      const j = await r.json()
      out.statusTotals = Array.isArray(j) ? j.map((s: any) => ({ slug: s.slug, total: s.total })) : j
    } else {
      out.statusTotalsError = r.status + ' ' + (await r.text().catch(() => '')).slice(0, 150)
    }
  } catch (e: any) {
    out.statusTotalsError = String(e?.message ?? e)
  }

  // 2. VOLUME + DATE SPAN (header totals + oldest/newest date only).
  try {
    const r = await fetch(base + '/orders?per_page=1&status=any', { headers })
    out.totalOrders = r.headers.get('x-wp-total')
    out.totalPages = r.headers.get('x-wp-totalpages')
  } catch (e: any) {
    out.volumeError = String(e?.message ?? e)
  }
  try {
    const oldest = await fetch(base + '/orders?per_page=1&status=any&order=asc&orderby=date', { headers }).then(x => x.json())
    const newest = await fetch(base + '/orders?per_page=1&status=any&order=desc&orderby=date', { headers }).then(x => x.json())
    out.oldestOrderDate = Array.isArray(oldest) && oldest[0] ? String(oldest[0].date_created).slice(0, 10) : null
    out.newestOrderDate = Array.isArray(newest) && newest[0] ? String(newest[0].date_created).slice(0, 10) : null
  } catch (e: any) {
    out.dateSpanError = String(e?.message ?? e)
  }

  // 3. REFUND SHAPE — one refunded order (or one with a non-empty refunds[]). Amounts only.
  try {
    let refundOrder: any = null
    const refunded = await fetch(base + '/orders?status=refunded&per_page=1', { headers }).then(x => x.json())
    if (Array.isArray(refunded) && refunded[0]) refundOrder = refunded[0]
    if (!refundOrder) {
      const recent = await fetch(base + '/orders?per_page=50&status=any&order=desc&orderby=date', { headers }).then(x => x.json())
      if (Array.isArray(recent)) refundOrder = recent.find((o: any) => Array.isArray(o.refunds) && o.refunds.length > 0) || null
    }
    if (refundOrder) {
      out.refundSample = {
        status: refundOrder.status,
        currency: refundOrder.currency,
        total_gross: refundOrder.total,
        has_total_refunded_field: Object.prototype.hasOwnProperty.call(refundOrder, 'total_refunded'),
        total_refunded_field: refundOrder.total_refunded ?? null,
        refunds_array_totals: Array.isArray(refundOrder.refunds) ? refundOrder.refunds.map((rf: any) => rf.total) : null,
      }
    } else {
      out.refundSample = 'no status=refunded orders and no orders with a non-empty refunds[] in the recent-50 sample'
    }
  } catch (e: any) {
    out.refundError = String(e?.message ?? e)
  }

  // 4. FULL-HISTORY PROBE — a 2-day window ~120 days back; confirms after/before on date_created
  //    reaches arbitrary past windows (no retention wall).
  try {
    const now = new Date()
    const a = new Date(now); a.setUTCDate(a.getUTCDate() - 120)
    const b = new Date(now); b.setUTCDate(b.getUTCDate() - 118)
    const url =
      base + '/orders?status=any&per_page=5&after=' +
      encodeURIComponent(fmt(a) + 'T00:00:00') + '&before=' + encodeURIComponent(fmt(b) + 'T23:59:59')
    const r = await fetch(url, { headers })
    const j = await r.json()
    out.pastWindowProbe = {
      window: { after: fmt(a), before: fmt(b) },
      returnedCount: Array.isArray(j) ? j.length : null,
      sampleDates: Array.isArray(j) ? j.slice(0, 5).map((o: any) => String(o.date_created).slice(0, 10)) : null,
    }
  } catch (e: any) {
    out.pastWindowError = String(e?.message ?? e)
  }

  return NextResponse.json(out)
}
