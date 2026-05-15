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
  const customStart = searchParams.get('customStart') || null
  const customEnd = searchParams.get('customEnd') || null
  const campaignId = searchParams.get('campaignId') || null

  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })

  const { data: tokenRow } = await supabaseAdmin
    .from('meta_tokens')
    .select('access_token')
    .eq('user_email', session.user.email)
    .single()

  if (!tokenRow?.access_token) return NextResponse.json({ error: 'No Meta token found' }, { status: 401 })

  const token = tokenRow.access_token
  const presets: Record<string, string> = {
    TODAY: 'today', YESTERDAY: 'yesterday',
    LAST_7_DAYS: 'last_7d', LAST_14_DAYS: 'last_14d',
    LAST_30_DAYS: 'last_30d', THIS_MONTH: 'this_month',
    LAST_MONTH: 'last_month', LAST_90_DAYS: 'last_90d',
  }

  const id = accountId.startsWith('act_') ? accountId : 'act_' + accountId
  const fields = 'spend,clicks,impressions,actions,action_values'

  try {
    let url: string
    if (campaignId) {
      // Campaign-level daily breakdown
      if (customStart && customEnd) {
        url = `https://graph.facebook.com/v18.0/${campaignId}/insights?fields=${fields}&time_increment=1&time_range={"since":"${customStart}","until":"${customEnd}"}&limit=90&access_token=${token}`
      } else {
        const preset = presets[dateRange] || 'last_30d'
        url = `https://graph.facebook.com/v18.0/${campaignId}/insights?fields=${fields}&time_increment=1&date_preset=${preset}&limit=90&access_token=${token}`
      }
    } else {
      // Account-level daily breakdown
      if (customStart && customEnd) {
        url = `https://graph.facebook.com/v18.0/${id}/insights?fields=${fields}&time_increment=1&time_range={"since":"${customStart}","until":"${customEnd}"}&limit=90&access_token=${token}`
      } else {
        const preset = presets[dateRange] || 'last_30d'
        url = `https://graph.facebook.com/v18.0/${id}/insights?fields=${fields}&time_increment=1&date_preset=${preset}&limit=90&access_token=${token}`
      }
    }

    const allRows: any[] = []
    let nextUrl: string | null = url
    while (nextUrl) {
      const res: Response = await fetch(nextUrl)
      const data = await res.json()
      if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
      if (data.data) allRows.push(...data.data)
      nextUrl = data.paging?.next || null
    }

    const convTypes = ['purchase', 'lead', 'complete_registration', 'offsite_conversion', 'submit_application']

    const daily = allRows.map((row: any) => {
      const actions: any[] = row.actions || []
      const actionValues: any[] = row.action_values || []
      const conversions = actions
        .filter(a => convTypes.includes(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || '0'), 0)
      const convValue = actionValues
        .filter(a => a.action_type === 'purchase')
        .reduce((s, a) => s + parseFloat(a.value || '0'), 0)

      return {
        date: row.date_start,
        cost: parseFloat(row.spend || '0'),
        clicks: parseInt(row.clicks || '0'),
        impressions: parseInt(row.impressions || '0'),
        conversions: parseFloat(conversions.toFixed(1)),
        conversionValue: parseFloat(convValue.toFixed(2)),
      }
    })

    return NextResponse.json({ daily })
  } catch (e: any) {
    console.error('Meta daily error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
