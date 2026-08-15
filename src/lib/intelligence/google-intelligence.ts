// ─── Google Ads Intelligence Adapter ──────────────────────────────────────────
// Fetches ALL available Google Ads data for a client account.
// Output conforms to PlatformIntelligence schema.

import { GoogleAdsApi, enums } from 'google-ads-api'
import { resolveDateWindow } from '@/lib/date-range' // LORAMER_GAQL_DATE_WINDOW_V1 — the ONE resolver (Lesson 19)
import { withGaqlRetry } from '@/lib/google-retry' // LORAMER_GOOGLE_GAQL_RETRY_V1
import { composeGoogleAdName } from '@/lib/google-ad-display-name' // LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — ONE composition, ONE home
import { noteGoogleQuotaError, readGoogleQuotaPause } from '@/lib/backfill/google-quota-store' // LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1
import { GoogleQuotaError } from '@/lib/backfill/google-quota' // LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1
import type { PlatformIntelligence, IntelligenceMetrics, IntelligenceCampaign, IntelligenceAdGroup, IntelligenceAd, IntelligenceKeyword, IntelligenceSearchTerm, IntelligenceConversionAction, IntelligenceConversionByCampaign, IntelligenceAudience, IntelligenceDemographic, IntelligenceAdAsset, IntelligenceAssetGroup, IntelligenceAssetGroupAsset, IntelligenceAssetCombination, IntelligenceGeographic, IntelligenceDeviceSplit, IntelligenceHourly, IntelligenceImpressionShare, IntelligenceRecommendation } from './intelligence-types'

// LORAMER_GAQL_DATE_WINDOW_V1 — was per-file date math with a `DURING ${dateRange}` tail (a hard GAQL error
// for any non-enum string; this helper feeds ELEVEN intelligence queries, so one bad preset killed them all
// at once). One resolver, explicit BETWEEN. For the presets this path actually receives the emitted window is
// value-identical to the old DURING enum (both exclude today for LAST_N_DAYS), so live behavior is unchanged.
function buildDateFilter(dateRange: string, customStart?: string, customEnd?: string): string {
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  return `segments.date BETWEEN '${startDate}' AND '${endDate}'`
}

function buildMetrics(row: any): IntelligenceMetrics {
  const spend = Number(row.metrics?.cost_micros || 0) / 1e6
  const clicks = Number(row.metrics?.clicks || 0)
  const impressions = Number(row.metrics?.impressions || 0)
  const conversions = Number(row.metrics?.conversions || 0)
  const convValue = Number(row.metrics?.conversions_value || 0)
  return {
    spend,
    clicks,
    impressions,
    conversions,
    conversionValue: convValue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    roas: spend > 0 && convValue > 0 ? convValue / spend : null,
    cpa: conversions > 0 ? spend / conversions : null,
    convRate: clicks > 0 ? (conversions / clicks) * 100 : null,
  }
}

function normalizeBidStrategy(row: any): string {
  const type = row.campaign?.bidding_strategy_type || ''
  const map: Record<string, string> = {
    TARGET_CPA: 'Target CPA',
    TARGET_ROAS: 'Target ROAS',
    MAXIMIZE_CONVERSIONS: 'Maximize Conversions',
    MAXIMIZE_CONVERSION_VALUE: 'Maximize Conversion Value',
    TARGET_IMPRESSION_SHARE: 'Target Impression Share',
    MANUAL_CPC: 'Manual CPC',
    ENHANCED_CPC: 'Enhanced CPC',
    MAXIMIZE_CLICKS: 'Maximize Clicks',
    PERCENT_CPC: 'Percent CPC',
    TARGET_CPM: 'Target CPM',
  }
  return map[type] || type
}

// LORAMER_CHANNEL_TYPE_ENUM_V1 — THE API RETURNS ORDINALS, AND LORA WAS BEING SHOWN THEM.
//
// ⛔ MEASURED 2026-08-01 on a real assembled context for Foam OH: `channelType` came back as 3, 2 and 10 — raw
// enum ordinals, not names. The old map keyed on STRING names only and ended `map[type] || type`, so every number
// fell straight through unchanged and build-claude-context.ts:610 rendered `[10]` and `[2]` into Lora's prompt as
// the campaign's type, on every Google client. :917 did the same on impression-share lines.
//
// ⛔ AND THE OLD STRING MAP WAS FACTUALLY WRONG, WHICH IS WORSE THAN UNMAPPED. It read
// `MULTI_CHANNEL: 'Performance Max'`. Google's proto is explicit: MULTI_CHANNEL = 7 is *"App Campaigns, and App
// Campaigns for Engagement, that run across multiple channels"*, while PERFORMANCE_MAX = 10 is its own value the
// map did not carry at all. So an App campaign was being reported to the user as Performance Max, and a real PMax
// campaign fell through as a bare number. Renaming one campaign type as another is not a display bug.
//
// ORDINALS SOURCED FROM GOOGLE'S OWN PROTO, NOT INFERRED FROM THE SEVEN VALUES WE HAPPEN TO HOLD:
// https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v21/enums/advertising_channel_type.proto
// (fetched 2026-08-01; the rendered reference page states "This type has no fields" and links to this proto).
// ⚠ NOTE THE GAP AT 12 — it is absent from the enum. It was DISCOVERY, superseded by DEMAND_GEN = 14. A 12 on the
// wire is therefore a legacy value, and it is mapped explicitly rather than left to the UNKNOWN branch.
const CHANNEL_TYPE_BY_ORDINAL: Record<string, string> = {
  '0': 'Unspecified',
  '1': 'Unknown',
  '2': 'Search',
  '3': 'Display',
  '4': 'Shopping',
  '5': 'Hotel',
  '6': 'Video',
  '7': 'App',              // MULTI_CHANNEL — App Campaigns. NOT Performance Max.
  '8': 'Local',
  '9': 'Smart',
  '10': 'Performance Max',
  '11': 'Local Services',
  '12': 'Discovery (legacy)', // absent from the current enum; superseded by DEMAND_GEN
  '13': 'Travel',
  '14': 'Demand Gen',
}
const CHANNEL_TYPE_BY_NAME: Record<string, string> = {
  UNSPECIFIED: 'Unspecified', UNKNOWN: 'Unknown', SEARCH: 'Search', DISPLAY: 'Display', SHOPPING: 'Shopping',
  HOTEL: 'Hotel', VIDEO: 'Video', MULTI_CHANNEL: 'App', LOCAL: 'Local', SMART: 'Smart',
  PERFORMANCE_MAX: 'Performance Max', LOCAL_SERVICES: 'Local Services', DISCOVERY: 'Discovery (legacy)',
  TRAVEL: 'Travel', DEMAND_GEN: 'Demand Gen',
}

