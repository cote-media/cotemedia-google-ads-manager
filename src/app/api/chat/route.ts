import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_AWARENESS: 'Brand Awareness', OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Lead Generation', OUTCOME_SALES: 'Sales',
  OUTCOME_TRAFFIC: 'Traffic', REACH: 'Reach', LEAD_GENERATION: 'Lead Gen',
  CONVERSIONS: 'Conversions', LINK_CLICKS: 'Traffic', VIDEO_VIEWS: 'Video Views',
  SEARCH: 'Search', DISPLAY: 'Display', PERFORMANCE_MAX: 'Performance Max',
  SHOPPING: 'Shopping', VIDEO: 'Video', DISCOVERY: 'Discovery/Demand Gen',
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    message,
    history,
    // Platform context
    platform,
    platformData,
    dateRange,
    // Client context
    clientId,
    clientName,
    accountId,
    // Drill context
    drillLevel,
    drillCampaign,
    drillAdGroup,
    // Sub-level data
    subRows,
  } = await request.json()

  // Fetch client context from Supabase
  let clientContext: any = null
  if (clientId) {
    const { data } = await supabaseAdmin
      .from('client_context')
      .select('*')
      .eq('client_id', clientId)
      .eq('user_email', session.user.email)
      .single()
    clientContext = data
  }

  const platformLabel = platform === 'google' ? 'Google Ads'
    : platform === 'meta' ? 'Meta Ads'
    : 'Google Ads + Meta Ads (combined view)'

  // Build drill context description
  const drillContext = (() => {
    if (drillLevel === 'adgroups' && drillCampaign) {
      return `The user is currently viewing AD GROUPS within campaign: "${drillCampaign.name}" (${drillCampaign.platform || platform})`
    }
    if (drillLevel === 'ads' && drillCampaign && drillAdGroup) {
      return `The user is currently viewing ADS within ad group/set: "${drillAdGroup.name}" → campaign: "${drillCampaign.name}"`
    }
    return 'The user is viewing the CAMPAIGNS list'
  })()

  // Build data summary based on what's visible
  const totals = platformData?.totals
  const campaigns = platformData?.campaigns || []
  const currentRows = (drillLevel !== 'campaigns' && subRows?.length > 0) ? subRows : campaigns

  const topRows = [...currentRows]
    .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
    .slice(0, 10)
    .map((row: any) => {
      const obj = row.objective || ''
      const objLabel = OBJECTIVE_LABELS[obj] ? ` [${OBJECTIVE_LABELS[obj]}]` : ''
      const platform_tag = row.platform ? ` (${row.platform})` : ''
      return `- ${row.name}${platform_tag}${objLabel}: $${Number(row.spend || 0).toFixed(2)} spend, ${Number(row.clicks || 0).toLocaleString()} clicks, CTR ${Number(row.ctr || 0).toFixed(2)}%, ${Number(row.conversions || 0).toFixed(1)} conv, ROAS ${row.roas ? Number(row.roas).toFixed(2) + 'x' : 'N/A'}, Status: ${row.status || 'unknown'}`
    })
    .join('\n')

  const clientProfileContext = clientContext ? `
Client Profile:
- Business type: ${clientContext.business_type || 'not specified'}
- Primary KPI: ${clientContext.primary_kpi || 'not specified'}
- Notes: ${clientContext.user_notes || 'none'}
${clientContext.funnel_notes ? '- Funnel context: ' + clientContext.funnel_notes : ''}` : ''

  const systemPrompt = `You are Claude, an expert digital advertising analyst built into Advar — an ads management platform for marketing agencies. You are having a conversation with an agency professional about their client's ad performance.

Current context:
- Client: ${clientName}
- Platform: ${platformLabel}
- Date range: ${dateRange?.replace(/_/g, ' ').toLowerCase() || 'last 30 days'}
- Current view: ${drillContext}
${clientProfileContext}

${totals ? `Account totals for this period:
- Total Spend: $${Number(totals.spend || 0).toLocaleString()}
- Clicks: ${Number(totals.clicks || 0).toLocaleString()}
- Impressions: ${Number(totals.impressions || 0).toLocaleString()}
- Conversions: ${totals.conversions || 0}
- ROAS: ${totals.roas ? Number(totals.roas).toFixed(2) + 'x' : 'N/A'}
- Avg CTR: ${Number(totals.avgCtr || 0).toFixed(2)}%
- Active campaigns: ${totals.activeCampaigns || 0}` : ''}

Current ${drillLevel === 'ads' ? 'ads' : drillLevel === 'adgroups' ? 'ad groups/sets' : 'campaigns'} data (top by spend):
${topRows || 'No data available'}

CRITICAL RULES:
- Always respect campaign objectives — never criticize CTR for awareness campaigns, never demand ROAS from lead gen campaigns
- Be specific — use actual names and numbers from the data
- You are talking to an experienced agency professional, not a beginner
- If the user gives you context about a client (goals, industry, funnel stage), incorporate it and remember it for this conversation
- Be conversational and direct — no unnecessary preamble
- When suggesting actions, be specific and realistic`

  const messages = [
    ...(history || []).map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message }
  ]

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    })
    const responseText = (response.content[0] as any).text?.trim() || ''
    return NextResponse.json({ response: responseText })
  } catch (e: any) {
    console.error('Chat error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
