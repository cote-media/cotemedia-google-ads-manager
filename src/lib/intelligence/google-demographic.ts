// LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 (G-FILL#3 — age + gender PERSIST)
// src/lib/intelligence/google-demographic.ts
//
// Shared Google demographic-breakdown fetch + row builder for BOTH entity grains (campaign, ad_group), used by
// forward capture (cron/sync, cron/catchup) AND the bounded backfill → byte-identical rows. Mirrors
// google-hour.ts (campaign + ad_group). Closes G3: fetchGoogleIntelligence ALREADY queried age_range_view +
// gender_view live for the Lora prompt (google-intelligence.ts ~L418/431) and DROPPED the result — zero rows ever
// landed. This persists them as their own breakdown_types.
//
// API TRUTH: age_range_view / gender_view are AD-GROUP-CRITERION views — each row is one (ad_group, age|gender
// bucket) with campaign.id + ad_group.id exposed. So the two grains Google serves are campaign + ad_group (like
// hour); ad and keyword are NOT served (criteria live at ad_group). BOTH grains come from ONE view query, so we
// fetch a dimension's view ONCE per window and build BOTH grains from the same rows (quota-minimal — the Basic
// 15k/day cap is a live constraint; do not query the same view twice).
//
// Grain (unique under the 7-col conflict key): entity_level per grain, entity_id per grain, parent per grain,
//   breakdown_type='age'|'gender', breakdown_value = raw Google enum NAME (verbatim upper — the "raw" encoding
//   the breakdown registry declares: AGE_RANGE_18_24 / MALE / FEMALE / AGE_RANGE_UNDETERMINED / UNDETERMINED).
// RECONCILE (in the backfill writer): FLAG-NOT-BLOCK vs the per-day campaign anchor — a demographic bucket
//   PARTITIONS a demographics-reporting campaign's spend (every impression maps to one bucket incl UNDETERMINED),
//   so Σ ties to the campaign total for the campaigns present. PMax has no age/gender criteria → those campaigns
//   never appear in the view AND are excluded from the anchor sum (anchor summed only over campaigns present,
//   exactly like google-device). A campaign whose demographic coverage < its total → an honest flag, never dropped.
import { GoogleAdsApi } from 'google-ads-api'
import { gaqlWithRetry } from '@/lib/backfill/gaql-with-retry' // shared transient-retry primitive (auto-paginates)

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)

// breakdown_value = CANONICAL Google enum NAME (AGE_RANGE_18_24 / MALE / FEMALE / UNDETERMINED). GATE-A FINDING
// (Bath Fitter 2026-07-13..17): customer.query() returns ad_group_criterion.age_range.type / .gender.type as the
// numeric CRITERION-CONSTANT ID ("503001".."503999" for age; "10"/"11"/"20" for gender) — NOT the enum name (the
// SDK path differs from the Lora AGE_LABEL_MAP path). Storing the opaque id would violate the registry's
// "MAPPED ENUM → canonical name" rule and defeat G-FILL#3's readability goal. So we MAP id → canonical enum name
// (mirrors google-device's int→NAME), pass through a value that already IS the enum name, and keep any
// unanticipated value verbatim (UPPER) so nothing is ever dropped. The untouched source is kept as valueRaw.
const AGE_ID_TO_ENUM: Record<string, string> = {
  '503001': 'AGE_RANGE_18_24', '503002': 'AGE_RANGE_25_34', '503003': 'AGE_RANGE_35_44',
  '503004': 'AGE_RANGE_45_54', '503005': 'AGE_RANGE_55_64', '503006': 'AGE_RANGE_65_UP',
  '503999': 'AGE_RANGE_UNDETERMINED',
}
const GENDER_ID_TO_ENUM: Record<string, string> = { '10': 'MALE', '11': 'FEMALE', '20': 'UNDETERMINED' }
// Values that are ALREADY canonical enum names → pass through (uppercased) unchanged.
const ENUM_PASSTHROUGH = new Set(['MALE', 'FEMALE', 'UNDETERMINED', 'UNKNOWN', 'UNSPECIFIED'])

export function canonicalDemoValue(dim: DemoDimension, raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return 'UNKNOWN'
  const up = s.toUpperCase()
  if (up.startsWith('AGE_RANGE_') || ENUM_PASSTHROUGH.has(up)) return up // already the enum name
  if (dim.idMap[s]) return dim.idMap[s]                                  // criterion-constant id → enum name
  return up                                                             // unanticipated → verbatim, never dropped
}

export type DemoDimensionKey = 'age' | 'gender'

export interface DemoDimension {
  dimension: DemoDimensionKey
  breakdownType: 'age' | 'gender'
  resource: 'age_range_view' | 'gender_view'
  criterionSelect: string       // GAQL select for the criterion type field
  typeOf: (r: any) => any        // extract the raw type off a returned row (id OR enum name)
  idMap: Record<string, string>  // criterion-constant id → canonical enum name
}

