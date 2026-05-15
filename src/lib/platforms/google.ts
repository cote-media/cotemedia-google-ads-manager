import { Campaign, PlatformData, PlatformTotals, normalizeGoogleStatus } from './types'

export async function fetchGoogleCampaigns(
  refreshToken: string,
  customerId: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<PlatformData> {
  // Build date filter
  let dateFilter: string
  if (customStart && customEnd) {
    dateFilter = `segments.date BETWEEN '${customStart}' AND '${customEnd}'`
  } else {
    dateFilter = `segments.date DURING ${dateRange}`
  }

  const { GoogleAdsApi } = await import('google-ads-api')
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  })
  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })

  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
    campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `)

  const campaigns: Campaign[] = rows.map((row: any) => {
    const cost = Number(row.metrics?.cost_micros || 0) / 1e6
    const clicks = Number(row.metrics?.clicks || 0)
    const impressions = Number(row.metrics?.impressions || 0)
    const conversions = Number(row.metrics?.conversions || 0)
    const convValue = Number(row.metrics?.conversions_value || 0)
    const budget = row.campaign_budget?.amount_micros ? Number(row.campaign_budget.amount_micros) / 1e6 : null

    return {
      id: String(row.campaign?.id || ''),
      name: String(row.campaign?.name || ''),
      status: normalizeGoogleStatus(String(row.campaign?.status || '')),
      platform: 'google',
      spend: cost,
      clicks,
      impressions,
      ctr: Number(row.metrics?.ctr || 0) * 100,
      conversions,
      conversionValue: convValue,
      roas: cost > 0 && convValue > 0 ? convValue / cost : null,
      costPerConv: conversions > 0 ? cost / conversions : null,
      convRate: clicks > 0 ? (conversions / clicks) * 100 : null,
      avgCpc: row.metrics?.average_cpc ? Number(row.metrics.average_cpc) / 1e6 : null,
      budget,
    }
  })

  const totals = buildTotals(campaigns)
  return { platform: 'google', campaigns, totals, dateRange, accountId: customerId }
}

function buildTotals(campaigns: Campaign[]): PlatformTotals {
  const spend = campaigns.reduce((s, c) => s + c.spend, 0)
  const clicks = campaigns.reduce((s, c) => s + c.clicks, 0)
  const impressions = campaigns.reduce((s, c) => s + c.impressions, 0)
  const conversions = campaigns.reduce((s, c) => s + c.conversions, 0)
  const convValue = campaigns.reduce((s, c) => s + c.conversionValue, 0)
  return {
    spend, clicks, impressions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    conversions, conversionValue: convValue,
    roas: spend > 0 && convValue > 0 ? convValue / spend : null,
    avgCtr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    activeCampaigns: campaigns.filter(c => c.status === 'active').length,
  }
}
