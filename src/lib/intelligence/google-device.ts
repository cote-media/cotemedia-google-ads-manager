// LORAMER_GOOGLE_DEVICE_CAPTURE_V1 (entity-level family — campaign + ad_group + ad + keyword)
// src/lib/intelligence/google-device.ts
//
// Shared Google device-breakdown fetch + row builder for ALL FOUR entity grains, used by forward capture
// (cron/sync, cron/catchup) AND the bounded backfill → byte-identical rows. Generalized over a grain registry
// (same shape as google-hour.ts). segments.device is selectable FROM every entity resource (verified live
// 2026-06-24): campaign / ad_group / ad_group_ad / keyword_view. (OS / OS-version / device-model are NOT served
// as performance segments — documented exception; the *_constant resources are targeting-reference lookups only.)
//
// Grain (unique under the 7-col conflict key): entity_level per grain, entity_id per grain, parent per grain,
//   breakdown_type='device', breakdown_value=<canonical device enum NAME>.
// ENCODING: device enum int (via .query()) → canonical UPPER name (MOBILE/TABLET/DESKTOP/OTHER/CONNECTED_TV);
//   unknown values kept verbatim (uppercased), never dropped. Same map at every entity level.
// RECONCILE (in the backfill writer): FLAG-NOT-BLOCK vs the per-day campaign anchor — device PARTITIONS spend at
//   every level (every cost row carries exactly one device), so Σ ties to the campaign total.
import { GoogleAdsApi } from 'google-ads-api'
import { gaqlWithRetry } from '@/lib/backfill/gaql-with-retry' // shared transient-retry primitive

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)

// Google Ads Device enum → canonical NAME. .query() yields the int code (verified "4"/"2"/"3"/"5"/"6") or a name;
// cover both, keep any unanticipated value verbatim (UPPERCASED) so a new device kind is captured, never dropped.
const DEVICE_NAME: Record<string, string> = {
  '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'MOBILE', '3': 'TABLET', '4': 'DESKTOP', '5': 'OTHER', '6': 'CONNECTED_TV',
}
export function deviceName(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return 'UNKNOWN'
  return DEVICE_NAME[s] || s.toUpperCase()
}

export interface DeviceGrain {
  entityLevel: 'campaign' | 'ad_group' | 'ad' | 'keyword'
  resource: 'campaign' | 'ad_group' | 'ad_group_ad' | 'keyword_view'
  selectIds: string
  entityId: (r: any) => string
  entityName: (r: any) => string
  parentId: (r: any, customerId: string) => string
  campaignId: (r: any) => string // for the per-day campaign-anchor reconcile
  reconcile: boolean             // true = FLAG-NOT-BLOCK vs campaign anchor (grain partitions spend);
                                 // false = write-only (grain is a SUBSET, not a partition — e.g. keyword_view)
}

// Field nesting VERIFIED live 2026-06-24 (Bath Fitter): ad_group_ad.ad.id (ad.name absent for RSAs → ''),
// ad_group_criterion.criterion_id + .keyword.text, ad_group.id / campaign.id for parents.
export const DEVICE_GRAINS: DeviceGrain[] = [
  {
    entityLevel: 'campaign', resource: 'campaign', selectIds: 'campaign.id, campaign.name',
    entityId: (r) => String(r.campaign?.id || ''), entityName: (r) => String(r.campaign?.name || ''),
    parentId: (_r, customerId) => customerId, campaignId: (r) => String(r.campaign?.id || ''), reconcile: true,
  },
  {
    entityLevel: 'ad_group', resource: 'ad_group', selectIds: 'ad_group.id, ad_group.name, campaign.id',
    entityId: (r) => String(r.ad_group?.id || ''), entityName: (r) => String(r.ad_group?.name || ''),
    parentId: (r) => String(r.campaign?.id || ''), campaignId: (r) => String(r.campaign?.id || ''), reconcile: true,
  },
  {
    entityLevel: 'ad', resource: 'ad_group_ad', selectIds: 'ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group.id, campaign.id',
    entityId: (r) => String(r.ad_group_ad?.ad?.id || ''), entityName: (r) => String(r.ad_group_ad?.ad?.name || ''),
    parentId: (r) => String(r.ad_group?.id || ''), campaignId: (r) => String(r.campaign?.id || ''), reconcile: true,
  },
  {
    // keyword_view = SEARCH-keyword SUBSET (PMax/Display/Search-partner spend isn't keyword-attributed) → NOT a
    // partition of campaign spend → WRITE-ONLY (matches the existing search_term/keyword breakdowns). Reconciling
    // it vs the campaign anchor produced false flags on every mixed account (Gate A: Veterinary 21/21 days).
    entityLevel: 'keyword', resource: 'keyword_view', selectIds: 'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group.id, campaign.id',
    entityId: (r) => String(r.ad_group_criterion?.criterion_id || ''), entityName: (r) => String(r.ad_group_criterion?.keyword?.text || ''),
    parentId: (r) => String(r.ad_group?.id || ''), campaignId: (r) => String(r.campaign?.id || ''), reconcile: false,
  },
]

