import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  const { data: tokenRow } = await supabaseAdmin.from('meta_tokens').select('access_token').eq('user_email', session.user.email).single()
  if (!tokenRow?.access_token) return NextResponse.json({ error: 'No Meta token found' }, { status: 401 })
  const token = tokenRow.access_token
  const presets: Record<string, string> = { TODAY: 'today', YESTERDAY: 'yesterday', LAST_7_DAYS: 'last_7d', LAST_14_DAYS: 'last_14d', LAST_30_DAYS: 'last_30d', THIS_MONTH: 'this_month', LAST_MONTH: 'last_month', LAST_90_DAYS: 'last_90d' }
  const datePreset = presets[dateRange] || 'last_30d'
  try {
    const id = accountId.startsWith('act_') ? accountId : 'act_' + accountId
    const insightFields = 'spend,clicks,impressions,ctr,cpc,actions,action_values'
    const url = 'https://graph.facebook.com/v18.0/' + id + '/campaigns?fields=name,status,objective,daily_budget,insights{' + insightFields + '}&date_preset=' + datePreset + '&limit=100&access_token=' + token
    const apiRes: Response = await fetch(url)
    const data = await apiRes.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
    const campaigns = (data.data || []).map((c: any) => {
      const ins = c.insights?.data?.[0] || {}
      const spend = parseFloat(ins.spend || '0')
      const clicks = parseInt(ins.clicks || '0')
      const impressions = parseInt(ins.impressions || '0')
      const actions: any[] = ins.actions || []
      const actionValues: any[] = ins.action_values || []
      const convTypes = ['purchase', 'lead', 'complete_registration', 'offsite_conversion']
      const conversions = actions.filter(a => convTypes.includes(a.action_type)).reduce((s, a) => s + parseFloat(a.value || '0'), 0)
      const convValue = actionValues.filter(a => a.action_type === 'purchase').reduce((s, a) => s + parseFloat(a.value || '0'), 0)
      return {
        id: c.id, name: c.name, status: c.status,
        budget: c.daily_budget ? (parseFloat(c.daily_budget) / 100).toFixed(2) : null,
        spend: spend.toFixed(2), clicks, impressions,
        ctr: ins.ctr ? (parseFloat(ins.ctr) * 100).toFixed(2) : '0.00',
        conversions: conversions.toFixed(1),
        conversionValue: convValue.toFixed(2),
        roas: spend > 0 && convValue > 0 ? (convValue / spend).toFixed(2) : null,
      }
    })
    const tSpend = campaigns.reduce((s: number, c: any) => s + parseFloat(c.spend), 0)
    const tClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0)
    const tImpressions = campaigns.reduce((s: number, c: any) => s + c.impressions, 0)
    const tConversions = campaigns.reduce((s: number, c: any) => s + parseFloat(c.conversions), 0)
    const tConvValue = campaigns.reduce((s: number, c: any) => s + parseFloat(c.conversionValue), 0)
    return NextResponse.json({
      campaigns,
      totalCost: tSpend.toFixed(2), totalClicks: tClicks, totalImpressions: tImpressions,
      totalConversions: tConversions.toFixed(1), totalConversionValue: tConvValue.toFixed(2),
      roas: tSpend > 0 && tConvValue > 0 ? (tConvValue / tSpend).toFixed(2) : '0',
      avgCtr: tImpressions > 0 ? ((tClicks / tImpressions) * 100).toFixed(2) : '0',
      activeCampaigns: campaigns.filter((c: any) => c.status === 'ACTIVE').length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
