import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext, buildClaudeContextCacheable } from '@/lib/intelligence/build-claude-context'  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'
import { runClaudeToolLoop } from '@/lib/claude-tools'  // LORAMER_INSIGHT_FOLLOWUP_SONNET_V1
import { supabaseAdmin } from '@/lib/supabase'  // LORAMER_QUERY_METRICS_OWNERSHIP_V1

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// The initial-insight user prompt. The obedience imperative lives in the user
// message (not just the system prompt) because Haiku in 50-word mode under-follows
// the system prompt. Worded WITHOUT referencing the prompt's own structure — the
// old "if there are HARD CONSTRAINTS at the top of your context" framing invited
// Haiku to narrate that scaffolding ("I don't see any hard constraints…"), which
// leaked into user-facing output (WS3 #5). Grep-able here for tuning.
const INITIAL_INSIGHT_PROMPT = `Generate a 1-2 sentence insight (50 words max) about this account.

CRITICAL RULES for this insight:
1. Obey every standing instruction you have been given about this account. Never mention a metric the user has asked you to ignore — not to compare against, not to dismiss. Treat any such metric as if it is not in the data for this insight.
2. Find a different angle. If ROAS is off-limits, talk about conversion volume, CTR patterns, budget concentration, campaign mix, or whatever else is meaningful given the user's stated priorities.
3. Be specific with actual campaign names and numbers — but only for metrics that aren't off-limits.
4. No markdown. Plain text only.

Write the insight now.`

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientName, dateRange, location, conversationHistory, customStart, customEnd, activeAlerts, shopify: shopifyFromUI } = await request.json() // LORAMER_INSIGHT_WINDOW_SYNC_V1
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // LORAMER_QUERY_METRICS_OWNERSHIP_V1 — the signed-in user MUST own this
  // client before we fetch its intelligence or expose query_metrics. Same
  // proven gate as /api/backfill/run.
  {
    const { data: owned, error: ownErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('user_email', session.user.email)
      .maybeSingle()
    if (ownErr || !owned) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }
  }

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

  // LORAMER_INSIGHT_WINDOW_SYNC_V1 — the dashboard already loaded + displays the Shopify payload (the
  // "No orders" banner reads it). Use that EXACT payload so Lora reasons on the same numbers the user
  // sees for the displayed window — divergence between the banner and Lora is then impossible by
  // construction. (Absent — e.g. ad-only views — falls back to the freshly-fetched intelligence.shopify.)
  if (shopifyFromUI) intelligence.shopify = shopifyFromUI

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
    if (isInitial) {
      // Auto one-liner banner — stays Haiku, no tool (proactive summary, not a question).
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: systemArr,  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
        messages,
      })
      const insight = (response.content[0] as any).text?.trim() || ''
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
    }

    // LORAMER_INSIGHT_FOLLOWUP_SONNET_V1
    // Typed follow-up questions in the blue box are answered by Sonnet with the
    // shared query_metrics tool loop (same engine as Ask Claude), so historical /
    // comparison questions work here too. The auto one-liner above stays Haiku.
    const { responseText, usage } = await runClaudeToolLoop({
      anthropic,
      model: 'claude-sonnet-4-6',
      maxTokens: 2000,
      system: systemArr,
      messages,
      clientId,
      userEmail: session.user.email,  // LORAMER_QUERY_METRICS_OWNERSHIP_V1
    })
    const insight = responseText || 'I wasn\u2019t able to complete that request. Please try rephrasing.'
    console.log('[insight] cache (followup sonnet):', {
      input: usage.input,
      cache_create: usage.cache_create,
      cache_read: usage.cache_read,
      output: usage.output,
    })
    logSpend({
      userEmail: session.user.email,
      clientId,
      endpoint: 'insight',
      model: 'claude-sonnet-4-6',
      inputTokens: usage.input,
      outputTokens: usage.output,
    })
    return NextResponse.json({ insight })
  } catch (e: any) {
    console.error('Insight error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
