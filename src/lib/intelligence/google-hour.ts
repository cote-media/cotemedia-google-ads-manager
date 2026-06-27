// LORAMER_GOOGLE_HOUR_CAPTURE_V1
// src/lib/intelligence/google-hour.ts
//
// Shared Google hour-breakdown fetch + row builder for BOTH entity grains (campaign × hour, ad_group × hour),
// used by forward capture (cron/sync, cron/catchup) AND the bounded backfill → byte-identical rows. Mirrors
// google-device.ts, plus the ad_group entity grain.
//
// API TRUTH (verified live 2026-06-24): segments.hour + segments.day_of_week are selectable FROM campaign and
// ad_group ONLY — ad_group_ad and keyword_view REJECT them (the not-served exception; do not attempt). Hour
// PARTITIONS campaign spend (Σ hour == campaign total, verified to the cent) → the backfill reconciles
// FLAG-NOT-BLOCK vs the per-day campaign anchor, like device (NOT geo's write-only).
//
// ENCODING: breakdown_type='hour', breakdown_value = ZERO-PADDED hour "00".."23" (raw int, lexically sortable —
// NOT an enum, so the UPPER-name casing rule does NOT apply). day_of_week is CONSTANT per date (date → weekday is
// derivable) → DROPPED from the key; its NAME (MON..SUN, mapped from the DayOfWeek enum int) is stored in
// extra.day_of_week for readability only.
import { GoogleAdsApi } from 'google-ads-api'
import { gaqlWithRetry } from '@/lib/backfill/gaql-with-retry'

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)

// Google DayOfWeek enum int → short name (derived label only; date determines it). 2=MON … 8=SUN.
const DOW_NAME: Record<string, string> = { '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'MON', '3': 'TUE', '4': 'WED', '5': 'THU', '6': 'FRI', '7': 'SAT', '8': 'SUN' }
const dowName = (raw: any): string => { const s = String(raw ?? '').trim(); return s ? (DOW_NAME[s] || s.toUpperCase()) : '' }
// hour int 0-23 → zero-padded 2-digit string for lexical sort. '' if not a finite hour.
const pad2 = (h: any): string => { const n = Number(h); return Number.isFinite(n) ? String(Math.trunc(n)).padStart(2, '0') : '' }

export interface HourGrain {
  entityLevel: 'campaign' | 'ad_group'
  resource: 'campaign' | 'ad_group'
  selectIds: string
  entityId: (r: any) => string
  entityName: (r: any) => string
  parentId: (r: any, customerId: string) => string
  campaignId: (r: any) => string // for the per-day campaign-anchor reconcile
}

export const HOUR_GRAINS: HourGrain[] = [
  {
    entityLevel: 'campaign', resource: 'campaign', selectIds: 'campaign.id, campaign.name',
    entityId: (r) => String(r.campaign?.id || ''), entityName: (r) => String(r.campaign?.name || ''),
    parentId: (_r, customerId) => customerId, campaignId: (r) => String(r.campaign?.id || ''),
  },
  {
    entityLevel: 'ad_group', resource: 'ad_group', selectIds: 'ad_group.id, ad_group.name, campaign.id',
    entityId: (r) => String(r.ad_group?.id || ''), entityName: (r) => String(r.ad_group?.name || ''),
    parentId: (r) => String(r.campaign?.id || ''), campaignId: (r) => String(r.campaign?.id || ''),
  },
]

export interface HourRow {
  date: string
  entityId: string
  entityName: string
  parentId: string
  campaignId: string
  hour: string // zero-padded "00".."23"
  dow: string  // MON..SUN (derived label)
  spend: number
  impressions: number
  clicks: number
  conversions: number
  convValue: number
}

const HOUR_GAQL = (grain: HourGrain, start: string, end: string): string =>
  `SELECT ${grain.selectIds}, segments.hour, segments.day_of_week, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM ${grain.resource} WHERE segments.date BETWEEN '${start}' AND '${end}'`

// Windowed fetch (backfill) for one entity grain WITH segments.date. NO status filter (history posture). Rows
// without an entity id / date / hour are dropped. Throws on a non-transient error (caller logs LOUD).
export async function fetchHourGrainWindow(grain: HourGrain, refreshToken: string, customerId: string, start: string, end: string): Promise<HourRow[]> {
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })
  const rows = await gaqlWithRetry(customer, HOUR_GAQL(grain, start, end))
  const out: HourRow[] = []
  for (const r of rows) {
    const entityId = grain.entityId(r)
    if (!entityId || !r.segments?.date) continue
    const hour = pad2(r.segments?.hour)
    if (hour === '') continue
    out.push({
      date: String(r.segments.date), entityId, entityName: grain.entityName(r),
      parentId: grain.parentId(r, customerId), campaignId: grain.campaignId(r),
      hour, dow: dowName(r.segments?.day_of_week),
      spend: fin(r.metrics?.cost_micros) / 1e6, impressions: fin(r.metrics?.impressions), clicks: fin(r.metrics?.clicks),
      conversions: fin(r.metrics?.conversions), convValue: fin(r.metrics?.conversions_value),
    })
  }
  return out
}

export async function fetchHourGrainDay(grain: HourGrain, refreshToken: string, customerId: string, captureDate: string): Promise<HourRow[]> {
  return fetchHourGrainWindow(grain, refreshToken, customerId, captureDate, captureDate)
}

type Agg = { entityId: string; entityName: string; parentId: string; campaignId: string; hour: string; dow: string; spend: number; impressions: number; clicks: number; conversions: number; convValue: number }

// Build metrics_daily rows for ONE entity grain on ONE day. AGGREGATES by (entityId, hour) → idempotent; skips
// all-zero rows. breakdown_value = zero-padded hour; extra.day_of_week = derived weekday name.
export function buildHourGrainRows(grain: HourGrain, clientId: string, userEmail: string, captureDate: string, customerId: string, dayRows: HourRow[]): Record<string, unknown>[] {
  const byKey = new Map<string, Agg>()
  for (const r of dayRows) {
    if (!r.entityId || r.hour === '') continue
    const key = `${r.entityId}|${r.hour}`
    let a = byKey.get(key)
    if (!a) { a = { entityId: r.entityId, entityName: r.entityName, parentId: r.parentId, campaignId: r.campaignId, hour: r.hour, dow: r.dow, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; byKey.set(key, a) }
    a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.conversions += r.conversions; a.convValue += r.convValue
    if (!a.dow && r.dow) a.dow = r.dow
  }
  const out: Record<string, unknown>[] = []
  for (const a of byKey.values()) {
    if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
    const spend = Number(a.spend.toFixed(2))
    const convValue = Number(a.convValue.toFixed(2))
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: grain.entityLevel, entity_id: a.entityId, entity_name: a.entityName,
      parent_entity_id: a.parentId, date: captureDate, breakdown_type: 'hour', breakdown_value: a.hour,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversion_value: convValue, revenue: 0,
      extra: {
        day_of_week: a.dow,
        ctr: ratio(a.clicks, a.impressions, 100), cpc: ratio(spend, a.clicks), cpm: ratio(spend, a.impressions, 1000),
        roas: ratio(convValue, spend), cpa: ratio(spend, a.conversions), convRate: ratio(a.conversions, a.clicks, 100),
      },
    })
  }
  return out
}
