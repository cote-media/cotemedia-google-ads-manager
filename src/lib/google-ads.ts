import { GoogleAdsApi } from 'google-ads-api'
import { resolveDateWindow } from '@/lib/date-range'

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

// LORAMER_GAQL_DATE_WINDOW_V1 — `DURING ${dateRange}` breaks on LAST_90_DAYS/CUSTOM (not GAQL enums); one
// resolver, explicit BETWEEN. customStart/customEnd are optional and additive — the MCP server's 3-arg calls
// are unchanged.
export async function getCampaigns(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const customer = getCustomer(refreshToken, customerId)
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
    campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.all_conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
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
    allConversions: Number(row.metrics?.all_conversions || 0), // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.20
    conversionValue: (Number(row.metrics?.conversions_value || 0)).toFixed(2),
    roas: row.metrics?.conversions_value && row.metrics?.cost_micros > 0
      ? (Number(row.metrics.conversions_value) / (Number(row.metrics.cost_micros) / 1e6)).toFixed(2) : null,
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.average_cpc ? (Number(row.metrics.average_cpc) / 1e6).toFixed(2) : null,
  }))
}

// LORAMER_RMF_REPORTING_DEFAULTS_V1 — the RMF R.50 (Keyword) query.
//
// THREE CHANGES, and the third was not in the brief — it was found while verifying the first two.
//  1. POSITION ESTIMATES + QUALITY SCORE + STATUS are now selected and CARRIED THROUGH THE MAPPER. `status` was
//     already in the SELECT and was silently dropped below, so no column could ever show it; selecting a field
//     and discarding it is the defect, not the absence of the field.
//  2. ⛔ `segments.date DURING ${dateRange}` REPLACED WITH AN EXPLICIT BETWEEN via resolveDateWindow. GAQL has no
//     LAST_90_DAYS enum and no CUSTOM enum (CLAUDE.md hard-won platform fact, Lesson 19: resolveDateWindow is the
//     ONLY date resolver). The old form would have thrown a GAQL error the moment a reviewer picked "Last 90 days"
//     or a custom range on the Keywords screen. It never surfaced because of (3).
//  3. ⛔ THE ROUTE WAS DROPPING dateRange ENTIRELY — /api/keywords called getKeywords(token, accountId) with no
//     third argument, so this defaulted to LAST_30_DAYS on EVERY request while the UI passed ?dateRange= and the
//     screen displayed whatever label the user had picked. The Keywords date picker did nothing at all. That is a
//     date-range compliance defect on an RMF level, found inside this flight's own fence, so it is fixed here.
//
// ADAPTER GATE, 2026-08-14 (scripts/rmf-adapter-gate.mjs): all four new fields ACCEPTED by the live API on
// google-ads-api v23. DELIVERY, measured and NOT assumed — status 200/200 and 93/93 non-null; quality_score
// 33/200 on account 3699173394 and 0/93 on 2102961791; BOTH position-estimate fields 0/200 and 0/93. Google
// accepts them and returns null on these accounts, so the mapper returns null (never 0) and the UI renders an
// em dash. A null here is the vendor's answer, not a capture defect, and must never be shown as a zero bid.
export async function getKeywords(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const customer = getCustomer(refreshToken, customerId)
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const rows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, ad_group.name, campaign.name,
    ad_group_criterion.position_estimates.first_page_cpc_micros,
    ad_group_criterion.position_estimates.first_position_cpc_micros,
    ad_group_criterion.quality_info.quality_score,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM keyword_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `)
  // micros → currency, PRESERVING NULL. `Number(null || 0)` would turn "Google did not estimate this" into "$0.00",
  // which is a confident wrong number of exactly the class this repo tracks.
  const micros = (v: any): string | null => (v === null || v === undefined ? null : (Number(v) / 1e6).toFixed(2))
  return rows.map((row: any) => ({
    text: String(row.ad_group_criterion?.keyword?.text || ''),
    matchType: String(row.ad_group_criterion?.keyword?.match_type || ''),
    status: String(row.ad_group_criterion?.status ?? ''), // LORAMER_RMF_REPORTING_DEFAULTS_V1 — was selected, then dropped
    adGroup: String(row.ad_group?.name || ''),
    campaign: String(row.campaign?.name || ''),
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: (Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2),
    conversions: Number(row.metrics?.conversions || 0),
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.average_cpc ? (Number(row.metrics.average_cpc) / 1e6).toFixed(2) : null,
    firstPageCpc: micros(row.ad_group_criterion?.position_estimates?.first_page_cpc_micros),
    firstPositionCpc: micros(row.ad_group_criterion?.position_estimates?.first_position_cpc_micros),
    qualityScore: row.ad_group_criterion?.quality_info?.quality_score ?? null,
  }))
}

// LORAMER_GAQL_DATE_WINDOW_V1 — same DURING→resolver fix. Live caller: mcp-server.js get_search_terms
// (presets only today; the resolver makes any preset safe).
export async function getSearchTerms(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const customer = getCustomer(refreshToken, customerId)
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const rows = await customer.query(`
    SELECT search_term_view.search_term, search_term_view.status,
    campaign.name, ad_group.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.ctr
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
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

export async function getAccountSummary(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const campaigns = await getCampaigns(refreshToken, customerId, dateRange, customStart, customEnd) // LORAMER_GAQL_DATE_WINDOW_V1 — customs forwarded, additive
  const totalCost = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.cost), 0)
  const totalClicks = campaigns.reduce((sum: number, c: any) => sum + Number(c.clicks), 0)
  const totalImpressions = campaigns.reduce((sum: number, c: any) => sum + Number(c.impressions), 0)
  const totalConversions = campaigns.reduce((sum: number, c: any) => sum + Number(c.conversions), 0)
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.10 (Account), summed from the campaign rows like every other total here.
  const totalAllConversions = campaigns.reduce((sum: number, c: any) => sum + Number(c.allConversions || 0), 0)
  const totalConversionValue = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.conversionValue || '0'), 0)
  return {
    totalCost: totalCost.toFixed(2),
    totalClicks,
    totalImpressions,
    totalConversions: totalConversions.toFixed(1),
    totalAllConversions: totalAllConversions.toFixed(1),
    totalConversionValue: totalConversionValue.toFixed(2),
    roas: totalCost > 0 ? (totalConversionValue / totalCost).toFixed(2) : '0',
    avgCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0',
    activeCampaigns: campaigns.filter((c: any) => c.status === 'ENABLED' || c.status === '2').length,
    campaigns,
  }
}

export async function getDailyMetrics(
  refreshToken: string,
  customerId: string,
  dateRange = 'LAST_30_DAYS',
  campaignId?: string,
  granularity = 'day',
  customStart?: string,
  customEnd?: string
) {
  const customer = getCustomer(refreshToken, customerId)
  const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : ''
  const resource = campaignId ? 'campaign' : 'customer'

  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`

  // Build segment field
  const segmentField = granularity === 'week' ? 'segments.week' : granularity === 'month' ? 'segments.month' : 'segments.date'

  const rows = await customer.query(`
    SELECT ${segmentField}, metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value
    FROM ${resource}
    WHERE ${dateFilter}
    ${campaignFilter}
    ORDER BY ${segmentField} ASC
  `)

  return rows.map((row: any) => {
    const seg = row.segments
    const dateVal = String(seg?.date || seg?.week || seg?.month || '')
    return {
      date: dateVal,
      impressions: Number(row.metrics?.impressions || 0),
      clicks: Number(row.metrics?.clicks || 0),
      cost: parseFloat((Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2)),
      conversions: parseFloat(Number(row.metrics?.conversions || 0).toFixed(1)),
      conversionValue: parseFloat((Number(row.metrics?.conversions_value || 0)).toFixed(2)),
    }
  })
}
