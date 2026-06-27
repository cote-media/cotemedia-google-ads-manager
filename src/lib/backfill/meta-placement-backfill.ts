// LORAMER_META_PLACEMENT_BACKFILL_SLICE2_V1
// Meta placement-grain (campaign × placement × day) backfill writer — mirrors
// src/lib/backfill/meta-campaign-backfill.ts byte-for-pattern (monthChunks, fetchAllWithRetry,
// idempotent upsert via normalizeMetricsRows on the standard CONFLICT key, same return shape).
// Source: Meta insights level=campaign, breakdowns=publisher_platform,platform_position,
// time_increment=1, bounded range, per client × ad-account.
// Persists entity_level='campaign', breakdown_type='placement', breakdown_value='<pub>:<pos>'.
// SPEND/clicks/impressions ONLY — Meta does not break conversions out per placement (conversions=0,
// conversion_value=0, never fabricated). Reconcile is ACCOUNT-level + FLAG-NOT-BLOCK (see the gate).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
// Meta rate-limit / transient error codes → backoff + retry.
const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80004])

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)
const iso = (d: Date) => d.toISOString().split('T')[0]

function monthChunks(start: string, end: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = []
  let cur = start
  while (cur <= end) {
    const d = new Date(cur + 'T00:00:00Z')
    const mEnd = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
    const to = mEnd < end ? mEnd : end
    chunks.push({ from: cur, to })
    const next = new Date(to + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); cur = iso(next)
  }
  return chunks
}

async function fetchAllWithRetry(initialUrl: string, token: string): Promise<any[]> {
  const out: any[] = []
  let url: string | null = initialUrl + (initialUrl.includes('?') ? '&' : '?') + 'access_token=' + token
  let guard = 0
  while (url && guard < 100) {
    guard++
    let j: any
    for (let i = 0; i < 4; i++) {
      const res = await fetch(url)
      j = await res.json()
      if (j.error) {
        if (RETRYABLE.has(j.error.code) && i < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** i)); continue }
        throw new Error('Meta Graph error: ' + JSON.stringify(j.error))
      }
      break
    }
    if (j.data) out.push(...j.data)
    url = j.paging?.next || null // paging.next is a full URL w/ token — used as-is
  }
  return out
}

export interface PlacementBackfillResult { status: number; body: Record<string, any> }

export async function runMetaPlacementBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<PlacementBackfillResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'meta')
  if (!conn) return { status: 400, body: { error: 'Client has no Meta connection' } }
  const metaAccountId = conn.account_id as string
  const actId = metaAccountId.startsWith('act_') ? metaAccountId : 'act_' + metaAccountId
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('meta_tokens').select('access_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.access_token) return { status: 400, body: { error: 'No Meta access token', detail: tErr?.message } }
  const token = tok.access_token as string

  // breakdowns go in &breakdowns=, NOT &fields= (LORAMER_META_PLACEMENT_FIELDS_FIX_V1). campaign_id is
  // additive so each placement row ties to its campaign (mirrors the forward Slice 1 fetch). spend>0
  // filter kept at campaign level — same basis as forward capture.
  const fields = 'campaign_id,campaign_name,spend,clicks,impressions'
  const flagged: any[] = []
  let written = 0, daysWritten = 0, placementDayRows = 0, daysFlagged = 0, skippedNoCampaign = 0
  let sampleRow: Record<string, unknown> | null = null // dryRun diagnostic: the first built placement row

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))
    const url = `${META_API}/${actId}/insights?level=campaign&time_range=${timeRange}&time_increment=1&breakdowns=publisher_platform,platform_position&fields=${fields}&filtering=${filtering}&limit=500`
    const insights = await fetchAllWithRetry(url, token)

    const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number }> = {}
    for (const ins of insights) {
      const date = ins?.date_start // time_increment=1 → one day per row
      if (!date) continue
      const campaignId = String(ins.campaign_id || '')
      if (!campaignId) { skippedNoCampaign++; continue } // fail-safe: no campaign id → skip (matches Slice 1)
      const publisher = String(ins.publisher_platform || '').toLowerCase()
      const position = String(ins.platform_position || '').toLowerCase()
      const spend = fin(parseFloat(ins.spend || '0'))
      const clicks = fin(parseInt(ins.clicks || '0'))
      const impressions = fin(parseInt(ins.impressions || '0'))
      if (!byDate[date]) byDate[date] = { rows: [], spend: 0 }
      const b = byDate[date]
      b.spend += spend
      b.rows.push({
        client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
        entity_level: 'campaign', entity_id: campaignId, entity_name: String(ins.campaign_name || ''),
        parent_entity_id: metaAccountId, date, breakdown_type: 'placement', breakdown_value: `${publisher}:${position}`,
        spend: Number(spend.toFixed(2)), impressions, clicks, conversions: 0, conversion_value: 0, revenue: 0,
        extra: {
          ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
          publisherPlatform: publisher, platformPosition: position,
        },
      })
    }
    placementDayRows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
    if (opts.dryRun && !sampleRow) {
      const firstBucket = Object.values(byDate).find((d) => d.rows.length > 0)
      if (firstBucket) sampleRow = firstBucket.rows[0]
    }

    for (const [date, bucket] of Object.entries(byDate)) {
      // RECONCILE = ACCOUNT level (NOT per-campaign): per-campaign×day spend rows do NOT exist for history
      // (the Meta campaign grain is forward-only since ~06-02, its backfill writer unwired), so the
      // deep, always-present account×day spend row is the anchor. FLAG-NOT-BLOCK posture: ALWAYS write
      // the placement rows; only RECORD a loud delta when Σ placement spend diverges from account spend.
      // The divergence is an EXPECTED ARTIFACT — the account row is summed from the spend>0-filtered
      // campaign capture while this placement breakdown can differ slightly — and must NEVER suppress real
      // placement rows (placement is trusted data already feeding Lora since Slice 1).
      const { data: acctRow } = await supabaseAdmin
        .from('metrics_daily').select('spend')
        .eq('client_id', clientId).eq('platform', 'meta').eq('entity_level', 'account')
        .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
      const acctSpend = fin(acctRow?.spend)
      const { within, delta } = reconcileDay(bucket.spend, acctSpend, { posture: 'flag' })
      if (!within) {
        daysFlagged++
        flagged.push({ date, placement_spend: Number(bucket.spend.toFixed(2)), account_spend: Number(acctSpend.toFixed(2)), delta: Number(delta.toFixed(2)) })
      }
      if (!opts.dryRun) {
        const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
        if (upErr) return { status: 500, body: { error: 'upsert failed', date, detail: upErr.message, flagged } }
      }
      written += bucket.rows.length; daysWritten++
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      placementDayRows, written, daysWritten, daysFlagged, skippedNoCampaign, flagged,
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
