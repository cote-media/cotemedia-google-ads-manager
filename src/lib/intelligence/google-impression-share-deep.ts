// LORAMER_GOOGLE_IS_DEEP_V1 (G-FILL#9) — search impression_share at the DEEPER grain: ad_group. The campaign grain
// rides fetchGoogleIntelligence (intel.impressionShares, ZERO new call). ad_group is a NEW GAQL (the same
// search_impression_share family FROM ad_group), mirroring the campaign query's fields + WRITE-ONLY posture exactly.
// ⚠ NOT SERVED AT KEYWORD: impression_share is grain-limited to campaign + ad_group (keyword IS is not selectable) →
// the vendor-complete set is [campaign, ad_group], NOT 4. This file adds ad_group only.
//
// ⚠ GAQL UNVERIFIED-AGAINST-LIVE-API: authored 2026-07-18 with Google read-quota EXHAUSTED (reset 07-19 ~04:03 ET).
// The field set mirrors the proven campaign query. Live Gate-A at the reset confirms search_impression_share is served
// FROM ad_group; if Google REJECTS it, STOP — impression_share stays campaign-only and the registry/manifest must
// declare [campaign] (not a false [campaign, ad_group] slice).
//
// ENCODING: entity_level='ad_group', breakdown_type='impression_share', breakdown_value='search'; the 7 ratio metrics
//   live in extra (nullable; the API's -1 non-eligible sentinel → null). NOT-NULL count columns = 0. WRITE-ONLY — a
//   ratio is not a partition of any total, never reconciled. Non-search ad_groups (search_impression_share == -1) → no row.
import { GoogleAdsApi } from 'google-ads-api'
import { gaqlWithRetry } from '@/lib/backfill/gaql-with-retry'

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

// -1 = the API's non-eligible sentinel → null (never a fabricated 0); any other finite value passes through.
const isRatio = (n: any): number | null => { const v = Number(n); return Number.isFinite(v) && v >= 0 ? v : null }

export interface ISDeepRow {
  date: string; entityId: string; entityName: string; parentId: string; channelType: string
  impressionShare: number | null; topImpressionShare: number | null; absoluteTopImpressionShare: number | null
  lostToBudget: number | null; lostToRank: number | null; lostTopToBudget: number | null; lostTopToRank: number | null
}

const IS_DEEP_GAQL = (start: string, end: string): string =>
  `SELECT ad_group.id, ad_group.name, campaign.id, campaign.advertising_channel_type, metrics.search_impression_share, metrics.search_top_impression_share, metrics.search_absolute_top_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, metrics.search_budget_lost_top_impression_share, metrics.search_rank_lost_top_impression_share, segments.date FROM ad_group WHERE segments.date BETWEEN '${start}' AND '${end}' AND ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`

export async function fetchISDeepWindow(refreshToken: string, customerId: string, start: string, end: string): Promise<ISDeepRow[]> {
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })
  const rows = await gaqlWithRetry(customer, IS_DEEP_GAQL(start, end))
  const out: ISDeepRow[] = []
  for (const r of rows) {
    const entityId = String(r.ad_group?.id || '')
    if (!entityId || !r.segments?.date) continue
    const is = isRatio(r.metrics?.search_impression_share)
    if (is === null) continue // non-search / non-eligible ad_group → no row (mirrors the campaign hasData filter)
    out.push({
      date: String(r.segments.date), entityId, entityName: String(r.ad_group?.name || ''), parentId: String(r.campaign?.id || ''),
      channelType: String(r.campaign?.advertising_channel_type ?? ''),
      impressionShare: is,
      topImpressionShare: isRatio(r.metrics?.search_top_impression_share),
      absoluteTopImpressionShare: isRatio(r.metrics?.search_absolute_top_impression_share),
      lostToBudget: isRatio(r.metrics?.search_budget_lost_impression_share),
      lostToRank: isRatio(r.metrics?.search_rank_lost_impression_share),
      lostTopToBudget: isRatio(r.metrics?.search_budget_lost_top_impression_share),
      lostTopToRank: isRatio(r.metrics?.search_rank_lost_top_impression_share),
    })
  }
  return out
}
export async function fetchISDeepDay(refreshToken: string, customerId: string, captureDate: string): Promise<ISDeepRow[]> {
  return fetchISDeepWindow(refreshToken, customerId, captureDate, captureDate)
}

// One row per (ad_group, day), breakdown_value='search'; 7 ratios in extra. Idempotent (keyed by entity_id).
export function buildISDeepRows(clientId: string, userEmail: string, captureDate: string, customerId: string, dayRows: ISDeepRow[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const s of dayRows) {
    if (!s.entityId || seen.has(s.entityId)) continue
    seen.add(s.entityId)
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: 'ad_group', entity_id: s.entityId, entity_name: s.entityName, parent_entity_id: s.parentId,
      date: captureDate, breakdown_type: 'impression_share', breakdown_value: 'search',
      spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, revenue: 0,
      extra: {
        channel_type: s.channelType,
        search_impression_share: s.impressionShare,
        search_top_impression_share: s.topImpressionShare,
        search_absolute_top_impression_share: s.absoluteTopImpressionShare,
        search_budget_lost_impression_share: s.lostToBudget,
        search_rank_lost_impression_share: s.lostToRank,
        search_budget_lost_top_impression_share: s.lostTopToBudget,
        search_rank_lost_top_impression_share: s.lostTopToRank,
      },
    })
  }
  return out
}
