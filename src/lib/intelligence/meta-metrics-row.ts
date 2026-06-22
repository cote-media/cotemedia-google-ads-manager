// LORAMER_META_METRICS_ROW_V1
// Meta -> metrics_daily row builder, extracted verbatim from the cron route so it
// is independently testable and reusable by the catch-up loop (mirrors
// ga-metrics-row.ts / shopify-metrics-row.ts). No logic change from cron/sync.
import type { IntelligenceMetrics, PlatformIntelligence } from './intelligence-types'

function metaMetricsExtra(metrics: IntelligenceMetrics): Record<string, unknown> {
  const extra: Record<string, unknown> = {
    ctr: metrics.ctr,
    cpc: metrics.cpc,
    cpm: metrics.cpm,
    roas: metrics.roas,
    cpa: metrics.cpa,
    convRate: metrics.convRate,
  }
  if (metrics.reach != null) extra.reach = metrics.reach
  if (metrics.frequency != null) extra.frequency = metrics.frequency
  if (metrics.purchases != null) extra.purchases = metrics.purchases
  if (metrics.addToCart != null) extra.addToCart = metrics.addToCart
  if (metrics.initiateCheckout != null) {
    extra.initiateCheckout = metrics.initiateCheckout
  }
  if (metrics.viewContent != null) extra.viewContent = metrics.viewContent
  if (metrics.costPerPurchase != null) {
    extra.costPerPurchase = metrics.costPerPurchase
  }
  if (metrics.costPerAddToCart != null) {
    extra.costPerAddToCart = metrics.costPerAddToCart
  }
  return extra
}

export function buildMetaMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  accountId: string,
  accountName: string | null | undefined,
  data: PlatformIntelligence
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const totals = data.totals

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
      platform: 'meta',
      account_id: accountId, // LORAMER_MULTIACCOUNT_PHASE2A_V1
      entity_level: entityLevel,
      entity_id: entityId,
      entity_name: entityName,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      spend: metrics.spend ?? 0,
      impressions: metrics.impressions ?? 0,
      clicks: metrics.clicks ?? 0,
      conversions: metrics.conversions ?? 0,
      conversion_value: metrics.conversionValue ?? 0,
      revenue: 0,
      extra: metaMetricsExtra(metrics),
    }
    if (parentEntityId) {
      row.parent_entity_id = parentEntityId
    }
    rows.push(row)
  }

  pushRow(
    'account',
    accountId,
    accountName || accountId,
    totals
  )

  for (const campaign of data.campaigns || []) {
    pushRow(
      'campaign',
      campaign.id,
      campaign.name,
      campaign.metrics,
      accountId
    )
  }

  for (const adSet of data.adGroups || []) {
    pushRow(
      'ad_set',
      adSet.id,
      adSet.name,
      adSet.metrics,
      adSet.campaignId
    )
  }

  for (const ad of data.ads || []) {
    pushRow(
      'ad',
      ad.id,
      ad.name,
      ad.metrics,
      ad.adGroupId
    )
  }

  // LORAMER_META_PLACEMENT_PERSIST_SLICE1_V1 — campaign × placement breakdown rows. SPEND/clicks/impressions
  // ONLY (Meta does not break conversions out per placement → conversions/conversion_value stay 0, never
  // fabricated). entity_level='campaign' + breakdown_type='placement' is collision-free with the campaign
  // grain (breakdown_type=''); breakdown_value '<publisher>:<position>' separates placements per campaign.
  for (const cp of data.campaignPlacements || []) {
    const ctr = cp.impressions > 0 ? (cp.clicks / cp.impressions) * 100 : 0
    const cpc = cp.clicks > 0 ? cp.spend / cp.clicks : null
    const cpm = cp.impressions > 0 ? (cp.spend / cp.impressions) * 1000 : null
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'meta',
      account_id: accountId,
      entity_level: 'campaign',
      entity_id: cp.campaignId,
      entity_name: cp.campaignName,
      parent_entity_id: accountId,
      date: captureDate,
      breakdown_type: 'placement',
      breakdown_value: `${cp.publisherPlatform}:${cp.platformPosition}`,
      spend: cp.spend,
      impressions: cp.impressions,
      clicks: cp.clicks,
      conversions: 0,
      conversion_value: 0,
      revenue: 0,
      extra: { ctr, cpc, cpm, publisherPlatform: cp.publisherPlatform, platformPosition: cp.platformPosition },
    })
  }

  return rows
}
