import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GoogleAdsApi } from 'google-ads-api'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const campaignId = searchParams.get('campaignId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const granularity = searchParams.get('granularity') || 'day'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!accountId || !campaignId) return NextResponse.json({ error: 'accountId and campaignId required' }, { status: 400 })

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  })
  const customer = client.Customer({
    customer_id: accountId,
    refresh_token: session.refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })

  let dateFilter: string
  if (customStart && customEnd) {
    dateFilter = `segments.date BETWEEN '${customStart}' AND '${customEnd}'`
  } else {
    dateFilter = `segments.date DURING ${dateRange}`
  }

  const segmentField = granularity === 'week' ? 'segments.week'
    : granularity === 'month' ? 'segments.month'
    : 'segments.date'

  try {
    const rows = await customer.query(`
      SELECT ad_group.id, ad_group.name, ${segmentField},
      metrics.cost_micros, metrics.clicks, metrics.impressions,
      metrics.conversions, metrics.conversions_value
      FROM ad_group
      WHERE ${dateFilter}
      AND campaign.id = ${campaignId}
      AND ad_group.status != 'REMOVED'
      ORDER BY ${segmentField} ASC
    `)

    // Group by ad group
    const byAdGroup: Record<string, { id: string; name: string; daily: any[] }> = {}

    rows.forEach((row: any) => {
      const id = String(row.ad_group?.id || '')
      const name = String(row.ad_group?.name || '')
      const seg = row.segments
      const date = String(seg?.date || seg?.week || seg?.month || '')
      if (!byAdGroup[id]) byAdGroup[id] = { id, name, daily: [] }
      byAdGroup[id].daily.push({
        date,
        cost: (Number(row.metrics?.cost_micros || 0) / 1e6),
        clicks: Number(row.metrics?.clicks || 0),
        impressions: Number(row.metrics?.impressions || 0),
        conversions: Number(row.metrics?.conversions || 0),
      })
    })

    return NextResponse.json({ adGroups: Object.values(byAdGroup) })
  } catch (e: any) {
    console.error('Ad group daily error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
