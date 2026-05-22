import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext } from '@/lib/intelligence/build-claude-context'
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// The initial-insight user prompt. We bake the HARD CONSTRAINTS reminder
// directly into the user message because Haiku in 50-word mode tends to
// follow the dominant data signal over the system prompt constraints.
// Naming this thing here also means it's grep-able when we want to tune it.
const INITIAL_INSIGHT_PROMPT = `Generate a 1-2 sentence insight (50 words max) about this account.

CRITICAL RULES for this insight:
1. If there are HARD CONSTRAINTS at the top of your context, OBEY THEM. Do NOT mention any metric the user told you to ignore — not even to compare against, not even to dismiss. Pretend that metric does not exist in the data for the purposes of this insight.
2. Find a different angle. If ROAS is off-limits, talk about conversion volume, CTR patterns, budget concentration, campaign mix, or whatever else is meaningful given the user's stated priorities.
3. Be specific with actual campaign names and numbers — but only for metrics that aren't off-limits.
4. No markdown. Plain text only.

Write the insight now.`

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientName, dateRange, location, conversationHistory, customStart, customEnd, activeAlerts } = await request.json()
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // Fetch complete intelligence for this client.
  // We use the hybrid cache: platform data is cached 15 min, but user_notes
  // and conversations are always re-read fresh (see /api/ielligence line 71).
  // forceRefresh removed May 22 — was costing ~10x per insight load.
  const intelligenceRes = await fetch(
    `${process.env.NEXTAUTH_URL}/api/intelligence?clientId=${clientId}&dateRange=${dateRange || 'LAST_30_DAYS'}${customStart ? '&customStart=' + customStart : ''}${customEnd ? '&customEnd=' + customEnd : ''}`,
    { headers: { Cookie: request.headers.get('cookie') || '' } }
  )
  const intelligenceData = await intelligenceRes.json()
  const intelligence: ClientIntelligence = intelligenceData.intelligence
  if (!intelligence) return NextResponse.json({ error: 'Could not fetch intelligence' }, { status: 500 })

  let systemPrompt = buildClaudeContext(intelligence, location || 'overview')
  if (Array.isArray(activeAlerts) && activeAlerts.length > 0) {
    systemPrompt += '\n\n=== ACTIVE ALERTS CURRENTLY VISIBLE TO THE USER ===\n'
    systemPrompt += '(These alerts are showing in the user-facing UI right now. If they ask a follow-up question, they may be referring to one of these. Reference them by content when relevant.)\n'
    activeAlerts.forEach((a) => { systemPrompt += '  • ' + a + '\n' })
  }
  const isInitial = !conversationHistory || conversationHistory.length === 0

  const messages = isInitial
    ? [{ role: 'user' as const, content: INITIAL_INSIGHT_PROMPT }]
    : conversationHistory.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isInitial ? 150 : 600,
      system: systemPrompt,
      messages,
    })
    const insight = (response.content[0] as any).text?.trim() || ''
    logSpend({
      userEmail: session.user.email,
      clientId,
      endpoint: 'insight',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    })
    return NextResponse.json({ insight })
  } catch (e: any) {
    console.error('Insight error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