export function normalizeChannelTypeValue(raw: unknown): string {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  if (/^\d+$/.test(v)) return CHANNEL_TYPE_BY_ORDINAL[v] ?? `UNKNOWN(${v})`
  const byName = CHANNEL_TYPE_BY_NAME[v.toUpperCase()]
  if (byName) return byName
  // ⛔ NEVER a bare unexplained token and NEVER dropped. An unrecognised value must be VISIBLE as unrecognised —
  // silently passing it through is exactly how `10` reached a user's screen and stayed there.
  return `UNKNOWN(${v})`
}

function normalizeChannelType(row: any): string {
  return normalizeChannelTypeValue(row.campaign?.advertising_channel_type)
}

function normalizeStatus(s: string): string {
  const u = String(s || '').toUpperCase()
  if (u === 'ENABLED' || u === '2') return 'active'
  if (u === 'PAUSED' || u === '3') return 'paused'
  if (u === 'REMOVED' || u === '4') return 'removed'
  return u.toLowerCase()
}

// LORAMER_GOOGLE_CAMPAIGN_STATUS_FIX_V2
// Google reports a campaign's on/off TOGGLE (campaign.status = ENABLED/PAUSED)
// separately from whether it is actually SERVING. A campaign past its end date
// keeps status=ENABLED but Google's campaign.primary_status reports ENDED.
// Reading only the toggle mislabeled ended campaigns as "active" and let their
// stale daily budgets be summed as live spend. We now also read
// campaign.primary_status (the authoritative serving signal). NOTE: this API
// surface (google-ads-api 23.0.0) rejects campaign.end_date / campaign.start_date
// as unrecognized fields — proven via the real account in Gate A — so we key on
// primary_status alone; ENDED there is exactly what the UI shows as "Ended".
function normalizePrimaryStatus(s: any): string {
  const u = String(s ?? '').toUpperCase()
  const byNum: Record<string, string> = {
    '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'ELIGIBLE', '3': 'PAUSED',
    '4': 'REMOVED', '5': 'ENDED', '6': 'PENDING', '7': 'NOT_ELIGIBLE',
    '8': 'LIMITED', '9': 'MISCONFIGURED',
  }
  return byNum[u] || u  // idempotent: string enums pass through unchanged
}

// Authoritative status for Lora's context. primary_status ENDED wins over the
// toggle; otherwise PAUSED (toggle or primary) → paused; otherwise active.
function computeCampaignStatus(rawStatus: string, primaryStatus: string): string {
  const toggle = normalizeStatus(rawStatus)            // active | paused | removed
  if (toggle === 'removed') return 'removed'
  const ps = normalizePrimaryStatus(primaryStatus)
  if (ps === 'ENDED') return 'ended'
  if (toggle === 'paused' || ps === 'PAUSED') return 'paused'
  return 'active'
}

// LORAMER_WS1C_WIDE_SWALLOW_HARDEN_V1 — replaces the bare `.catch(() => [])` swallows. A GAQL call that RESOLVES
// (even to []) is a TRUE ZERO (the API affirmatively reported no rows); a call that REJECTS is a real FETCH FAILURE
// (auth/network/quota/API). On reject we log LOUD + record {label,message} into fetchErrors, then return [] — the
// non-throwing behavior is byte-identical to the old swallow, so nothing downstream regresses; the failure is now
// VISIBLE (the cron pushes fetchErrors into summary.errors → cron_runs.error_count). The BASE campaigns query is
// deliberately NOT routed through this — it must THROW so the cron never stamps the cursor on a failed base fetch.
// LORAMER_QUOTA_OUTAGE_IS_NOT_ABSENCE_V1 — `quota` marks the one failure kind the READER must be able to tell
// apart from a true zero. Without it every entry here reads the same to build-claude-context, so an exhausted
// developer token renders as "Google has no data" instead of "Google is refusing to answer until 08:03Z".
type GaqlFetchError = { label: string; message: string; quota?: boolean }
async function safeQuery(
  label: string,
  fn: () => Promise<any>,
  fetchErrors: GaqlFetchError[]
): Promise<any[]> {
  try {
    const rows = await fn()
    return Array.isArray(rows) ? rows : []
  } catch (e: any) {
    // LORAMER_GAQL_ERROR_SERIALIZE_V1 — ★GOOGLE-ERRORS-UNREADABLE. The old two lines produced BOTH observed
    // failure strings and neither could be read: the log printed `undefined [` because a google-ads-api rejection
    // carries its detail on `errors[]` and leaves `.message` empty, and `String(e?.message ?? e)` fell through to
    // String(<object>) = "[object Object]", which is what reached summary.errors → cron_runs → the Vercel error
    // clusters for 14+ clients. LOGGING ONLY — the catch still returns [] and nothing about the fetch changes.
    const detail = describeGaqlError(e)
    console.error(`[google-intel] ${label} query FAILED (returned [] — DEGRADED, not a true zero): ${detail}`)
    // LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1 — THE SWALLOW POINT IS AN ERROR BOUNDARY TOO, and it is the last
    // one before an outage becomes an empty array. Twenty of this file's queries land here. Arm the sentinel,
    // and MARK the entry so the reader can tell an outage from an absence.
    // ⛔ awaited, not fire-and-forget: this runs inside a request whose lambda may freeze the moment the
    // response is sent, and a frozen write is a write that did not happen.
    const q = await noteGoogleQuotaError(e, `safeQuery:${label}`)
    fetchErrors.push({ label, message: detail, ...(q.quota ? { quota: true } : {}) })
    return []
  }
}

