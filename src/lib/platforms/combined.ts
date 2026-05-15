import { Campaign, PlatformData, PlatformTotals } from './types'

export function buildCombinedData(
  googleData: PlatformData | null,
  metaData: PlatformData | null,
  dateRange: string
): PlatformData {
  const googleCampaigns = googleData?.campaigns || []
  const metaCampaigns = metaData?.campaigns || []
  const allCampaigns: Campaign[] = [...googleCampaigns, ...metaCampaigns]

  const googleSpend = googleData?.totals.spend || 0
  const metaSpend = metaData?.totals.spend || 0
  const totalSpend = googleSpend + metaSpend

  const clicks = allCampaigns.reduce((s, c) => s + c.clicks, 0)
  const impressions = allCampaigns.reduce((s, c) => s + c.impressions, 0)
  const conversions = allCampaigns.reduce((s, c) => s + c.conversions, 0)
  const convValue = allCampaigns.reduce((s, c) => s + c.conversionValue, 0)

  const totals: PlatformTotals = {
    spend: totalSpend,
    clicks,
    impressions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    conversions,
    conversionValue: convValue,
    roas: totalSpend > 0 && convValue > 0 ? convValue / totalSpend : null,
    avgCtr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    activeCampaigns: allCampaigns.filter(c => c.status === 'active').length,
    googleSpend,
    metaSpend,
  }

  return {
    platform: 'combined',
    campaigns: allCampaigns,
    totals,
    dateRange,
    accountId: 'combined',
  }
}
