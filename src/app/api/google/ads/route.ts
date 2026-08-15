import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GoogleAdsApi } from 'google-ads-api'
import { resolveDateWindow } from '@/lib/date-range' // LORAMER_GAQL_DATE_WINDOW_V1 — the ONE resolver (Lesson 19)
import { composeGoogleAdName } from '@/lib/google-ad-display-name' // LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — ONE composition, ONE home

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
  const adGroupId = searchParams.get('adGroupId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!accountId || !adGroupId) return NextResponse.json({ error: 'accountId and adGroupId required' }, { status: 400 })

  // LORAMER_GAQL_DATE_WINDOW_V1 — same defect + fix as /api/google/adgroups: DURING breaks on
  // LAST_90_DAYS/CUSTOM, the drill caller swallows the 500 as 0 ads. One resolver, explicit BETWEEN.
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart || undefined, customEnd || undefined)
  const dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`

  try {
    const customer = getCustomer(session.refreshToken, accountId)
    const rows = await customer.query(`
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name,
      ad_group_ad.status, ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.expanded_text_ad.headline_part1,
      ad_group_ad.ad.expanded_text_ad.headline_part2,
      ad_group_ad.ad.expanded_text_ad.description,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value,
      metrics.ctr, metrics.average_cpc
      FROM ad_group_ad
      WHERE ${dateFilter}
      AND ad_group.id = ${adGroupId}
      AND ad_group_ad.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
    `)

    const ads = rows.map((row: any) => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1e6
      const clicks = Number(row.metrics?.clicks || 0)
      const impressions = Number(row.metrics?.impressions || 0)
      const conversions = Number(row.metrics?.conversions || 0)
      const convValue = Number(row.metrics?.conversions_value || 0)
      const status = String(row.ad_group_ad?.status || '')
      const ad = row.ad_group_ad?.ad || {}
      const adType = String(ad.type || '')

      // LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — the composition moved to its ONE home (google-ad-display-name.ts)
      // so the warehouse writers and this live surface can never drift apart. Behavior here is byte-compatible
      // with the previous inline version: RSA first-3 ' | ', ETA part1|part2, else the vendor name.
      const headline = composeGoogleAdName(ad) || 'Ad'
      const description = (ad.responsive_search_ad?.descriptions?.[0]?.text) || ad.expanded_text_ad?.description || ''

      return {
        id: String(ad.id || ''),
        name: headline || 'Ad',
        description,
        type: adType,
        finalUrl: (ad.final_urls || [])[0] || '',
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
        budget: null,
      }
    })

    return NextResponse.json({ ads })
  } catch (e: any) {
    console.error('Ads error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
