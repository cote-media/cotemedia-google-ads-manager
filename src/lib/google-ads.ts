const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const MANAGER_ID = process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(data))
  return data.access_token
}

async function gadsRequest(accessToken: string, customerId: string, query: string) {
  const res = await fetch(
    'https://googleads.googleapis.com/v17/customers/' + customerId + '/googleAds:search',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'developer-token': DEVELOPER_TOKEN,
        'login-customer-id': MANAGER_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  return data.results || []
}

export async function listAccessibleAccounts(refreshToken: string) {
  const accessToken = await getAccessToken(refreshToken)
  const res = await fetch(
    'https://googleads.googleapis.com/v17/customers/' + MANAGER_ID + '/googleAds:search',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'developer-token': DEVELOPER_TOKEN,
        'login-customer-id': MANAGER_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: "SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.status FROM customer_client WHERE customer_client.level = 1 AND customer_client.status = 'ENABLED'" }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  const results = data.results || []
  return results.map((row: any) => ({
    id: row.customerClient.clientCustomer.replace('customers/', ''),
    name: row.customerClient.descriptiveName,
    currency: row.customerClient.currencyCode,
    timezone: row.customerClient.timeZone,
  }))
}

export async function getCampaigns(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const accessToken = await getAccessToken(refreshToken)
  const results = await gadsRequest(accessToken, customerId, 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc FROM campaign WHERE segments.date DURING ' + dateRange + ' AND campaign.status != REMOVED ORDER BY metrics.cost_micros DESC')
  return results.map((row: any) => ({
    id: row.campaign?.id,
    name: row.campaign?.name,
    status: row.campaign?.status,
    type: row.campaign?.advertisingChannelType,
    budget: row.campaignBudget ? (row.campaignBudget.amountMicros / 1000000).toFixed(2) : null,
    impressions: row.metrics?.impressions || 0,
    clicks: row.metrics?.clicks || 0,
    cost: ((row.metrics?.costMicros || 0) / 1000000).toFixed(2),
    conversions: row.metrics?.conversions || 0,
    conversionValue: row.metrics?.conversionsValue?.toFixed(2) || '0',
    roas: row.metrics?.conversionsValue && row.metrics?.costMicros > 0 ? (row.metrics.conversionsValue / (row.metrics.costMicros / 1000000)).toFixed(2) : null,
    ctr: ((row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.averageCpc ? (row.metrics.averageCpc / 1000000).toFixed(2) : null,
  }))
}

export async function getKeywords(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const accessToken = await getAccessToken(refreshToken)
  const results = await gadsRequest(accessToken, customerId, 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM keyword_view WHERE segments.date DURING ' + dateRange + ' AND ad_group_criterion.status != REMOVED ORDER BY metrics.cost_micros DESC LIMIT 200')
  return results.map((row: any) => ({
    text: row.adGroupCriterion?.keyword?.text,
    matchType: row.adGroupCriterion?.keyword?.matchType,
    adGroup: row.adGroup?.name,
    campaign: row.campaign?.name,
    impressions: row.metrics?.impressions || 0,
    clicks: row.metrics?.clicks || 0,
    cost: ((row.metrics?.costMicros || 0) / 1000000).toFixed(2),
    conversions: row.metrics?.conversions || 0,
    ctr: ((row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.averageCpc ? (row.metrics.averageCpc / 1000000).toFixed(2) : null,
  }))
}

export async function getSearchTerms(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS') {
  const accessToken = await getAccessToken(refreshToken)
  const results = await gadsRequest(accessToken, customerId, 'SELECT search_term_view.search_term, search_term_view.status, campaign.name, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr FROM search_term_view WHERE segments.date DURING ' + dateRange + ' ORDER BY metrics.cost_micros DESC LIMIT 500')
  return results.map((row: any) => ({
    term: row.searchTermView?.searchTerm,
    campaign: row.campaign?.name,
    adGroup: row.adGroup?.name,
    impressions: row.metrics?.impressions || 0,
    clicks: row.metrics?.clicks || 0,
    cost: ((row.metrics?.costMicros || 0) / 1000000).toFixed(2),
    conversions: row.metrics?.conversions || 0,
    ctr: ((row.metrics?.ctr || 0) * 100).toFixed(2),
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
    activeCampaigns: campaigns.filter(c => c.status === 'ENABLED').length,
    campaigns,
  }
}
