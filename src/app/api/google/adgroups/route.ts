import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GoogleAdsApi } from 'google-ads-api'

function getCustomer(refreshToken: string, customerId: string) {
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  })
  return client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const campaignId = searchParams.get('campaignId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!accountId || !campaignId) return NextResponse.json({ error: 'accountId and campaignId required' }, { status: 400 })

  const dateFilter = customStart && customEnd
    ? `segments.date BETWEEN '${customStart}' AND '${customEnd}'`
    : `segments.date DURING ${dateRange}`

  try {
    const customer = getCustomer(session.refreshToken, accountId)
    const rows = await customer.query(`
      SELECT ad_group.id, ad_group.name, ad_group.status,
      ad_group.type, ad_group.cpc_bid_micros,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value,
      metrics.ctr, metrics.average_cpc
      FROM ad_group
      WHERE ${dateFilter}
      AND campaign.id = ${campaignId}
      AND ad_group.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
    `)

    const adGroups = rows.map((row: any) => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1e6
      const clicks = Number(row.metrics?.clicks || 0)
      const impressions = Number(row.metrics?.impressions || 0)
      const conversions = Number(row.metrics?.conversions || 0)
      const convValue = Number(row.metrics?.conversions_value || 0)
      const status = String(row.ad_group?.status || '')
      return {
        id: String(row.ad_group?.id || ''),
        name: String(row.ad_group?.name || ''),
        status: status === 'ENABLED' || status === '2' ? 'active'
          : status === 'PAUSED' || status === '3' ? 'paused' : 'deleted',
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
        budget: row.ad_group?.cpc_bid_micros ? Number(row.ad_group.cpc_bid_micros) / 1e6 : null,
      }
    })

    return NextResponse.json({ adGroups })
  } catch (e: any) {
    console.error('Ad groups error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
