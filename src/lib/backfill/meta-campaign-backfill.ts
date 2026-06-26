// LORAMER_CAMPAIGN_BACKFILL_META_PILOT_V1
// Meta campaign-grain backfill writer — mirrors src/lib/backfill/google-campaign-backfill.ts for Meta.
// Source: Meta insights level=campaign, time_increment=1 (per campaign×day), bounded range, per client×ad-account.
// SAME spend>0 basis as forward capture (meta-intelligence.ts:97) so campaign Σ reconciles to the account grain.
// Parsing mirrors meta-intelligence.ts buildMetrics (conversions from actions[], convValue from action_values[],
// reach/frequency) and meta-metrics-row.ts extra shape. Idempotent upsert + per-day SPEND reconcile.
// LORAMER_META_CAMPAIGN_BACKFILL_FLAG_NOT_BLOCK_V2: reconcile = FLAG-NOT-BLOCK (the settled Meta-placement /
// google-adgroup-ad posture), NOT block. Gate A proved finalized days reconcile EXACTLY but RECENT days show
// small (<1%) deltas because the stored account anchor is a few days STALE vs the live campaign fetch (Meta
// restates spend ~28d). A BLOCK gate + the drain's monotonic range cursor would PERMANENTLY skip those days;
// so we ALWAYS write the real campaign rows and RECORD divergence in flagged[]. Conversions are NEVER the gate
// (Meta account-level dedup → account conversions ≠ Σcampaign conversions; otherDeltas is informational only).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const RECON_ABS = 0.01
const RECON_PCT = 0.001
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

// mirror of meta-intelligence.ts buildMetrics
function parseInsight(insight: any) {
  const spend = parseFloat(insight?.spend || '0')
  const clicks = parseInt(insight?.clicks || '0')
  const impressions = parseInt(insight?.impressions || '0')
  const ctr = parseFloat(insight?.ctr || '0')
  const getAction = (actions: any[], type: string) => { const a = actions?.find((x: any) => x.action_type === type); return a ? parseFloat(a.value) : 0 }
  const actions = insight?.actions || []
  const conversions = getAction(actions, 'lead') || getAction(actions, 'offsite_conversion.fb_pixel_lead') || getAction(actions, 'offsite_conversion.fb_pixel_purchase') || parseFloat(insight?.conversions || '0')
  const purchases = getAction(actions, 'offsite_conversion.fb_pixel_purchase')
  const addToCart = getAction(actions, 'offsite_conversion.fb_pixel_add_to_cart')
  const initiateCheckout = getAction(actions, 'offsite_conversion.fb_pixel_initiate_checkout')
  const viewContent = getAction(actions, 'offsite_conversion.fb_pixel_view_content')
  const convValue = parseFloat(insight?.action_values?.find((x: any) => x.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
  const reach = parseInt(insight?.reach || '0')
  const frequency = parseFloat(insight?.frequency || '0')
  return {
    spend: fin(spend), clicks: fin(clicks), impressions: fin(impressions), conversions: fin(conversions),
    conversionValue: fin(convValue), ctr: fin(ctr), reach: fin(reach), frequency: fin(frequency),
    purchases: fin(purchases), addToCart: fin(addToCart), initiateCheckout: fin(initiateCheckout), viewContent: fin(viewContent),
  }
}

function metaExtra(m: ReturnType<typeof parseInsight>): Record<string, unknown> {
  const e: Record<string, unknown> = {
    ctr: m.ctr, cpc: ratio(m.spend, m.clicks), cpm: ratio(m.spend, m.impressions, 1000),
    roas: ratio(m.conversionValue, m.spend), cpa: ratio(m.spend, m.conversions), convRate: ratio(m.conversions, m.clicks, 100),
  }
  if (m.reach) e.reach = m.reach
  if (m.frequency) e.frequency = m.frequency
  if (m.purchases) e.purchases = m.purchases
  if (m.addToCart) e.addToCart = m.addToCart
  if (m.initiateCheckout) e.initiateCheckout = m.initiateCheckout
  if (m.viewContent) e.viewContent = m.viewContent
  return e
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

export interface CampaignBackfillResult { status: number; body: Record<string, any> }

export async function runMetaCampaignBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<CampaignBackfillResult> {
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

  const insightFields = 'campaign_id,campaign_name,spend,clicks,impressions,ctr,reach,frequency,actions,action_values,conversions'
  const flagged: any[] = []
  let written = 0, daysWritten = 0, daysFlagged = 0, campaignDayRows = 0
  const otherDeltas = { clicks: 0, impressions: 0, conversions: 0 }

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))
    const url = `${META_API}/${actId}/insights?level=campaign&time_range=${timeRange}&time_increment=1&fields=${insightFields}&filtering=${filtering}&limit=500`
    const insights = await fetchAllWithRetry(url, token)

    const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number; clicks: number; impressions: number; conversions: number }> = {}
    for (const ins of insights) {
      const date = ins?.date_start // time_increment=1 → one day per row
      if (!date) continue
      const m = parseInsight(ins)
      if (!byDate[date]) byDate[date] = { rows: [], spend: 0, clicks: 0, impressions: 0, conversions: 0 }
      const b = byDate[date]
      b.spend += m.spend; b.clicks += m.clicks; b.impressions += m.impressions; b.conversions += m.conversions
      b.rows.push({
        client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
        entity_level: 'campaign', entity_id: String(ins.campaign_id), entity_name: String(ins.campaign_name || ''),
        parent_entity_id: metaAccountId, date, breakdown_type: '', breakdown_value: '',
        spend: Number(m.spend.toFixed(2)), impressions: m.impressions, clicks: m.clicks, conversions: m.conversions,
        conversion_value: Number(m.conversionValue.toFixed(2)), revenue: 0, extra: metaExtra(m),
      })
    }
    campaignDayRows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)

    for (const [date, bucket] of Object.entries(byDate)) {
      const { data: acctRow } = await supabaseAdmin
        .from('metrics_daily').select('spend,clicks,impressions,conversions')
        .eq('client_id', clientId).eq('platform', 'meta').eq('entity_level', 'account')
        .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
      const acctSpend = fin(acctRow?.spend)
      const delta = Math.abs(bucket.spend - acctSpend)
      const within = delta <= RECON_ABS || (acctSpend > 0 && delta / acctSpend <= RECON_PCT)
      // FLAG-NOT-BLOCK: ALWAYS write the real campaign rows; only record a loud delta when divergent.
      if (!within) {
        daysFlagged++
        flagged.push({ date, campaign_spend: Number(bucket.spend.toFixed(2)), account_spend: Number(acctSpend.toFixed(2)), delta: Number(delta.toFixed(2)) })
      }
      otherDeltas.clicks += bucket.clicks - fin(acctRow?.clicks)
      otherDeltas.impressions += bucket.impressions - fin(acctRow?.impressions)
      otherDeltas.conversions += bucket.conversions - fin(acctRow?.conversions)
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
      campaignDayRows, written, daysWritten, daysFlagged,
      otherDeltas: { clicks: Math.round(otherDeltas.clicks), impressions: Math.round(otherDeltas.impressions), conversions: Number(otherDeltas.conversions.toFixed(2)) },
      flagged,
    },
  }
}
