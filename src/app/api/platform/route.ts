import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchMetaCampaigns } from '@/lib/platforms/meta'
import { buildCombinedData } from '@/lib/platforms/combined'
import { GoogleAdsApi } from 'google-ads-api'
import { normalizeGoogleStatus } from '@/lib/platforms/types'
import type { Campaign, PlatformData, PlatformTotals } from '@/lib/platforms/types'

function getGoogleClient() {
  return new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  })
}

async function fetchGoogleData(
  refreshToken: string,
  customerId: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<PlatformData> {
  const client = getGoogleClient()
  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })

  let dateFilter: string
  if (customStart && customEnd) {
    dateFilter = `segments.date BETWEEN '${customStart}' AND '${customEnd}'`
  } else {
    dateFilter = `segments.date DURING ${dateRange}`
  }

  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status,
    campaign_budget.amount_micros, metrics.impressions, metrics.clicks,
    metrics.cost_micros, metrics.conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc
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

  const spend = campaigns.reduce((s, c) => s + c.spend, 0)
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0)
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0)
  const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0)
  const totalConvValue = campaigns.reduce((s, c) => s + c.conversionValue, 0)

  const totals: PlatformTotals = {
    spend, clicks: totalClicks, impressions: totalImpressions,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    conversions: totalConversions, conversionValue: totalConvValue,
    roas: spend > 0 && totalConvValue > 0 ? totalConvValue / spend : null,
    avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    activeCampaigns: campaigns.filter(c => c.status === 'active').length,
  }

  return { platform: 'google', campaigns, totals, dateRange, accountId: customerId }
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const platform = searchParams.get('platform') || 'google'
  const googleAccountId = searchParams.get('googleAccountId') || ''
  const metaAccountId = searchParams.get('metaAccountId') || ''
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart') || undefined
  const customEnd = searchParams.get('customEnd') || undefined

  try {
    if (platform === 'google') {
      if (!googleAccountId) return NextResponse.json({ error: 'googleAccountId required' }, { status: 400 })
      const data = await fetchGoogleData(session.refreshToken, googleAccountId, dateRange, customStart, customEnd)
      return NextResponse.json(data)
    }

    if (platform === 'meta') {
      if (!metaAccountId) return NextResponse.json({ error: 'metaAccountId required' }, { status: 400 })
      const { data: tokenRow } = await supabaseAdmin.from('meta_tokens').select('access_token').eq('user_email', session.user.email).single()
      if (!tokenRow?.access_token) return NextResponse.json({ error: 'No Meta token' }, { status: 401 })
      const data = await fetchMetaCampaigns(tokenRow.access_token, metaAccountId, dateRange, customStart, customEnd)
      return NextResponse.json(data)
    }

    if (platform === 'combined') {
      let googleData: PlatformData | null = null
      let metaData: PlatformData | null = null

      if (googleAccountId && session.refreshToken) {
        try { googleData = await fetchGoogleData(session.refreshToken, googleAccountId, dateRange, customStart, customEnd) } catch (e) { console.error('Google fetch error:', e) }
      }

      if (metaAccountId) {
        const { data: tokenRow } = await supabaseAdmin.from('meta_tokens').select('access_token').eq('user_email', session.user.email).single()
        if (tokenRow?.access_token) {
          try { metaData = await fetchMetaCampaigns(tokenRow.access_token, metaAccountId, dateRange, customStart, customEnd) } catch (e) { console.error('Meta fetch error:', e) }
        }
      }

      const combined = buildCombinedData(googleData, metaData, dateRange)
      return NextResponse.json(combined)
    }

    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 })
  } catch (e: any) {
    console.error('Platform data error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
