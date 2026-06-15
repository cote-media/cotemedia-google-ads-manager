// LORAMER_GOOGLE_METRICS_ROW_V1
// Google -> metrics_daily row builder, extracted verbatim from the cron route so it
// is independently testable and reusable by the catch-up loop (mirrors
// ga-metrics-row.ts / shopify-metrics-row.ts). No logic change from cron/sync.
import type { IntelligenceMetrics, PlatformIntelligence } from './intelligence-types'

function googleMetricsExtra(metrics: IntelligenceMetrics): Record<string, unknown> {
  return {
    ctr: metrics.ctr,
    cpc: metrics.cpc,
    cpm: metrics.cpm,
    roas: metrics.roas,
    cpa: metrics.cpa,
    convRate: metrics.convRate,
  }
}

export function buildGoogleMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  customerId: string,
  accountName: string | null | undefined,
  data: PlatformIntelligence
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  const pushRow = (
    entityLevel: string,
    entityId: string,
    entityName: string,
    metrics: IntelligenceMetrics,
    parentEntityId?: string
  ) => {
    const row: Record<string, unknown> = {
      client_id: clientId,
      user_email: userEmail,
      platform: 'google',
      account_id: customerId, // LORAMER_MULTIACCOUNT_PHASE2A_V1
      entity_level: entityLevel,
      entity_id: entityId,
      entity_name: entityName,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      conversion_value: metrics.conversionValue,
      revenue: 0,
      extra: googleMetricsExtra(metrics),
    }
    if (parentEntityId) {
      row.parent_entity_id = parentEntityId
    }
    rows.push(row)
  }

  pushRow('account', customerId, accountName || customerId, data.totals)

  for (const campaign of data.campaigns || []) {
    pushRow('campaign', campaign.id, campaign.name, campaign.metrics, customerId)
  }

  for (const adGroup of data.adGroups || []) {
    pushRow('ad_group', adGroup.id, adGroup.name, adGroup.metrics, adGroup.campaignId)
  }

  for (const ad of data.ads || []) {
    pushRow('ad', ad.id, ad.name, ad.metrics, ad.adGroupId)
  }

  return rows
}
