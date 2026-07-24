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
// LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B) — the query_breakdown enums are GENERATED from the ONE declared
// source (breakdown-registry.ts), never hand-written, so the tool schema and the query layer cannot drift.
import { breakdownToolTypes, breakdownPlatforms, breakdownEntityLevels, geoGrains, geoScopes } from '@/lib/breakdown-registry'
// LORAMER_LORA_COVERAGE_V1 — coverage FACT (state) for the query_metrics tool layer ONLY (queryMetrics untouched).
import { getCoverageForWindows, coverageNotes } from '@/lib/next/coverage'
import { annotateContribution } from '@/lib/next/query-completeness' // LORAMER_LORA_INCOMPLETE_TOTAL_V1 (T0#2 slice 1)
import { resolveAccess } from '@/lib/access/can-access'
import { logToolDecision } from '@/lib/lora-tool-log' // LORAMER_LORA_TOOL_DECISION_LOG_V1 — L2-retrieval instrument (fire-and-forget)

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
    'Query LoraMer\u2019s historical store for aggregated advertising/commerce metrics over one or more time windows for the CURRENT client. Data is read from our own database (not a live fetch), so it is fast and covers paused or historical periods, including periods older than the ad platforms themselves retain. Returns spend, impressions, clicks, conversions, conversionValue, revenue and rowCount per window, plus derived CTR/CPC/CPA/ROAS/AOV. REVENUE & ROAS — READ THIS: for any total-revenue or ROAS answer use `canonical` — canonical.revenue and canonical.roas are the figures that MATCH THE DASHBOARD CARDS (revenue precedence store > ga > none, NEVER summed; roas = revenue/spend). `totals.revenue` is a RAW cross-platform SUM that double-counts store + GA — NEVER report totals.revenue as the total revenue. `bySource` breaks revenue/spend out by origin (store, ga, google, meta), each labeled — when more than one revenue source is present, surface them ALL with their own ROAS and explain why they differ. `derived.roas` is AD-ATTRIBUTED (platform conversionValue/spend) and is NOT the card ROAS. COMPLETENESS — READ BEFORE STATING ANY TOTAL: the result carries a top-level `complete` (boolean) and each window carries `complete` plus a per-platform `contribution` array (each item has platform + status: ok / capture_failing / trailing_gap / predates_capture / draining / not_connected). If `complete` is false, or any platform`s contribution status is `capture_failing` or `trailing_gap`, the total is PARTIAL — state it AS incomplete and NAME the platform (e.g. "this is the Google total; WooCommerce capture is currently failing, so the store side is missing and the combined figure is understated"). NEVER present a partial total as a whole number, and NEVER report $0 for a platform whose status is capture_failing / trailing_gap / predates_capture — that is NOT $0 and NOT disconnected; its data simply was not captured for that period. A platform with status `ok` and zero rows IS a genuine zero — say so plainly. There are two MUTUALLY EXCLUSIVE ways to specify time. (1) For ANY specific calendar period - a quarter, a named month, a year, or any arbitrary explicit range - translate it to exact YYYY-MM-DD dates YOURSELF and pass them in `windows`, one object per period you want compared. Examples: "Q4 2024" -> [{label:"Q4 2024",startDate:"2024-10-01",endDate:"2024-12-31"}]; "compare Q4 2024 to Q4 2025" -> two window objects. Label each window for the exact dates it covers and NEVER relabel a different span as the requested period. (2) For rolling recent-vs-prior comparisons only, use `baseRange` (a preset such as LAST_30_DAYS) together with `offsetsMonths`. If `windows` is provided, `baseRange` and `offsetsMonths` are ignored. Prefer this tool over reasoning from numbers already in your context whenever the question involves a specific historical period or a period-over-period comparison.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: {
        type: 'string',
        description: 'The target client’s id, taken ONLY from the "clients you can access" list in your instructions. REQUIRED at the agency / all-clients view (no client is selected). At a single-client view it is IGNORED — the current client is always used. Never invent an id.', // LORAMER_AGENCY_SCOPE_LORA_V1
      },
      platform: {
        type: 'string',
        enum: ['google', 'meta', 'shopify', 'woocommerce', 'ga', 'all'],
        description: 'Which platform to query. Use "all" (default) to query every connected platform in ONE call: the result’s `canonical` gives the correctly-settled total (store>ga>none, never summed) and `bySource` the labeled per-source split. Do NOT read the raw `totals.revenue` as the total (it double-counts store+GA). Defaults to all if omitted.',
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
      clientId: {
        type: 'string',
        description: 'The target client’s id, taken ONLY from the "clients you can access" list in your instructions. REQUIRED at the agency / all-clients view; IGNORED at a single-client view (the current client is used). Never invent an id.', // LORAMER_AGENCY_SCOPE_LORA_V1
      },
      breakdownType: {
        type: 'string',
        enum: breakdownToolTypes(),
        description: 'Which dimension to list. GOOGLE ads: search_term, keyword, conversion_action, impression_share, device, hour, and the GEO family via breakdownType "geo" + geoGrain + geoScope (city/county/metro/state/province/district/postal/most_specific/region). META ads: placement (publisher:position), age, gender, age_gender, device_platform, action_type, video, device, hour. GA4 SITE ANALYTICS (pass platform "ga"): ga_source_medium, ga_channel, ga_campaign, ga_landing_page, ga_device, ga_geo_country, ga_geo_region, ga_geo_city, ga_age, ga_gender, ga_event, ga_item — these are SITE analytics (sessions/users/revenue), NOT ad spend. CROSS-PLATFORM: geo_country/geo_region are on Shopify (ship-to, the default) AND Meta AND Google (pass platform). CAVEAT platform="google" hour: hour "00" is a Google CATCH-ALL absorbing the full-day spend of campaigns without hourly segmentation (Display, some Performance Max) — inflated, NOT genuine midnight; never call hour 0 a dayparting peak or suggest a midnight bid-down. action_type/conversion_action carry per-action conversions, not spend — ranked by conversions. NON-ADDITIVE per-entity families (metrics under nonAdditiveMetrics): impression_share (per Google campaign — POINT-IN-TIME, most-recent day in-window) and video (per Meta entity — view counts summed + avg-time/cost-per-thruplay rates null across multi-day windows). COMMERCE (Shopify/Woo — pass platform; account grain; these carry revenue and orders, never ad spend): sales_channel, discount_code, discount_type, coupon_code, coupon_type, order_status, order_time, financial_status, fulfillment_status, payment_method, shipping_method, abandoned_checkout, customer_cohort, product_type, product_vendor, product_tag, product_category, product_collection, geo_city. META CREATIVE ASSETS (campaign/ad_set/ad — WHICH creative element was served, the input to "what creative is working"): image_asset, video_asset, title_asset, body_asset, description_asset, call_to_action_asset, link_url_asset, ad_format_asset, flexible_format_asset_type, creative_relaxation_asset_type, gen_ai_asset_type. META OTHER: attribution_window (per-window decomposition of every action_type), product_id (catalog grain), comscore_market. (Product/variant performance → query_metrics with level="product"/"variant".)',
      },
      platform: {
        type: 'string',
        enum: breakdownPlatforms(),
        description: 'Which platform this dimension is on. "ga" = GA4 site analytics (the ga_* types). REQUIRED for multi-platform dimensions (device, hour). For geo_country/geo_region omit for Shopify ship-to geo (the default) or pass "meta"/"google". For single-platform dimensions it is implied and can be omitted. A platform the dimension is not captured on is rejected.',
      },
      geoGrain: {
        type: 'string',
        enum: geoGrains(),
        description: 'For breakdownType "geo" ONLY: the geographic grain (city, county, metro, state, province, district, postal, most_specific, region). For country- or region-level totals that also span Shopify/Meta, use breakdownType geo_country / geo_region instead.',
      },
      geoScope: {
        type: 'string',
        enum: geoScopes(),
        description: 'For breakdownType "geo" ONLY, and it MATTERS: "ad" = where you TARGETED the ad (ad-location); "user" = where the person PHYSICALLY WAS (user-location). These are DIFFERENT — someone in Boston can see an ad targeted to New York. Pick deliberately; conflating ad-location with user-location yields a confident WRONG answer.',
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
        enum: breakdownEntityLevels(),
        description: 'Which entity grain to scope the breakdown to. Default = the COARSEST grain present for the family (so metrics are never double-counted across levels). It is honored for ALL breakdown types — e.g. Google device or hour at ad_group or keyword — NOT video-only. For breakdownType="video" it additionally prevents cross-level double-counting of view counts.',
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
    geoGrain: typeof input?.geoGrain === 'string' ? input.geoGrain : undefined, // LORAMER_BREAKDOWN_REGISTRY_CONSUME_V1 (G2 2B)
    geoScope: typeof input?.geoScope === 'string' ? input.geoScope : undefined,
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
      clientId: { type: 'string', description: 'The target client’s id, taken ONLY from the "clients you can access" list in your instructions. REQUIRED at the agency / all-clients view; IGNORED at a single-client view (the current client is used). Never invent an id.' }, // LORAMER_AGENCY_SCOPE_LORA_V1
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
  const result = await queryMetrics({ clientId, platforms, level, baseRange, offsetsMonths, windows })
  // LORAMER_LORA_COVERAGE_V1 — annotate each window with the coverage FACT (state) so Lora answers from FACT, not
  // from ambiguous rowCount-0 zeros (identical for not-connected / pre-capture / true-zero). ADDITIVE + best-effort:
  // wrapped in try/catch so it NEVER breaks the tool; account grain only (coverage is an account-grain concept).
  if (level && level !== 'account') return result
  try {
    const wins = result.windows.map((w) => ({ startDate: w.startDate, endDate: w.endDate }))
    const cov = await getCoverageForWindows(clientId, platforms, wins)
    // LORAMER_LORA_INCOMPLETE_TOTAL_V1 (T0#2 slice 1) — per-platform CONTRIBUTION flag + a top-level completeness
    // verdict, so a total that silently omits a currently-FAILING platform (Shelley's woo) is marked incomplete
    // instead of stated as a whole number. A total is NEVER emitted here without `complete`.
    const comp = await annotateContribution(clientId, wins, cov)
    const windows2 = result.windows.map((w, i) => ({ ...w, coverage: cov[i], contribution: comp.perWindow[i], complete: comp.completePerWindow[i] }))
    const notes = [...(result.notes || []), ...coverageNotes(cov), ...comp.notes]
    return { ...result, windows: windows2, complete: comp.overallComplete, notes: notes.length ? notes : undefined }
  } catch {
    return result
  }
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
  // LORAMER_AGENCY_SCOPE_LORA_V1 — tools attach for ANY authenticated viewer, INCLUDING the agency / all-clients
  // scope (where clientId is empty). The old `clientId && viewerCanAccess(...)` presence-gate is REMOVED: withholding
  // tools was the only thing scoping access, which is why agency scope had none. Cross-client safety is now enforced
  // PER TOOL CALL in the executor below (resolve the TARGET client, viewerCanAccess that target, FAIL CLOSED) — the
  // right place, because at agency scope the target is chosen by the model per call, not fixed for the loop.
  const tools: any[] | undefined =
    userEmail ? [QUERY_METRICS_TOOL, QUERY_BREAKDOWN_TOOL, QUERY_MONEY_TOOL] : undefined
  const convo: any[] = [...messages]
  // LORAMER_LORA_TOOL_DECISION_LOG_V1 — capture the user's QUESTION once for the decision instrument; on later turns
  // the last message is a tool_result, not the question.
  const originalQuestion: string = (() => {
    const lu = [...messages].reverse().find((m: any) => m?.role === 'user' && typeof m?.content === 'string')
    return (lu?.content as string) || ''
  })()
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

    // LORAMER_LORA_TOOL_DECISION_LOG_V1 — FIRE-AND-FORGET (not awaited) L2-retrieval instrument. Never blocks the
    // response and never breaks the turn (the try guards input-building; logToolDecision swallows internally).
    // BEHAVIOR UNCHANGED: no tool_choice added, tools array untouched, system prompt untouched — this only WATCHES.
    try {
      const decidedTool = (resp.content as any[])?.find((b) => b?.type === 'tool_use')
      void logToolDecision({ clientId, questionText: originalQuestion, toolCalled: !!decidedTool, toolName: decidedTool?.name ?? null, turnIndex: turn, model })
    } catch { /* never break the turn */ }

    if (resp.stop_reason === 'tool_use' && tools) {   // LORAMER_AGENCY_SCOPE_LORA_V1 — dropped `&& clientId`: agency scope has no bound client; the target is resolved + access-checked per call below
      const toolUses = (resp.content as any[]).filter(b => b.type === 'tool_use')
      convo.push({ role: 'assistant', content: resp.content })
      const toolResults: any[] = []
      for (const tu of toolUses) {
        let payload: any
        let isError = false
        try {
          // LORAMER_AGENCY_SCOPE_LORA_V1 — THE RBAC CHECK. Resolve the TARGET client for THIS call: the bound scope
          // client wins (single-client tab — unchanged, and the model cannot steer it elsewhere); at agency scope
          // there is none, so the model must name one via tu.input.clientId. Then viewerCanAccess THAT target on
          // EVERY call and FAIL CLOSED — with tools now attached at agency scope this per-call check is the only
          // thing preventing cross-client access, so it runs before any query touches the DB.
          const target = clientId || (typeof tu.input?.clientId === 'string' ? tu.input.clientId.trim() : '')
          if (!target) {
            payload = { error: 'No client specified. Name one of the clients you can access (use its id as clientId), or ask the user which client to look at — do not answer without a client.' }
            isError = true
          } else if (!(await viewerCanAccess(userEmail, target))) {
            payload = { error: 'Access denied: you do not have access to that client. Do not report any data for it, and tell the user you cannot access it.' }
            isError = true
          } else if (tu.name === 'query_metrics') payload = await runQueryMetricsTool(tu.input, target)
          else if (tu.name === 'query_breakdown') payload = await runQueryBreakdownTool(tu.input, target)
          else if (tu.name === 'query_money') payload = await runQueryMoneyTool(tu.input, target)
          else { payload = { error: 'unknown tool: ' + tu.name }; isError = true }
        } catch (err) {
          payload = { error: err instanceof Error ? err.message : String(err) }
          isError = true
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(payload),
          // LORAMER_LORA_TOOL_HARD_ERROR_V1 (T0#2 slice 1) — a THROWN query (e.g. a DB failure) is a HARD tool
          // error, not error-text riding as normal content, so the model treats a real read failure as a failure
          // and never reads it as data / a false number.
          ...(isError ? { is_error: true } : {}),
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
