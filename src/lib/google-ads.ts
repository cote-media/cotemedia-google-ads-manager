import { GoogleAdsApi, Customer } from 'google-ads-api'

let client: GoogleAdsApi | null = null

export function getGoogleAdsClient() {
  if (!client) {
    client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    })
  }
  return client
}

export function getCustomer(refreshToken: string, customerId: string): Customer {
  const client = getGoogleAdsClient()
  return client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID,
  })
}

export async function listAccessibleAccounts(refreshToken: string) {
  const client = getGoogleAdsClient()
  const customer = client.Customer({
    customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID,
  })

  const accounts = await customer.query(`
    SELECT
      customer_client.client_customer,
      customer_client.descriptive_name,
      customer_client.currency_code,
      customer_client.time_zone,
      customer_client.status
    FROM customer_client
    WHERE customer_client.level = 1
    AND customer_client.status = 'ENABLED'
  `)

  return accounts.map((row: any) => ({
    id: row.customer_client.client_customer.replace('customers/', ''),
    name: row.customer_client.descriptive_name,
    currency: row.customer_client.currency_code,
    timezone: row.customer_client.time_zone,
  }))
}

export async function getCampaigns(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const customer = getCustomer(refreshToken, customerId)

  const campaigns = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date DURING ${dateRange}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `)

  return campaigns.map((row: any) => ({
    id: row.campaign.id,
    name: row.campaign.name,
    status: row.campaign.status,
    type: row.campaign.advertising_channel_type,
    biddingStrategy: row.campaign.bidding_strategy_type,
    budget: row.campaign_budget ? (row.campaign_budget.amount_micros / 1_000_000).toFixed(2) : null,
    impressions: row.metrics.impressions,
    clicks: row.metrics.clicks,
    cost: (row.metrics.cost_micros / 1_000_000).toFixed(2),
    conversions: row.metrics.conversions,
    conversionValue: row.metrics.conversions_value?.toFixed(2),
    roas: row.metrics.conversions_value && row.metrics.cost_micros > 0
      ? (row.metrics.conversions_value / (row.metrics.cost_micros / 1_000_000)).toFixed(2)
      : null,
    ctr: (row.metrics.ctr * 100).toFixed(2),
    avgCpc: row.metrics.average_cpc ? (row.metrics.average_cpc / 1_000_000).toFixed(2) : null,
  }))
}

export async function getKeywords(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const customer = getCustomer(refreshToken, customerId)

  const keywords = await customer.query(`
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ad_group.name,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.quality_score
    FROM keyword_view
    WHERE segments.date DURING ${dateRange}
    AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `)

  return keywords.map((row: any) => ({
    text: row.ad_group_criterion.keyword.text,
    matchType: row.ad_group_criterion.keyword.match_type,
    status: row.ad_group_criterion.status,
    adGroup: row.ad_group.name,
    campaign: row.campaign.name,
    impressions: row.metrics.impressions,
    clicks: row.metrics.clicks,
    cost: (row.metrics.cost_micros / 1_000_000).toFixed(2),
    conversions: row.metrics.conversions,
    ctr: (row.metrics.ctr * 100).toFixed(2),
    avgCpc: row.metrics.average_cpc ? (row.metrics.average_cpc / 1_000_000).toFixed(2) : null,
    qualityScore: row.metrics.quality_score,
  }))
}

export async function getSearchTerms(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const customer = getCustomer(refreshToken, customerId)

  const terms = await customer.query(`
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      campaign.name,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr
    FROM search_term_view
    WHERE segments.date DURING ${dateRange}
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `)

  return terms.map((row: any) => ({
    term: row.search_term_view.search_term,
    status: row.search_term_view.status,
    campaign: row.campaign.name,
    adGroup: row.ad_group.name,
    impressions: row.metrics.impressions,
    clicks: row.metrics.clicks,
    cost: (row.metrics.cost_micros / 1_000_000).toFixed(2),
    conversions: row.metrics.conversions,
    ctr: (row.metrics.ctr * 100).toFixed(2),
  }))
}

export async function getAccountSummary(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const campaigns = await getCampaigns(refreshToken, customerId, dateRange)

  const totalCost = campaigns.reduce((sum, c) => sum + parseFloat(c.cost), 0)
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0)
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0)
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0)
  const totalConversionValue = campaigns.reduce((sum, c) => sum + parseFloat(c.conversionValue || '0'), 0)

  return {
    totalCost: totalCost.toFixed(2),
    totalClicks,
    totalImpressions,
    totalConversions: totalConversions.toFixed(1),
    totalConversionValue: totalConversionValue.toFixed(2),
    roas: totalCost > 0 ? (totalConversionValue / totalCost).toFixed(2) : '0',
    avgCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0',
    activeCampaigns: campaigns.filter(c => c.status === 'ENABLED').length,
    campaigns,
  }
}