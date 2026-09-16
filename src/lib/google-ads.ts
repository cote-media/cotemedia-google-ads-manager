import { GoogleAdsApi, enums } from 'google-ads-api' // enums: LORAMER_RMF_R70_SEARCH_TERMS_V1 match-type/status name maps
import { resolveDateWindow } from '@/lib/date-range'

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

function getCustomer(refreshToken: string, customerId: string) {
  return client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
}

/**
 * LORAMER_DIRECT_ACCESS_CUSTOMER_V1 — WHAT THIS LOGIN CAN ACTUALLY REACH, WHICH IS A STRICT SUPERSET OF WHAT
 * IT USED TO RETURN.
 *
 * ⛔ WHAT IT USED TO DO, AND WHY THAT COULD NEVER SERVE A CUSTOMER WHO IS NOT US: it asked the token for the
 * `customer_client` children of OUR OWN manager account, at `level = 1`. A stranger's token was being asked
 * for the contents of Russ's manager account, so their own accounts could not appear in the list however
 * valid their authorization was. MEASURED 2026-09-16: that query returned 17 accounts for the owner token
 * while `ListAccessibleCustomers` returned 20 for the same token — 3 the picker could not show, of which 5
 * live accounts across the wider set sit outside the manager entirely.
 *
 * ⛔ THE HIERARCHY QUERY IS KEPT, NOT REPLACED, AND THE REASON IS COST. It names every account under the
 * manager in ONE request, and that is the common case for the existing fleet. `ListAccessibleCustomers` costs
 * nothing extra (Google's own doc: the `login-customer-id` header "is not required for this request type, and
 * has no effect on the list of customers returned") but it returns IDS ONLY, so a name for an account outside
 * the manager costs one request each. Paying that only for the accounts the old path could not show keeps the
 * existing fleet's picker at the request count it has today.
 *
 * ⚠ A DIRECTLY-REACHED ACCOUNT WHOSE NAME LOOKUP FAILS IS STILL RETURNED, WITH ITS ID AS ITS NAME — EXCEPT A
 * DEACTIVATED ONE, WHICH IS DROPPED. Those two are not the same case and the live run is what separated them:
 * of the 8 accounts this newly reaches for the owner token, 5 named cleanly and 3 came back
 * *"not yet enabled or has been deactivated"*. A deactivated account can never produce a row, so listing it as
 * a bare number is a TRAP — the customer maps it and the walk then captures nothing, which is the silent-empty
 * shape this repo refuses. An account that merely failed to NAME itself is a different thing: it may still be
 * usable, so it is kept and shown by id rather than hidden.
 */
export async function listAccessibleAccounts(refreshToken: string) {
  const manager = process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!
  const out = new Map<string, { id: string; name: string; currency: string; timezone: string }>()

  // (1) everything under OUR manager, one request, names included — unchanged from before this change.
  try {
    const customer = client.Customer({ customer_id: manager, refresh_token: refreshToken, login_customer_id: manager })
    const rows = await customer.query(`
      SELECT customer_client.client_customer, customer_client.descriptive_name,
      customer_client.currency_code, customer_client.time_zone, customer_client.status
      FROM customer_client
      WHERE customer_client.level = 1
      AND customer_client.status = 'ENABLED'
    `)
    for (const row of rows as any[]) {
      const id = String(row.customer_client.client_customer || '').replace('customers/', '')
      if (id) out.set(id, {
        id,
        name: String(row.customer_client.descriptive_name || ''),
        currency: String(row.customer_client.currency_code || ''),
        timezone: String(row.customer_client.time_zone || ''),
      })
    }
  } catch (e: any) {
    // ⛔ NOT FATAL AND NOT SILENT. A token with no relationship to our manager — which is every future
    // customer — is REFUSED here, and that refusal is the normal case for them, not an error for us.
    console.log(`[google-ads] manager hierarchy unavailable for this token (normal for a customer who is not under it): ${e?.errors?.[0]?.message ?? e?.message ?? e}`)
  }

  // (2) everything the TOKEN reaches directly, whatever hierarchy it sits in.
  const reachable = await listReachableCustomerIds(refreshToken)
  for (const id of reachable) {
    if (out.has(id) || id === String(manager).replace(/-/g, '')) continue
    out.set(id, { id, name: id, currency: '', timezone: '' })
  }

  // (3) name the ones the hierarchy query could not name — one request each, direct access only.
  // ⛔ DEACTIVATED IS NOT "UNNAMED". The vendor says so in its own words and the two get different fates.
  const DEACTIVATED = /not yet enabled|has been deactivated|CUSTOMER_NOT_ENABLED/i
  const drop = new Set<string>()
  await Promise.all([...out.values()].filter((a) => a.name === a.id).map(async (a) => {
    try {
      const c = client.Customer({ customer_id: a.id, refresh_token: refreshToken })
      const rows = await c.query('SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1')
      const r = (rows as any[])[0]?.customer
      if (r) {
        a.name = String(r.descriptive_name || a.id)
        a.currency = String(r.currency_code || '')
        a.timezone = String(r.time_zone || '')
      }
    } catch (e: any) {
      const msg = String(e?.errors?.[0]?.message ?? e?.message ?? e)
      if (DEACTIVATED.test(msg)) {
        drop.add(a.id)
        console.log(`[google-ads] ${a.id}: DEACTIVATED — not offered. Mapping it would capture nothing and read as an empty account.`)
      } else {
        console.log(`[google-ads] ${a.id}: reachable but not nameable — offered by id: ${msg}`)
      }
    }
  }))

  return [...out.values()].filter((a) => !drop.has(a.id))
}

