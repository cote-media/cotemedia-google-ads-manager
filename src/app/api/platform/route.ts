import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchMetaCampaigns } from '@/lib/platforms/meta'
import { buildCombinedData } from '@/lib/platforms/combined'
import { GoogleAdsApi } from 'google-ads-api'
import { withGaqlRetry } from '@/lib/google-retry' // LORAMER_GOOGLE_GAQL_RETRY_V1
import { resolveDateWindow } from '@/lib/date-range' // LORAMER_GAQL_DATE_WINDOW_V1 — the ONE resolver (Lesson 19)
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

  // LORAMER_GAQL_DATE_WINDOW_V1 — was a per-route LAST_90_DAYS special case with a `DURING ${dateRange}`
  // tail: CUSTOM (sent by the UI before both date inputs are filled) hit `DURING CUSTOM`, a hard GAQL error
  // the Campaigns tab rendered as an empty table. One resolver, explicit BETWEEN (Lesson 19).
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`

  // LORAMER_GOOGLE_GAQL_RETRY_V1 — retry transient deadline/internal/unavailable on the deep-window query
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — `metrics.all_conversions` added for RMF R.20 (Campaign) and, because this
  // route DERIVES the account totals by summing these campaign rows rather than issuing a separate `FROM customer`
  // query, it is also what satisfies R.10 (Account). ONE field add serves both levels.
  // ADAPTER GATE, 2026-08-14: accepted by the live API on google-ads-api v23 and DELIVERING — 8/8 non-null on
  // account 3699173394 (Influential Drones), 4/4 on 2102961791 (Ennis Exterminating).
  // scripts/rmf-adapter-gate.mjs re-runs the proof.
  const rows = await withGaqlRetry('platform:google-campaigns', () => customer.query(`
    SELECT campaign.id, campaign.name, campaign.status,
    campaign_budget.amount_micros, metrics.impressions, metrics.clicks,
    metrics.cost_micros, metrics.conversions, metrics.all_conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `))

  const campaigns: Campaign[] = rows.map((row: any) => {
    const cost = Number(row.metrics?.cost_micros || 0) / 1e6
    const clicks = Number(row.metrics?.clicks || 0)
    const impressions = Number(row.metrics?.impressions || 0)
    const conversions = Number(row.metrics?.conversions || 0)
    // LORAMER_RMF_REPORTING_DEFAULTS_V1 — carried through the mapper. Selecting a field and then discarding it in
    // the mapper is exactly how `ad_group_criterion.status` ended up invisible on the Keywords screen for months.
    const allConversions = Number(row.metrics?.all_conversions || 0)
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
      allConversions, // LORAMER_RMF_REPORTING_DEFAULTS_V1
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
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.10 (Account). Summed from the same campaign rows every other account
  // total on this screen is summed from, so the tile reconciles with the table by construction.
  const totalAllConversions = campaigns.reduce((s, c) => s + (c.allConversions ?? 0), 0)
  const totalConvValue = campaigns.reduce((s, c) => s + c.conversionValue, 0)

  const totals: PlatformTotals = {
    spend, clicks: totalClicks, impressions: totalImpressions,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    conversions: totalConversions, allConversions: totalAllConversions, conversionValue: totalConvValue,
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
