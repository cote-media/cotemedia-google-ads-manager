// LORAMER_GOOGLE_DEVICE_BACKFILL_V1
// First BREADTH dimension writer (Phase 2) — Google campaign × device × day persisted into metrics_daily as
// BREAKDOWN rows: entity_level='campaign', breakdown_type='device', breakdown_value=<canonical device enum
// name>, entity_id=campaign.id, parent_entity_id=customerId. Backfill-only — does NOT touch forward capture
// (cron/sync + cron/catchup forward-capture of device is the IMMEDIATE next motion, mirroring the
// search_term/keyword V1-capture / V1-backfill split; see docs/LORAMER_BREAKDOWN_REGISTRY.md §6).
//
// MIRRORS src/lib/backfill/google-adgroup-ad-backfill.ts (stateless-range signature for rangeLap, monthChunks,
// gaqlWithRetry, idempotent UPSERT via normalizeMetricsRows on the standard CONFLICT key, per-day campaign
// anchor). The ad-grain writer is the closest model because device — like ad_group/ad — PARTITIONS campaign
// spend, so it reconciles against the per-day CAMPAIGN anchor (NOT the account anchor the campaign writer uses).
//
// SOURCE GAQL = the proven live device query (src/lib/intelligence/google-intelligence.ts:653), FROM campaign
// with segments.device. A HISTORY writer does NOT filter campaign.status (a since-REMOVED campaign still had
// real historical spend — same posture as the campaign/ad_group/ad backfills; the LIVE query filters REMOVED,
// a backfill must not, so its Σ matches the no-status-filter campaign anchor). segments.device returns the
// Google Ads Device enum (int code via .query(), or a name) → mapped to the canonical NAME; any unanticipated
// value is kept verbatim (uppercased), never dropped.
//
// RECONCILE = FLAG-NOT-BLOCK vs the per-day CAMPAIGN anchor (Lesson 59 posture; mirrors google-adgroup-ad /
// Meta-placement): Σ device spend over the campaigns present that day vs Σ their campaign-grain spend. Device
// SHOULD sum to the campaign total, but PMax/UNKNOWN coverage gaps can diverge → ALWAYS write, record a loud
// delta in flagged[]. Anchor read PER DAY (scoped to one date → bounded, never supabase-js's silent 1000-row
// cap that collapsed the anchor for high-campaign clients; Lesson 8). Conversions never gate.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import { gaqlWithRetry } from './gaql-with-retry'
import { GoogleAdsApi } from 'google-ads-api'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const CAMP_DAY_CAP = 5000 // one day's campaign rows are ≤ a few hundred; explicit guard, never near this

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)
const iso = (d: Date) => d.toISOString().split('T')[0]

// Google Ads Device enum → canonical name. .query() may yield the int code or the name; cover both, and keep
// any unanticipated value verbatim (UPPERCASED) so a new device kind is captured, never dropped.
const DEVICE_NAME: Record<string, string> = {
  '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'MOBILE', '3': 'TABLET', '4': 'DESKTOP', '5': 'OTHER', '6': 'CONNECTED_TV',
}
function deviceName(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return 'UNKNOWN'
  return DEVICE_NAME[s] || s.toUpperCase()
}

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

interface DeviceAgg {
  campaignId: string
  campaignName: string
  device: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  convValue: number
}

export interface DeviceBackfillResult { status: number; body: Record<string, any> }