// LORAMER_GAQL_ERROR_SERIALIZE_V1 — never return "[object Object]", "undefined" or "". Google Ads rejections put
// the useful part in errors[].{error_code,message}; plain Errors put it in .message; everything else gets JSON.
export function describeGaqlError(e: any): string {
  const parts: string[] = []
  const msg = typeof e?.message === 'string' ? e.message.trim() : ''
  if (msg) parts.push(msg)
  const errs = Array.isArray(e?.errors) ? e.errors : null
  if (errs?.length) {
    parts.push(
      errs
        .slice(0, 3)
        .map((x: any) => {
          const code = x?.error_code ? JSON.stringify(x.error_code) : ''
          const m = typeof x?.message === 'string' ? x.message : ''
          const trigger = x?.trigger?.string_value ? ` trigger=${x.trigger.string_value}` : ''
          return [code, m].filter(Boolean).join(' ') + trigger
        })
        .filter(Boolean)
        .join(' | ')
    )
  }
  if (e?.code !== undefined && e?.code !== null) parts.push(`code=${String(e.code)}`)
  if (parts.length === 0) {
    try {
      const j = JSON.stringify(e)
      if (j && j !== '{}') parts.push(j)
    } catch { /* circular — fall through */ }
  }
  if (parts.length === 0) parts.push(e?.constructor?.name ? `unserializable ${e.constructor.name}` : String(e))
  return parts.join(' · ').slice(0, 600)
}