/**
 * `CustomerService.ListAccessibleCustomers` — the customers THIS TOKEN can reach, by the vendor's own account.
 * ⛔ NO `login-customer-id`, and that is the vendor's instruction rather than our preference: Google documents
 * that the header "is not required for this request type, and has no effect on the list of customers returned."
 */
export async function listReachableCustomerIds(refreshToken: string): Promise<string[]> {
  try {
    const names = await client.listAccessibleCustomers(refreshToken)
    const list = (names as any)?.resource_names ?? (names as any)?.resourceNames ?? names
    return (Array.isArray(list) ? list : []).map((n: string) => String(n).split('/')[1]).filter(Boolean)
  } catch (e: any) {
    console.error(`[google-ads] listAccessibleCustomers failed: ${e?.errors?.[0]?.message ?? e?.message ?? e}`)
    return []
  }
}

// LORAMER_GAQL_DATE_WINDOW_V1 — `DURING ${dateRange}` breaks on LAST_90_DAYS/CUSTOM (not GAQL enums); one
// resolver, explicit BETWEEN. customStart/customEnd are optional and additive — the MCP server's 3-arg calls
// are unchanged.
export async function getCampaigns(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const customer = getCustomer(refreshToken, customerId)
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
    campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.all_conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `)
  return rows.map((row: any) => ({
    id: String(row.campaign?.id || ''),
    name: String(row.campaign?.name || ''),
    status: String(row.campaign?.status || ''),
    type: String(row.campaign?.advertising_channel_type || ''),
    budget: row.campaign_budget?.amount_micros ? (Number(row.campaign_budget.amount_micros) / 1e6).toFixed(2) : null,
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: (Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2),
    conversions: Number(row.metrics?.conversions || 0),
    allConversions: Number(row.metrics?.all_conversions || 0), // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.20
    conversionValue: (Number(row.metrics?.conversions_value || 0)).toFixed(2),
    roas: row.metrics?.conversions_value && row.metrics?.cost_micros > 0
      ? (Number(row.metrics.conversions_value) / (Number(row.metrics.cost_micros) / 1e6)).toFixed(2) : null,
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.average_cpc ? (Number(row.metrics.average_cpc) / 1e6).toFixed(2) : null,
  }))
}

// LORAMER_RMF_REPORTING_DEFAULTS_V1 — the RMF R.50 (Keyword) query.
//
// THREE CHANGES, and the third was not in the brief — it was found while verifying the first two.
//  1. POSITION ESTIMATES + QUALITY SCORE + STATUS are now selected and CARRIED THROUGH THE MAPPER. `status` was
//     already in the SELECT and was silently dropped below, so no column could ever show it; selecting a field
//     and discarding it is the defect, not the absence of the field.
//  2. ⛔ `segments.date DURING ${dateRange}` REPLACED WITH AN EXPLICIT BETWEEN via resolveDateWindow. GAQL has no
//     LAST_90_DAYS enum and no CUSTOM enum (CLAUDE.md hard-won platform fact, Lesson 19: resolveDateWindow is the
//     ONLY date resolver). The old form would have thrown a GAQL error the moment a reviewer picked "Last 90 days"
//     or a custom range on the Keywords screen. It never surfaced because of (3).
//  3. ⛔ THE ROUTE WAS DROPPING dateRange ENTIRELY — /api/keywords called getKeywords(token, accountId) with no
//     third argument, so this defaulted to LAST_30_DAYS on EVERY request while the UI passed ?dateRange= and the
//     screen displayed whatever label the user had picked. The Keywords date picker did nothing at all. That is a
//     date-range compliance defect on an RMF level, found inside this flight's own fence, so it is fixed here.
//
// ADAPTER GATE, 2026-08-14 (scripts/rmf-adapter-gate.mjs): all four new fields ACCEPTED by the live API on
// google-ads-api v23. DELIVERY, measured and NOT assumed — status 200/200 and 93/93 non-null; quality_score
// 33/200 on account 3699173394 and 0/93 on 2102961791; BOTH position-estimate fields 0/200 and 0/93. Google
// accepts them and returns null on these accounts, so the mapper returns null (never 0) and the UI renders an
// em dash. A null here is the vendor's answer, not a capture defect, and must never be shown as a zero bid.
export async function getKeywords(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const customer = getCustomer(refreshToken, customerId)
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const rows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, ad_group.name, campaign.name,
    ad_group_criterion.position_estimates.first_page_cpc_micros,
    ad_group_criterion.position_estimates.first_position_cpc_micros,
    ad_group_criterion.quality_info.quality_score,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM keyword_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `)
  // micros → currency, PRESERVING NULL. `Number(null || 0)` would turn "Google did not estimate this" into "$0.00",
  // which is a confident wrong number of exactly the class this repo tracks.
  const micros = (v: any): string | null => (v === null || v === undefined ? null : (Number(v) / 1e6).toFixed(2))
  return rows.map((row: any) => ({
    text: String(row.ad_group_criterion?.keyword?.text || ''),
    matchType: String(row.ad_group_criterion?.keyword?.match_type || ''),
    status: String(row.ad_group_criterion?.status ?? ''), // LORAMER_RMF_REPORTING_DEFAULTS_V1 — was selected, then dropped
    adGroup: String(row.ad_group?.name || ''),
    campaign: String(row.campaign?.name || ''),
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: (Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2),
    conversions: Number(row.metrics?.conversions || 0),
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
    avgCpc: row.metrics?.average_cpc ? (Number(row.metrics.average_cpc) / 1e6).toFixed(2) : null,
    firstPageCpc: micros(row.ad_group_criterion?.position_estimates?.first_page_cpc_micros),
    firstPositionCpc: micros(row.ad_group_criterion?.position_estimates?.first_position_cpc_micros),
    qualityScore: row.ad_group_criterion?.quality_info?.quality_score ?? null,
  }))
}

