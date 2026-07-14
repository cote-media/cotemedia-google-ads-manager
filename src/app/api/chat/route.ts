import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext, buildClaudeContextCacheable } from '@/lib/intelligence/build-claude-context'  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'
import { runClaudeToolLoop } from '@/lib/claude-tools'  // LORAMER_QUERY_METRICS_SHARED_LOOP_V1
import { resolveAccess } from '@/lib/access/can-access'  // LORAMER_RBAC_ACCESS_ORG_V1 — membership-aware gate

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// LORAMER_LORA_CHAT_MODEL_ENV_V1 — the chat model is env-selectable so the eval A/B (Sonnet vs Opus) can switch it
// without a code edit. Default MUST stay claude-sonnet-4-6 so production behavior is byte-identical unless overridden.
const LORA_CHAT_MODEL = process.env.LORA_CHAT_MODEL || 'claude-sonnet-4-6'

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
    location,  // LORAMER_FOCUS_LOCATION_V1
  } = await request.json()

  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  // LORAMER_QUERY_METRICS_OWNERSHIP_V1 / LORAMER_RBAC_ACCESS_ORG_V1 — when a client is in scope, the signed-in
  // viewer MUST have ACCESS (owner ∪ org-grant ∪ legacy) before we fetch its intelligence or expose query_metrics.
  // resolveAccess is membership-aware and fails closed → this unblocks a GRANTED member's Ask-Lora on a shared
  // client while cross-org isolation still 404s. clientId is optional here, so only gate when present. Downstream
  // owner-keyed reads run on ownerEmail (via /api/intelligence's own resolveAccess gate + the tool loop), NEVER the
  // viewer — the share-runs-on-the-owner keystone is preserved.
  if (clientId) {
    const access = await resolveAccess(clientId, session.user.email)
    if (!access?.ok) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 }) // 404, don't confirm the id
    }
  }

  // LORAMER_FOCUS_LOCATION_V1
  // Build focus description. Honor `location` (the tab) first - that's
  // the most reliable signal of what the user is looking at. Only fall
  // back to platform-based focus when location indicates an ad-view
  // (overview/campaigns/keywords) AND the user is drilling into ad data.
  // Avoids the bug where platform='google' (a default fallback) leaks
  // 'Google Ads campaigns' as the view for Shopify-only clients.
  // LORAMER_FOCUS_LOCATION_V2
  // V1 left location='chat' falling through to platform-based focus,
  // which lies for Shopify-only clients (platform defaults to 'google').
  // The Ask Claude tab is platform-agnostic - use a neutral focus.
  // LORAMER_CROSS_CLAUDE_FOCUS_V1 — emit mode KEYS that normalizeFocus accepts,
  // not human-readable labels. Drill specifics flow through rowContext, not focus.
  // This makes /api/chat and /api/insight produce the same intelligence context
  // for the same question — fixing the cross-surface answer inconsistency where
  // insight bar, right panel, and Ask Claude tab gave different responses.
  let focus: string
  if (location === 'shopify') {
    focus = 'shopify'
  } else if (location === 'woocommerce') {
    focus = 'woocommerce'
  } else if (location === 'chat') {
    focus = 'overview'  // Ask Claude tab is cross-platform; overview gives full context
  } else if (drillLevel === 'adgroups' && drillCampaign) {
    focus = 'adgroups'  // campaign name flows via rowContext
  } else if (drillLevel === 'ads' && drillAdGroup) {
    focus = 'ads'       // ad group name flows via rowContext
  } else if (platform === 'combined' || platform === 'meta' || platform === 'google') {
    focus = 'overview'  // platform top-level views all get full overview context
  } else {
    focus = location || 'overview'
  }

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
    systemPrompt = `You are Lora, an expert digital advertising analyst in LoraMer. Always refer to yourself as Lora. Client: ${clientName}. Platform: ${platform}. Current view: ${focus}.${rowContext ? '\nSpecifically looking at: ' + rowContext : ''}`
  }

  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
  // Build a typed system array with cache_control on the prefix block so
  // Anthropic caches the stable parts (hard constraints, identity, profile,
  // platform data, memory) across turns. Conversation history + rules stay
  // dynamic in the suffix and rebuild each call. Falls back to the plain
  // string `systemPrompt` (Phase-1 wrapper output) if intelligence fetch
  // failed — keeps the existing error path working unchanged.
  let systemArr: any = undefined
  if (clientId) {
    try {
      const intelligenceRes2 = await fetch(
        `${process.env.NEXTAUTH_URL}/api/intelligence?clientId=${clientId}&dateRange=${dateRange || 'LAST_30_DAYS'}${customStart ? '&customStart=' + customStart : ''}${customEnd ? '&customEnd=' + customEnd : ''}`,
        { headers: { Cookie: request.headers.get('cookie') || '' } }
      )
      const intelligenceData2 = await intelligenceRes2.json()
      const intelligence2: ClientIntelligence = intelligenceData2.intelligence
      if (intelligence2) {
        const { prefix, suffix } = buildClaudeContextCacheable(intelligence2, focus, rowContext)
        systemArr = [
          { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
          ...(suffix ? [{ type: 'text', text: suffix }] : []),
        ]
      }
    } catch (e) {
      console.error('Cacheable intelligence rebuild error:', e)
    }
  }

  const messages = [
    ...(history || []).map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message }
  ]

  // LORAMER_QUERY_METRICS_SHARED_LOOP_V1
  // Capped Claude tool-use loop (shared with /api/insight follow-ups via
  // src/lib/claude-tools.ts) exposing query_metrics so chat can answer
  // historical / comparison questions from metrics_daily. Single-shot when the
  // model calls no tool or no clientId is present.
  try {
    const { responseText, usage } = await runClaudeToolLoop({
      anthropic,
      model: LORA_CHAT_MODEL,
      maxTokens: 16000,  // LORAMER_CHAT_MAX_TOKENS_BUMP_V1
      system: systemArr || systemPrompt,  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
      messages,
      clientId,
      userEmail: session.user.email,  // LORAMER_QUERY_METRICS_OWNERSHIP_V1
    })
    const finalText = responseText || 'I wasn\u2019t able to complete that request. Please try rephrasing.'
    console.log('[chat] cache:', {
      input: usage.input,
      cache_create: usage.cache_create,
      cache_read: usage.cache_read,
      output: usage.output,
    })
    logSpend({
      userEmail: session.user.email,
      clientId,
      endpoint: 'chat',
      model: LORA_CHAT_MODEL,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cache_read,        // LORAMER_LORA_MODEL_PRICING_V1 — honest cache-token cost
      cacheCreationTokens: usage.cache_create,
    })
    return NextResponse.json({ response: finalText })
  } catch (e: any) {
    console.error('Chat error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
