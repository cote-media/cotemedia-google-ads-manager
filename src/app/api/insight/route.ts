import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { buildClaudeContext } from '@/lib/intelligence/build-claude-context'
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientName, dateRange, location, conversationHistory, customStart, customEnd } = await request.json()
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // Fetch complete intelligence for this client
  const intelligenceRes = await fetch(
    `${process.env.NEXTAUTH_URL}/api/intelligence?clientId=${clientId}&dateRange=${dateRange || 'LAST_30_DAYS'}${customStart ? '&customStart=' + customStart : ''}${customEnd ? '&customEnd=' + customEnd : ''}`,
    { headers: { Cookie: request.headers.get('cookie') || '' } }
  )
  const intelligenceData = await intelligenceRes.json()
  const intelligence: ClientIntelligence = intelligenceData.intelligence

  if (!intelligence) return NextResponse.json({ error: 'Could not fetch intelligence' }, { status: 500 })

  const systemPrompt = buildClaudeContext(intelligence, location || 'overview')

  const isInitial = !conversationHistory || conversationHistory.length === 0
  const messages = isInitial
    ? [{ role: 'user' as const, content: 'Give me a brief analysis of this account. 1-2 sentences max, 50 words max. Be specific with actual names and numbers. No markdown.' }]
    : conversationHistory.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isInitial ? 150 : 600,
      system: systemPrompt,
      messages,
    })
    const insight = (response.content[0] as any).text?.trim() || ''
    return NextResponse.json({ insight })
  } catch (e: any) {
    console.error('Insight error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
