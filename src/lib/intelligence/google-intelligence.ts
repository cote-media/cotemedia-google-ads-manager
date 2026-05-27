// ─── Google Ads Intelligence Adapter ──────────────────────────────────────────
// Fetches ALL available Google Ads data for a client account.
// Output conforms to PlatformIntelligence schema.

import { GoogleAdsApi } from 'google-ads-api'
import type { PlatformIntelligence, IntelligenceMetrics, IntelligenceCampaign, IntelligenceAdGroup, IntelligenceAd, IntelligenceKeyword, IntelligenceSearchTerm, IntelligenceConversionAction, IntelligenceConversionByCampaign, IntelligenceAudience, IntelligenceDemographic, IntelligenceAdAsset, IntelligenceAssetGroup, IntelligenceAssetGroupAsset } from './intelligence-types'

function buildDateFilter(dateRange: string, customStart?: string, customEnd?: string): string {
  if (customStart && customEnd) return `segments.date BETWEEN '${customStart}' AND '${customEnd}'`
  if (dateRange === 'LAST_90_DAYS') {
    const end = new Date(); end.setDate(end.getDate() - 1)
    const start = new Date(); start.setDate(start.getDate() - 90)
    const fmt = (d: Date) => d.toISOString().split('T')[0]
    return `segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'`
  }
  return `segments.date DURING ${dateRange}`
}

function buildMetrics(row: any): IntelligenceMetrics {
  const spend = Number(row.metrics?.cost_micros || 0) / 1e6
  const clicks = Number(row.metrics?.clicks || 0)
  const impressions = Number(row.metrics?.impressions || 0)
  const conversions = Number(row.metrics?.conversions || 0)
  const convValue = Number(row.metrics?.conversions_value || 0)
  return {
    spend,
    clicks,
    impressions,
    conversions,
    conversionValue: convValue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    roas: spend > 0 && convValue > 0 ? convValue / spend : null,
    cpa: conversions > 0 ? spend / conversions : null,
    convRate: clicks > 0 ? (conversions / clicks) * 100 : null,
  }
}

function normalizeBidStrategy(row: any): string {
  const type = row.campaign?.bidding_strategy_type || ''
  const map: Record<string, string> = {
    TARGET_CPA: 'Target CPA',
    TARGET_ROAS: 'Target ROAS',
    MAXIMIZE_CONVERSIONS: 'Maximize Conversions',
    MAXIMIZE_CONVERSION_VALUE: 'Maximize Conversion Value',
    TARGET_IMPRESSION_SHARE: 'Target Impression Share',
    MANUAL_CPC: 'Manual CPC',
    ENHANCED_CPC: 'Enhanced CPC',
    MAXIMIZE_CLICKS: 'Maximize Clicks',
    PERCENT_CPC: 'Percent CPC',
    TARGET_CPM: 'Target CPM',
  }
  return map[type] || type
}

function normalizeChannelType(row: any): string {
  const type = row.campaign?.advertising_channel_type || ''
  const map: Record<string, string> = {
    SEARCH: 'Search',
    DISPLAY: 'Display',
    SHOPPING: 'Shopping',
    VIDEO: 'Video',
    MULTI_CHANNEL: 'Performance Max',
    DISCOVERY: 'Discovery/Demand Gen',
    SMART: 'Smart',
    LOCAL: 'Local',
    APP: 'App',
  }
  return map[type] || type
}

function normalizeStatus(s: string): string {
  const u = String(s || '').toUpperCase()
  if (u === 'ENABLED' || u === '2') return 'active'
  if (u === 'PAUSED' || u === '3') return 'paused'
  if (u === 'REMOVED' || u === '4') return 'removed'
  return u.toLowerCase()
}