// LORAMER_RMF_R70_SEARCH_TERMS_V1 — the R.70 (Search Term) query, REVIVED for the legacy Search Terms tab.
// This function sat caller-less in the app for months (only mcp-server.js get_search_terms used it) while the
// UI displayed no search-term level at all. RMF R.70 requires, default-ON: search term, match type, clicks,
// cost, impressions. What changed:
//  1. `segments.search_term_match_type` ADDED — it was never selected. ADAPTER GATE 2026-08-14 (account
//     3699173394): ACCEPTED on all three windows, 500/500 rows each (L30/L90/custom), match_type 500/500
//     non-null. It arrives as an integer enum; mapped through the lib's own enums.SearchTermMatchType so a
//     `7` renders as AI_MAX, never as a bare number (values incl. BROAD/EXACT/PHRASE/NEAR_*/AI_MAX/PMAX).
//  2. `search_term_view.status` was SELECTED AND DROPPED by the mapper — the exact keyword-status defect,
//     third instance of the class. Now carried (targeting status: ADDED/EXCLUDED/NONE — negative-keyword
//     visibility), mapped through enums.SearchTermTargetingStatus.
//  3. Return keys are ADDITIVE ONLY (matchType, status) — mcp-server.js's 3-arg call is unchanged.
// Dates ride resolveDateWindow (LORAMER_GAQL_DATE_WINDOW_V1; guard 108 holds DURING at zero tree-wide).
export async function getSearchTerms(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const customer = getCustomer(refreshToken, customerId)
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const rows = await customer.query(`
    SELECT search_term_view.search_term, segments.search_term_match_type,
    search_term_view.status, campaign.name, ad_group.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.ctr
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `)
  // Integer enum → name via the lib's own tables (the number→name direction of the bidirectional enum objects).
  const mtName = (v: any): string => (v === null || v === undefined) ? '' : String((enums.SearchTermMatchType as any)[Number(v)] ?? v)
  const stName = (v: any): string => (v === null || v === undefined) ? '' : String((enums.SearchTermTargetingStatus as any)[Number(v)] ?? v)
  return rows.map((row: any) => ({
    term: String(row.search_term_view?.search_term || ''),
    matchType: mtName(row.segments?.search_term_match_type), // LORAMER_RMF_R70_SEARCH_TERMS_V1
    status: stName(row.search_term_view?.status), // was selected-and-dropped; now carried
    campaign: String(row.campaign?.name || ''),
    adGroup: String(row.ad_group?.name || ''),
    impressions: Number(row.metrics?.impressions || 0),
    clicks: Number(row.metrics?.clicks || 0),
    cost: (Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2),
    conversions: Number(row.metrics?.conversions || 0),
    ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
  }))
}

