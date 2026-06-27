// LORAMER_GOOGLE_DEVICE_CAPTURE_V1
// src/lib/intelligence/google-device.ts
//
// Shared Google device-breakdown fetch + row builder, used by BOTH forward capture (cron/sync, cron/catchup)
// AND the bounded backfill (src/lib/backfill/google-device-backfill.ts) — so forward and backfill write
// BYTE-IDENTICAL rows (the universal backfill pattern). Mirrors src/lib/intelligence/google-dimensional.ts's
// fetch / window / build trio. Extracted (ZERO behavior change) from the original inline writer.
//
// Grain (unique under the metrics_daily conflict key client_id,platform,entity_level,entity_id,date,
//   breakdown_type,breakdown_value): entity_level='campaign', entity_id=campaign.id, parent=customerId,
//   breakdown_type='device', breakdown_value=<canonical device enum NAME>. Rows are AGGREGATED by
//   (campaignId, device) per day so the conflict key is unique and re-runs are idempotent; all-zero-activity
//   rows are skipped (pure noise). The RECONCILE (Σ device vs the per-day campaign anchor) lives in the
//   BACKFILL writer, NOT here — this module owns ONLY fetch + build.
import { GoogleAdsApi } from 'google-ads-api'
import { gaqlWithRetry } from '@/lib/backfill/gaql-with-retry' // shared transient-retry primitive (same policy the writer used)

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)

// Google Ads Device enum → canonical NAME. .query() yields the int code (verified Gate A: "4"/"2"/"3") or a
// name; cover both, keep any unanticipated value verbatim (UPPERCASED) so a new device kind is captured, never
// dropped. Mapped-enum casing convention = UPPER (matches MATCH_TYPE/STATUS); Title-case is prompt-only.
const DEVICE_NAME: Record<string, string> = {
  '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'MOBILE', '3': 'TABLET', '4': 'DESKTOP', '5': 'OTHER', '6': 'CONNECTED_TV',
}
export function deviceName(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return 'UNKNOWN'
  return DEVICE_NAME[s] || s.toUpperCase()
}

export interface GoogleDeviceRow {
  date: string
  campaignId: string
  campaignName: string
  device: string       // canonical enum NAME (mapped)
  deviceRaw: string    // the raw segments.device value (diagnostic; e.g. "4")
  spend: number
  impressions: number
  clicks: number
  conversions: number
  convValue: number
}

const DEVICE_GAQL = (startDate: string, endDate: string): string =>
  `SELECT campaign.id, campaign.name, segments.device, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`

function mapRow(r: any): GoogleDeviceRow {
  return {
    date: String(r.segments?.date || ''),
    campaignId: String(r.campaign?.id || ''),
    campaignName: String(r.campaign?.name || ''),
    device: deviceName(r.segments?.device),
    deviceRaw: String(r.segments?.device ?? ''),
    spend: fin(r.metrics?.cost_micros) / 1e6,
    impressions: fin(r.metrics?.impressions),
    clicks: fin(r.metrics?.clicks),
    conversions: fin(r.metrics?.conversions),
    convValue: fin(r.metrics?.conversions_value),
  }
}

// Windowed fetch (backfill): one GAQL over [startDate,endDate] WITH segments.date, FROM campaign. NO status
// filter — a since-REMOVED campaign still had real historical spend (history posture; the LIVE query filters
// REMOVED, a backfill must not, so its Σ matches the no-filter campaign anchor). Rows without a campaign id are
// dropped (no stable entity_id). Throws on a non-transient error (caller logs LOUD).
export async function fetchGoogleDeviceWindow(
  refreshToken: string, customerId: string, startDate: string, endDate: string
): Promise<GoogleDeviceRow[]> {
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })
  const rows = await gaqlWithRetry(customer, DEVICE_GAQL(startDate, endDate))
  return rows.filter((r: any) => r.campaign?.id && r.segments?.date).map(mapRow)
}

// Per-day fetch (forward capture): a single captureDate. Same field list / shape / posture as the window.
export async function fetchGoogleDeviceDay(
  refreshToken: string, customerId: string, captureDate: string
): Promise<GoogleDeviceRow[]> {
  return fetchGoogleDeviceWindow(refreshToken, customerId, captureDate, captureDate)
}

type DeviceAgg = { campaignId: string; campaignName: string; device: string; spend: number; impressions: number; clicks: number; conversions: number; convValue: number }

// Build metrics_daily breakdown rows for ONE day's device rows. AGGREGATES by (campaignId, device) → idempotent
// under the conflict key; skips all-zero-activity rows. Byte-identical to the original inline builder.
export function buildGoogleDeviceRows(
  clientId: string, userEmail: string, captureDate: string, customerId: string, dayRows: GoogleDeviceRow[]
): Record<string, unknown>[] {
  const byKey = new Map<string, DeviceAgg>()
  for (const r of dayRows) {
    if (!r.campaignId) continue
    const key = `${r.campaignId}|${r.device}`
    let a = byKey.get(key)
    if (!a) { a = { campaignId: r.campaignId, campaignName: r.campaignName, device: r.device, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; byKey.set(key, a) }
    a.spend += r.spend; a.impressions += r.impressions; a.clicks += r.clicks; a.conversions += r.conversions; a.convValue += r.convValue
  }
  const out: Record<string, unknown>[] = []
  for (const a of byKey.values()) {
    if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
    const spend = Number(a.spend.toFixed(2))
    const convValue = Number(a.convValue.toFixed(2))
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: 'campaign', entity_id: a.campaignId, entity_name: a.campaignName,
      parent_entity_id: customerId, date: captureDate, breakdown_type: 'device', breakdown_value: a.device,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversion_value: convValue, revenue: 0,
      extra: {
        ctr: ratio(a.clicks, a.impressions, 100), cpc: ratio(spend, a.clicks), cpm: ratio(spend, a.impressions, 1000),
        roas: ratio(convValue, spend), cpa: ratio(spend, a.conversions), convRate: ratio(a.conversions, a.clicks, 100),
      },
    })
  }
  return out
}
