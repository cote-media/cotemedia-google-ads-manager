// ─── Google Ads Intelligence Adapter ──────────────────────────────────────────
// Fetches ALL available Google Ads data for a client account.
// Output conforms to PlatformIntelligence schema.

import { GoogleAdsApi } from 'google-ads-api'
import type { PlatformIntelligence, IntelligenceMetrics, IntelligenceCampaign, IntelligenceAdGroup, IntelligenceAd, IntelligenceKeyword, IntelligenceSearchTerm, IntelligenceConversionAction } from './intelligence-types'

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
    totals,
  }
}
