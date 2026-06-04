// LORAMER_QUERY_METRICS_SHARED_LOOP_V1
// Single source of truth for Claude's tools and the capped tool-use loop.
// Consumed by /api/chat (Sonnet) and /api/insight follow-ups (Sonnet) so the two
// surfaces cannot drift (handoff lesson 26). clientId is injected server-side by
// the caller - it is NEVER a model-controlled input.

import { queryMetrics } from '@/lib/metrics-query'

export const QUERY_METRICS_TOOL: any = {
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

export async function runQueryMetricsTool(input: any, clientId: string) {
  const platform = typeof input?.platform === 'string' ? input.platform : undefined
  const level = typeof input?.level === 'string' ? input.level : undefined
  const baseRange = typeof input?.baseRange === 'string' ? input.baseRange : undefined
  const offsetsMonths = Array.isArray(input?.offsetsMonths)
    ? input.offsetsMonths.filter((n: any) => typeof n === 'number')
    : undefined
  const platforms = platform && platform !== 'all' ? [platform] : []
  return queryMetrics({ clientId, platforms, level, baseRange, offsetsMonths })
}

export type ToolLoopResult = {
  responseText: string
  usage: { input: number; output: number; cache_create: number; cache_read: number }
}

// Capped Claude tool-use loop. Exposes query_metrics only when a clientId is in
// scope. If the model calls no tool, this is a single create() - identical to the
// old single-shot behavior. Usage is summed across tool round-trips.
export async function runClaudeToolLoop(opts: {
  anthropic: any
  model: string
  maxTokens: number
  system: any
  messages: any[]
  clientId?: string | null
  maxToolTurns?: number
}): Promise<ToolLoopResult> {
  const { anthropic, model, maxTokens, system, messages } = opts
  const clientId = opts.clientId || ''
  const tools: any[] | undefined = clientId ? [QUERY_METRICS_TOOL] : undefined
  const convo: any[] = [...messages]
  const usage = { input: 0, output: 0, cache_create: 0, cache_read: 0 }
  const MAX = opts.maxToolTurns ?? 5

  let out: any = null
  let last: any = null
  for (let turn = 0; turn < MAX; turn++) {
    const createParams: any = { model, max_tokens: maxTokens, system, messages: convo }
    if (tools) createParams.tools = tools
    const resp: any = await anthropic.messages.create(createParams)
    last = resp
    const u = resp.usage || {}
    usage.input += u.input_tokens || 0
    usage.output += u.output_tokens || 0
    usage.cache_create += u.cache_creation_input_tokens || 0
    usage.cache_read += u.cache_read_input_tokens || 0

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
  const responseText = finalResp
    ? (finalResp.content as any[])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim()
    : ''
  return { responseText, usage }
}
