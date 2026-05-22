import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext } from '@/lib/intelligence/build-claude-context'
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    message,
    history,
    clientId,
    clientName,
    dateRange,
    platform,
    drillLevel,
    drillCampaign,
    drillAdGroup,
    rowContext,
    customStart,
    customEnd,
  } = await request.json()

  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  // Build focus description
  const focus = drillLevel === 'adgroups' && drillCampaign
    ? `ad groups within campaign: ${drillCampaign.name}`
    : drillLevel === 'ads' && drillAdGroup
    ? `ads within ad group: ${drillAdGroup.name}`
    : platform === 'combined' ? 'combined Google + Meta view'
    : platform === 'meta' ? 'Meta Ads campaigns'
    : 'Google Ads campaigns'

  let systemPrompt = ''

  if (clientId) {
    // Fetch complete intelligence
    try {
      const intelligenceRes = await fetch(
        `${process.env.NEXTAUTH_URL}/api/intelligence?clientId=${clientId}&dateRange=${dateRange || 'LAST_30_DAYS'}${customStart ? '&customStart=' + customStart : ''}${customEnd ? '&customEnd=' + customEnd : ''}`,
        { headers: { Cookie: request.headers.get('cookie') || '' } }
      )
      const intelligenceData = await intelligenceRes.json()
      const intelligence: ClientIntelligence = intelligenceData.intelligence
      if (intelligence) {
        systemPrompt = buildClaudeContext(intelligence, focus, rowContext)
      }
    } catch (e) {
      console.error('Intelligence fetch error:', e)
    }
  }

  // Fallback system prompt if intelligence fetch failed
  if (!systemPrompt) {
    systemPrompt = `You are an expert digital advertising analyst in LoraMer. Client: ${clientName}. Platform: ${platform}. Current view: ${focus}.${rowContext ? '\nSpecifically looking at: ' + rowContext : ''}`
  }

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
    logSpend({
      userEmail: session.user.email,
      clientId,
      endpoint: 'chat',
      model: 'claude-sonnet-4-6',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    })
    return NextResponse.json({ response: responseText })
  } catch (e: any) {
    console.error('Chat error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
