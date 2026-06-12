// LORAMER_SEARCH_TERMS_CAPTURE_V1
// src/lib/intelligence/google-dimensional.ts
//
// Nightly dimensional capture for Google Ads: search terms + keywords persisted into
// metrics_daily as BREAKDOWN rows (the same mechanism Meta uses for publisher_platform/age/etc).
// This is decoupled from the 15-min-cached dashboard intelligence fetch (which caps these at 100
// for brevity) — capture pulls deeper (top 300 search terms / top 200 keywords by cost) and writes
// history that would otherwise be lost daily.
//
// Grain (unique under the metrics_daily conflict key
//   client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value):
//   entity_level='ad_group', entity_id=<adGroupId>, parent_entity_id=<campaignId>,
//   breakdown_type='search_term'|'keyword', breakdown_value=<the term/keyword text>.
// Rows are AGGREGATED by (adGroupId, text) in the builder so a text that appears under multiple
// match types in one ad group collapses to ONE idempotent row (match types collected into extra) —
// otherwise two match-type variants would collide on the conflict key.

import { GoogleAdsApi } from 'google-ads-api'

const SEARCH_TERMS_CAP = 300
const KEYWORDS_CAP = 200

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

export interface GoogleDimSearchTerm {
  term: string
  status: string
  campaignId: string
  adGroupId: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
}

export interface GoogleDimKeyword {
  text: string
  matchType: string
  status: string
  campaignId: string
  adGroupId: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
}

export interface GoogleDimensional {
  searchTerms: GoogleDimSearchTerm[]
  keywords: GoogleDimKeyword[]
  searchTermsTruncated: boolean
  keywordsTruncated: boolean
}

const micros = (v: any) => Number(v || 0) / 1e6
const num = (v: any) => Number(v || 0)

