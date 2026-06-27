// LORAMER_GOOGLE_GEO_CAPTURE_V1 (full grain family — rebuilt, not layered)
// src/lib/intelligence/google-geo.ts
//
// Shared Google geo-breakdown fetch + row builder for the FULL geo grain family, used by BOTH forward capture
// (cron/sync, cron/catchup) AND the bounded backfill (src/lib/backfill/google-geo-backfill.ts) → byte-identical
// rows (universal pattern). Mirrors the device/geo trio shape but generalized over a GRAIN REGISTRY.
//
// GRAIN TRUTH (verified live 2026-06-27): geo is a FAMILY, captured per-grain across TWO resources:
//   • geographic_view  (targeted / area-of-interest + presence) — every grain ALSO carries location_type.
//       grains: geo_city, geo_metro, geo_region, geo_state, geo_province, geo_county, geo_district,
//               geo_postal, geo_most_specific  (via segments.geo_target_*)  + geo_country (country_criterion_id)
//   • user_location_view (PHYSICAL location; NO location_type) — different ids than geographic_view.
//       grains: user_geo_city, user_geo_metro, user_geo_region, user_geo_state, user_geo_province,
//               user_geo_county, user_geo_district, user_geo_postal, user_geo_most_specific
//   (user_geo_country is NOT served — geo_target_country is not selectable on user_location_view and there is no
//    country field there; the ONLY acceptable omission = the platform genuinely doesn't serve it. Excluded.)
//
// WHY PER-GRAIN QUERIES (not co-select): co-selecting segments returns the INTERSECTION (rows where every
// selected grain is populated) — verified: all-9 co-select = 0 rows (province/district zero-out everything);
// city+region = 35 = city-alone (finest annotated with parent), NOT region-alone (30). So a complete per-grain
// capture REQUIRES one query per grain. Cost: 10 (geographic_view) + 9 (user_location_view) = 19 queries/client.
//
// ENCODING:
//   • breakdown_value = "geoTargetConstants/<id>" VERBATIM (segments already return that resource-name form;
//     country_criterion_id returns a bare id → normalized to the same form so the whole family is one encoding).
//     RAW opaque id — name resolution DEFERRED (additive later layer; ids stable, no recapture; gates Lora-queryable).
//   • geographic_view grains append ":<LOCATION_TYPE_UPPER>" (enum int → UPPER name per the registry casing rule:
//     2→AREA_OF_INTEREST, 3→LOCATION_OF_PRESENCE, 1→UNKNOWN, 0→UNSPECIFIED). user_location_view grains: NO suffix.
//   • RECONCILE = NONE (write-only): location_type overlap + multi-grain make geo non-partitioning (like
//     search_term/keyword); conversions never gate.
import { GoogleAdsApi } from 'google-ads-api'
import { gaqlWithRetry } from '@/lib/backfill/gaql-with-retry' // shared transient-retry primitive

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)

