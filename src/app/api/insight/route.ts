import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Map campaign objectives to their correct KPIs and evaluation framework
const OBJECTIVE_FRAMEWORK: Record<string, { label: string; primaryKPIs: string[]; ignoreKPIs: string[]; notes: string }> = {
  OUTCOME_AWARENESS: { label: 'Brand Awareness', primaryKPIs: ['CPM', 'reach', 'frequency', 'impressions'], ignoreKPIs: ['ROAS', 'CTR', 'conversions', 'CPA'], notes: 'Never evaluate CTR or ROAS for awareness campaigns. Focus on CPM efficiency and audience reach.' },
  OUTCOME_ENGAGEMENT: { label: 'Engagement', primaryKPIs: ['engagement rate', 'CPE', 'post reactions', 'shares'], ignoreKPIs: ['ROAS', 'conversions'], notes: 'Evaluate engagement metrics, not conversion metrics.' },
  OUTCOME_LEADS: { label: 'Lead Generation', primaryKPIs: ['CPL', 'leads', 'form completions'], ignoreKPIs: ['ROAS', 'purchases'], notes: 'CPL is the only metric that matters. A low CTR is fine if CPL is efficient.' },
  OUTCOME_SALES: { label: 'Sales / Conversions', primaryKPIs: ['ROAS', 'CPA', 'purchases', 'revenue'], ignoreKPIs: [], notes: 'ROAS and CPA are primary. CTR is secondary.' },
  OUTCOME_TRAFFIC: { label: 'Traffic', primaryKPIs: ['CPC', 'CTR', 'link clicks', 'landing page views'], ignoreKPIs: ['ROAS', 'conversions'], notes: 'CPC and CTR matter. Do not expect or evaluate conversions.' },
  REACH: { label: 'Reach', primaryKPIs: ['CPM', 'reach', 'frequency'], ignoreKPIs: ['ROAS', 'CTR', 'conversions'], notes: 'Maximize reach at lowest CPM. CTR and conversions are irrelevant.' },
  LEAD_GENERATION: { label: 'Lead Generation', primaryKPIs: ['CPL', 'leads'], ignoreKPIs: ['ROAS', 'purchases'], notes: 'CPL is the primary metric.' },
  CONVERSIONS: { label: 'Conversions', primaryKPIs: ['ROAS', 'CPA', 'purchases'], ignoreKPIs: [], notes: 'Evaluate conversion efficiency.' },
  LINK_CLICKS: { label: 'Traffic', primaryKPIs: ['CPC', 'CTR', 'clicks'], ignoreKPIs: ['ROAS', 'conversions'], notes: 'Optimize for clicks and CPC.' },
  VIDEO_VIEWS: { label: 'Video Views', primaryKPIs: ['CPV', 'ThruPlays', 'video completion rate'], ignoreKPIs: ['ROAS', 'CTR', 'conversions'], notes: 'Never evaluate CTR or conversions for video view campaigns.' },
  POST_ENGAGEMENT: { label: 'Post Engagement', primaryKPIs: ['CPE', 'reactions', 'comments', 'shares'], ignoreKPIs: ['ROAS', 'conversions'], notes: 'Engagement metrics only.' },
  BRAND_AWARENESS: { label: 'Brand Awareness', primaryKPIs: ['estimated ad recall lift', 'reach', 'CPM'], ignoreKPIs: ['ROAS', 'CTR', 'conversions'], notes: 'Never evaluate CTR or conversions.' },
  APP_INSTALLS: { label: 'App Installs', primaryKPIs: ['CPI', 'installs', 'cost per install'], ignoreKPIs: ['ROAS'], notes: 'Cost per install is the primary metric.' },
  PRODUCT_CATALOG_SALES: { label: 'Catalog Sales', primaryKPIs: ['ROAS', 'purchases', 'revenue'], ignoreKPIs: [], notes: 'This is an e-commerce objective. ROAS matters.' },
}

