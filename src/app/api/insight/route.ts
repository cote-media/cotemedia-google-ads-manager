import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { totals, campaigns, platform, dateRange, clientName, clientId, conversationHistory, location } = await request.json()
  if (!totals || !campaigns) return NextResponse.json({ error: 'Missing data' }, { status: 400 })

  // Fetch client context if clientId provided
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

  const topCampaigns = [...campaigns]
    .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
    .slice(0, 8)
    .map((c: any) => `- ${c.name}${c.platform ? ' (' + c.platform + ')' : ''}: $${Number(c.spend).toFixed(2)} spend, ${Number(c.conversions).toFixed(1)} conv, ROAS ${c.roas ? Number(c.roas).toFixed(2) + 'x' : 'N/A'}, CTR ${Number(c.ctr).toFixed(2)}%, Status: ${c.status}`)
    .join('\n')

  // Build context section from client profile
  const contextSection = clientContext ? `
Client Profile:
- Business type: ${clientContext.business_type || 'not specified'}
- Primary KPI: ${clientContext.primary_kpi || 'not specified'}
- Additional context: ${clientContext.user_notes || 'none'}
${clientContext.funnel_notes ? '- Funnel notes: ' + clientContext.funnel_notes : ''}
` : ''

  // Build system prompt
  const systemPrompt = `You are an expert digital advertising analyst embedded in Advar, an ads management platform for agencies. You are analyzing ${clientName}'s ${platformLabel} performance.

${contextSection}

Account data for ${dateLabel}:
- Total Spend: $${Number(totals.spend).toLocaleString()}
- Clicks: ${Number(totals.clicks).toLocaleString()}
- Impressions: ${Number(totals.impressions).toLocaleString()}
- Conversions: ${totals.conversions}
- ROAS: ${totals.roas ? Number(totals.roas).toFixed(2) + 'x' : 'N/A'}
- Avg CTR: ${Number(totals.avgCtr).toFixed(2)}%
- Active Campaigns: ${totals.activeCampaigns}

Top campaigns:
${topCampaigns}

Current view: ${location || 'overview'}

Rules:
- Be specific — use actual campaign names and numbers
- Respect the client's primary KPI and context above all else
- If no client profile exists, focus on the most actionable insight
- Keep initial analysis to 1-2 sentences maximum (50 words)
- In follow-up conversation, be more detailed and conversational
- Never use markdown in your response`

  // Build messages — initial analysis or continuation of conversation
  const isInitial = !conversationHistory || conversationHistory.length === 0
  const messages = isInitial
    ? [{ role: 'user' as const, content: 'Give me a brief analysis of this account.' }]
    : conversationHistory.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isInitial ? 150 : 400,
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
