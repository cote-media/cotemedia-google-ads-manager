import { GoogleAdsApi } from 'google-ads-api'

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

function getCustomer(refreshToken: string, customerId: string) {
  return client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
}

export async function listAccessibleAccounts(refreshToken: string) {
  const customer = client.Customer({
    customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
  const rows = await customer.query(`
    SELECT customer_client.client_customer, customer_client.descriptive_name,
    customer_client.currency_code, customer_client.time_zone, customer_client.status
    FROM customer_client
    WHERE customer_client.level = 1
    AND customer_client.status = 'ENABLED'
  `)
  return rows.map((row: any) => ({
    id: String(row.customer_client.client_customer || '').replace('customers/', ''),
    name: String(row.customer_client.descriptive_name || ''),
    currency: String(row.customer_client.currency_code || ''),
    timezone: String(row.customer_client.time_zone || ''),
  }))
}

export async function getCampaigns(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const customer = getCustomer(refreshToken, customerId)
  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
    campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE segments.date DURING ${dateRange}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `)
  return rows.map((row: any) => ({
    id: String(row.campaign?.id || ''),
    name: String(row.campaign?.name || ''),
    status: String(row.campaign?.status || ''),
    type: String(row.campaign?.advertising_channel_type || ''),
    budget: row.campaign_budget?.amount_micros ? (Number(row.campaign_budget.amount_micros) / 1e6).toFixed(2) : null,
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: (Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2),
    conversions: Number(row.metrics?.conversions || 0),
    conversionValue: (Number(row.metrics?.conversions_value || 0)).toFixed(2),
    roas: row.metrics?.conversions_value && row.metrics?.cost_micros > 0
      ? (Number(row.metrics.conversions_value) / (Number(row.metrics.cost_micros) / 1e6)).toFixed(2) : null,
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.average_cpc ? (Number(row.metrics.average_cpc) / 1e6).toFixed(2) : null,
  }))
}

export async function getKeywords(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const customer = getCustomer(refreshToken, customerId)
  const rows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, ad_group.name, campaign.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM keyword_view
    WHERE segments.date DURING ${dateRange}
    AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `)
  return rows.map((row: any) => ({
    text: String(row.ad_group_criterion?.keyword?.text || ''),
    matchType: String(row.ad_group_criterion?.keyword?.match_type || ''),
    adGroup: String(row.ad_group?.name || ''),
    campaign: String(row.campaign?.name || ''),
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: (Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2),
    conversions: Number(row.metrics?.conversions || 0),
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.average_cpc ? (Number(row.metrics.average_cpc) / 1e6).toFixed(2) : null,
  }))
}

export async function getSearchTerms(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const customer = getCustomer(refreshToken, customerId)
  const rows = await customer.query(`
    SELECT search_term_view.search_term, search_term_view.status,
    campaign.name, ad_group.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.ctr
    FROM search_term_view
    WHERE segments.date DURING ${dateRange}
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `)
  return rows.map((row: any) => ({
    term: String(row.search_term_view?.search_term || ''),
    campaign: String(row.campaign?.name || ''),
    adGroup: String(row.ad_group?.name || ''),
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: (Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2),
    conversions: Number(row.metrics?.conversions || 0),
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
  }))
}

export async function getAccountSummary(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const campaigns = await getCampaigns(refreshToken, customerId, dateRange)
  const totalCost = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.cost), 0)
  const totalClicks = campaigns.reduce((sum: number, c: any) => sum + Number(c.clicks), 0)
  const totalImpressions = campaigns.reduce((sum: number, c: any) => sum + Number(c.impressions), 0)
  const totalConversions = campaigns.reduce((sum: number, c: any) => sum + Number(c.conversions), 0)
  const totalConversionValue = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.conversionValue || '0'), 0)
  return {
    totalCost: totalCost.toFixed(2),
    totalClicks,
    totalImpressions,
    totalConversions: totalConversions.toFixed(1),
    totalConversionValue: totalConversionValue.toFixed(2),
    roas: totalCost > 0 ? (totalConversionValue / totalCost).toFixed(2) : '0',
    avgCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0',
    activeCampaigns: campaigns.filter((c: any) => c.status === 'ENABLED' || c.status === '2').length,
    campaigns,
  }
}

export async function getDailyMetrics(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', campaignId?: string) {
  const customer = getCustomer(refreshToken, customerId)
  const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : ''
  const resource = campaignId ? 'campaign' : 'customer'
  const rows = await customer.query(`
    SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value
    FROM ${resource}
    WHERE segments.date DURING ${dateRange}
    ${campaignFilter}
    ORDER BY segments.date ASC
  `)
  return rows.map((row: any) => ({
    date: String(row.segments?.date || ''),
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: parseFloat((Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2)),
    conversions: parseFloat(Number(row.metrics?.conversions || 0).toFixed(1)),
    conversionValue: parseFloat((Number(row.metrics?.conversions_value || 0)).toFixed(2)),
  }))
}