export async function fetchGoogleIntelligence(
  refreshToken: string,
  customerId: string,
  dateRange: string,
  managerAccountId: string,
  clientId: string,
  clientSecret: string,
  developerToken: string,
  customStart?: string,
  customEnd?: string
): Promise<PlatformIntelligence> {
  const client = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken })
  const customer = client.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: managerAccountId })
  const dateFilter = buildDateFilter(dateRange, customStart, customEnd)

  // ── Campaigns ──────────────────────────────────────────────────────────────
  const campaignRows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status,
    campaign.advertising_channel_type, campaign.bidding_strategy_type,
    campaign_budget.amount_micros, campaign_budget.type,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `)

  const campaigns: IntelligenceCampaign[] = campaignRows.map((row: any) => ({
    id: String(row.campaign?.id || ''),
    name: String(row.campaign?.name || ''),
    platform: 'google' as const,
    status: normalizeStatus(String(row.campaign?.status || '')),
    channelType: normalizeChannelType(row),
    objective: normalizeChannelType(row),
    bidStrategy: normalizeBidStrategy(row),
    budgetType: row.campaign_budget?.type === 'DAILY' ? 'daily' : 'lifetime',
    budget: Number(row.campaign_budget?.amount_micros || 0) / 1e6,
    metrics: buildMetrics(row),
  }))

  // ── Ad Groups ──────────────────────────────────────────────────────────────
  const adGroupRows = await customer.query(`
    SELECT ad_group.id, ad_group.name, ad_group.status,
    campaign.id, campaign.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc
    FROM ad_group
    WHERE ${dateFilter}
    AND ad_group.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `).catch(() => [])

  const adGroups: IntelligenceAdGroup[] = adGroupRows.map((row: any) => ({
    id: String(row.ad_group?.id || ''),
    name: String(row.ad_group?.name || ''),
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    platform: 'google' as const,
    status: normalizeStatus(String(row.ad_group?.status || '')),
    metrics: buildMetrics(row),
  }))

  // ── Ads ────────────────────────────────────────────────────────────────────
  const adRows = await customer.query(`
    SELECT ad_group_ad.ad.id, ad_group_ad.ad.name,
    ad_group_ad.ad.type,
    ad_group_ad.ad.responsive_search_ad.headlines,
    ad_group_ad.ad.responsive_search_ad.descriptions,
    ad_group_ad.ad.expanded_text_ad.headline_part1,
    ad_group_ad.ad.expanded_text_ad.description,
    ad_group_ad.status,
    ad_group.id, ad_group.name,
    campaign.id, campaign.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value, metrics.ctr
    FROM ad_group_ad
    WHERE ${dateFilter}
    AND ad_group_ad.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `).catch(() => [])

  const ads: IntelligenceAd[] = adRows.map((row: any) => {
    const adType = String(row.ad_group_ad?.ad?.type || '')
    const rsaHeadlines = row.ad_group_ad?.ad?.responsive_search_ad?.headlines
    const headline = rsaHeadlines?.[0]?.text || row.ad_group_ad?.ad?.expanded_text_ad?.headline_part1 || ''
    const description = row.ad_group_ad?.ad?.responsive_search_ad?.descriptions?.[0]?.text || row.ad_group_ad?.ad?.expanded_text_ad?.description || ''
    return {
      id: String(row.ad_group_ad?.ad?.id || ''),
      name: String(row.ad_group_ad?.ad?.name || ''),
      adGroupId: String(row.ad_group?.id || ''),
      adGroupName: String(row.ad_group?.name || ''),
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      platform: 'google' as const,
      status: normalizeStatus(String(row.ad_group_ad?.status || '')),
      creativeType: adType.includes('RESPONSIVE') ? 'responsive' : adType.includes('VIDEO') ? 'video' : 'text',
      headline,
      description,
      metrics: buildMetrics(row),
    }
  })

  // ── Keywords ───────────────────────────────────────────────────────────────
  const kwRows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
    ad_group.name, campaign.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
    FROM keyword_view
    WHERE ${dateFilter}
    AND ad_group_criterion.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `).catch(() => [])

  const keywords: IntelligenceKeyword[] = kwRows.map((row: any) => ({
    text: String(row.ad_group_criterion?.keyword?.text || ''),
    matchType: String(row.ad_group_criterion?.keyword?.match_type || ''),
    campaignName: String(row.campaign?.name || ''),
    adGroupName: String(row.ad_group?.name || ''),
    status: normalizeStatus(String(row.ad_group_criterion?.status || '')),
    qualityScore: row.ad_group_criterion?.quality_info?.quality_score || undefined,
    metrics: buildMetrics(row),
  }))

  // ── Search Terms (LORAMER_PROJECT_3_STEP_2A_V1) ────────────────────────────
  // The search term report — what users actually typed that triggered our ads.
  // Independent of the keywords we bid on. Reveals where money is going.
  // Cached for 15 min by the intelligence route; this query is relatively
  // expensive so we cap at top 100 by spend.
  const searchTermRows = await customer.query(`
    SELECT search_term_view.search_term, search_term_view.status,
    segments.search_term_match_type,
    campaign.id, campaign.name,
    ad_group.id, ad_group.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value
    FROM search_term_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `).catch(() => [])

  const searchTerms: IntelligenceSearchTerm[] = searchTermRows.map((row: any) => {
    const statusRaw = String(row.search_term_view?.status || '')
    const statusMap: Record<string, string> = {
      NONE: 'unmapped',
      ADDED: 'added as keyword',
      EXCLUDED: 'excluded',
      ADDED_EXCLUDED: 'added & excluded',
      UNKNOWN: 'unknown',
    }
    return {
      text: String(row.search_term_view?.search_term || ''),
      matchType: String(row.segments?.search_term_match_type || ''),
      status: statusMap[statusRaw] || statusRaw.toLowerCase(),
      campaignName: String(row.campaign?.name || ''),
      adGroupName: String(row.ad_group?.name || ''),
      metrics: buildMetrics(row),
    }
  })

  // ── Conversion Actions ─────────────────────────────────────────────────────
  const convRows = await customer.query(`
    SELECT conversion_action.id, conversion_action.name, conversion_action.category,
    conversion_action.include_in_conversions_metric,
    metrics.conversions
    FROM conversion_action
    WHERE ${dateFilter}
    AND conversion_action.status = 'ENABLED'
  `).catch(() => [])

  const conversionActions: IntelligenceConversionAction[] = convRows.map((row: any) => ({
    id: String(row.conversion_action?.id || ''),
    name: String(row.conversion_action?.name || ''),
    category: String(row.conversion_action?.category || ''),
    platform: 'google' as const,
    includeInConversions: Boolean(row.conversion_action?.include_in_conversions_metric),
    count: Number(row.metrics?.conversions || 0),
  }))

  // ── Conversions × Campaign (LORAMER_PROJECT_3_STEP_2B_V1) ──────────────────
  // Per-campaign breakdown of which conversion actions fired where.
  // segments.conversion_action gives one row per (campaign, conv_action) pair.
  // Filters out rows with 0 conversions to keep the payload tight.
  const convByCampaignRows = await customer.query(`
    SELECT campaign.id, campaign.name,
    segments.conversion_action_name, segments.conversion_action_category,
    metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    AND metrics.conversions > 0
    ORDER BY metrics.conversions DESC
    LIMIT 200
  `).catch(() => [])

  const conversionsByCampaign: IntelligenceConversionByCampaign[] = convByCampaignRows.map((row: any) => ({
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    conversionActionName: String(row.segments?.conversion_action_name || ''),
    conversionActionCategory: String(row.segments?.conversion_action_category || ''),
    count: Number(row.metrics?.conversions || 0),
    value: Number(row.metrics?.conversions_value || 0),
  }))

  // ── Audience Segments (LORAMER_PROJECT_3_STEP_2C_V1) ───────────────────────
  // audience_view returns per-(audience, campaign, ad_group) performance.
  // For accounts without audience targeting (pure search-keyword) returns [].
  // For PMax / Display / Discovery accounts this is gold — reveals which
  // audience signals (in-market, affinity, lookalike, custom) actually drive
  // conversions vs. just spending.
  const audienceRows = await customer.query(`
    SELECT campaign.id, campaign.name,
    ad_group.id, ad_group.name,
    audience.id, audience.name, audience.description,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value
    FROM audience_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    AND metrics.cost_micros > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `).catch(() => [])

  const audiences: IntelligenceAudience[] = audienceRows.map((row: any) => ({
    id: String(row.audience?.id || ''),
    name: String(row.audience?.name || '(unnamed audience)'),
    description: row.audience?.description ? String(row.audience.description) : undefined,
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    adGroupId: row.ad_group?.id ? String(row.ad_group.id) : undefined,
    adGroupName: row.ad_group?.name ? String(row.ad_group.name) : undefined,
    metrics: buildMetrics(row),
  }))

  // ── Demographics (LORAMER_PROJECT_3_STEP_2D_V1) ────────────────────────────
  // Two GAQL views — age_range_view and gender_view — give us per-campaign
  // demographic breakdowns. Both queried independently, results flattened
  // into one demographics array distinguished by `dimension`.
  const [ageRows, genderRows] = await Promise.all([
    customer.query(`
      SELECT campaign.id, campaign.name,
      ad_group.id, ad_group.name,
      ad_group_criterion.age_range.type,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM age_range_view
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `).catch(() => []),
    customer.query(`
      SELECT campaign.id, campaign.name,
      ad_group.id, ad_group.name,
      ad_group_criterion.gender.type,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM gender_view
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `).catch(() => []),
  ])

  // Normalize Google's enum-style age and gender labels for readability
  const AGE_LABEL_MAP: Record<string, string> = {
    AGE_RANGE_18_24: '18-24',
    AGE_RANGE_25_34: '25-34',
    AGE_RANGE_35_44: '35-44',
    AGE_RANGE_45_54: '45-54',
    AGE_RANGE_55_64: '55-64',
    AGE_RANGE_65_UP: '65+',
    AGE_RANGE_UNDETERMINED: 'Unknown age',
  }
  const GENDER_LABEL_MAP: Record<string, string> = {
    MALE: 'Male',
    FEMALE: 'Female',
    UNDETERMINED: 'Unknown gender',
  }

  const ageDemos: IntelligenceDemographic[] = ageRows.map((row: any) => {
    const raw = String(row.ad_group_criterion?.age_range?.type || '')
    return {
      dimension: 'age' as const,
      value: AGE_LABEL_MAP[raw] || raw,
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      adGroupId: row.ad_group?.id ? String(row.ad_group.id) : undefined,
      adGroupName: row.ad_group?.name ? String(row.ad_group.name) : undefined,
      metrics: buildMetrics(row),
    }
  })

  const genderDemos: IntelligenceDemographic[] = genderRows.map((row: any) => {
    const raw = String(row.ad_group_criterion?.gender?.type || '')
    return {
      dimension: 'gender' as const,
      value: GENDER_LABEL_MAP[raw] || raw,
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      adGroupId: row.ad_group?.id ? String(row.ad_group.id) : undefined,
      adGroupName: row.ad_group?.name ? String(row.ad_group.name) : undefined,
      metrics: buildMetrics(row),
    }
  })

  const demographics: IntelligenceDemographic[] = [...ageDemos, ...genderDemos]

  // ── RSA Asset Performance (LORAMER_PROJECT_3_STEP_2E_V1) ───────────────────
  // Per-asset headlines and descriptions for Responsive Search Ads, with
  // Google's BEST/GOOD/LOW performance labels. Filters to text assets only
  // (HEADLINE or DESCRIPTION field types). PMax asset-group assets handled
  // separately in 2f.
  const adAssetRows = await customer.query(`
    SELECT campaign.name,
    ad_group.name,
    ad_group_ad.ad.id,
    ad_group_ad_asset_view.field_type,
    ad_group_ad_asset_view.performance_label,
    asset.text_asset.text
    FROM ad_group_ad_asset_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    AND ad_group_ad.status != 'REMOVED'
    AND ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')
    LIMIT 500
  `).catch(() => [])

  const adAssets: IntelligenceAdAsset[] = adAssetRows.map((row: any) => {
    const ft = String(row.ad_group_ad_asset_view?.field_type || '')
    const fieldType: 'HEADLINE' | 'DESCRIPTION' | 'OTHER' =
      ft === 'HEADLINE' ? 'HEADLINE' : ft === 'DESCRIPTION' ? 'DESCRIPTION' : 'OTHER'
    return {
      adId: String(row.ad_group_ad?.ad?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      adGroupName: String(row.ad_group?.name || ''),
      fieldType,
      text: String(row.asset?.text_asset?.text || ''),
      performanceLabel: String(row.ad_group_ad_asset_view?.performance_label || ''),
    }
  })

  // ── PMax Asset Groups + Assets (LORAMER_PROJECT_3_STEP_2F_V1) ──────────────
  // THE NORTH STAR — lets Claude answer "which asset combination drove this
  // conversion?" for Performance Max campaigns. Two queries in parallel:
  // asset_group_view (per-group metrics) and asset_group_asset_view (per-asset
  // performance labels). Combined render shows asset groups with their assets
  // grouped beneath them.
  const [assetGroupRows, assetGroupAssetRows] = await Promise.all([
    customer.query(`
      SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.ad_strength,
      campaign.id, campaign.name,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM asset_group
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      AND asset_group.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `).catch(() => []),
    customer.query(`
      SELECT asset_group.id, asset_group.name,
      campaign.name,
      asset_group_asset.field_type, asset_group_asset.performance_label,
      asset.type, asset.text_asset.text
      FROM asset_group_asset
      WHERE asset_group_asset.status != 'REMOVED'
      AND campaign.status != 'REMOVED'
      LIMIT 500
    `).catch(() => []),
  ])

  const assetGroups: IntelligenceAssetGroup[] = assetGroupRows.map((row: any) => ({
    id: String(row.asset_group?.id || ''),
    name: String(row.asset_group?.name || ''),
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    status: normalizeStatus(String(row.asset_group?.status || '')),
    adStrength: row.asset_group?.ad_strength ? String(row.asset_group.ad_strength) : undefined,
    metrics: buildMetrics(row),
  }))

  const assetGroupAssets: IntelligenceAssetGroupAsset[] = assetGroupAssetRows.map((row: any) => {
    const fieldType = String(row.asset_group_asset?.field_type || '')
    const assetType = String(row.asset?.type || '')
    const isImage = fieldType.includes('IMAGE') || fieldType.includes('LOGO') || assetType === 'IMAGE'
    const isVideo = fieldType.includes('VIDEO') || assetType === 'YOUTUBE_VIDEO'
    return {
      assetGroupId: String(row.asset_group?.id || ''),
      assetGroupName: String(row.asset_group?.name || ''),
      campaignName: String(row.campaign?.name || ''),
      fieldType,
      text: row.asset?.text_asset?.text ? String(row.asset.text_asset.text) : undefined,
      isImage,
      isVideo,
      performanceLabel: String(row.asset_group_asset?.performance_label || ''),
    }
  })

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalSpend = campaigns.reduce((s, c) => s + c.metrics.spend, 0)
  const totalClicks = campaigns.reduce((s, c) => s + c.metrics.clicks, 0)
  const totalImpressions = campaigns.reduce((s, c) => s + c.metrics.impressions, 0)
  const totalConversions = campaigns.reduce((s, c) => s + c.metrics.conversions, 0)
  const totalConvValue = campaigns.reduce((s, c) => s + c.metrics.conversionValue, 0)

  const totals: IntelligenceMetrics = {
    spend: totalSpend,
    clicks: totalClicks,
    impressions: totalImpressions,
    conversions: totalConversions,
    conversionValue: totalConvValue,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    roas: totalSpend > 0 && totalConvValue > 0 ? totalConvValue / totalSpend : null,
    cpa: totalConversions > 0 ? totalSpend / totalConversions : null,
    convRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : null,
  }

  return {
    connected: true,
    accountId: customerId,
    dateRange,
    fetchedAt: new Date().toISOString(),
    campaigns,
    adGroups,
    ads,
    keywords,
    searchTerms,  // LORAMER_PROJECT_3_STEP_2A_V1
    conversionActions,
    conversionsByCampaign,  // LORAMER_PROJECT_3_STEP_2B_V1
    audiences,              // LORAMER_PROJECT_3_STEP_2C_V1
    demographics,           // LORAMER_PROJECT_3_STEP_2D_V1
    adAssets,               // LORAMER_PROJECT_3_STEP_2E_V1
    assetGroups,            // LORAMER_PROJECT_3_STEP_2F_V1
    assetGroupAssets,       // LORAMER_PROJECT_3_STEP_2F_V1
    totals,
  }
}