export async function fetchGoogleIntelligence(
  refreshToken: string,
  customerId: string,
  dateRange: string,
  managerAccountId: string,
  clientId: string,
  clientSecret: string,
  developerToken: string,
  customStart?: string,
  customEnd?: string
): Promise<PlatformIntelligence> {
  // LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1 — DO NOT FIRE INTO AN EXHAUSTED TOKEN. Before 2026-07-31 nothing on
  // this path consulted the sentinel at all: google-intelligence.ts contained no readGoogleQuotaPause and no
  // holdGoogleWork, so every dashboard load for a google-connected client fired ~20 GAQL queries into a token
  // Google was refusing, and reported the result as an absence.
  //
  // ⛔ THROWS, NEVER RETURNS AN EMPTY RESULT — and that is the load-bearing choice. This file's own contract is
  // that a call which RESOLVES (even to []) is a TRUE ZERO and a call that REJECTS is a FETCH FAILURE; the BASE
  // campaigns query is deliberately left un-swallowed for exactly this reason, so the cron never stamps a cursor
  // on a failed fetch. A quota hold that returned an empty PlatformIntelligence would be a false zero written
  // straight into that contract, and forward capture would stamp cursors over a day it never fetched.
  //
  // ⛔ GATED ON A CONFIRMED PAUSE (`qp.paused`), NOT ON holdGoogleWork — DELIBERATE DEVIATION, SEE THE REPORT.
  // holdGoogleWork is TRUE when the sentinel READ FAILED ('unknown'), which is correct for capture lanes (cost
  // of a false hold = one lap, retried in ten minutes) and WRONG here. This function serves the ANSWER path, and
  // google-quota-store.ts banks the rule as do-not-relitigate: "a Supabase blip must never make Lora announce a
  // platform outage that is not happening" (FAIL-PARTIAL READ-PATH LAW / VERIFICATION LAW 1). Holding on
  // 'unknown' here would break the dashboard for every google client on a DB hiccup unrelated to Google.
  // The capture lanes do NOT lose hold-on-unknown: catchup:272 and drain:83 still gate on holdGoogleWork BEFORE
  // calling this, so this is a backstop beneath their gate, not a replacement for it.
  const qp = await readGoogleQuotaPause()
  if (qp.paused) {
    throw new GoogleQuotaError(qp.until ?? 'unknown', `sentinel: google developer-scope quota paused until ${qp.until} (${qp.reason ?? 'no reason recorded'})`)
  }

  const client = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken })
  const customer = client.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: managerAccountId })
  const dateFilter = buildDateFilter(dateRange, customStart, customEnd)
  const fetchErrors: GaqlFetchError[] = [] // LORAMER_WS1C_WIDE_SWALLOW_HARDEN_V1 — sub-query failures collected here

  // ── Campaigns ──────────────────────────────────────────────────────────────
  // LORAMER_GOOGLE_CAMPAIGN_STATUS_FIX_V2 — the ENRICHED select adds
  // campaign.primary_status so ENABLED-but-ended campaigns are labeled "ended",
  // not "active". HARDENED: if the enriched query throws (e.g. a future API
  // version rejects a field, the way end_date is rejected today), fall back to
  // the ORIGINAL field set and log LOUDLY — a campaign-field error must NEVER
  // silently drop the whole Google platform from context again (the V1
  // regression). Worst case we lose only the new status precision, not Google.
  const CAMPAIGN_BASE_FIELDS = `campaign.id, campaign.name, campaign.status,
    campaign.advertising_channel_type, campaign.bidding_strategy_type,
    campaign_budget.amount_micros, campaign_budget.type,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc`
  const campaignQuery = (fields: string) => `
    SELECT ${fields}
    FROM campaign
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `
  // LORAMER_WS1C_WIDE_SWALLOW_HARDEN_V1 — INVARIANT: the base campaigns query MUST stay un-swallowed (it THROWS on
  // failure). data.totals = campaigns.reduce(...) → the account base row; if this query ever returned [] on failure
  // (a `.catch(() => [])` or a safeQuery wrap) the account/campaign rows become a FALSE ZERO and the cron would stamp
  // last_forward_sync_date on a failed fetch. NEVER route this query through safeQuery / any swallowing catch.
  let campaignRows: any[]
  let campaignStatusEnriched = true
  try {
    // LORAMER_GOOGLE_GAQL_RETRY_V1 — retry transient deadline/internal/unavailable before falling back
    campaignRows = await withGaqlRetry('intel:campaign-enriched', () => customer.query(campaignQuery(`campaign.primary_status, ${CAMPAIGN_BASE_FIELDS}`)))
  } catch (enrichErr) {
    campaignStatusEnriched = false
    // LORAMER_ENRICHED_CAMPAIGN_FALLBACK_VISIBLE_V1 — RECORD IT. This catch degraded the answer and told no one:
    // it logged, fell back, and pushed NOTHING into fetchErrors, so build-claude-context could not know and Lora
    // reported toggle-only statuses as if they were authoritative. That is the difference between "ENABLED" and
    // "ENABLED but not serving (payment / policy / still learning)" — a distinction she will state confidently
    // and wrongly. describeGaqlError (LORAMER_GAQL_ERROR_SERIALIZE_V1) because a google-ads rejection leaves
    // .message empty and would otherwise land here as "[object Object]".
    fetchErrors.push({ label: 'campaign_status', message: describeGaqlError(enrichErr) })
    console.error('LORAMER_GOOGLE_CAMPAIGN_STATUS_FIX_V2: enriched campaign query failed, falling back to base fields (status precision lost, Google NOT dropped):', enrichErr instanceof Error ? enrichErr.message : enrichErr)
    campaignRows = await withGaqlRetry('intel:campaign-base', () => customer.query(campaignQuery(CAMPAIGN_BASE_FIELDS)))
  }

  const campaigns: IntelligenceCampaign[] = campaignRows.map((row: any) => {
    const primaryStatus = campaignStatusEnriched ? normalizePrimaryStatus(row.campaign?.primary_status) : ''
    // Enriched: primary_status authoritative. Fallback: toggle only (V1 behavior).
    const status = campaignStatusEnriched
      ? computeCampaignStatus(String(row.campaign?.status || ''), primaryStatus)
      : normalizeStatus(String(row.campaign?.status || ''))
    return {
      id: String(row.campaign?.id || ''),
      name: String(row.campaign?.name || ''),
      platform: 'google' as const,
      status,
      primaryStatus: primaryStatus || undefined,
      channelType: normalizeChannelType(row),
      objective: normalizeChannelType(row),
      bidStrategy: normalizeBidStrategy(row),
      budgetType: row.campaign_budget?.type === 'DAILY' ? 'daily' : 'lifetime',
      budget: Number(row.campaign_budget?.amount_micros || 0) / 1e6,
      metrics: buildMetrics(row),
    }
  })

  // ── Ad Groups ──────────────────────────────────────────────────────────────
  const adGroupRows = await safeQuery('ad_group', () => customer.query(`
    SELECT ad_group.id, ad_group.name, ad_group.status,
    campaign.id, campaign.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc
    FROM ad_group
    WHERE ${dateFilter}
    AND ad_group.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `), fetchErrors)

  const adGroups: IntelligenceAdGroup[] = adGroupRows.map((row: any) => ({
    id: String(row.ad_group?.id || ''),
    name: String(row.ad_group?.name || ''),
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    platform: 'google' as const,
    status: normalizeStatus(String(row.ad_group?.status || '')),
    metrics: buildMetrics(row),
  }))

  // ── Ads ────────────────────────────────────────────────────────────────────
  const adRows = await safeQuery('ad', () => customer.query(`
    SELECT ad_group_ad.ad.id, ad_group_ad.ad.name,
    ad_group_ad.ad.type,
    ad_group_ad.ad.responsive_search_ad.headlines,
    ad_group_ad.ad.responsive_search_ad.descriptions,
    ad_group_ad.ad.expanded_text_ad.headline_part1,
    ad_group_ad.ad.expanded_text_ad.description,
    ad_group_ad.status,
    ad_group.id, ad_group.name,
    campaign.id, campaign.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value, metrics.ctr
    FROM ad_group_ad
    WHERE ${dateFilter}
    AND ad_group_ad.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `), fetchErrors)

  const ads: IntelligenceAd[] = adRows.map((row: any) => {
    const adType = String(row.ad_group_ad?.ad?.type || '')
    const rsaHeadlines = row.ad_group_ad?.ad?.responsive_search_ad?.headlines
    const headline = rsaHeadlines?.[0]?.text || row.ad_group_ad?.ad?.expanded_text_ad?.headline_part1 || ''
    const description = row.ad_group_ad?.ad?.responsive_search_ad?.descriptions?.[0]?.text || row.ad_group_ad?.ad?.expanded_text_ad?.description || ''
    return {
      id: String(row.ad_group_ad?.ad?.id || ''),
      // LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — Google serves NO ad.name for search-type ads (vendor-empty by
      // probe, FACT REGISTRY §AD.NAME), so this used to write '' into every forward ad-grain metrics row via
      // google-metrics-row.ts:71. Compose from the headlines this query ALREADY selects; the shared function
      // is the one home (junk vendor names lose to composition, real video/image names win — no material).
      name: composeGoogleAdName(row.ad_group_ad?.ad),
      adGroupId: String(row.ad_group?.id || ''),
      adGroupName: String(row.ad_group?.name || ''),
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      platform: 'google' as const,
      status: normalizeStatus(String(row.ad_group_ad?.status || '')),
      creativeType: adType.includes('RESPONSIVE') ? 'responsive' : adType.includes('VIDEO') ? 'video' : 'text',
      headline,
      description,
      metrics: buildMetrics(row),
    }
  })

  // ── Keywords ───────────────────────────────────────────────────────────────
  const kwRows = await safeQuery('keyword', () => customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
    ad_group.name, campaign.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
    FROM keyword_view
    WHERE ${dateFilter}
    AND ad_group_criterion.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `), fetchErrors)

  const keywords: IntelligenceKeyword[] = kwRows.map((row: any) => ({
    text: String(row.ad_group_criterion?.keyword?.text || ''),
    matchType: String(row.ad_group_criterion?.keyword?.match_type || ''),
    campaignName: String(row.campaign?.name || ''),
    adGroupName: String(row.ad_group?.name || ''),
    status: normalizeStatus(String(row.ad_group_criterion?.status || '')),
    qualityScore: row.ad_group_criterion?.quality_info?.quality_score || undefined,
    metrics: buildMetrics(row),
  }))

  // ── Search Terms (LORAMER_PROJECT_3_STEP_2A_V1) ────────────────────────────
  // The search term report — what users actually typed that triggered our ads.
  // Independent of the keywords we bid on. Reveals where money is going.
  // Cached for 15 min by the intelligence route; this query is relatively
  // expensive so we cap at top 100 by spend.
  const searchTermRows = await safeQuery('search_term', () => customer.query(`
    SELECT search_term_view.search_term, search_term_view.status,
    segments.search_term_match_type,
    campaign.id, campaign.name,
    ad_group.id, ad_group.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value
    FROM search_term_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `), fetchErrors)

  const searchTerms: IntelligenceSearchTerm[] = searchTermRows.map((row: any) => {
    const statusRaw = String(row.search_term_view?.status || '')
    const statusMap: Record<string, string> = {
      NONE: 'unmapped',
      ADDED: 'added as keyword',
      EXCLUDED: 'excluded',
      ADDED_EXCLUDED: 'added & excluded',
      UNKNOWN: 'unknown',
    }
    return {
      text: String(row.search_term_view?.search_term || ''),
      matchType: String(row.segments?.search_term_match_type || ''),
      status: statusMap[statusRaw] || statusRaw.toLowerCase(),
      campaignName: String(row.campaign?.name || ''),
      adGroupName: String(row.ad_group?.name || ''),
      metrics: buildMetrics(row),
    }
  })

  // ── Conversion Actions ─────────────────────────────────────────────────────
  const convRows = await safeQuery('conversion_action', () => customer.query(`
    SELECT conversion_action.id, conversion_action.name, conversion_action.category,
    conversion_action.include_in_conversions_metric,
    metrics.conversions
    FROM conversion_action
    WHERE ${dateFilter}
    AND conversion_action.status = 'ENABLED'
  `), fetchErrors)

  const conversionActions: IntelligenceConversionAction[] = convRows.map((row: any) => ({
    id: String(row.conversion_action?.id || ''),
    name: String(row.conversion_action?.name || ''),
    category: String(row.conversion_action?.category || ''),
    platform: 'google' as const,
    includeInConversions: Boolean(row.conversion_action?.include_in_conversions_metric),
    count: Number(row.metrics?.conversions || 0),
  }))

  // ── Conversions × Campaign (LORAMER_PROJECT_3_STEP_2B_V1) ──────────────────
  // Per-campaign breakdown of which conversion actions fired where.
  // segments.conversion_action gives one row per (campaign, conv_action) pair.
  // Filters out rows with 0 conversions to keep the payload tight.
  const convByCampaignRows = await safeQuery('conv_by_campaign', () => customer.query(`
    SELECT campaign.id, campaign.name,
    segments.conversion_action_name, segments.conversion_action_category,
    metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    AND metrics.conversions > 0
    ORDER BY metrics.conversions DESC
    LIMIT 200
  `), fetchErrors)

  const conversionsByCampaign: IntelligenceConversionByCampaign[] = convByCampaignRows.map((row: any) => ({
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    conversionActionName: String(row.segments?.conversion_action_name || ''),
    conversionActionCategory: String(row.segments?.conversion_action_category || ''),
    count: Number(row.metrics?.conversions || 0),
    value: Number(row.metrics?.conversions_value || 0),
  }))

  // ── Audience Segments (LORAMER_PROJECT_3_STEP_2C_V1) ───────────────────────
  // audience_view returns per-(audience, campaign, ad_group) performance.
  // For accounts without audience targeting (pure search-keyword) returns [].
  // For PMax / Display / Discovery accounts this is gold — reveals which
  // audience signals (in-market, affinity, lookalike, custom) actually drive
  // conversions vs. just spending.
  const audienceRows = await safeQuery('audience', () => customer.query(`
    SELECT campaign.id, campaign.name,
    ad_group.id, ad_group.name,
    audience.id, audience.name, audience.description,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value
    FROM audience_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    AND metrics.cost_micros > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `), fetchErrors)

  const audiences: IntelligenceAudience[] = audienceRows.map((row: any) => ({
    id: String(row.audience?.id || ''),
    name: resolveAudienceName(String(row.audience?.name || '')),  // LORAMER_AUDIENCE_CRITERION_ID_MAP_V1
    description: row.audience?.description ? String(row.audience.description) : undefined,
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    adGroupId: row.ad_group?.id ? String(row.ad_group.id) : undefined,
    adGroupName: row.ad_group?.name ? String(row.ad_group.name) : undefined,
    metrics: buildMetrics(row),
  }))

  // ── Demographics (LORAMER_PROJECT_3_STEP_2D_V1) ────────────────────────────
  // Two GAQL views — age_range_view and gender_view — give us per-campaign
  // demographic breakdowns. Both queried independently, results flattened
  // into one demographics array distinguished by `dimension`.
  const [ageRows, genderRows] = await Promise.all([
    safeQuery('age_range', () => customer.query(`
      SELECT campaign.id, campaign.name,
      ad_group.id, ad_group.name,
      ad_group_criterion.age_range.type,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM age_range_view
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `), fetchErrors),
    safeQuery('gender', () => customer.query(`
      SELECT campaign.id, campaign.name,
      ad_group.id, ad_group.name,
      ad_group_criterion.gender.type,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM gender_view
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `), fetchErrors),
  ])

  // Normalize Google's enum-style age and gender labels for readability
  const AGE_LABEL_MAP: Record<string, string> = {
    AGE_RANGE_18_24: '18-24',
    AGE_RANGE_25_34: '25-34',
    AGE_RANGE_35_44: '35-44',
    AGE_RANGE_45_54: '45-54',
    AGE_RANGE_55_64: '55-64',
    AGE_RANGE_65_UP: '65+',
    AGE_RANGE_UNDETERMINED: 'Unknown age',
  }
  const GENDER_LABEL_MAP: Record<string, string> = {
    MALE: 'Male',
    FEMALE: 'Female',
    UNDETERMINED: 'Unknown gender',
  }
  // LORAMER_AUDIENCE_CRITERION_ID_MAP_V1
  // When audience_view returns criterion-based audiences (e.g. age range targeting on
  // a Search campaign), audience.name may be the raw criterion ID. Map known IDs to
  // human-readable labels. Pass through anything that doesn't match (e.g. real
  // in-market or custom audience names).
  const CRITERION_ID_MAP: Record<string, string> = {
    '503001': 'Age 18-24',
    '503002': 'Age 25-34',
    '503003': 'Age 35-44',
    '503004': 'Age 45-54',
    '503005': 'Age 55-64',
    '503006': 'Age 65+',
    '503999': 'Age undetermined',
    '10': 'Male',
    '11': 'Female',
    '20': 'Gender undetermined',
  }
  function resolveAudienceName(raw: string): string {
    if (!raw) return '(unnamed audience)'
    // Only attempt mapping if the name is purely numeric — real audience names
    // (e.g. "In-market: Travel & Tourism") should pass through untouched.
    if (/^\d+$/.test(raw) && CRITERION_ID_MAP[raw]) {
      return CRITERION_ID_MAP[raw]
    }
    return raw
  }

  const ageDemos: IntelligenceDemographic[] = ageRows.map((row: any) => {
    const raw = String(row.ad_group_criterion?.age_range?.type || '')
    return {
      dimension: 'age' as const,
      value: AGE_LABEL_MAP[raw] || raw,
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      adGroupId: row.ad_group?.id ? String(row.ad_group.id) : undefined,
      adGroupName: row.ad_group?.name ? String(row.ad_group.name) : undefined,
      metrics: buildMetrics(row),
    }
  })

  const genderDemos: IntelligenceDemographic[] = genderRows.map((row: any) => {
    const raw = String(row.ad_group_criterion?.gender?.type || '')
    return {
      dimension: 'gender' as const,
      value: GENDER_LABEL_MAP[raw] || raw,
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      adGroupId: row.ad_group?.id ? String(row.ad_group.id) : undefined,
      adGroupName: row.ad_group?.name ? String(row.ad_group.name) : undefined,
      metrics: buildMetrics(row),
    }
  })

  const demographics: IntelligenceDemographic[] = [...ageDemos, ...genderDemos]

  // ── RSA Asset Performance (LORAMER_PROJECT_3_STEP_2E_V1) ───────────────────
  // Per-asset headlines and descriptions for Responsive Search Ads, with
  // Google's BEST/GOOD/LOW performance labels. Filters to text assets only
  // (HEADLINE or DESCRIPTION field types). PMax asset-group assets handled
  // separately in 2f.
  const adAssetRows = await safeQuery('ad_asset', () => customer.query(`
    SELECT campaign.name,
    ad_group.name,
    ad_group_ad.ad.id,
    ad_group_ad_asset_view.field_type,
    ad_group_ad_asset_view.performance_label,
    asset.text_asset.text
    FROM ad_group_ad_asset_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    AND ad_group_ad.status != 'REMOVED'
    AND ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')
    LIMIT 500
  `), fetchErrors)

  const adAssets: IntelligenceAdAsset[] = adAssetRows.map((row: any) => {
    const ft = String(row.ad_group_ad_asset_view?.field_type || '')
    const fieldType: 'HEADLINE' | 'DESCRIPTION' | 'OTHER' =
      ft === 'HEADLINE' ? 'HEADLINE' : ft === 'DESCRIPTION' ? 'DESCRIPTION' : 'OTHER'
    return {
      adId: String(row.ad_group_ad?.ad?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      adGroupName: String(row.ad_group?.name || ''),
      fieldType,
      text: String(row.asset?.text_asset?.text || ''),
      performanceLabel: String(row.ad_group_ad_asset_view?.performance_label || ''),
    }
  })

  // ── PMax Asset Groups + Assets (LORAMER_PROJECT_3_STEP_2F_V1) ──────────────
  // THE NORTH STAR — lets Claude answer "which asset combination drove this
  // conversion?" for Performance Max campaigns. Two queries in parallel:
  // asset_group_view (per-group metrics) and asset_group_asset_view (per-asset
  // performance labels). Combined render shows asset groups with their assets
  // grouped beneath them.
  // LORAMER_PROJECT_3_STEP_2G_V1 — three parallel PMax queries:
  //   1) asset_group        — per-group metrics
  //   2) asset_group_asset  — asset text/type (+ asset id as the join key)
  //   3) asset_group_top_combination_view — Google's Combinations report:
  //      which assets actually served TOGETHER as a top combination. This is
  //      the real north-star signal. Per-asset BEST/GOOD/LOW labels are UI-only
  //      in v23 (validator-confirmed), so we do NOT attempt to read them.
  const [assetGroupRows, assetGroupAssetRows, assetCombinationRows] = await Promise.all([
    safeQuery('pmax_asset_group', () => customer.query(`
      SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.ad_strength,
      campaign.id, campaign.name,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM asset_group
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      AND asset_group.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `), fetchErrors),  // LORAMER_PMAX_CATCH_INSTRUMENTATION_V1
    safeQuery('pmax_asset_group_asset', () => customer.query(`
      SELECT asset_group.id, asset_group.name,
      campaign.name,
      asset_group_asset.asset,
      asset_group_asset.field_type,
      asset.type, asset.text_asset.text
      FROM asset_group_asset
      WHERE asset_group_asset.status != 'REMOVED'
      AND campaign.status != 'REMOVED'
      LIMIT 500
    `), fetchErrors),  // LORAMER_PMAX_CATCH_INSTRUMENTATION_V1
    safeQuery('pmax_top_combination', () => customer.query(`
      SELECT campaign.id, campaign.name,
      asset_group.id, asset_group.name, asset_group.ad_strength,
      asset_group_top_combination_view.asset_group_top_combinations
      FROM asset_group_top_combination_view
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
    `), fetchErrors),  // LORAMER_PMAX_CATCH_INSTRUMENTATION_V1
  ])

  const assetGroups: IntelligenceAssetGroup[] = assetGroupRows.map((row: any) => ({
    id: String(row.asset_group?.id || ''),
    name: String(row.asset_group?.name || ''),
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    status: normalizeStatus(String(row.asset_group?.status || '')),
    adStrength: row.asset_group?.ad_strength ? String(row.asset_group.ad_strength) : undefined,
    metrics: buildMetrics(row),
  }))

  const assetGroupAssets: IntelligenceAssetGroupAsset[] = assetGroupAssetRows.map((row: any) => {
    const fieldType = String(row.asset_group_asset?.field_type || '')
    const assetType = String(row.asset?.type || '')
    const isImage = fieldType.includes('IMAGE') || fieldType.includes('LOGO') || assetType === 'IMAGE'
    const isVideo = fieldType.includes('VIDEO') || assetType === 'YOUTUBE_VIDEO'
    return {
      assetGroupId: String(row.asset_group?.id || ''),
      assetGroupName: String(row.asset_group?.name || ''),
      campaignName: String(row.campaign?.name || ''),
      fieldType,
      text: row.asset?.text_asset?.text ? String(row.asset.text_asset.text) : undefined,
      isImage,
      isVideo,
      assetId: String(row.asset_group_asset?.asset || ''),  // LORAMER_PROJECT_3_STEP_2G_V1 — join key for combinations
    }
  })

  // LORAMER_PROJECT_3_STEP_2G_V1 — resolve combination asset references (which
  // come back as asset RESOURCE NAMES like "customers/X/assets/123") to
  // readable text/type using the assets we just fetched. Then flatten each
  // top combination into a human-readable list of its served assets.
  const assetTextById: Record<string, string> = {}
  assetGroupAssets.forEach(a => {
    if (!a.assetId) return
    const idNum = a.assetId.split('/').pop() || a.assetId
    let label: string
    if (a.text) label = `${a.fieldType}: "${a.text}"`
    else if (a.isVideo) label = `VIDEO (${a.fieldType})`
    else if (a.isImage) label = `IMAGE (${a.fieldType})`
    else label = a.fieldType || 'asset'
    assetTextById[idNum] = label
  })

  const assetCombinations: IntelligenceAssetCombination[] = []
  assetCombinationRows.forEach((row: any) => {
    const view = row.asset_group_top_combination_view
    const combos = view?.asset_group_top_combinations || []
    combos.forEach((combo: any) => {
      const served = combo?.asset_combination_data?.served_assets
        ?? combo?.served_assets
        ?? []
      const assetDescriptions: string[] = served.map((u: any) => {
        const ref = String(u?.asset || '')
        const idNum = ref.split('/').pop() || ref
        return assetTextById[idNum] || `asset ${idNum}`
      }).filter(Boolean)
      if (assetDescriptions.length > 0) {
        assetCombinations.push({
          assetGroupId: String(row.asset_group?.id || ''),
          assetGroupName: String(row.asset_group?.name || ''),
          campaignName: String(row.campaign?.name || ''),
          adStrength: row.asset_group?.ad_strength ? String(row.asset_group.ad_strength) : undefined,
          assets: assetDescriptions,
        })
      }
    })
  })

  // ── Geographic + Device + Hour (LORAMER_PROJECT_3_STEP_3A_V1 / 3B_V1 / 3C_V1) ─
  // Three Tier-2 segmentations of campaign performance, batched. No UI surfaces;
  // these flow into Claude's context only.
  const [geoRows, deviceRows, hourRows] = await Promise.all([
    safeQuery('geographic', () => customer.query(`
      SELECT campaign.id, campaign.name,
      geographic_view.country_criterion_id, geographic_view.location_type,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM geographic_view
      WHERE ${dateFilter}
      ORDER BY metrics.cost_micros DESC
      LIMIT 200
    `), fetchErrors),  // LORAMER_PMAX_CATCH_INSTRUMENTATION_V1
    safeQuery('device', () => customer.query(`
      SELECT campaign.id, campaign.name, segments.device,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `), fetchErrors),
    safeQuery('hour', () => customer.query(`
      SELECT campaign.id, campaign.name, segments.hour, segments.day_of_week,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 1000
    `), fetchErrors),
  ])

  const geographics: IntelligenceGeographic[] = geoRows.map((row: any) => ({
    campaignId: String(row.campaign?.id || ''),
    campaignName: String(row.campaign?.name || ''),
    countryCriterionId: row.geographic_view?.country_criterion_id ? String(row.geographic_view.country_criterion_id) : undefined,
    locationType: row.geographic_view?.location_type ? String(row.geographic_view.location_type) : undefined,
    metrics: buildMetrics(row),
  }))

  const DEVICE_LABEL_MAP: Record<string, string> = {
    'MOBILE': 'Mobile', 'DESKTOP': 'Desktop', 'TABLET': 'Tablet',
    'CONNECTED_TV': 'Connected TV', 'OTHER': 'Other', 'UNKNOWN': 'Unknown',
  }
  const devices: IntelligenceDeviceSplit[] = deviceRows.map((row: any) => {
    const raw = String(row.segments?.device || '')
    return {
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      device: DEVICE_LABEL_MAP[raw] || raw || 'Unknown',
      metrics: buildMetrics(row),
    }
  })

  const DOW_LABEL_MAP: Record<string, string> = {
    'MONDAY': 'Mon', 'TUESDAY': 'Tue', 'WEDNESDAY': 'Wed', 'THURSDAY': 'Thu',
    'FRIDAY': 'Fri', 'SATURDAY': 'Sat', 'SUNDAY': 'Sun',
  }
  const hourly: IntelligenceHourly[] = hourRows.map((row: any) => {
    const dow = String(row.segments?.day_of_week || '')
    return {
      campaignId: String(row.campaign?.id || ''),
      campaignName: String(row.campaign?.name || ''),
      hour: Number(row.segments?.hour || 0),
      dayOfWeek: DOW_LABEL_MAP[dow] || dow || '',
      metrics: buildMetrics(row),
    }
  })

  // ── Impression Share (LORAMER_PROJECT_3_STEP_3D_V1) ───────────────────────
  // The API-accessible auction signal: how much of available impressions are
  // captured, and how much is lost to budget vs. rank. True Auction Insights
  // (competitor domains, overlap rate, outranking share) is UI-only in v23.
  const impressionShareRows = await safeQuery('impression_share', () => customer.query(`
    SELECT campaign.id, campaign.name, campaign.advertising_channel_type,
    metrics.search_impression_share,
    metrics.search_top_impression_share,
    metrics.search_absolute_top_impression_share,
    metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share,
    metrics.search_budget_lost_top_impression_share,
    metrics.search_rank_lost_top_impression_share,
    metrics.cost_micros
    FROM campaign
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `), fetchErrors)

  const impressionShares: IntelligenceImpressionShare[] = impressionShareRows
    .map((row: any) => {
      const is = Number(row.metrics?.search_impression_share || 0)
      const topIs = Number(row.metrics?.search_top_impression_share || 0)
      const absTopIs = Number(row.metrics?.search_absolute_top_impression_share || 0)
      const lostBudget = Number(row.metrics?.search_budget_lost_impression_share || 0)
      const lostRank = Number(row.metrics?.search_rank_lost_impression_share || 0)
      const lostBudgetTop = Number(row.metrics?.search_budget_lost_top_impression_share || 0)
      const lostRankTop = Number(row.metrics?.search_rank_lost_top_impression_share || 0)
      // The API returns -1.0 for non-eligible/unavailable; filter those out
      const hasData = is >= 0 || topIs >= 0 || absTopIs >= 0
      return {
        campaignId: String(row.campaign?.id || ''),
        campaignName: String(row.campaign?.name || ''),
        // LORAMER_CHANNEL_TYPE_ENUM_V1 — the SECOND site that fed a raw ordinal to the prompt. build-claude-context
        // :917 renders this on every impression-share line, so it had the same `[10]` defect as the campaigns list.
        channelType: normalizeChannelTypeValue(row.campaign?.advertising_channel_type),
        impressionShare: is >= 0 ? is : null,
        topImpressionShare: topIs >= 0 ? topIs : null,
        absoluteTopImpressionShare: absTopIs >= 0 ? absTopIs : null,
        lostToBudget: lostBudget >= 0 ? lostBudget : null,
        lostToRank: lostRank >= 0 ? lostRank : null,
        lostTopToBudget: lostBudgetTop >= 0 ? lostBudgetTop : null,
        lostTopToRank: lostRankTop >= 0 ? lostRankTop : null,
        hasData,
      }
    })
    .filter((x: IntelligenceImpressionShare) => x.hasData)

  // ── Google Recommendations (LORAMER_PROJECT_3_STEP_3E_V1) ─────────────────
  // Google's own optimization suggestions. Bias-warning: these are calibrated
  // for Google's revenue, not the operator's outcomes. Claude evaluates each
  // against the client's actual data (see prompt section).
  const recommendationRows = await safeQuery('recommendation', () => customer.query(`
    SELECT recommendation.resource_name, recommendation.type, recommendation.campaign, recommendation.impact, recommendation.dismissed
    FROM recommendation
    WHERE recommendation.dismissed = FALSE
    LIMIT 200
  `), fetchErrors)

  const microsToDollars = (v: any): number => Number(v || 0) / 1e6
  // LORAMER_PROJECT_3_STEP_3E_HOTFIX_V1 — recommendation.type comes back as
  // an integer enum value from the npm lib. Invert the exported enum into a
  // number→name map at module init so we can resolve to human labels.
  const RECOMMENDATION_TYPE_BY_VALUE: Record<number, string> = (() => {
    const m: Record<number, string> = {}
    const e: any = (enums as any)?.RecommendationType || {}
    Object.entries(e).forEach(([k, v]) => {
      if (typeof v === 'number' && typeof k === 'string') m[v] = k
    })
    return m
  })()
  const resolveRecommendationType = (raw: any): string => {
    if (raw === null || raw === undefined) return ''
    if (typeof raw === 'string' && raw && !/^\d+$/.test(raw)) return raw
    const n = Number(raw)
    if (Number.isFinite(n) && RECOMMENDATION_TYPE_BY_VALUE[n]) return RECOMMENDATION_TYPE_BY_VALUE[n]
    return String(raw)
  }
  const recommendations: IntelligenceRecommendation[] = recommendationRows.map((row: any) => {
    const r = row.recommendation || {}
    const impact = r.impact || {}
    const base = impact.base_metrics || {}
    const potential = impact.potential_metrics || {}
    return {
      resourceName: String(r.resource_name || ''),
      type: resolveRecommendationType(r.type),
      campaignResourceName: r.campaign ? String(r.campaign) : undefined,
      baseImpressions: Number(base.impressions || 0),
      baseClicks: Number(base.clicks || 0),
      baseCost: microsToDollars(base.cost_micros),
      baseConversions: Number(base.conversions || 0),
      potentialImpressions: Number(potential.impressions || 0),
      potentialClicks: Number(potential.clicks || 0),
      potentialCost: microsToDollars(potential.cost_micros),
      potentialConversions: Number(potential.conversions || 0),
    }
  })

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalSpend = campaigns.reduce((s, c) => s + c.metrics.spend, 0)
  const totalClicks = campaigns.reduce((s, c) => s + c.metrics.clicks, 0)
  const totalImpressions = campaigns.reduce((s, c) => s + c.metrics.impressions, 0)
  const totalConversions = campaigns.reduce((s, c) => s + c.metrics.conversions, 0)
  const totalConvValue = campaigns.reduce((s, c) => s + c.metrics.conversionValue, 0)

  const totals: IntelligenceMetrics = {
    spend: totalSpend,
    clicks: totalClicks,
    impressions: totalImpressions,
    conversions: totalConversions,
    conversionValue: totalConvValue,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    roas: totalSpend > 0 && totalConvValue > 0 ? totalConvValue / totalSpend : null,
    cpa: totalConversions > 0 ? totalSpend / totalConversions : null,
    convRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : null,
  }

  return {
    connected: true,
    accountId: customerId,
    dateRange,
    fetchedAt: new Date().toISOString(),
    campaigns,
    adGroups,
    ads,
    keywords,
    searchTerms,  // LORAMER_PROJECT_3_STEP_2A_V1
    conversionActions,
    conversionsByCampaign,  // LORAMER_PROJECT_3_STEP_2B_V1
    audiences,              // LORAMER_PROJECT_3_STEP_2C_V1
    demographics,           // LORAMER_PROJECT_3_STEP_2D_V1
    adAssets,               // LORAMER_PROJECT_3_STEP_2E_V1
    assetGroups,            // LORAMER_PROJECT_3_STEP_2F_V1
    assetGroupAssets,       // LORAMER_PROJECT_3_STEP_2F_V1
    assetCombinations,      // LORAMER_PROJECT_3_STEP_2G_V1
    geographics,            // LORAMER_PROJECT_3_STEP_3A_V1
    devices,                // LORAMER_PROJECT_3_STEP_3B_V1
    hourly,                 // LORAMER_PROJECT_3_STEP_3C_V1
    impressionShares,       // LORAMER_PROJECT_3_STEP_3D_V1
    recommendations,        // LORAMER_PROJECT_3_STEP_3E_V1
    totals,
    fetchErrors,            // LORAMER_WS1C_WIDE_SWALLOW_HARDEN_V1
  }
}