export async function getAccountSummary(refreshToken: string, customerId: string, dateRange = 'LAST_30_DAYS', customStart?: string, customEnd?: string) {
  const campaigns = await getCampaigns(refreshToken, customerId, dateRange, customStart, customEnd) // LORAMER_GAQL_DATE_WINDOW_V1 — customs forwarded, additive
  const totalCost = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.cost), 0)
  const totalClicks = campaigns.reduce((sum: number, c: any) => sum + Number(c.clicks), 0)
  const totalImpressions = campaigns.reduce((sum: number, c: any) => sum + Number(c.impressions), 0)
  const totalConversions = campaigns.reduce((sum: number, c: any) => sum + Number(c.conversions), 0)
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.10 (Account), summed from the campaign rows like every other total here.
  const totalAllConversions = campaigns.reduce((sum: number, c: any) => sum + Number(c.allConversions || 0), 0)
  const totalConversionValue = campaigns.reduce((sum: number, c: any) => sum + parseFloat(c.conversionValue || '0'), 0)
  return {
    totalCost: totalCost.toFixed(2),
    totalClicks,
    totalImpressions,
    totalConversions: totalConversions.toFixed(1),
    totalAllConversions: totalAllConversions.toFixed(1),
    totalConversionValue: totalConversionValue.toFixed(2),
    roas: totalCost > 0 ? (totalConversionValue / totalCost).toFixed(2) : '0',
    avgCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0',
    activeCampaigns: campaigns.filter((c: any) => c.status === 'ENABLED' || c.status === '2').length,
    campaigns,
  }
}

export async function getDailyMetrics(
  refreshToken: string,
  customerId: string,
  dateRange = 'LAST_30_DAYS',
  campaignId?: string,
  granularity = 'day',
  customStart?: string,
  customEnd?: string
) {
  const customer = getCustomer(refreshToken, customerId)
  const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : ''
  const resource = campaignId ? 'campaign' : 'customer'

  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)
  const dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`

  // Build segment field
  const segmentField = granularity === 'week' ? 'segments.week' : granularity === 'month' ? 'segments.month' : 'segments.date'

  const rows = await customer.query(`
    SELECT ${segmentField}, metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value
    FROM ${resource}
    WHERE ${dateFilter}
    ${campaignFilter}
    ORDER BY ${segmentField} ASC
  `)

  return rows.map((row: any) => {
    const seg = row.segments
    const dateVal = String(seg?.date || seg?.week || seg?.month || '')
    return {
      date: dateVal,
      impressions: Number(row.metrics?.impressions || 0),
      clicks: Number(row.metrics?.clicks || 0),
      cost: parseFloat((Number(row.metrics?.cost_micros || 0) / 1e6).toFixed(2)),
      conversions: parseFloat(Number(row.metrics?.conversions || 0).toFixed(1)),
      conversionValue: parseFloat((Number(row.metrics?.conversions_value || 0)).toFixed(2)),
    }
  })
}