export const DEMO_DIMENSIONS: DemoDimension[] = [
  { dimension: 'age', breakdownType: 'age', resource: 'age_range_view', criterionSelect: 'ad_group_criterion.age_range.type', typeOf: (r) => r.ad_group_criterion?.age_range?.type, idMap: AGE_ID_TO_ENUM },
  { dimension: 'gender', breakdownType: 'gender', resource: 'gender_view', criterionSelect: 'ad_group_criterion.gender.type', typeOf: (r) => r.ad_group_criterion?.gender?.type, idMap: GENDER_ID_TO_ENUM },
]
export const DEMO_DIMENSION_BY_KEY: Record<DemoDimensionKey, DemoDimension> =
  Object.fromEntries(DEMO_DIMENSIONS.map((d) => [d.dimension, d])) as Record<DemoDimensionKey, DemoDimension>

export interface DemographicRow {
  date: string
  campaignId: string
  campaignName: string
  adGroupId: string
  adGroupName: string
  value: string        // canonical breakdown_value (raw enum name)
  valueRaw: string     // diagnostic (the untouched source value)
  spend: number
  impressions: number
  clicks: number
  conversions: number
  convValue: number
}

// Both grains (campaign, ad_group) read off the SAME fetched DemographicRow — closures pick the right ids.
export interface DemoGrain {
  entityLevel: 'campaign' | 'ad_group'
  entityId: (r: DemographicRow) => string
  entityName: (r: DemographicRow) => string
  parentId: (r: DemographicRow, customerId: string) => string
  campaignId: (r: DemographicRow) => string // for the per-day campaign-anchor reconcile
}

export const DEMO_GRAINS: DemoGrain[] = [
  {
    entityLevel: 'campaign',
    entityId: (r) => r.campaignId, entityName: (r) => r.campaignName,
    parentId: (_r, customerId) => customerId, campaignId: (r) => r.campaignId,
  },
  {
    entityLevel: 'ad_group',
    entityId: (r) => r.adGroupId, entityName: (r) => r.adGroupName,
    parentId: (r) => r.campaignId, campaignId: (r) => r.campaignId,
  },
]

const DEMO_GAQL = (dim: DemoDimension, start: string, end: string): string =>
  `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ${dim.criterionSelect}, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM ${dim.resource} WHERE segments.date BETWEEN '${start}' AND '${end}'`

// Windowed fetch (ONE view = both grains). NO status / cost filter (history posture, mirrors device/hour — the
// builder skips all-zero rows, so impression-only demographic rows are still captured as legit activity). Rows
// without a campaign id or date are dropped. Throws on a non-transient error (caller logs LOUD).
export async function fetchDemographicWindow(dim: DemoDimension, refreshToken: string, customerId: string, start: string, end: string): Promise<DemographicRow[]> {
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })
  const rows = await gaqlWithRetry(customer, DEMO_GAQL(dim, start, end))
  const out: DemographicRow[] = []
  for (const r of rows) {
    const campaignId = String(r.campaign?.id || '')
    if (!campaignId || !r.segments?.date) continue
    const rawType = dim.typeOf(r)
    out.push({
      date: String(r.segments.date), campaignId, campaignName: String(r.campaign?.name || ''),
      adGroupId: String(r.ad_group?.id || ''), adGroupName: String(r.ad_group?.name || ''),
      value: canonicalDemoValue(dim, rawType), valueRaw: String(rawType ?? ''),
      spend: fin(r.metrics?.cost_micros) / 1e6, impressions: fin(r.metrics?.impressions), clicks: fin(r.metrics?.clicks),
      conversions: fin(r.metrics?.conversions), convValue: fin(r.metrics?.conversions_value),
    })
  }
  return out
}

export async function fetchDemographicDay(dim: DemoDimension, refreshToken: string, customerId: string, captureDate: string): Promise<DemographicRow[]> {
  return fetchDemographicWindow(dim, refreshToken, customerId, captureDate, captureDate)
}

type Agg = { entityId: string; entityName: string; parentId: string; campaignId: string; value: string; spend: number; impressions: number; clicks: number; conversions: number; convValue: number }

// Build metrics_daily rows for ONE dimension × ONE entity grain on ONE day, from the shared day rows. AGGREGATES
// by (entityId, value) → idempotent; skips all-zero rows. breakdown_type = dim.breakdownType, breakdown_value =
// raw enum name. Extra = the same derived ratios device/hour carry (byte-identical shape).
export function buildDemographicGrainRows(dim: DemoDimension, grain: DemoGrain, clientId: string, userEmail: string, captureDate: string, customerId: string, dayRows: DemographicRow[]): Record<string, unknown>[] {
  const byKey = new Map<string, Agg>()
  for (const r of dayRows) {
    const entityId = grain.entityId(r)
    if (!entityId) continue
    const key = `${entityId}|${r.value}`
    let a = byKey.get(key)
    if (!a) { a = { entityId, entityName: grain.entityName(r), parentId: grain.parentId(r, customerId), campaignId: grain.campaignId(r), value: r.value, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; byKey.set(key, a) }
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
      parent_entity_id: a.parentId, date: captureDate, breakdown_type: dim.breakdownType, breakdown_value: a.value,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversion_value: convValue, revenue: 0,
      extra: {
        ctr: ratio(a.clicks, a.impressions, 100), cpc: ratio(spend, a.clicks), cpm: ratio(spend, a.impressions, 1000),
        roas: ratio(convValue, spend), cpa: ratio(spend, a.conversions), convRate: ratio(a.conversions, a.clicks, 100),
      },
    })
  }
  return out
}