export interface DeviceRow {
  date: string
  entityId: string
  entityName: string
  parentId: string
  campaignId: string
  device: string       // canonical enum NAME (mapped)
  deviceRaw: string    // raw segments.device value (diagnostic; e.g. "4")
  spend: number
  impressions: number
  clicks: number
  conversions: number
  convValue: number
}

const DEVICE_GAQL = (grain: DeviceGrain, start: string, end: string): string =>
  `SELECT ${grain.selectIds}, segments.device, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM ${grain.resource} WHERE segments.date BETWEEN '${start}' AND '${end}'`

// Windowed fetch (backfill) for one entity grain WITH segments.date. NO status filter (history posture). Rows
// without an entity id / date are dropped. Throws on a non-transient error (caller logs LOUD).
export async function fetchDeviceGrainWindow(grain: DeviceGrain, refreshToken: string, customerId: string, start: string, end: string): Promise<DeviceRow[]> {
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })
  const rows = await gaqlWithRetry(customer, DEVICE_GAQL(grain, start, end))
  const out: DeviceRow[] = []
  for (const r of rows) {
    const entityId = grain.entityId(r)
    if (!entityId || !r.segments?.date) continue
    out.push({
      date: String(r.segments.date), entityId, entityName: grain.entityName(r),
      parentId: grain.parentId(r, customerId), campaignId: grain.campaignId(r),
      device: deviceName(r.segments?.device), deviceRaw: String(r.segments?.device ?? ''),
      spend: fin(r.metrics?.cost_micros) / 1e6, impressions: fin(r.metrics?.impressions), clicks: fin(r.metrics?.clicks),
      conversions: fin(r.metrics?.conversions), convValue: fin(r.metrics?.conversions_value),
    })
  }
  return out
}

export async function fetchDeviceGrainDay(grain: DeviceGrain, refreshToken: string, customerId: string, captureDate: string): Promise<DeviceRow[]> {
  return fetchDeviceGrainWindow(grain, refreshToken, customerId, captureDate, captureDate)
}

type Agg = { entityId: string; entityName: string; parentId: string; campaignId: string; device: string; spend: number; impressions: number; clicks: number; conversions: number; convValue: number }

// Build metrics_daily rows for ONE entity grain on ONE day. AGGREGATES by (entityId, device) → idempotent; skips
// all-zero rows. breakdown_type='device', breakdown_value = canonical device name.
export function buildDeviceGrainRows(grain: DeviceGrain, clientId: string, userEmail: string, captureDate: string, customerId: string, dayRows: DeviceRow[]): Record<string, unknown>[] {
  const byKey = new Map<string, Agg>()
  for (const r of dayRows) {
    if (!r.entityId) continue
    const key = `${r.entityId}|${r.device}`
    let a = byKey.get(key)
    if (!a) { a = { entityId: r.entityId, entityName: r.entityName, parentId: r.parentId, campaignId: r.campaignId, device: r.device, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; byKey.set(key, a) }
    a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.conversions += r.conversions; a.convValue += r.convValue
  }
  const out: Record<string, unknown>[] = []
  for (const a of byKey.values()) {
    if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
    const spend = Number(a.spend.toFixed(2))
    const convValue = Number(a.convValue.toFixed(2))
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: grain.entityLevel, entity_id: a.entityId, entity_name: a.entityName,
      parent_entity_id: a.parentId, date: captureDate, breakdown_type: 'device', breakdown_value: a.device,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversion_value: convValue, revenue: 0,
      extra: {
        ctr: ratio(a.clicks, a.impressions, 100), cpc: ratio(spend, a.clicks), cpm: ratio(spend, a.impressions, 1000),
        roas: ratio(convValue, spend), cpa: ratio(spend, a.conversions), convRate: ratio(a.conversions, a.clicks, 100),
      },
    })
  }
  return out
}
