import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaignId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart')
  const customEnd = searchParams.get('customEnd')

  if (!campaignId) return NextResponse.json({ error: 'campaignId required' }, { status: 400 })

  const { data: tokenRow } = await supabaseAdmin
    .from('meta_tokens').select('access_token').eq('user_email', session.user.email).single()
  if (!tokenRow?.access_token) return NextResponse.json({ error: 'No Meta token' }, { status: 401 })

  const token = tokenRow.access_token
  const presets: Record<string, string> = {
    TODAY: 'today', YESTERDAY: 'yesterday', LAST_7_DAYS: 'last_7d',
    LAST_14_DAYS: 'last_14d', LAST_30_DAYS: 'last_30d',
    THIS_MONTH: 'this_month', LAST_MONTH: 'last_month', LAST_90_DAYS: 'last_90d',
  }

  let dateParam: string
  if (customStart && customEnd) {
    dateParam = `insights.time_range({"since":"${customStart}","until":"${customEnd}"})`
  } else {
    const preset = presets[dateRange] || 'last_30d'
    dateParam = `insights.date_preset(${preset})`
  }

  const insightFields = 'spend,clicks,impressions,ctr,cpc,cpm,actions,action_values,reach,frequency'
  const fields = `name,status,effective_status,daily_budget,lifetime_budget,targeting,${dateParam}{${insightFields}}`

  try {
    const allRaw: any[] = []
    let nextUrl: string | null = `https://graph.facebook.com/v18.0/${campaignId}/adsets?fields=${fields}&limit=100&access_token=${token}`
    while (nextUrl) {
      const res: Response = await fetch(nextUrl)
      const data = await res.json()
      if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
      if (data.data) allRaw.push(...data.data)
      nextUrl = data.paging?.next || null
    }

    const convTypes = ['purchase', 'lead', 'complete_registration', 'offsite_conversion', 'submit_application']

    const adSets = allRaw.map((s: any) => {
      const ins = s.insights?.data?.[0] || {}
      const spend = parseFloat(ins.spend || '0')
      const clicks = parseInt(ins.clicks || '0')
      const impressions = parseInt(ins.impressions || '0')
      const actions: any[] = ins.actions || []
      const actionValues: any[] = ins.action_values || []
      const conversions = actions.filter(a => convTypes.includes(a.action_type)).reduce((sum, a) => sum + parseFloat(a.value || '0'), 0)
      const convValue = actionValues.filter(a => a.action_type === 'purchase').reduce((sum, a) => sum + parseFloat(a.value || '0'), 0)
      const ctr = ins.ctr ? parseFloat(ins.ctr) : (impressions > 0 ? (clicks / impressions) * 100 : 0)
      const status = String(s.effective_status || s.status || '').toUpperCase()

      return {
        id: s.id,
        name: s.name,
        status: status === 'ACTIVE' ? 'active' : status === 'PAUSED' || status === 'CAMPAIGN_PAUSED' ? 'paused' : 'completed',
        platform: 'meta',
        spend,
        clicks,
        impressions,
        ctr,
        conversions,
        conversionValue: convValue,
        roas: spend > 0 && convValue > 0 ? convValue / spend : null,
        costPerConv: conversions > 0 ? spend / conversions : null,
        convRate: clicks > 0 ? (conversions / clicks) * 100 : null,
        avgCpc: ins.cpc ? parseFloat(ins.cpc) : null,
        budget: s.daily_budget ? parseFloat(s.daily_budget) / 100 : s.lifetime_budget ? parseFloat(s.lifetime_budget) / 100 : null,
        cpm: ins.cpm ? parseFloat(ins.cpm) : null,
        reach: parseInt(ins.reach || '0'),
        frequency: ins.frequency ? parseFloat(ins.frequency) : null,
      }
    })

    return NextResponse.json({ adSets })
  } catch (e: any) {
    console.error('Meta ad sets error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
