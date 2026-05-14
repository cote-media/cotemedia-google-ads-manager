import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'

  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }

  // Get stored Meta token
  const { data: tokenRow } = await supabaseAdmin
    .from('meta_tokens')
    .select('access_token')
    .eq('user_email', session.user.email)
    .single()

  if (!tokenRow?.access_token) {
    return NextResponse.json({ error: 'No Meta token found' }, { status: 401 })
  }

  const token = tokenRow.access_token

  // Convert dateRange to Meta date_preset or date range
  const datePresetMap: Record<string, string> = {
    'TODAY': 'today',
    'YESTERDAY': 'yesterday',
    'LAST_7_DAYS': 'last_7d',
    'LAST_14_DAYS': 'last_14d',
    'LAST_30_DAYS': 'last_30d',
    'THIS_MONTH': 'this_month',
    'LAST_MONTH': 'last_month',
    'LAST_90_DAYS': 'last_90d',
  }

  const datePreset = datePresetMap[dateRange] || 'last_30d'

  try {
    // Normalize account ID — Meta uses act_XXXXXXX format
    const normalizedId = accountId.startsWith('act_') ? accountId : 'act_' + accountId

    // Fetch campaigns with insights
    const fields = 'name,status,objective,daily_budget,lifetime_budget'
    const insightFields = 'spend,clicks,impressions,ctr,cpc,cpm,actions,action_values,reach,frequency'

    const campaignsRes = await fetch(
      `https://graph.facebook.com/v18.0/${normalizedId}/campaigns?fields=${fields},insights{${insightFields}}&date_preset=${datePreset}&limit=100&access_token=${token}`
    )
    const campaignsData = await campaignsRes.json()

    if (campaignsData.error) {
      return NextResponse.json({ error: campaignsData.error.message }, { status: 400 })
    }

    const campaigns = (campaignsData.data || []).map((c: any) => {
      const insights = c.insights?.data?.[0] || {}
      const spend = parseFloat(insights.spend || '0')
      const clicks = parseInt(insights.clicks || '0')
      const impressions = parseInt(insights.impressions || '0')

      // Extract conversions from actions
      const actions = insights.actions || []
      const actionValues = insights.action_values || []
      const conversions = actions
        .filter((a: any) => ['purchase', 'lead', 'complete_registration', 'offsite_conversion'].includes(a.action_type))
        .reduce((sum: number, a: any) => sum + parseFloat(a.value || '0'), 0)

      const conversionValue = actionValues
        .filter((a: any) => a.action_type === 'purchase')
        .reduce((sum: number, a: any) => sum + parseFloat(a.value || '0'), 0)

      const roas = spend > 0 && conversionValue > 0 ? (conversionValue / spend).toFixed(2) : null
      const budget = c.daily_budget ? (parseFloat(c.daily_budget) / 100).toFixed(2) : null

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        budget,
        spend: spend.toFixed(2),
        clicks,
        impressions,
        ctr: insights.ctr ? (parseFloat(insights.ctr) * 100).toFixed(2) : '0.00',
        cpc: insights.cpc ? parseFloat(insights.cpc).toFixed(2) : null,
        cpm: insights.cpm ? parseFloat(insights.cpm).toFixed(2) : null,
        conversions: conversions.toFixed(1),
        conversionValue: conversionValue.toFixed(2),
        roas,
        reach: parseInt(insights.reach || '0'),
        frequency: insights.frequency ? parseFloat(insights.frequency).toFixed(2) : null,
      }
    })

    // Calculate totals
    const totalSpend = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.spend), 0)
    const totalClicks = campaigns.reduce((sum: number, c: any) => sum + c.clicks, 0)
    const totalImpressions = campaigns.reduce((sum: number, c: any) => sum + c.impressions, 0)
    const totalConversions = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.conversions), 0)
    const totalConversionValue = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.conversionValue), 0)
    const activeCampaigns = campaigns.filter((c: any) => c.status === 'ACTIVE').length

    return NextResponse.json({
      campaigns,
      totalCost: totalSpend.toFixed(2),
      totalClicks,
      totalImpressions,
      totalConversions: totalConversions.toFixed(1),
      totalConversionValue: totalConversionValue.toFixed(2),
      roas: totalSpend > 0 && totalConversionValue > 0 ? (totalConversionValue / totalSpend).toFixed(2) : '0',
      avgCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0',
      activeCampaigns,
    })
  } catch (e: any) {
    console.error('Meta campaigns error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