// Google Ads campaign type framework
const GOOGLE_TYPE_FRAMEWORK: Record<string, { label: string; primaryKPIs: string[]; ignoreKPIs: string[]; notes: string }> = {
  SEARCH: { label: 'Search', primaryKPIs: ['CTR', 'Quality Score', 'CPC', 'conversions', 'CPA'], ignoreKPIs: [], notes: 'CTR matters significantly for search. Evaluate Quality Score and CPC efficiency.' },
  DISPLAY: { label: 'Display', primaryKPIs: ['CPM', 'viewability', 'reach'], ignoreKPIs: ['CTR', 'conversions'], notes: 'Display CTR is naturally very low (0.1-0.35% is normal). Never criticize low CTR on display campaigns.' },
  PERFORMANCE_MAX: { label: 'Performance Max', primaryKPIs: ['ROAS', 'CPA', 'conversions'], ignoreKPIs: [], notes: 'PMax optimizes automatically. Evaluate conversion efficiency and ROAS.' },
  VIDEO: { label: 'Video', primaryKPIs: ['CPV', 'view rate', 'video completion'], ignoreKPIs: ['CTR', 'conversions'], notes: 'Video CTR is not a meaningful metric. Focus on view rate and completion.' },
  SHOPPING: { label: 'Shopping', primaryKPIs: ['ROAS', 'CPA', 'conversion rate'], ignoreKPIs: [], notes: 'Shopping is conversion-focused. ROAS is primary.' },
  SMART: { label: 'Smart', primaryKPIs: ['conversions', 'CPA'], ignoreKPIs: [], notes: 'Smart campaigns auto-optimize for conversions.' },
  APP: { label: 'App', primaryKPIs: ['CPI', 'installs', 'in-app actions'], ignoreKPIs: ['ROAS'], notes: 'Cost per install is primary.' },
  DISCOVERY: { label: 'Discovery / Demand Gen', primaryKPIs: ['CTR', 'CPM', 'reach'], ignoreKPIs: ['conversions'], notes: 'Discovery is upper-funnel. CTR relative to impressions matters, but do not expect high conversion volume.' },
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { totals, campaigns, platform, dateRange, clientName, clientId, conversationHistory, location } = await request.json()
  if (!totals || !campaigns) return NextResponse.json({ error: 'Missing data' }, { status: 400 })

  // Fetch client context
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

  const platformLabel = platform === 'google' ? 'Google Ads' : platform === 'meta' ? 'Meta Ads' : 'Google Ads + Meta Ads combined'
  const dateLabel = dateRange?.replace(/_/g, ' ').toLowerCase() || 'the selected period'

  // Build objective-aware campaign summary
  const campaignSummary = [...campaigns]
    .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
    .slice(0, 8)
    .map((c: any) => {
      const objective = c.objective || ''
      const framework = OBJECTIVE_FRAMEWORK[objective] || GOOGLE_TYPE_FRAMEWORK[objective] || null
      const objectiveLabel = framework ? framework.label : (objective || 'unknown objective')
      return `- ${c.name} [${objectiveLabel}]: $${Number(c.spend).toFixed(2)} spend, ${Number(c.conversions).toFixed(1)} conv, ROAS ${c.roas ? Number(c.roas).toFixed(2) + 'x' : 'N/A'}, CTR ${Number(c.ctr).toFixed(2)}%, Status: ${c.status}`
    })
    .join('\n')

  // Build objective framework context
  const objectiveContext = (() => {
    const objectives = [...new Set(campaigns.map((c: any) => c.objective).filter(Boolean))] as string[]
    if (objectives.length === 0) return ''
    return '\nCampaign Objective Framework:\n' + objectives.map(obj => {
      const f = OBJECTIVE_FRAMEWORK[obj] || GOOGLE_TYPE_FRAMEWORK[obj]
      if (!f) return ''
      return `- ${obj} (${f.label}): Primary KPIs = ${f.primaryKPIs.join(', ')}. ${f.notes}${f.ignoreKPIs.length > 0 ? ` DO NOT evaluate: ${f.ignoreKPIs.join(', ')}.` : ''}`
    }).filter(Boolean).join('\n')
  })()

  // Client profile context
  const clientProfileContext = clientContext ? `
Client Profile:
- Business type: ${clientContext.business_type || 'not specified'}
- Primary KPI: ${clientContext.primary_kpi || 'not specified'}
- Notes: ${clientContext.user_notes || 'none'}
${clientContext.funnel_notes ? '- Funnel context: ' + clientContext.funnel_notes : ''}` : ''

  const systemPrompt = `You are an expert digital advertising analyst embedded in Advar, an ads management platform for marketing agencies. You are analyzing ${clientName}'s ${platformLabel} performance for ${dateLabel}.
${clientProfileContext}

CRITICAL RULE — OBJECTIVE-AWARE ANALYSIS:
Every campaign has an objective that determines which metrics are meaningful. You MUST follow these rules:
- AWARENESS/REACH/VIDEO objectives: NEVER criticize CTR or ROAS. These campaigns are not meant to convert.
- TRAFFIC objectives: CTR and CPC matter. Do NOT expect conversions.
- LEAD GEN objectives: CPL is the only metric that matters.
- CONVERSIONS/SALES objectives: ROAS and CPA are primary.
- DISPLAY campaigns: 0.1-0.35% CTR is completely normal. Never call this "low".
- PERFORMANCE MAX: Auto-optimizes. Evaluate conversion efficiency only.

If you do not know the objective, do not assume the campaign should convert.
${objectiveContext}

Account data for ${dateLabel}:
- Total Spend: $${Number(totals.spend).toLocaleString()}
- Clicks: ${Number(totals.clicks).toLocaleString()}
- Impressions: ${Number(totals.impressions).toLocaleString()}
- Conversions: ${totals.conversions}
- ROAS: ${totals.roas ? Number(totals.roas).toFixed(2) + 'x' : 'N/A'}
- Avg CTR: ${Number(totals.avgCtr).toFixed(2)}%
- Active Campaigns: ${totals.activeCampaigns}

Top campaigns by spend:
${campaignSummary}

Current view: ${location || 'overview'}

Response rules:
- Be specific — use actual campaign names and numbers
- Never criticize a metric that isn't relevant to the campaign's objective
- Initial analysis: 1-2 sentences max, 50 words max
- Follow-up conversation: be more detailed and conversational
- No markdown, no bullet points in initial analysis
- Lead with the single most actionable insight`

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
