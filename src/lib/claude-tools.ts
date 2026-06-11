// LORAMER_QUERY_METRICS_SHARED_LOOP_V1
// LORAMER_QUERY_METRICS_DATE_FLEX_V1 - query_metrics now accepts explicit
// `windows` (arbitrary YYYY-MM-DD date ranges). Description rewritten so the
// model translates specific calendar periods (quarters/months/years) to exact
// dates itself. Additive; baseRange/offsetsMonths path unchanged.
// Single source of truth for Claude's tools and the capped tool-use loop.
// Consumed by /api/chat (Sonnet) and /api/insight follow-ups (Sonnet) so the two
// surfaces cannot drift (handoff lesson 26). clientId is injected server-side by
// the caller - it is NEVER a model-controlled input.

import { queryMetrics } from '@/lib/metrics-query'
import { supabaseAdmin } from '@/lib/supabase'

// LORAMER_QUERY_METRICS_OWNERSHIP_V1
// Defense-in-depth ownership check (the routes also gate before calling the
// loop). A signed-in user may only query a client they own. Same proven
// pattern as /api/backfill/run. Fails CLOSED: any error or missing input
// returns false, so the tool is simply not exposed.
async function userOwnsClient(userEmail: string, clientId: string): Promise<boolean> {
  if (!userEmail || !clientId) return false
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_email', userEmail)
    .maybeSingle()
  return !error && !!data
}

export const QUERY_METRICS_TOOL: any = {
  name: 'query_metrics',
  description:
    'Query LoraMer\u2019s historical store for aggregated advertising/commerce metrics over one or more time windows for the CURRENT client. Data is read from our own database (not a live fetch), so it is fast and covers paused or historical periods, including periods older than the ad platforms themselves retain. Returns spend, impressions, clicks, conversions, conversionValue, revenue and rowCount per window, plus derived CTR/CPC/CPA/ROAS/AOV. There are two MUTUALLY EXCLUSIVE ways to specify time. (1) For ANY specific calendar period - a quarter, a named month, a year, or any arbitrary explicit range - translate it to exact YYYY-MM-DD dates YOURSELF and pass them in `windows`, one object per period you want compared. Examples: "Q4 2024" -> [{label:"Q4 2024",startDate:"2024-10-01",endDate:"2024-12-31"}]; "compare Q4 2024 to Q4 2025" -> two window objects. Label each window for the exact dates it covers and NEVER relabel a different span as the requested period. (2) For rolling recent-vs-prior comparisons only, use `baseRange` (a preset such as LAST_30_DAYS) together with `offsetsMonths`. If `windows` is provided, `baseRange` and `offsetsMonths` are ignored. Prefer this tool over reasoning from numbers already in your context whenever the question involves a specific historical period or a period-over-period comparison.',
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
        description: 'Rolling-comparison mode only (ignored when `windows` is set). The primary / most-recent window, as a preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, or LAST_MONTH. Default LAST_7_DAYS.',
      },
      offsetsMonths: {
        type: 'array',
        items: { type: 'number' },
        description: 'Rolling-comparison mode only (ignored when `windows` is set). Month offsets for comparison windows; 0 is the base window itself. Each offset produces an equal-length window ending that many calendar months before the base window. Example: [0, 6, 12, 18].',
      },
      windows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Human-readable label naming the period exactly as the user referred to it, e.g. "Q4 2024".',
            },
            startDate: {
              type: 'string',
              description: 'Inclusive start date in YYYY-MM-DD format.',
            },
            endDate: {
              type: 'string',
              description: 'Inclusive end date in YYYY-MM-DD format.',
            },
          },
          required: ['startDate', 'endDate'],
        },
        description: 'Explicit, fully-specified comparison windows for any specific calendar period or arbitrary range. Translate the period to exact YYYY-MM-DD dates yourself and pass one object per window. Example: "Q4 2024" -> [{label:"Q4 2024",startDate:"2024-10-01",endDate:"2024-12-31"}]. When provided, baseRange and offsetsMonths are ignored (mutually exclusive).',
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
  const windows = Array.isArray(input?.windows)
    ? input.windows
        .filter((w: any) => w && typeof w.startDate === 'string' && typeof w.endDate === 'string')
        .map((w: any) => ({
          label: typeof w.label === 'string' ? w.label : undefined,
          startDate: w.startDate,
          endDate: w.endDate,
        }))
    : undefined
  const platforms = platform && platform !== 'all' ? [platform] : []
  return queryMetrics({ clientId, platforms, level, baseRange, offsetsMonths, windows })
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
  userEmail?: string | null  // LORAMER_QUERY_METRICS_OWNERSHIP_V1
  maxToolTurns?: number
}): Promise<ToolLoopResult> {
  const { anthropic, model, maxTokens, system, messages } = opts
  const clientId = opts.clientId || ''
  const userEmail = opts.userEmail || ''
  // LORAMER_QUERY_METRICS_OWNERSHIP_V1 — expose query_metrics ONLY when the
  // signed-in user owns this client. Without a verified owner the tool is
  // withheld and the loop degrades to a single-shot call (no cross-tenant read).
  const tools: any[] | undefined =
    clientId && (await userOwnsClient(userEmail, clientId)) ? [QUERY_METRICS_TOOL] : undefined
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

    if (resp.stop_reason === 'tool_use' && tools && clientId) {
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
