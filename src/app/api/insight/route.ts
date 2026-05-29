import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext, buildClaudeContextCacheable } from '@/lib/intelligence/build-claude-context'  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
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

  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
  // Build prefix/suffix from intelligence. Active alerts are per-call dynamic
  // content so they go in the suffix (NOT the cached prefix), keeping the
  // cacheable block stable across calls for the same client+dateRange.
  const { prefix, suffix: baseSuffix } = buildClaudeContextCacheable(intelligence, location || 'overview')
  let suffix = baseSuffix
  if (Array.isArray(activeAlerts) && activeAlerts.length > 0) {
    suffix += '\n\n=== ACTIVE ALERTS CURRENTLY VISIBLE TO THE USER ===\n'
    suffix += '(These alerts are showing in the user-facing UI right now. If they ask a follow-up question, they may be referring to one of these. Reference them by content when relevant.)\n'
    activeAlerts.forEach((a) => { suffix += '  • ' + a + '\n' })
  }
  const systemArr: any = [
    { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
    ...(suffix ? [{ type: 'text', text: suffix }] : []),
  ]
  const isInitial = !conversationHistory || conversationHistory.length === 0

  const messages = isInitial
    ? [{ role: 'user' as const, content: INITIAL_INSIGHT_PROMPT }]
    : conversationHistory.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: isInitial ? 150 : 600,
      system: systemArr,  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
      messages,
    })
    const insight = (response.content[0] as any).text?.trim() || ''
    // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1 — surface cache metrics
    const usage = response.usage as any
    console.log('[insight] cache:', {
      input: usage?.input_tokens || 0,
      cache_create: usage?.cache_creation_input_tokens || 0,
      cache_read: usage?.cache_read_input_tokens || 0,
      output: usage?.output_tokens || 0,
    })
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
