import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext, buildClaudeContextCacheable } from '@/lib/intelligence/build-claude-context'  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'
import { queryMetrics } from '@/lib/metrics-query'  // LORAMER_QUERY_METRICS_TOOL_0B_V1

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// LORAMER_QUERY_METRICS_TOOL_0B_V1
// query_metrics tool: lets Claude pull historical / period-over-period numbers
// from LoraMer's own store (metrics_daily) instead of a live platform fetch.
// clientId is injected server-side from the request - NOT a model-controlled input.
const QUERY_METRICS_TOOL: any = {
  name: 'query_metrics',
  description:
    'Query LoraMer\u2019s historical store for aggregated advertising/commerce metrics over one or more time windows for the CURRENT client. Use this for any period-over-period or historical comparison (for example: last 7 days vs the same window 6, 12, and 18 months ago), including periods older than the ad platforms themselves retain. Returns spend, impressions, clicks, conversions, conversionValue, revenue and rowCount per window, plus derived CTR/CPC/CPA/ROAS/AOV. Data is read from our own database, not a live fetch, so it is fast and covers paused or historical periods. Prefer this over reasoning from the numbers already in your context whenever the question involves a comparison to a prior period or a specific historical window.',
  input_schema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: ['google', 'meta', 'shopify', 'woocommerce', 'ga', 'all'],
        description: 'Which platform to query. Use "all" to sum across every connected platform. Defaults to all if omitted.',
      },
      level: {
        type: 'string',
        enum: ['account', 'campaign', 'ad_group', 'ad_set', 'ad', 'product'],
        description: 'Aggregation level. Default "account" (whole-account totals). Note: only account-level history is broadly backfilled today; deeper levels exist mainly from the connect date forward.',
      },
      baseRange: {
        type: 'string',
        description: 'The primary / most-recent window, as a preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, or LAST_MONTH. Default LAST_7_DAYS.',
      },
      offsetsMonths: {
        type: 'array',
        items: { type: 'number' },
        description: 'Month offsets for comparison windows; 0 is the base window itself. Each offset produces an equal-length window ending that many calendar months before the base window. Example: [0, 6, 12, 18].',
      },
    },
    required: [],
  },
}

// LORAMER_QUERY_METRICS_TOOL_0B_V1
async function runQueryMetricsTool(input: any, clientId: string) {
  const platform = typeof input?.platform === 'string' ? input.platform : undefined
  const level = typeof input?.level === 'string' ? input.level : undefined
  const baseRange = typeof input?.baseRange === 'string' ? input.baseRange : undefined
  const offsetsMonths = Array.isArray(input?.offsetsMonths)
    ? input.offsetsMonths.filter((n: any) => typeof n === 'number')
    : undefined
  const platforms = platform && platform !== 'all' ? [platform] : []
  return queryMetrics({ clientId, platforms, level, baseRange, offsetsMonths })
}

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
    systemPrompt = `You are an expert digital advertising analyst in LoraMer. Client: ${clientName}. Platform: ${platform}. Current view: ${focus}.${rowContext ? '\nSpecifically looking at: ' + rowContext : ''}`
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

  // LORAMER_QUERY_METRICS_TOOL_0B_V1
  // Tool-use loop. With a client in scope, expose query_metrics so Claude can pull
  // historical/comparison numbers from our store. Single-shot behavior is preserved
  // when Claude calls no tool or no clientId is present. Caps tool round-trips.
  const tools: any[] | undefined = clientId ? [QUERY_METRICS_TOOL] : undefined
  const convo: any[] = [...messages]
  const usageTotals = { input: 0, output: 0, cache_create: 0, cache_read: 0 }
  const MAX_TOOL_TURNS = 5

  try {
    let out: any = null
    let last: any = null
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const createParams: any = {
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,  // LORAMER_CHAT_MAX_TOKENS_BUMP_V1
        system: systemArr || systemPrompt,  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
        messages: convo,
      }
      if (tools) createParams.tools = tools
      const resp: any = await anthropic.messages.create(createParams)
      last = resp
      const u = resp.usage || {}
      usageTotals.input += u.input_tokens || 0
      usageTotals.output += u.output_tokens || 0
      usageTotals.cache_create += u.cache_creation_input_tokens || 0
      usageTotals.cache_read += u.cache_read_input_tokens || 0

      if (resp.stop_reason === 'tool_use' && clientId) {
        const toolUses = (resp.content as any[]).filter(b => b.type === 'tool_use')
        convo.push({ role: 'assistant', content: resp.content })
        const toolResults: any[] = []
        for (const tu of toolUses) {
          let payload: any
          try {
            payload = tu.name === 'query_metrics'
              ? await runQueryMetricsTool(tu.input, clientId)
              : { error: 'unknown tool: ' + tu.name }
          } catch (err) {
            payload = { error: err instanceof Error ? err.message : String(err) }
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(payload),
          })
        }
        convo.push({ role: 'user', content: toolResults })
        continue
      }

      out = resp
      break
    }

    const finalResp: any = out || last
    let responseText = finalResp
      ? (finalResp.content as any[])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim()
      : ''
    if (!responseText) responseText = 'I wasn\u2019t able to complete that request. Please try rephrasing.'

    // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1 — cache metrics, summed across tool turns
    console.log('[chat] cache:', {
      input: usageTotals.input,
      cache_create: usageTotals.cache_create,
      cache_read: usageTotals.cache_read,
      output: usageTotals.output,
    })
    logSpend({
      userEmail: session.user.email,
      clientId,
      endpoint: 'chat',
      model: 'claude-sonnet-4-6',
      inputTokens: usageTotals.input,
      outputTokens: usageTotals.output,
    })
    return NextResponse.json({ response: responseText })
  } catch (e: any) {
    console.error('Chat error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
