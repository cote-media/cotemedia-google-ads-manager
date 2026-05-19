import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const OBJECTIVE_FRAMEWORK: Record<string, { label: string; primaryKPIs: string[]; ignoreKPIs: string[]; notes: string }> = {
  OUTCOME_AWARENESS: { label: 'Brand Awareness', primaryKPIs: ['CPM', 'reach', 'frequency'], ignoreKPIs: ['ROAS', 'CTR', 'conversions'], notes: 'Never evaluate CTR or ROAS. Focus on CPM efficiency and reach.' },
  OUTCOME_ENGAGEMENT: { label: 'Engagement', primaryKPIs: ['engagement rate', 'CPE'], ignoreKPIs: ['ROAS', 'conversions'], notes: 'Engagement metrics only.' },
  OUTCOME_LEADS: { label: 'Lead Generation', primaryKPIs: ['CPL', 'leads'], ignoreKPIs: ['ROAS', 'purchases'], notes: 'CPL is the only metric that matters.' },
  OUTCOME_SALES: { label: 'Sales', primaryKPIs: ['ROAS', 'CPA', 'purchases'], ignoreKPIs: [], notes: 'ROAS and CPA are primary.' },
  OUTCOME_TRAFFIC: { label: 'Traffic', primaryKPIs: ['CPC', 'CTR', 'clicks'], ignoreKPIs: ['ROAS', 'conversions'], notes: 'CPC and CTR matter. Do not expect conversions.' },
  REACH: { label: 'Reach', primaryKPIs: ['CPM', 'reach', 'frequency'], ignoreKPIs: ['ROAS', 'CTR', 'conversions'], notes: 'Maximize reach at lowest CPM.' },
  LEAD_GENERATION: { label: 'Lead Generation', primaryKPIs: ['CPL', 'leads'], ignoreKPIs: ['ROAS'], notes: 'CPL is primary.' },
  CONVERSIONS: { label: 'Conversions', primaryKPIs: ['ROAS', 'CPA'], ignoreKPIs: [], notes: 'Conversion efficiency.' },
  LINK_CLICKS: { label: 'Traffic', primaryKPIs: ['CPC', 'CTR'], ignoreKPIs: ['ROAS', 'conversions'], notes: 'Optimize for clicks.' },
  VIDEO_VIEWS: { label: 'Video Views', primaryKPIs: ['CPV', 'view rate'], ignoreKPIs: ['ROAS', 'CTR', 'conversions'], notes: 'Never evaluate CTR or conversions.' },
  SEARCH: { label: 'Search', primaryKPIs: ['CTR', 'CPC', 'conversions', 'CPA'], ignoreKPIs: [], notes: 'CTR matters for search. Quality Score and CPC efficiency are key.' },
  DISPLAY: { label: 'Display', primaryKPIs: ['CPM', 'reach'], ignoreKPIs: ['CTR', 'conversions'], notes: '0.1-0.35% CTR is normal for display. Never criticize low CTR.' },
  PERFORMANCE_MAX: { label: 'Performance Max', primaryKPIs: ['ROAS', 'CPA'], ignoreKPIs: [], notes: 'Auto-optimizes. Evaluate conversion efficiency only.' },
  VIDEO: { label: 'Video', primaryKPIs: ['CPV', 'view rate'], ignoreKPIs: ['CTR', 'conversions'], notes: 'View rate and completion. CTR is not meaningful.' },
  SHOPPING: { label: 'Shopping', primaryKPIs: ['ROAS', 'CPA'], ignoreKPIs: [], notes: 'Shopping is conversion-focused.' },
  DISCOVERY: { label: 'Discovery/Demand Gen', primaryKPIs: ['CTR', 'CPM'], ignoreKPIs: ['conversions'], notes: 'Upper-funnel. Do not expect high conversion volume.' },
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { totals, campaigns, platform, dateRange, clientName, clientId, conversationHistory, location } = await request.json()
  if (!totals || !campaigns) return NextResponse.json({ error: 'Missing data' }, { status: 400 })

  // Fetch client context including ALL conversation threads
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

  const platformLabel = platform === 'google' ? 'Google Ads' : platform === 'meta' ? 'Meta Ads' : 'Google + Meta combined'
  const dateLabel = dateRange?.replace(/_/g, ' ').toLowerCase() || 'the selected period'

  const campaignSummary = [...campaigns]
    .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
    .slice(0, 8)
    .map((c: any) => {
      const f = OBJECTIVE_FRAMEWORK[c.objective || '']
      const objLabel = f ? f.label : (c.objective || 'unknown objective')
      return `- ${c.name}${c.platform ? ' (' + c.platform + ')' : ''} [${objLabel}]: $${Number(c.spend || 0).toFixed(2)} spend, ${Number(c.conversions || 0).toFixed(1)} conv, ROAS ${c.roas ? Number(c.roas).toFixed(2) + 'x' : 'N/A'}, CTR ${Number(c.ctr || 0).toFixed(2)}%, Status: ${c.status}`
    })
    .join('\n')

  const objectiveContext = (() => {
    const objectives = [...new Set(campaigns.map((c: any) => c.objective).filter(Boolean))] as string[]
    if (!objectives.length) return ''
    return '\nObjective rules:\n' + objectives.map(obj => {
      const f = OBJECTIVE_FRAMEWORK[obj]
      if (!f) return ''
      return `- ${obj}: Primary=${f.primaryKPIs.join(', ')}. ${f.notes}${f.ignoreKPIs.length ? ' NEVER evaluate: ' + f.ignoreKPIs.join(', ') : ''}`
    }).filter(Boolean).join('\n')
  })()

  // Client profile context
  const profileContext = clientContext ? `
Client Profile:
- Business type: ${clientContext.business_type || 'not specified'}
- Primary KPI: ${clientContext.primary_kpi || 'not specified'}
- Notes: ${clientContext.user_notes || 'none'}
${clientContext.funnel_notes ? '- Funnel: ' + clientContext.funnel_notes : ''}` : ''

  // Build cross-page conversation context
  // This is the key feature — Claude sees what the user told it on OTHER pages too
  const allConversations = clientContext?.conversations || {}
  const currentLocationKey = (location || 'overview') + '-' + platform
  const crossPageContext = (() => {
    const otherThreads = Object.entries(allConversations)
      .filter(([key]) => key !== currentLocationKey)
      .filter(([, msgs]: [string, any]) => Array.isArray(msgs) && msgs.length > 0)
    if (!otherThreads.length) return ''
    return '\nPrevious conversations on other pages:\n' + otherThreads.map(([key, msgs]: [string, any]) => {
      const lastFew = (msgs as any[]).slice(-4) // Last 2 exchanges from other pages
      return `[${key}]: ` + lastFew.map((m: any) => `${m.role === 'user' ? 'User' : 'Claude'}: ${m.content}`).join(' | ')
    }).join('\n')
  })()

  const systemPrompt = `You are an expert digital advertising analyst embedded in Advar, an ads management platform for marketing agencies. You are analyzing ${clientName}'s ${platformLabel} performance for ${dateLabel}.
${profileContext}
${crossPageContext ? crossPageContext + '\n' : ''}
CRITICAL — OBJECTIVE-AWARE ANALYSIS:
Every campaign has an objective that determines which metrics are meaningful. NEVER criticize a metric that is irrelevant to the campaign objective.
- AWARENESS/REACH/VIDEO: NEVER criticize CTR or ROAS
- DISPLAY: 0.1-0.35% CTR is completely normal, never call it low
- TRAFFIC: CTR/CPC matter, do NOT expect conversions
- LEAD GEN: CPL only
- CONVERSIONS/SALES/PMAX: ROAS and CPA primary
${objectiveContext}

Account data for ${dateLabel}:
- Total Spend: $${Number(totals.spend || 0).toLocaleString()}
- Clicks: ${Number(totals.clicks || 0).toLocaleString()}
- Impressions: ${Number(totals.impressions || 0).toLocaleString()}
- Conversions: ${totals.conversions || 0}
- ROAS: ${totals.roas ? Number(totals.roas).toFixed(2) + 'x' : 'N/A'}
- Avg CTR: ${Number(totals.avgCtr || 0).toFixed(2)}%
- Active campaigns: ${totals.activeCampaigns || 0}

Top campaigns by spend:
${campaignSummary}

Current view: ${location || 'overview'}

Response rules:
- Be specific — use actual campaign names and numbers
- If the user has given context in previous conversations (e.g. "ignore ROAS"), ALWAYS respect that
- Initial analysis: 1-2 sentences, 50 words max
- Follow-up: detailed and conversational, up to 400 words
- No markdown in initial analysis`

  const isInitial = !conversationHistory || conversationHistory.length === 0
  const messages = isInitial
    ? [{ role: 'user' as const, content: 'Give me a brief analysis of this account.' }]
    : conversationHistory.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isInitial ? 150 : 500,
      system: systemPrompt,
      messages,
    })
    const insight = (response.content[0] as any).text?.trim() || ''
    return NextResponse.json({ insight })
  } catch (e: any) {
    console.error('Insight API error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
