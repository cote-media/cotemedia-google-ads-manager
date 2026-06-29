// LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1 (T0.2) — forward-persist the SEARCH impression-share family that
// fetchGoogleIntelligence ALREADY returns (intel.impressionShares = one row per campaign). ZERO new Google
// call: this RIDES the existing live-intel GAQL (google-intelligence.ts impressionShareRows — SELECT
// campaign.id, metrics.search_impression_share + the lost/top family FROM campaign, LIMIT 200; the API
// returns -1 for non-eligible campaigns which is already filtered to hasData upstream). The payload is
// fetched on every forward capture for the Lora prompt and was otherwise DROPPED; here we persist it.
// HISTORY backfill of this dim = T2.3 (quota-gated), NOT this writer.
//
// ENCODING (unique under the 7-col conflict key): entity_level='campaign' (IS is grain-limited to
//   campaign/ad_group/keyword and the live query is FROM campaign → CAMPAIGN ONLY here; ad_group/keyword IS
//   would be a NEW fetch = T2), breakdown_type='impression_share', breakdown_value='search' ('content'
//   reserved for the content_* family, not fetched today). One row per campaign per day.
// IS is a RATIO, not spend/clicks/conversions → the 7 ratio metrics live in extra (nullable; null = the
//   API's -1 non-eligible sentinel, already mapped to null upstream); the NOT-NULL count columns are 0.
// RECONCILE = WRITE-ONLY: a ratio is not a partition of any total — never reconciled.
// CAP: inherits the live query's LIMIT 200 (top campaigns by cost) — a logged, deliberate noise cap.
import type { IntelligenceImpressionShare } from './intelligence-types'

export function buildGoogleImpressionShareRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  customerId: string,
  impressionShares?: IntelligenceImpressionShare[]
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const s of impressionShares || []) {
    const campaignId = String(s.campaignId || '')
    if (!campaignId || !s.hasData) continue
    out.push({
      client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
      entity_level: 'campaign', entity_id: campaignId, entity_name: String(s.campaignName || ''), parent_entity_id: customerId,
      date: captureDate, breakdown_type: 'impression_share', breakdown_value: 'search',
      spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, revenue: 0,
      extra: {
        channel_type: s.channelType ?? '',
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
