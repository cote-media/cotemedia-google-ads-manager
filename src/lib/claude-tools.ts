// LORAMER_QUERY_METRICS_SHARED_LOOP_V1
// LORAMER_QUERY_METRICS_DATE_FLEX_V1 - query_metrics now accepts explicit
// `windows` (arbitrary YYYY-MM-DD date ranges). Description rewritten so the
// model translates specific calendar periods (quarters/months/years) to exact
// dates itself. Additive; baseRange/offsetsMonths path unchanged.
// Single source of truth for Claude's tools and the capped tool-use loop.
// Consumed by /api/chat (Sonnet) and /api/insight follow-ups (Sonnet) so the two
// surfaces cannot drift (handoff lesson 26). clientId is injected server-side by
// the caller - it is NEVER a model-controlled input.

import { queryMetrics, queryBreakdown, queryMoney } from '@/lib/metrics-query'
import { resolveAccess } from '@/lib/access/can-access'

// LORAMER_QUERY_METRICS_OWNERSHIP_V1 / LORAMER_RBAC_ACCESS_ORG_V1
// Defense-in-depth ACCESS check (the routes also gate before calling the loop). Now membership/org-AWARE via
// resolveAccess (owner ∪ org-grant ∪ legacy client_members), not owner-only — so a GRANTED member gets the tools.
// The query tools read metrics_daily BY clientId (owner-agnostic data), so a member's read == the owner's; no
// owner-keyed data is read here. Fails CLOSED: any error / no access → false → tools withheld, single-shot loop.
async function viewerCanAccess(viewerEmail: string, clientId: string): Promise<boolean> {
  if (!viewerEmail || !clientId) return false
  const a = await resolveAccess(clientId, viewerEmail)
  return !!a?.ok
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
        enum: ['account', 'campaign', 'ad_group', 'ad_set', 'ad', 'product', 'variant'],
        description: 'Aggregation level. Default "account" (whole-account totals). "product" and "variant" are the commerce grains (Shopify/Woo — variant = a product’s SKU/variation). Note: only account-level history is broadly backfilled today; deeper levels exist mainly from the connect date forward.',
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

// LORAMER_QUERY_BREAKDOWN_V1 — sibling of query_metrics for the DIMENSIONAL grain
// (individual search terms, keywords, and the existing Meta publisher_platform/age/
// gender rows). Reads only breakdown rows (never base rows), so it cannot be summed
// against query_metrics' account/campaign totals.
export const QUERY_BREAKDOWN_TOOL: any = {
  name: 'query_breakdown',
  description:
    'List the TOP breakdown values for the CURRENT client over a SINGLE time window, ranked by a metric, from LoraMer’s historical store. Use this for "top search terms" (the actual queries people typed that triggered ads), "top keywords" (the keywords you bid on), or Meta/Google breakdowns (placement, age, gender, device, hour, action_type/conversion_action). Returns up to topN rows, each with the value text, summed spend/impressions/clicks/conversions/conversionValue and derived CTR/CPC/CPA/ROAS, plus distinctValueCount and a truncated flag. CRITICAL: these values are a SUBSET of the entity’s activity — their summed spend is LESS THAN the account or campaign total and you must describe them as "top search terms/keywords", NEVER as the account’s or campaign’s total spend. If rows is empty or the note says no data, tell the user that no data of that kind was captured for that period — do NOT infer or invent values from anything else in context. Scope to a campaign or ad group by passing parentEntityId or entityId. This is for ranking within one window; for whole-account or period-over-period TOTALS use query_metrics instead.',
  input_schema: {
    type: 'object',
    properties: {
      breakdownType: {
        type: 'string',
        enum: ['search_term', 'keyword', 'placement', 'age', 'gender', 'device', 'device_platform', 'hour', 'action_type', 'conversion_action', 'impression_share', 'video', 'geo_country', 'geo_region'],
        description: 'Which dimension to list. Google-only: search_term, keyword, conversion_action, impression_share. Meta-only: placement (publisher:position), age, gender, device_platform, action_type, video. MULTI-PLATFORM (Meta AND Google) — you MUST pass platform for these: device, hour. CAVEAT for platform="google" hour: hour "00" (midnight) is a Google CATCH-ALL that absorbs the full-day spend of campaigns without hourly segmentation (Display, some Performance Max) — it is inflated and NOT genuine midnight activity, so never call hour 0 a real dayparting peak or suggest a midnight bid-down from it. geo_country/geo_region are captured on BOTH Shopify (ship-to; the default when platform is omitted) AND Meta (audience geo; pass platform:"meta"). action_type/conversion_action carry per-action conversions, not spend — rank them by conversions. NON-ADDITIVE per-entity families (rows are one-per-entity, metrics under nonAdditiveMetrics): impression_share (per Google campaign — POINT-IN-TIME search IS ratios; shows the MOST RECENT day in-window, never aggregated) and video (per Meta entity — 8 view counts summed + avg-time/cost-per-thruplay rates that are null across multi-day windows; pass entityLevel, default campaign). (Product/variant performance is NOT here — use query_metrics with level="product"/"variant".)',
      },
      platform: {
        type: 'string',
        enum: ['google', 'meta', 'shopify'],
        description: 'Which platform this dimension is on. REQUIRED for multi-platform dimensions (device, hour). For geo_country/geo_region, omit for Shopify ship-to geo (the default) or pass "meta" for Meta audience geo. For single-platform dimensions it is implied and can be omitted. A platform the dimension is not captured on is rejected.',
      },
      baseRange: {
        type: 'string',
        description: 'Single-window preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, LAST_MONTH. Default LAST_30_DAYS. Ignored if startDate+endDate are given.',
      },
      startDate: { type: 'string', description: 'Optional explicit window start, YYYY-MM-DD (use with endDate).' },
      endDate: { type: 'string', description: 'Optional explicit window end, YYYY-MM-DD (use with startDate).' },
      rankBy: {
        type: 'string',
        enum: ['spend', 'impressions', 'clicks', 'conversions', 'conversionValue', 'revenue'],
        description: 'Metric to rank by. Default spend (for the conversion families action_type/conversion_action the default is conversions, since their spend is 0). Use "revenue" for revenue-centric breakdowns like Shopify geo (ad breakdowns have no revenue; commerce breakdowns have no spend).',
      },
      topN: { type: 'number', description: 'How many to return. Default 20, maximum 50.' },
      orderDir: { type: 'string', enum: ['desc', 'asc'], description: 'desc (default) for top, asc for bottom.' },
      parentEntityId: { type: 'string', description: 'Optional: restrict to one campaign id (the parent of the ad group).' },
      entityId: { type: 'string', description: 'Optional: restrict to one ad group id.' },
      entityLevel: {
        type: 'string',
        enum: ['account', 'campaign', 'ad_set', 'ad'],
        description: 'For breakdownType="video" ONLY: which entity grain to scope to (prevents cross-level double-counting of view counts). Default "campaign". Ignored for other breakdown types.',
      },
    },
    required: ['breakdownType'],
  },
}

export async function runQueryBreakdownTool(input: any, clientId: string) {
  return queryBreakdown({
    clientId,
    breakdownType: typeof input?.breakdownType === 'string' ? input.breakdownType : '',
    platform: typeof input?.platform === 'string' ? input.platform : undefined,
    baseRange: typeof input?.baseRange === 'string' ? input.baseRange : undefined,
    startDate: typeof input?.startDate === 'string' ? input.startDate : undefined,
    endDate: typeof input?.endDate === 'string' ? input.endDate : undefined,
    rankBy: typeof input?.rankBy === 'string' ? input.rankBy : undefined,
    topN: typeof input?.topN === 'number' ? input.topN : undefined,
    orderDir: input?.orderDir === 'asc' ? 'asc' : input?.orderDir === 'desc' ? 'desc' : undefined,
    parentEntityId: typeof input?.parentEntityId === 'string' ? input.parentEntityId : undefined,
    entityId: typeof input?.entityId === 'string' ? input.entityId : undefined,
    entityLevel: typeof input?.entityLevel === 'string' ? input.entityLevel : undefined,
  })
}

// LORAMER_QUERY_MONEY_V1 — the store money surface (gross→net waterfall components) for ONE store platform.
export const QUERY_MONEY_TOOL: any = {
  name: 'query_money',
  description:
    'Break the CURRENT client’s STORE revenue into its money components over a single window — gross sales, discounts, taxes, shipping, fees, tips, refunds, total sales, net sales, and an on-sale-markdown residual — from LoraMer’s historical store, at ACCOUNT grain. Use this when the user asks how revenue breaks down / where the money goes / gross vs net / discounts or taxes or shipping totals. Returns per-component values (each a summed $ amount) plus a "chain" giving the correct waterfall order and +/- direction for the store’s basis, and coverage info. IMPORTANT: net-sales BASIS differs by platform and is reported in "basis" — WooCommerce net INCLUDES shipping + tax; Shopify net EXCLUDES them — so never compare net across the two as like-for-like. A component value of null means it was not captured on at least one day in the window (honestly "not captured", NOT $0). Store-only: pass platform "shopify" or "woocommerce"; there is no cross-platform money total. For plain revenue/spend totals or period-over-period use query_metrics instead.',
  input_schema: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: ['shopify', 'woocommerce'], description: 'Which store platform’s money to break down. Required — money is per-store (different net basis); never summed across platforms.' },
      baseRange: { type: 'string', description: 'Single-window preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, LAST_90_DAYS, THIS_MONTH, LAST_MONTH. Default LAST_30_DAYS. Ignored if startDate+endDate are given.' },
      startDate: { type: 'string', description: 'Optional explicit window start, YYYY-MM-DD (use with endDate).' },
      endDate: { type: 'string', description: 'Optional explicit window end, YYYY-MM-DD (use with startDate).' },
    },
    required: ['platform'],
  },
}

export async function runQueryMoneyTool(input: any, clientId: string) {
  return queryMoney({
    clientId,
    platform: typeof input?.platform === 'string' ? input.platform : '',
    baseRange: typeof input?.baseRange === 'string' ? input.baseRange : undefined,
    startDate: typeof input?.startDate === 'string' ? input.startDate : undefined,
    endDate: typeof input?.endDate === 'string' ? input.endDate : undefined,
  })
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
    clientId && (await viewerCanAccess(userEmail, clientId)) ? [QUERY_METRICS_TOOL, QUERY_BREAKDOWN_TOOL, QUERY_MONEY_TOOL] : undefined
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
            : tu.name === 'query_breakdown'
              ? await runQueryBreakdownTool(tu.input, clientId)
              : tu.name === 'query_money'
                ? await runQueryMoneyTool(tu.input, clientId)
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
