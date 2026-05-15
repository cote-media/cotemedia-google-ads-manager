import { Campaign, PlatformData, PlatformTotals, normalizeMetaStatus } from './types'

export async function fetchMetaCampaigns(
  accessToken: string,
  accountId: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<PlatformData> {
  const presets: Record<string, string> = {
    TODAY: 'today', YESTERDAY: 'yesterday',
    LAST_7_DAYS: 'last_7d', LAST_14_DAYS: 'last_14d',
    LAST_30_DAYS: 'last_30d', THIS_MONTH: 'this_month',
    LAST_MONTH: 'last_month', LAST_90_DAYS: 'last_90d',
  }

  const id = accountId.startsWith('act_') ? accountId : 'act_' + accountId
  const insightFields = 'spend,clicks,impressions,ctr,cpc,cpm,actions,action_values,reach,frequency'

  let dateParam: string
  if (customStart && customEnd) {
    dateParam = `insights.time_range({"since":"${customStart}","until":"${customEnd}"})`
  } else {
    const preset = presets[dateRange] || 'last_30d'
    dateParam = `insights.date_preset(${preset})`
  }

  const fields = `name,status,effective_status,objective,daily_budget,lifetime_budget,${dateParam}{${insightFields}}`

  // Fetch all pages
  const allRaw: any[] = []
  let nextUrl: string | null = `https://graph.facebook.com/v18.0/${id}/campaigns?fields=${fields}&limit=100&access_token=${accessToken}`
  while (nextUrl) {
    const res: Response = await fetch(nextUrl)
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    if (data.data) allRaw.push(...data.data)
    nextUrl = data.paging?.next || null
  }

  const convTypes = ['purchase', 'lead', 'complete_registration', 'offsite_conversion', 'submit_application']

  const allCampaigns: Campaign[] = allRaw.map((c: any) => {
    const ins = c.insights?.data?.[0] || {}
    const spend = parseFloat(ins.spend || '0')
    const clicks = parseInt(ins.clicks || '0')
    const impressions = parseInt(ins.impressions || '0')
    const actions: any[] = ins.actions || []
    const actionValues: any[] = ins.action_values || []
    const conversions = actions.filter(a => convTypes.includes(a.action_type)).reduce((s, a) => s + parseFloat(a.value || '0'), 0)
    const convValue = actionValues.filter(a => a.action_type === 'purchase').reduce((s, a) => s + parseFloat(a.value || '0'), 0)

    return {
      id: c.id,
      name: c.name,
      status: normalizeMetaStatus(c.effective_status || c.status),
      platform: 'meta',
      spend,
      clicks,
      impressions,
      ctr: ins.ctr ? parseFloat(ins.ctr) * 100 : 0,
      conversions,
      conversionValue: convValue,
      roas: spend > 0 && convValue > 0 ? convValue / spend : null,
      costPerConv: conversions > 0 ? spend / conversions : null,
      convRate: clicks > 0 ? (conversions / clicks) * 100 : null,
      avgCpc: ins.cpc ? parseFloat(ins.cpc) : null,
      budget: c.daily_budget
        ? parseFloat(c.daily_budget) / 100
        : c.lifetime_budget
        ? parseFloat(c.lifetime_budget) / 100
        : null,
      cpm: ins.cpm ? parseFloat(ins.cpm) : null,
      reach: parseInt(ins.reach || '0'),
      frequency: ins.frequency ? parseFloat(ins.frequency) : null,
      objective: c.objective || '',
    }
  })

  // Only campaigns with spend in the period
  const campaigns = allCampaigns.filter(c => c.spend > 0)
  const totals = buildTotals(campaigns)
  return { platform: 'meta', campaigns, totals, dateRange, accountId }
}

function buildTotals(campaigns: Campaign[]): PlatformTotals {
  const spend = campaigns.reduce((s, c) => s + c.spend, 0)
  const clicks = campaigns.reduce((s, c) => s + c.clicks, 0)
  const impressions = campaigns.reduce((s, c) => s + c.impressions, 0)
  const conversions = campaigns.reduce((s, c) => s + c.conversions, 0)
  const convValue = campaigns.reduce((s, c) => s + c.conversionValue, 0)
  const reach = campaigns.reduce((s, c) => s + (c.reach || 0), 0)
  return {
    spend, clicks, impressions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    conversions, conversionValue: convValue,
    roas: spend > 0 && convValue > 0 ? convValue / spend : null,
    avgCtr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    activeCampaigns: campaigns.filter(c => c.status === 'active').length,
    reach,
  }
}
