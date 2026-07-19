// LORAMER_GOOGLE_ADGROUP_AD_BACKFILL_V1
// Ad-group-grain AND ad-grain backfill writer for Google (NEW, backfill-only — does NOT touch forward
// capture). Mirrors src/lib/backfill/google-campaign-backfill.ts byte-for-pattern (monthChunks,
// queryWithRetry, idempotent UPSERT via normalizeMetricsRows on the standard CONFLICT key, same return
// shape). One pass per month-chunk runs TWO GAQL reports:
//   • ad_group        → entity_level='ad_group', entity_id=ad_group.id,        parent=campaign.id
//   • ad_group_ad     → entity_level='ad',       entity_id=ad_group_ad.ad.id,  parent=ad_group.id
// Rows are byte-compatible with the forward builder (src/lib/intelligence/google-metrics-row.ts) — same
// columns, same conflict key, same extra-JSON shape (ctr/cpc/cpm/roas/cpa/convRate), breakdown_type/value=''.
// Like the campaign writer we DO NOT filter status (a since-REMOVED ad_group/ad still had real historical
// spend). The google-ads-api lib auto-paginates, so the GAQL fetch itself is not silently truncatable.
//
// RECONCILE = FLAG-NOT-BLOCK against a per-day CAMPAIGN anchor (mirrors the settled Meta-placement posture):
//   Proven on real data (Gate A, 2026-06-26): Σad_group / Σad do NOT always equal account (PMax/Shopping
//   campaigns expose no ad_group/ad children) and do NOT even always equal Σcampaign exactly (Google
//   attributes some campaign spend outside the ad_group grain — partial-coverage campaigns). So a BLOCK
//   gate would DROP real, correct grain rows on structurally-divergent days — a capture-everything
//   violation. Instead we ALWAYS write the real grain rows and RECORD a loud delta in flagged[] when
//   Σ(grain spend) diverges from Σ(campaign-grain spend over only the campaigns present in that grain's
//   result that day). The anchor is read PER DAY (scoped to one date — never the whole chunk, which for
//   high-campaign-count clients like Bath Fitter exceeds supabase-js's silent 1000-row cap and collapsed
//   the anchor to 0; Lesson 8). Account spend is reported in dryRun for context (the PMax/Shopping gap).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import { gaqlWithRetry } from './gaql-with-retry'
import { GoogleAdsApi } from 'google-ads-api'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const CAMP_DAY_CAP = 5000 // explicit guard — one day's campaign rows are ≤ a few hundred; never near this

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

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

// One built metrics_daily row (byte-compatible with buildGoogleMetricsRows).
function buildRow(
  clientId: string, userEmail: string, customerId: string,
  entityLevel: string, entityId: string, entityName: string, parentEntityId: string,
  date: string, spend: number, impressions: number, clicks: number, conversions: number, convValue: number,
  allConversions: number, allConversionsValue: number, viewThroughConversions: number // LORAMER_GOOGLE_ALL_CONVERSIONS_V1 (G-FILL#1)
): Record<string, unknown> {
  return {
    client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
    entity_level: entityLevel, entity_id: entityId, entity_name: entityName,
    parent_entity_id: parentEntityId, date, breakdown_type: '', breakdown_value: '',
    spend: Number(spend.toFixed(2)), impressions, clicks, conversions, conversion_value: Number(convValue.toFixed(2)), revenue: 0,
    // LORAMER_GOOGLE_ALL_CONVERSIONS_V1 (G-FILL#1) — DEDICATED COLUMNS. ⚠ MIGRATION-GATED (see google-metrics-row.ts).
    all_conversions: allConversions, all_conversions_value: Number(allConversionsValue.toFixed(2)), view_through_conversions: viewThroughConversions,
    extra: {
      ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
      roas: ratio(convValue, spend), cpa: ratio(spend, conversions), convRate: ratio(conversions, clicks, 100),
    },
  }
}

interface GrainStat {
  grainDayRows: number
  written: number
  daysWritten: number
  daysFlagged: number
}
const emptyStat = (): GrainStat => ({ grainDayRows: 0, written: 0, daysWritten: 0, daysFlagged: 0 })

export interface AdGroupAdBackfillResult { status: number; body: Record<string, any> }

export async function runGoogleAdGroupAdBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<AdGroupAdBackfillResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).is('deleted_at', null).single() // LORAMER_DELETE_CLIENT_V1 — archived client → no row → no-op
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'google')
  if (!conn) return { status: 400, body: { error: 'Client has no Google connection' } }
  const customerId = conn.account_id as string
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.refresh_token) return { status: 400, body: { error: 'No Google refresh token', detail: tErr?.message } }
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: tok.refresh_token as string, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })

  // PER-DAY caches (scoped to one date → bounded result, never the silent 1000-row cap). Shared across
  // both grains and all chunks; each date is queried at most once.
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

  const stats: Record<'ad_group' | 'ad', GrainStat> = { ad_group: emptyStat(), ad: emptyStat() }
  const flagged: any[] = []
  const sampleRow: Record<string, unknown> = {} // dryRun diagnostic: first built row per grain

  for (const chunk of monthChunks(startDate, endDate)) {
    const grains: { level: 'ad_group' | 'ad'; gaql: string; extract: (r: any) => { entityId: string; entityName: string; parentId: string; campaignId: string } }[] = [
      {
        level: 'ad_group',
        gaql: `SELECT ad_group.id, ad_group.name, campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value, metrics.view_through_conversions, segments.date FROM ad_group WHERE segments.date BETWEEN '${chunk.from}' AND '${chunk.to}'`,
        extract: (r) => ({ entityId: String(r.ad_group?.id), entityName: String(r.ad_group?.name || ''), parentId: String(r.campaign?.id), campaignId: String(r.campaign?.id) }),
      },
      {
        level: 'ad',
        gaql: `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group.id, campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value, metrics.view_through_conversions, segments.date FROM ad_group_ad WHERE segments.date BETWEEN '${chunk.from}' AND '${chunk.to}'`,
        extract: (r) => ({ entityId: String(r.ad_group_ad?.ad?.id), entityName: String(r.ad_group_ad?.ad?.name || ''), parentId: String(r.ad_group?.id), campaignId: String(r.campaign?.id) }),
      },
    ]

    for (const grain of grains) {
      const rows = await gaqlWithRetry(customer, grain.gaql)
      const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number; campaignIds: Set<string> }> = {}
      for (const r of rows) {
        const date = r.segments?.date
        if (!date) continue
        const { entityId, entityName, parentId, campaignId } = grain.extract(r)
        const spend = fin(r.metrics?.cost_micros) / 1e6
        const clicks = fin(r.metrics?.clicks)
        const impressions = fin(r.metrics?.impressions)
        const conversions = fin(r.metrics?.conversions)
        const convValue = fin(r.metrics?.conversions_value)
        const allConversions = fin(r.metrics?.all_conversions)
        const allConversionsValue = fin(r.metrics?.all_conversions_value)
        const viewThroughConversions = fin(r.metrics?.view_through_conversions)
        if (!byDate[date]) byDate[date] = { rows: [], spend: 0, campaignIds: new Set() }
        const b = byDate[date]
        b.spend += spend
        if (campaignId) b.campaignIds.add(campaignId)
        b.rows.push(buildRow(clientId, userEmail, customerId, grain.level, entityId, entityName, parentId, date, spend, impressions, clicks, conversions, convValue, allConversions, allConversionsValue, viewThroughConversions))
      }
      const stat = stats[grain.level]
      stat.grainDayRows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
      if (opts.dryRun && !sampleRow[grain.level]) {
        const firstBucket = Object.values(byDate).find((d) => d.rows.length > 0)
        if (firstBucket) sampleRow[grain.level] = firstBucket.rows[0]
      }

      for (const [date, bucket] of Object.entries(byDate)) {
        // Anchor = Σ campaign-grain spend over ONLY the campaigns present in THIS grain's result this day.
        const dayCamp = await campDay(date)
        let anchorSpend = 0
        let anchorMissing = 0 // campaigns in the grain result with no campaign-grain row (anchor unavailable)
        for (const cid of bucket.campaignIds) {
          if (cid in dayCamp) anchorSpend += dayCamp[cid]
          else anchorMissing++
        }
        const { within: tolWithin, delta } = reconcileDay(bucket.spend, anchorSpend, { posture: 'flag' })
        const within = anchorMissing === 0 && tolWithin   // anchorMissing guard preserved in the caller
        // FLAG-NOT-BLOCK: ALWAYS write the real grain rows; only record a loud delta when divergent.
        if (!within) {
          stat.daysFlagged++
          flagged.push({
            grain: grain.level, date,
            grain_spend: Number(bucket.spend.toFixed(2)),
            campaign_anchor_spend: Number(anchorSpend.toFixed(2)),
            delta_vs_campaign: Number(delta.toFixed(2)),
            anchor_missing_campaigns: anchorMissing,
            ...(opts.dryRun ? { account_spend: Number((await acctDay(date)).toFixed(2)) } : {}),
          })
        }
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', grain: grain.level, date, detail: upErr.message, flagged } }
        }
        stat.written += bucket.rows.length; stat.daysWritten++
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, customerId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      adGroup: stats.ad_group, ad: stats.ad,
      written: stats.ad_group.written + stats.ad.written,
      flagged,
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
