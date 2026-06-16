// LORAMER_WOO_PROBE_DAY_TEMP — TEMPORARY Gate-B day comparison for WS3 #7. CRON_SECRET-gated,
// READ-ONLY. Given clientId+date, fetches that day's orders (status=any) and reports all-status vs
// the sale set {completed,processing,refunded}: counts, gross vs net revenue, per-status breakdown.
// No creds, no PII (only statuses + money amounts + counts). REMOVE after the Gate-B read.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const maxDuration = 60

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const u = new URL(request.url)
  const clientId = u.searchParams.get('clientId')
  const date = u.searchParams.get('date')
  if (!clientId || !date) return NextResponse.json({ error: 'Missing clientId or date' }, { status: 400 })

  const { data: tok, error } = await supabaseAdmin
    .from('woocommerce_tokens')
    .select('store_url, consumer_key, consumer_secret')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !tok?.store_url || !tok?.consumer_key || !tok?.consumer_secret) {
    return NextResponse.json({ error: 'No Woo creds for client', detail: error?.message }, { status: 404 })
  }

  const baseUrl = tok.store_url.replace(/\/+$/, '') + '/wp-json/wc/v3'
  const headers = {
    Authorization: 'Basic ' + Buffer.from(tok.consumer_key + ':' + tok.consumer_secret).toString('base64'),
    Accept: 'application/json',
  }
  // creds used only for the header below; never logged/returned.

  const after = date + 'T00:00:00'
  const before = date + 'T23:59:59'
  const all: any[] = []
  for (let page = 1; page <= 10; page++) {
    const url =
      baseUrl + '/orders?per_page=100&page=' + page + '&status=any&after=' +
      encodeURIComponent(after) + '&before=' + encodeURIComponent(before)
    const r = await fetch(url, { headers })
    if (!r.ok) return NextResponse.json({ error: 'woo fetch ' + r.status }, { status: 502 })
    const o = await r.json()
    if (!Array.isArray(o) || o.length === 0) break
    all.push(...o)
    if (o.length < 100) break
  }

  const SALE = new Set(['completed', 'processing', 'refunded'])
  const netOf = (o: any): number =>
    parseFloat(o.total || '0') + ((o.refunds as any[]) || []).reduce((s: number, rf: any) => s + parseFloat(rf.total || '0'), 0)
  const r2 = (n: number) => Math.round(n * 100) / 100

  const byStatus: Record<string, number> = {}
  for (const o of all) byStatus[o.status] = (byStatus[o.status] || 0) + 1
  const sale = all.filter((o) => SALE.has(String(o.status || '').toLowerCase()))

  return NextResponse.json({
    date,
    allStatusCount: all.length,
    allStatusGross: r2(all.reduce((s, o) => s + parseFloat(o.total || '0'), 0)),
    byStatus,
    saleCount: sale.length,
    saleGross: r2(sale.reduce((s, o) => s + parseFloat(o.total || '0'), 0)),
    saleNet: r2(sale.reduce((s, o) => s + netOf(o), 0)),
  })
}
