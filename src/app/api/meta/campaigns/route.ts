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
  const datePresetMap: Record<string, string> = {
    'TODAY': 'today', 'YESTERDAY': 'yesterday', 'LAST_7_DAYS': 'last_7d',
    'LAST_14_DAYS': 'last_14d', 'LAST_30_DAYS': 'last_30d',
    'THIS_MONTH': 'this_month', 'LAST_MONTH': 'last_month', 'LAST_90_DAYS': 'last_90d',
  }
  const datePreset = datePresetMap[dateRange] || 'last_30d'

  try {
    const normalizedId = accountId.startsWith('act_') ? accountId : 'act_' + accountId
    const fields = 'name,status,objective,daily_budget'
    const insightFields = 'spend,clicks,impressions,ctr,cpc,cpm,actions,action_values,reach,frequency'
    const res: Response = await fetch(`https://graph.facebook.com/v18.0/${normalizedId}/campaigns?fields=${fields},insights{${insightFields}}&date_preset=${datePreset}&limit=100&access_token=${token}`)
    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })

    const campaigns = (data.data || []).map((c: any) => {
      const ins = c.insights?.data?.[0] || {}
      const spend = parseFloat(ins.spend || '0')
      const clicks = parseInt(ins.clicks || '0')
      const impressions = parseInt(ins.impressions || '0')
      const actions = ins.actions || []
      const actionValues = ins.action_values || []
      const conversions = actions.filter((a: any) => ['purchase','lead','complete_registration','offsite_conversion'].includes(a.action_type)).reduce((s: number, a: any) => s + parseFloat(a.value || '0'), 0)
      const conversionValue = actionValues.filter((a: any) => a.action_type === 'purchase').reduce((s: number, a: any) => s + parseFloat(a.value || '0'), 0)
      return {
        id: c.id, name: c.name, status: c.status, objective: c.objective,
        budget: c.daily_budget ? (parseFloat(c.daily_budget) / 100).toFixed(2) : null,
        spend: spend.toFixed(2), clicks, impressions,
        ctr: ins.ctr ? (parseFloat(ins.ctr) * 100).toFixed(2) : '0.00',
        cpc: ins.cpc ? parseFloat(ins.cpc).toFixed(2) : null,
        conversions: conversions.toFixed(1), conversionValue: conversionValue.toFixed(2),
        roas: spend > 0 && conversionValue > 0 ? (conversionValue / spend).toFixed(2) : null,
      }
    })

    const totalSpend = campaigns.reduce((s: number, c: any) => s + parseFloat(c.spend), 0)
    const totalClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0)
    const totalImpressions = campaigns.reduce((s: number, c: any) => s + c.impressions, 0)
    const totalConversions = campaigns.reduce((s: number, c: any) => s + parseFloat(c.conversions), 0)
    const totalConversionValue = campaigns.reduce((s: number, c: any) =
mkdir -p src/app/api/meta/campaigns && cat > src/app/api/meta/campaigns/route.ts << 'ENDOFFILE'
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
  const datePresetMap: Record<string, string> = {
    'TODAY': 'today', 'YESTERDAY': 'yesterday', 'LAST_7_DAYS': 'last_7d',
    'LAST_14_DAYS': 'last_14d', 'LAST_30_DAYS': 'last_30d',
    'THIS_MONTH': 'this_month', 'LAST_MONTH': 'last_month', 'LAST_90_DAYS': 'last_90d',
  }
  const datePreset = datePresetMap[dateRange] || 'last_30d'

  try {
    const normalizedId = accountId.startsWith('act_') ? accountId : 'act_' + accountId
    const fields = 'name,status,objective,daily_budget'
    const insightFields = 'spend,clicks,impressions,ctr,cpc,cpm,actions,action_values,reach,frequency'
    const res: Response = await fetch(`https://graph.facebook.com/v18.0/${normalizedId}/campaigns?fields=${fields},insights{${insightFields}}&date_preset=${datePreset}&limit=100&access_token=${token}`)
    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })

    const campaigns = (data.data || []).map((c: any) => {
      const ins = c.insights?.data?.[0] || {}
      const spend = parseFloat(ins.spend || '0')
      const clicks = parseInt(ins.clicks || '0')
      const impressions = parseInt(ins.impressions || '0')
      const actions = ins.actions || []
      const actionValues = ins.action_values || []
      const conversions = actions.filter((a: any) => ['purchase','lead','complete_registration','offsite_conversion'].includes(a.action_type)).reduce((s: number, a: any) => s + parseFloat(a.value || '0'), 0)
      const conversionValue = actionValues.filter((a: any) => a.action_type === 'purchase').reduce((s: number, a: any) => s + parseFloat(a.value || '0'), 0)
      return {
        id: c.id, name: c.name, status: c.status, objective: c.objective,
        budget: c.daily_budget ? (parseFloat(c.daily_budget) / 100).toFixed(2) : null,
        spend: spend.toFixed(2), clicks, impressions,
        ctr: ins.ctr ? (parseFloat(ins.ctr) * 100).toFixed(2) : '0.00',
        cpc: ins.cpc ? parseFloat(ins.cpc).toFixed(2) : null,
        conversions: conversions.toFixed(1), conversionValue: conversionValue.toFixed(2),
        roas: spend > 0 && conversionValue > 0 ? (conversionValue / spend).toFixed(2) : null,
      }
    })

    const totalSpend = campaigns.reduce((s: number, c: any) => s + parseFloat(c.spend), 0)
    const totalClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0)
    const totalImpressions = campaigns.reduce((s: number, c: any) => s + c.impressions, 0)
    const totalConversions = campaigns.reduce((s: number, c: any) => s + parseFloat(c.conversions), 0)
    const totalConversionValue = campaigns.reduce((s: number, c: any) => s + parseFloat(c.conversionValue), 0)

    return NextResponse.json({
      campaigns, totalCost: totalSpend.toFixed(2), totalClicks, totalImpressions,
      totalConversions: totalConversions.toFixed(1), totalConversionValue: totalConversionValue.toFixed(2),
      roas: totalSpend > 0 && totalConversionValue > 0 ? (totalConversionValue / totalSpend).toFixed(2) : '0',
      avgCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0',
      activeCampaigns: campaigns.filter((c: any) => c.status === 'ACTIVE').length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
