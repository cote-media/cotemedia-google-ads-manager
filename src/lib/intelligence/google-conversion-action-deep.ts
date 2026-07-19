// LORAMER_GOOGLE_CONV_ACTION_DEEP_V1 (G-FILL#9) — conversion_action at the DEEPER grains: ad_group + keyword.
// The campaign grain rides fetchGoogleIntelligence (intel.conversionsByCampaign, ZERO new call). ad_group + keyword
// are NOT in that payload → a NEW GAQL per grain (segments.conversion_action_* FROM ad_group / keyword_view), mirroring
// the campaign query's fields + WRITE-ONLY posture exactly. Shared fetch+builder for forward (cron/sync + catchup).
//
// ⚠ GAQL UNVERIFIED-AGAINST-LIVE-API: authored 2026-07-18 with Google read-quota EXHAUSTED (reset 07-19 ~04:03 ET).
// The field set + resources mirror the proven campaign query + the device/keyword-view patterns; live Gate-A at the
// reset confirms (a rejection at keyword_view = the not-served exception → drop that grain + correct the registry).
//
// ENCODING: entity_level='ad_group'|'keyword', breakdown_type='conversion_action', breakdown_value=<action NAME>;
//   per-action conversions + conversion_value in the count columns; category NAME in extra (decoded once, shared with
//   the campaign writer). spend/impressions/clicks = 0 (the segment carries no cost). WRITE-ONLY / no reconcile —
//   per-action conversions do NOT sum to any total (multi-action attribution), a conversion breakdown, not a partition.
import { GoogleAdsApi } from 'google-ads-api'
import { gaqlWithRetry } from '@/lib/backfill/gaql-with-retry'
import { decodeCategoryName } from './google-conversion-action' // reuse the ONE category decode

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }

export interface ConvDeepGrain {
  entityLevel: 'ad_group' | 'keyword'
  resource: 'ad_group' | 'keyword_view'
  selectIds: string
  statusFilter: string
  entityId: (r: any) => string
  entityName: (r: any) => string
  parentId: (r: any) => string
}
export const CONV_DEEP_GRAINS: ConvDeepGrain[] = [
  {
    entityLevel: 'ad_group', resource: 'ad_group', selectIds: 'ad_group.id, ad_group.name, campaign.id',
    statusFilter: " AND ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'",
    entityId: (r) => String(r.ad_group?.id || ''), entityName: (r) => String(r.ad_group?.name || ''), parentId: (r) => String(r.campaign?.id || ''),
  },
  {
    entityLevel: 'keyword', resource: 'keyword_view', selectIds: 'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group.id, campaign.id',
    statusFilter: '',
    entityId: (r) => String(r.ad_group_criterion?.criterion_id || ''), entityName: (r) => String(r.ad_group_criterion?.keyword?.text || ''), parentId: (r) => String(r.ad_group?.id || ''),
  },
]

export interface ConvDeepRow { date: string; entityId: string; entityName: string; parentId: string; actionName: string; category: string; conversions: number; value: number }

const CONV_DEEP_GAQL = (grain: ConvDeepGrain, start: string, end: string): string =>
  `SELECT ${grain.selectIds}, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.conversions_value, segments.date FROM ${grain.resource} WHERE segments.date BETWEEN '${start}' AND '${end}'${grain.statusFilter} AND metrics.conversions > 0`

export async function fetchConvDeepGrainWindow(grain: ConvDeepGrain, refreshToken: string, customerId: string, start: string, end: string): Promise<ConvDeepRow[]> {
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })
  const rows = await gaqlWithRetry(customer, CONV_DEEP_GAQL(grain, start, end))
  const out: ConvDeepRow[] = []
  for (const r of rows) {
    const entityId = grain.entityId(r)
    const actionName = String(r.segments?.conversion_action_name || '')
    if (!entityId || !actionName || !r.segments?.date) continue
    out.push({
      date: String(r.segments.date), entityId, entityName: grain.entityName(r), parentId: grain.parentId(r),
      actionName, category: String(r.segments?.conversion_action_category ?? ''),
      conversions: fin(r.metrics?.conversions), value: fin(r.metrics?.conversions_value),
    })
  }
  return out
}
export async function fetchConvDeepGrainDay(grain: ConvDeepGrain, refreshToken: string, customerId: string, captureDate: string): Promise<ConvDeepRow[]> {
  return fetchConvDeepGrainWindow(grain, refreshToken, customerId, captureDate, captureDate)
}

type Agg = { entityId: string; entityName: string; parentId: string; actionName: string; category: string; conversions: number; value: number }

// Build metrics_daily rows for ONE grain on ONE day. AGGREGATE by (entityId, actionName) → idempotent; skip zero.
export function buildConvDeepGrainRows(grain: ConvDeepGrain, clientId: string, userEmail: string, captureDate: string, customerId: string, dayRows: ConvDeepRow[]): Record<string, unknown>[] {
  const byKey = new Map<string, Agg>()
  for (const r of dayRows) {
    if (!r.entityId || !r.actionName) continue
    const key = `${r.entityId}|${r.actionName}`
    let a = byKey.get(key)
    if (!a) { a = { entityId: r.entityId, entityName: r.entityName, parentId: r.parentId, actionName: r.actionName, category: r.category, conversions: 0, value: 0 }; byKey.set(key, a) }
    a.conversions += r.conversions; a.value += r.value
  }
  const out: Record<string, unknown>[] = []
  for (const a of byKey.values()) {
    if (a.conversions === 0 && a.value === 0) continue
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: grain.entityLevel, entity_id: a.entityId, entity_name: a.entityName, parent_entity_id: a.parentId,
      date: captureDate, breakdown_type: 'conversion_action', breakdown_value: a.actionName,
      spend: 0, impressions: 0, clicks: 0,
      conversions: Number(a.conversions.toFixed(2)), conversion_value: Number(a.value.toFixed(2)), revenue: 0,
      extra: { conversion_action_category: a.category, conversion_action_category_name: decodeCategoryName(a.category) },
    })
  }
  return out
}