const LOCATION_TYPE: Record<string, string> = { '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'AREA_OF_INTEREST', '3': 'LOCATION_OF_PRESENCE' }
const locType = (raw: any): string => { const s = String(raw ?? '').trim(); return s ? (LOCATION_TYPE[s] || s.toUpperCase()) : 'UNSPECIFIED' }
// Normalize to "geoTargetConstants/<id>": segments already return that; country_criterion_id returns a bare id.
const geoConst = (raw: any): string => { const s = String(raw ?? '').trim(); return !s ? '' : s.startsWith('geoTargetConstants/') ? s : `geoTargetConstants/${s}` }

export interface GeoGrain {
  breakdownType: string                       // e.g. 'geo_city' | 'user_geo_region' | 'geo_country'
  resource: 'geographic_view' | 'user_location_view'
  select: string                              // GAQL field, e.g. 'segments.geo_target_city'
  extract: (r: any) => any                    // pull the raw geo value from a result row
  hasLocationType: boolean                    // geographic_view grains carry location_type
}

// (snake segment field, short breakdown suffix). The google-ads-api lib returns SNAKE_CASE result keys
// (r.segments.geo_target_city, like r.metrics.cost_micros) — extract via the snake key, NOT camelCase.
const SEGMENTS: Array<[string, string]> = [
  ['city', 'city'],
  ['metro', 'metro'],
  ['region', 'region'],
  ['state', 'state'],
  ['province', 'province'],
  ['county', 'county'],
  ['district', 'district'],
  ['postal_code', 'postal'],
  ['most_specific_location', 'most_specific'],
]

export const GEOGRAPHIC_GRAINS: GeoGrain[] = [
  ...SEGMENTS.map(([snake, short]): GeoGrain => ({
    breakdownType: `geo_${short}`, resource: 'geographic_view', select: `segments.geo_target_${snake}`,
    extract: (r) => r.segments?.[`geo_target_${snake}`], hasLocationType: true,
  })),
  { breakdownType: 'geo_country', resource: 'geographic_view', select: 'geographic_view.country_criterion_id', extract: (r) => r.geographic_view?.country_criterion_id, hasLocationType: true },
]

export const USER_GRAINS: GeoGrain[] = SEGMENTS.map(([snake, short]): GeoGrain => ({
  breakdownType: `user_geo_${short}`, resource: 'user_location_view', select: `segments.geo_target_${snake}`,
  extract: (r) => r.segments?.[`geo_target_${snake}`], hasLocationType: false,
}))

export interface GeoRow {
  date: string
  campaignId: string
  campaignName: string
  value: string        // normalized "geoTargetConstants/<id>"
  locationType: string // UPPER name for geographic_view grains, '' for user_location_view
  spend: number
  impressions: number
  clicks: number
  conversions: number
  convValue: number
}

// One grain over [startDate,endDate] WITH segments.date. NO status filter, NO LIMIT (capture all). Throws on a
// non-transient error (caller logs LOUD). Rows without a campaign id / date / geo value are dropped.
export async function fetchGeoGrainWindow(
  grain: GeoGrain, refreshToken: string, customerId: string, startDate: string, endDate: string
): Promise<GeoRow[]> {
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })
  const lt = grain.hasLocationType ? ', geographic_view.location_type' : ''
  const gaql = `SELECT campaign.id, campaign.name, ${grain.select}${lt}, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM ${grain.resource} WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`
  const rows = await gaqlWithRetry(customer, gaql)
  const out: GeoRow[] = []
  for (const r of rows) {
    if (!r.campaign?.id || !r.segments?.date) continue
    const value = geoConst(grain.extract(r))
    if (!value) continue
    out.push({
      date: String(r.segments.date), campaignId: String(r.campaign.id), campaignName: String(r.campaign?.name || ''),
      value, locationType: grain.hasLocationType ? locType(r.geographic_view?.location_type) : '',
      spend: fin(r.metrics?.cost_micros) / 1e6, impressions: fin(r.metrics?.impressions), clicks: fin(r.metrics?.clicks),
      conversions: fin(r.metrics?.conversions), convValue: fin(r.metrics?.conversions_value),
    })
  }
  return out
}

export async function fetchGeoGrainDay(grain: GeoGrain, refreshToken: string, customerId: string, captureDate: string): Promise<GeoRow[]> {
  return fetchGeoGrainWindow(grain, refreshToken, customerId, captureDate, captureDate)
}

type Agg = { value: string; locationType: string; campaignId: string; campaignName: string; spend: number; impressions: number; clicks: number; conversions: number; convValue: number }

// Build metrics_daily rows for ONE grain on ONE day. AGGREGATES by (campaignId, value, locationType) →
// idempotent; skips all-zero rows. breakdown_value = value[:LOCATION_TYPE for geographic_view grains]. NO reconcile.
export function buildGeoGrainRows(
  grain: GeoGrain, clientId: string, userEmail: string, captureDate: string, customerId: string, dayRows: GeoRow[]
): Record<string, unknown>[] {
  const byKey = new Map<string, Agg>()
  for (const r of dayRows) {
    if (!r.campaignId || !r.value) continue
    const key = `${r.campaignId}|${r.value}|${r.locationType}`
    let a = byKey.get(key)
    if (!a) { a = { value: r.value, locationType: r.locationType, campaignId: r.campaignId, campaignName: r.campaignName, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; byKey.set(key, a) }
    a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.conversions += r.conversions; a.convValue += r.convValue
  }
  const out: Record<string, unknown>[] = []
  for (const a of byKey.values()) {
    if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
    const spend = Number(a.spend.toFixed(2))
    const convValue = Number(a.convValue.toFixed(2))
    const breakdownValue = grain.hasLocationType ? `${a.value}:${a.locationType}` : a.value
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: 'campaign', entity_id: a.campaignId, entity_name: a.campaignName,
      parent_entity_id: customerId, date: captureDate, breakdown_type: grain.breakdownType, breakdown_value: breakdownValue,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversion_value: convValue, revenue: 0,
      extra: {
        ctr: ratio(a.clicks, a.impressions, 100), cpc: ratio(spend, a.clicks), cpm: ratio(spend, a.impressions, 1000),
        roas: ratio(convValue, spend), cpa: ratio(spend, a.conversions), convRate: ratio(a.conversions, a.clicks, 100),
      },
    })
  }
  return out
}