export async function runGoogleDeviceBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<DeviceBackfillResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'google')
  if (!conn) return { status: 400, body: { error: 'Client has no Google connection' } }
  const customerId = conn.account_id as string
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.refresh_token) return { status: 400, body: { error: 'No Google refresh token', detail: tErr?.message } }
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: tok.refresh_token as string, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })

  // PER-DAY campaign-anchor cache (scoped to one date → bounded, never the silent 1000-row cap; Lesson 8).
  const campCache = new Map<string, Record<string, number>>()
  const acctCache = new Map<string, number>()
  const campDay = async (date: string): Promise<Record<string, number>> => {
    const hit = campCache.get(date)
    if (hit) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('entity_id,spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'campaign')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).limit(CAMP_DAY_CAP)
    const m: Record<string, number> = {}
    for (const r of data || []) m[String((r as any).entity_id)] = fin((r as any).spend)
    campCache.set(date, m)
    return m
  }
  const acctDay = async (date: string): Promise<number> => {
    const hit = acctCache.get(date)
    if (hit !== undefined) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'account')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
    const v = fin((data as any)?.spend)
    acctCache.set(date, v)
    return v
  }

  const buildRow = (a: DeviceAgg, date: string): Record<string, unknown> => {
    const spend = Number(a.spend.toFixed(2))
    const convValue = Number(a.convValue.toFixed(2))
    return {
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: 'campaign', entity_id: a.campaignId, entity_name: a.campaignName,
      parent_entity_id: customerId, date, breakdown_type: 'device', breakdown_value: a.device,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversion_value: convValue, revenue: 0,
      extra: {
        ctr: ratio(a.clicks, a.impressions, 100), cpc: ratio(spend, a.clicks), cpm: ratio(spend, a.impressions, 1000),
        roas: ratio(convValue, spend), cpa: ratio(spend, a.conversions), convRate: ratio(a.conversions, a.clicks, 100),
      },
    }
  }

  let grainDayRows = 0, written = 0, daysWritten = 0, daysFlagged = 0
  const flagged: any[] = []
  const distinctDeviceRaw = new Set<string>() // dryRun diagnostic — the actual enum forms Google returns
  let sampleRow: Record<string, unknown> | null = null

  for (const chunk of monthChunks(startDate, endDate)) {
    const gaql = `SELECT campaign.id, campaign.name, segments.device, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM campaign WHERE segments.date BETWEEN '${chunk.from}' AND '${chunk.to}'`
    const rows = await gaqlWithRetry(customer, gaql)

    // Aggregate by (date, campaignId, device); track per-day Σspend + campaigns present for the reconcile.
    const byDate: Record<string, { aggs: Map<string, DeviceAgg>; spend: number; campaignIds: Set<string> }> = {}
    for (const r of rows) {
      const date = r.segments?.date
      if (!date) continue
      const campaignId = String(r.campaign?.id || '')
      if (!campaignId) continue
      distinctDeviceRaw.add(String(r.segments?.device ?? ''))
      const device = deviceName(r.segments?.device)
      const spend = fin(r.metrics?.cost_micros) / 1e6
      const clicks = fin(r.metrics?.clicks)
      const impressions = fin(r.metrics?.impressions)
      const conversions = fin(r.metrics?.conversions)
      const convValue = fin(r.metrics?.conversions_value)
      if (!byDate[date]) byDate[date] = { aggs: new Map(), spend: 0, campaignIds: new Set() }
      const b = byDate[date]
      const key = `${campaignId}|${device}`
      let a = b.aggs.get(key)
      if (!a) { a = { campaignId, campaignName: String(r.campaign?.name || ''), device, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; b.aggs.set(key, a) }
      a.spend += spend; a.impressions += impressions; a.clicks += clicks; a.conversions += conversions; a.convValue += convValue
      b.spend += spend
      b.campaignIds.add(campaignId)
    }

    for (const [date, bucket] of Object.entries(byDate)) {
      // Skip all-zero-activity rows (pure noise; spend stays 0 so the reconcile sum is unaffected) — mirrors
      // google-dimensional.ts.
      const dayRows: Record<string, unknown>[] = []
      for (const a of bucket.aggs.values()) {
        if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
        dayRows.push(buildRow(a, date))
      }
      grainDayRows += dayRows.length
      if (dayRows.length === 0) continue
      if (opts.dryRun && !sampleRow) sampleRow = dayRows[0]

      // FLAG-NOT-BLOCK reconcile vs the per-day campaign anchor (Σ over the campaigns present this day).
      const dayCamp = await campDay(date)
      let anchorSpend = 0, anchorMissing = 0
      for (const cid of bucket.campaignIds) {
        if (cid in dayCamp) anchorSpend += dayCamp[cid]
        else anchorMissing++
      }
      const { within: tolWithin, delta } = reconcileDay(bucket.spend, anchorSpend, { posture: 'flag' })
      const within = anchorMissing === 0 && tolWithin
      if (!within) {
        daysFlagged++
        flagged.push({
          date,
          device_spend: Number(bucket.spend.toFixed(2)),
          campaign_anchor_spend: Number(anchorSpend.toFixed(2)),
          delta_vs_campaign: Number(delta.toFixed(2)),
          anchor_missing_campaigns: anchorMissing,
          ...(opts.dryRun ? { account_spend: Number((await acctDay(date)).toFixed(2)) } : {}),
        })
      }
      if (!opts.dryRun) {
        const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(dayRows), { onConflict: CONFLICT })
        if (upErr) return { status: 500, body: { error: 'upsert failed', date, detail: upErr.message, flagged } }
      }
      written += dayRows.length; daysWritten++
    }
  }

  return {
    status: 200,
    body: {
      clientId, customerId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      grainDayRows, written, daysWritten, daysFlagged,
      flagged,
      ...(opts.dryRun ? { distinctDeviceRaw: Array.from(distinctDeviceRaw), sampleRow } : {}),
    },
  }
}
