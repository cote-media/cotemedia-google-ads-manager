// LORAMER_DRIVER_SETTINGS_WRITER_V1 (2026-09-22, round 14) — THE FORWARD DRIVER'S ENTITY-STATE SLICE, FROM ITS OWN TWO QUERIES.
//
// WHAT THIS IS: the slice-1 facts (campaign advertising_channel_type + campaign_status; conversion_action
// include_in_conversions + the two lookback windows — SLICE1_DECLARED_KEYS) for a WALK-marked connection, which the
// legacy sync no longer serves. The sync gets them from fetchGoogleIntelligence (~15 requests); the driver asks the two
// resources the extractor actually reads (2 requests) and maps the rows through the intelligence module's OWN exported
// normalisers, so entity_state_history holds ONE spelling whichever engine observed the fact. MEASURED 2026-09-22
// (round 13, Bath Fitter 60e6dd99 / 6871055643): 177 facts from this path, 177 from the sync's, 0 differences, and
// 177/177 equal to the stored open rows.
//
// ⛔ THE FIELD LISTS AND WHERE CLAUSES ARE THE INTELLIGENCE MODULE'S, COPIED VERBATIM — google-intelligence.ts
// CAMPAIGN_BASE_FIELDS (:274) with `campaign.primary_status` (:294, the enriched query) and the conversion_action SELECT
// (CONVERSION_ACTION_ATTRIBUTE_GAQL, imported — LORAMER_CONVERSION_ACTION_ATTRIBUTE_ONLY_V1). The guard pins both clauses to the intel's.
// ⛔ NO FALLBACK. The intel path degrades to toggle-only status when the enriched query fails (:296-306) and records a
// fetchError. A toggle-only 'active' for a campaign whose primary_status is ENDED is a SECOND SHAPE of one fact; the
// driver REFUSES the pass instead (the caller records outcome 'error'), so a walk account never holds a degraded row.
// ⛔ NO PER-VALUE LITERALS HERE: every enum ordinal is resolved by the exported helpers, never by a map in this file.
import { computeCampaignStatus, normalizePrimaryStatus, normalizeChannelTypeValue, CONVERSION_ACTION_ATTRIBUTE_GAQL } from '@/lib/intelligence/google-intelligence'
import { extractGoogleSlice1, type ObservedFact } from '@/lib/capture/entity-state-history'

/** google-intelligence.ts campaignQuery(`campaign.primary_status, ${CAMPAIGN_BASE_FIELDS}`) — the settings fields only (no metrics, no date filter: the state of every non-removed campaign, today). */
export const DRIVER_CAMPAIGN_SETTINGS_GAQL =
  `SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED'`

/** The intel's own template, IMPORTED — the repo carries exactly one FROM conversion_action (conversion-action-attribute-only guard). */
export const DRIVER_CONVERSION_ACTION_GAQL = CONVERSION_ACTION_ATTRIBUTE_GAQL

export type DriverSettingsPayload = {
  campaigns: Array<{ id: string; name: string; status: string; channelType: string }>
  conversionActions: Array<{ id: string; name: string; includeInConversions: boolean; clickThroughLookbackWindowDays?: number; viewThroughLookbackWindowDays?: number }>
}

const finiteOrUndefined = (v: unknown): number | undefined => (v != null && Number.isFinite(Number(v)) ? Number(v) : undefined)

/** PURE. Vendor rows in, the extractor's payload shape out — the same mapping google-intelligence.ts applies at :311-323 and :529-541. */
export function mapDriverSettingsRows(campaignRows: any[], conversionRows: any[]): DriverSettingsPayload {
  return {
    campaigns: campaignRows.map((r) => ({
      id: String(r?.campaign?.id || ''),
      name: String(r?.campaign?.name || ''),
      status: computeCampaignStatus(String(r?.campaign?.status || ''), normalizePrimaryStatus(r?.campaign?.primary_status)),
      channelType: normalizeChannelTypeValue(r?.campaign?.advertising_channel_type),
    })),
    conversionActions: conversionRows.map((r) => ({
      id: String(r?.conversion_action?.id || ''),
      name: String(r?.conversion_action?.name || ''),
      includeInConversions: Boolean(r?.conversion_action?.include_in_conversions_metric),
      clickThroughLookbackWindowDays: finiteOrUndefined(r?.conversion_action?.click_through_lookback_window_days),
      viewThroughLookbackWindowDays: finiteOrUndefined(r?.conversion_action?.view_through_lookback_window_days),
    })),
  }
}

async function collect(stream: (gaql: string) => AsyncGenerator<any>, gaql: string): Promise<any[]> {
  const out: any[] = []
  for await (const row of stream(gaql)) out.push(row)
  return out
}

/**
 * Two vendor requests → the slice-1 facts, through the intel's normalisers and the ONE extractor.
 * THROWS on either query failing — the caller refuses the pass and records it; nothing degraded is returned.
 */
export async function driverSettingsFacts(stream: (gaql: string) => AsyncGenerator<any>): Promise<{ facts: ObservedFact[]; campaigns: number; conversionActions: number; requests: number }> {
  const campaignRows = await collect(stream, DRIVER_CAMPAIGN_SETTINGS_GAQL)
  const conversionRows = await collect(stream, DRIVER_CONVERSION_ACTION_GAQL)
  const payload = mapDriverSettingsRows(campaignRows, conversionRows)
  return { facts: extractGoogleSlice1(payload), campaigns: payload.campaigns.length, conversionActions: payload.conversionActions.length, requests: 2 }
}
