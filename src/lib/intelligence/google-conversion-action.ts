// LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1 (T0.1) — forward-persist the conversion-action segmentation that
// fetchGoogleIntelligence ALREADY returns (intel.conversionsByCampaign = one row per (campaign × conversion_action)).
// ZERO new Google call: this RIDES the existing live-intel GAQL (google-intelligence.ts convByCampaignRows —
// SELECT campaign.id, segments.conversion_action_name/_category, metrics.conversions/_value FROM campaign,
// conversions>0, LIMIT 200). That payload is fetched on every forward capture for the Lora prompt and was
// otherwise DROPPED; here we persist it. HISTORY backfill of this dim = T2.3 (quota-gated), NOT this writer.
//
// ENCODING (unique under the 7-col conflict key): entity_level='campaign', entity_id=campaignId,
//   breakdown_type='conversion_action', breakdown_value=<conversion action NAME>; per-action conversions +
//   conversion_value in the count columns; category in extra. spend/impressions/clicks = 0 — Google's
//   conversion_action segment does NOT carry cost (only metrics.conversions/_value were selected).
// RECONCILE = WRITE-ONLY / FLAG-NOT-BLOCK: per-action conversions do NOT sum to the campaign total
//   (multi-action attribution double-counts by design) — a conversion breakdown, NOT a partition of spend.
// CAP: inherits the live query's LIMIT 200 (top actions by conversions) — a logged, deliberate noise cap.
// Idempotent: aggregates by (campaignId, actionName); skips zero-conversion rows.
import type { IntelligenceConversionByCampaign } from './intelligence-types'

type Agg = { campaignId: string; campaignName: string; actionName: string; category: string; conversions: number; value: number }

export function buildGoogleConversionActionRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  customerId: string,
  conversionsByCampaign?: IntelligenceConversionByCampaign[]
): Record<string, unknown>[] {
  const byKey = new Map<string, Agg>()
  for (const c of conversionsByCampaign || []) {
    const campaignId = String(c.campaignId || '')
    const actionName = String(c.conversionActionName || '')
    if (!campaignId || !actionName) continue
    const key = `${campaignId}|${actionName}`
    let a = byKey.get(key)
    if (!a) {
      a = { campaignId, campaignName: String(c.campaignName || ''), actionName, category: String(c.conversionActionCategory || ''), conversions: 0, value: 0 }
      byKey.set(key, a)
    }
    a.conversions += Number(c.count || 0)
    a.value += Number(c.value || 0)
  }
  const out: Record<string, unknown>[] = []
  for (const a of byKey.values()) {
    if (a.conversions === 0 && a.value === 0) continue
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: 'campaign', entity_id: a.campaignId, entity_name: a.campaignName, parent_entity_id: customerId,
      date: captureDate, breakdown_type: 'conversion_action', breakdown_value: a.actionName,
      spend: 0, impressions: 0, clicks: 0,
      conversions: Number(a.conversions.toFixed(2)), conversion_value: Number(a.value.toFixed(2)), revenue: 0,
      extra: { conversion_action_category: a.category },
    })
  }
  return out
}