// google-ads-api returns enums as their integer value via .query(). Map to readable names so the
// captured history is not opaque ("2"/"3"). Already-named strings (e.g. 'EXACT') pass through.
const MATCH_TYPE: Record<string, string> = { '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'EXACT', '3': 'PHRASE', '4': 'BROAD' }
const CRITERION_STATUS: Record<string, string> = { '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'ENABLED', '3': 'PAUSED', '4': 'REMOVED' }
const SEARCH_TERM_STATUS: Record<string, string> = { '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'ADDED', '3': 'EXCLUDED', '4': 'ADDED_EXCLUDED', '5': 'NONE' }
const mapEnum = (raw: any, table: Record<string, string>): string => {
  if (raw === null || raw === undefined || raw === '') return ''
  const s = String(raw)
  return table[s] || s // already a name, or an unknown int → keep verbatim
}

// Fetch search terms + keywords for a single capture day [startDate, endDate] (inclusive, same day
// for forward capture). Uses explicit BETWEEN — there is no LAST_90_DAYS GAQL enum. Each query is a
// single reporting request. Does NOT swallow errors: throws so the caller can log LOUD (no silent
// .catch(()=>[])). search_term_view is queried WITHOUT the match_type segment so the grain stays
// (search_term × ad_group) — match-type segmentation would split a term into colliding rows.
export async function fetchGoogleDimensional(
  refreshToken: string,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<GoogleDimensional> {
  const customer = adsClient.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })

  const dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`

  const searchTermRows = await customer.query(`
    SELECT search_term_view.search_term, search_term_view.status,
    campaign.id, ad_group.id,
    metrics.cost_micros, metrics.impressions, metrics.clicks,
    metrics.conversions, metrics.conversions_value
    FROM search_term_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${SEARCH_TERMS_CAP}
  `)

  const keywordRows = await customer.query(`
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, campaign.id, ad_group.id,
    metrics.cost_micros, metrics.impressions, metrics.clicks,
    metrics.conversions, metrics.conversions_value
    FROM keyword_view
    WHERE ${dateFilter}
    AND ad_group_criterion.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${KEYWORDS_CAP}
  `)

  const searchTerms: GoogleDimSearchTerm[] = (searchTermRows as any[]).map((row) => ({
    term: String(row.search_term_view?.search_term || ''),
    status: mapEnum(row.search_term_view?.status, SEARCH_TERM_STATUS),
    campaignId: String(row.campaign?.id || ''),
    adGroupId: String(row.ad_group?.id || ''),
    spend: micros(row.metrics?.cost_micros),
    impressions: num(row.metrics?.impressions),
    clicks: num(row.metrics?.clicks),
    conversions: num(row.metrics?.conversions),
    conversionValue: num(row.metrics?.conversions_value),
  }))

  const keywords: GoogleDimKeyword[] = (keywordRows as any[]).map((row) => ({
    text: String(row.ad_group_criterion?.keyword?.text || ''),
    matchType: mapEnum(row.ad_group_criterion?.keyword?.match_type, MATCH_TYPE),
    status: mapEnum(row.ad_group_criterion?.status, CRITERION_STATUS),
    campaignId: String(row.campaign?.id || ''),
    adGroupId: String(row.ad_group?.id || ''),
    spend: micros(row.metrics?.cost_micros),
    impressions: num(row.metrics?.impressions),
    clicks: num(row.metrics?.clicks),
    conversions: num(row.metrics?.conversions),
    conversionValue: num(row.metrics?.conversions_value),
  }))

  return {
    searchTerms,
    keywords,
    // Hitting the LIMIT means lower-spend rows were dropped — the caller logs this, never hides it.
    searchTermsTruncated: searchTermRows.length >= SEARCH_TERMS_CAP,
    keywordsTruncated: keywordRows.length >= KEYWORDS_CAP,
  }
}

type Agg = {
  entityName: string
  campaignId: string
  adGroupId: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  statuses: Set<string>
  matchTypes: Set<string>
}

function aggKey(adGroupId: string, text: string): string {
  return `${adGroupId}${text}`
}

// Build metrics_daily breakdown rows from captured dimensional data. AGGREGATES by (adGroupId, text)
// so the conflict key is unique and re-runs are idempotent. breakdown_value is the text verbatim
// (trimmed); empty texts are skipped.
export function buildGoogleDimensionalRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  customerId: string,
  dim: GoogleDimensional
): Record<string, unknown>[] {
  const build = (
    items: Array<{ text: string; status: string; matchType?: string; campaignId: string; adGroupId: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>,
    breakdownType: 'search_term' | 'keyword'
  ): Record<string, unknown>[] => {
    const byKey = new Map<string, Agg>()
    for (const it of items) {
      const text = (it.text || '').trim()
      if (!text) continue // skip empty terms/keywords
      if (!it.adGroupId) continue // need a stable entity_id
      const key = aggKey(it.adGroupId, text)
      let a = byKey.get(key)
      if (!a) {
        a = {
          entityName: text,
          campaignId: it.campaignId,
          adGroupId: it.adGroupId,
          spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
          statuses: new Set<string>(),
          matchTypes: new Set<string>(),
        }
        byKey.set(key, a)
      }
      a.spend += it.spend
      a.impressions += it.impressions
      a.clicks += it.clicks
      a.conversions += it.conversions
      a.conversionValue += it.conversionValue
      if (it.status) a.statuses.add(it.status)
      if (it.matchType) a.matchTypes.add(it.matchType)
    }

    const rows: Record<string, unknown>[] = []
    for (const a of byKey.values()) {
      // Skip fully-inactive rows — keyword_view returns every enabled keyword incl. zero-activity
      // ones; persisting those is pure noise. (Search terms always have activity, so this is a
      // no-op for them.)
      if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
      const extra: Record<string, unknown> = {
        status: a.statuses.size ? Array.from(a.statuses) : [],
      }
      if (breakdownType === 'keyword') {
        extra.match_type = a.matchTypes.size ? Array.from(a.matchTypes) : []
      }
      rows.push({
        client_id: clientId,
        user_email: userEmail,
        platform: 'google',
        account_id: customerId,
        entity_level: 'ad_group',
        entity_id: a.adGroupId,
        entity_name: a.entityName, // the term/keyword text, for readability
        parent_entity_id: a.campaignId,
        date: captureDate,
        breakdown_type: breakdownType,
        breakdown_value: a.entityName,
        spend: a.spend,
        impressions: a.impressions,
        clicks: a.clicks,
        conversions: a.conversions,
        conversion_value: a.conversionValue,
        revenue: 0,
        extra,
      })
    }
    return rows
  }

  return [
    ...build(dim.searchTerms.map((st) => ({ ...st, text: st.term })), 'search_term'),
    ...build(dim.keywords, 'keyword'),
  ]
}

// ── Windowed capture for the bounded backfill (LORAMER_SEARCH_TERMS_BACKFILL_V1) ──
// One query per type over a date window WITH segments.date, then the caller buckets by date and
// applies the same per-day top-N — so ~2 requests recover N days instead of 2×N. A LIMIT acts as a
// safety cap: hitting it means we can't guarantee per-day completeness, so the caller falls back to
// the per-day path (Option A). Same enum mapping + field shape as the single-day fetch.
const WINDOW_ROW_CAP = 50000

export interface GoogleDimWindow {
  searchTerms: Array<GoogleDimSearchTerm & { date: string }>
  keywords: Array<GoogleDimKeyword & { date: string }>
  overflow: boolean // a query hit WINDOW_ROW_CAP → caller should fall back to per-day (Option A)
}

export async function fetchGoogleDimensionalWindow(
  refreshToken: string,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<GoogleDimWindow> {
  const customer = adsClient.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
  const dateFilter = `segments.date BETWEEN '${startDate}' AND '${endDate}'`

  const stRows: any[] = await customer.query(`
    SELECT segments.date, search_term_view.search_term, search_term_view.status,
    campaign.id, ad_group.id,
    metrics.cost_micros, metrics.impressions, metrics.clicks,
    metrics.conversions, metrics.conversions_value
    FROM search_term_view
    WHERE ${dateFilter}
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${WINDOW_ROW_CAP}
  `)

  const kwRows: any[] = await customer.query(`
    SELECT segments.date, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, campaign.id, ad_group.id,
    metrics.cost_micros, metrics.impressions, metrics.clicks,
    metrics.conversions, metrics.conversions_value
    FROM keyword_view
    WHERE ${dateFilter}
    AND ad_group_criterion.status != 'REMOVED'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${WINDOW_ROW_CAP}
  `)

  const searchTerms = stRows.map((row) => ({
    date: String(row.segments?.date || ''),
    term: String(row.search_term_view?.search_term || ''),
    status: mapEnum(row.search_term_view?.status, SEARCH_TERM_STATUS),
    campaignId: String(row.campaign?.id || ''),
    adGroupId: String(row.ad_group?.id || ''),
    spend: micros(row.metrics?.cost_micros),
    impressions: num(row.metrics?.impressions),
    clicks: num(row.metrics?.clicks),
    conversions: num(row.metrics?.conversions),
    conversionValue: num(row.metrics?.conversions_value),
  }))

  const keywords = kwRows.map((row) => ({
    date: String(row.segments?.date || ''),
    text: String(row.ad_group_criterion?.keyword?.text || ''),
    matchType: mapEnum(row.ad_group_criterion?.keyword?.match_type, MATCH_TYPE),
    status: mapEnum(row.ad_group_criterion?.status, CRITERION_STATUS),
    campaignId: String(row.campaign?.id || ''),
    adGroupId: String(row.ad_group?.id || ''),
    spend: micros(row.metrics?.cost_micros),
    impressions: num(row.metrics?.impressions),
    clicks: num(row.metrics?.clicks),
    conversions: num(row.metrics?.conversions),
    conversionValue: num(row.metrics?.conversions_value),
  }))

  return {
    searchTerms,
    keywords,
    overflow: stRows.length >= WINDOW_ROW_CAP || kwRows.length >= WINDOW_ROW_CAP,
  }
}

// Bucket a window's rows by date and apply the SAME per-day top-N (by cost) as forward capture, so
// the per-day GoogleDimensional fed to buildGoogleDimensionalRows is byte-identical in shape.
export function bucketWindowByDate(win: GoogleDimWindow): Map<string, GoogleDimensional> {
  const byDate = new Map<string, { st: Array<GoogleDimSearchTerm & { date: string }>; kw: Array<GoogleDimKeyword & { date: string }> }>()
  for (const t of win.searchTerms) {
    if (!t.date) continue
    if (!byDate.has(t.date)) byDate.set(t.date, { st: [], kw: [] })
    byDate.get(t.date)!.st.push(t)
  }
  for (const k of win.keywords) {
    if (!k.date) continue
    if (!byDate.has(k.date)) byDate.set(k.date, { st: [], kw: [] })
    byDate.get(k.date)!.kw.push(k)
  }
  const out = new Map<string, GoogleDimensional>()
  for (const [date, { st, kw }] of byDate) {
    st.sort((a, b) => b.spend - a.spend)
    kw.sort((a, b) => b.spend - a.spend)
    out.set(date, {
      searchTerms: st.slice(0, SEARCH_TERMS_CAP),
      keywords: kw.slice(0, KEYWORDS_CAP),
      searchTermsTruncated: st.length > SEARCH_TERMS_CAP,
      keywordsTruncated: kw.length > KEYWORDS_CAP,
    })
  }
  return out
}
