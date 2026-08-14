#!/usr/bin/env node
// LORAMER_RMF_REPORTING_DEFAULTS_V1 — THE RMF REPORTING-ONLY DEFAULT COLUMNS MUST STAY PRESENT BY DEFAULT.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// We are classified REPORTING-ONLY under Google's Required Minimum Functionality
// (developers.google.com/google-ads/api/docs/api-policy/rmf). RMF obliges a reporting tool to show a required set
// of DEFAULT columns for every Google Ads hierarchy level its UI displays. The legacy /dashboard surface is the one
// a Google reviewer is given, so its defaults are a COMPLIANCE ARTIFACT, not a design preference.
//
// ⛔ EVERY FAILURE THIS GUARDS IS SILENT. Not one of them throws, 500s, or reddens a test:
//   · dropping a field from a SELECT — rows keep arriving, one column just goes empty forever;
//   · selecting a field and DISCARDING IT IN THE MAPPER — this is not hypothetical, it is what happened to
//     `ad_group_criterion.status`, which sat in the keyword SELECT for months while no column could show it;
//   · flipping a `defaultOn` back to false — the column picker still lists it, so it looks present;
//   · replacing the BETWEEN with `segments.date DURING ${dateRange}` — fine for LAST_30_DAYS, a hard GAQL error the
//     moment a reviewer picks Last 90 days or a custom range, because neither is a GAQL enum;
//   · rendering a null bid estimate as $0.00 — a fabricated zero bid that looks exactly like a real one.
// A reviewer opening the screen is currently the only other detector, and by then it is a rejected application.
//
// ── THE ASSERTION (six fixes, plus the two properties that make them stick) ──────────────────────────────────────
//   R.10 Account + R.20 Campaign — `metrics.all_conversions` is SELECTED in the live campaign GAQL, CARRIED by the
//        mapper, and SUMMED into the account totals. /api/platform derives the account row from the campaign rows,
//        so all three legs are one level's evidence.
//   R.20/R.40 — `impressions` is defaultOn in the shared COLUMN_DEFS (campaign + ad-group + ad tables).
//   R.20 — an `allConversions` ColumnDef exists, is defaultOn, and is GOOGLE-ONLY (listing it for meta would ship a
//        permanently empty column, the exact defect Quality Score had).
//   R.50 Keyword — the four keyword fields are SELECTED and CARRIED, impressions/conversions/both CPC estimates are
//        defaultOn, the Status column renders, and the query resolves its window through resolveDateWindow.
//   R.70 Search Term (LORAMER_RMF_R70_SEARCH_TERMS_V1) — all five required fields SELECTED from search_term_view
//        (search_term, segments.search_term_match_type, clicks, cost_micros, impressions), matchType/term CARRIED by
//        the mapper (match type name-mapped via the lib's own enum, never a bare integer), spend/clicks/impressions
//        defaultOn in the tab, the /api/google/search-terms route FORWARDS dateRange+customs (never inert), and the
//        route is in the middleware legacy matcher (same session-only/shared-MCC shape as its siblings — absent from
//        the matcher it is reachable by every authed user, reopening H2 for this route).
//   NULL-PRESERVATION — the micros mapper and both estimate cells keep null distinct from zero.
//   ANTI-STALE — rmfEnsure() is applied at BOTH column-picker seeds. `defaultOn` alone only governs a FRESH
//        browser; both pickers seed from localStorage, so without the union a saved preference silently drops a
//        required column on precisely the machine being reviewed.
//   GATE-PINNING — the field list in scripts/rmf-adapter-gate.mjs equals the field list the product ships. An
//        adapter gate proving a field the product no longer sends is a green that means nothing.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// STATIC SOURCE READ. It proves the fields are requested, carried, and default-on IN THE SOURCE. It cannot prove
// Google returned a value (that is scripts/rmf-adapter-gate.mjs, which spends real quota), cannot prove a pixel
// rendered (that is Gate-B on device), and cannot prove a reviewer's browser has no stale localStorage — it proves
// only that the code now unions the required set back in. Read a green as "the wiring is still there".
//
// USAGE: node tests/guards/rmf-reporting-defaults.guard.mjs [--inject-drop-select] [--inject-drop-mapper]
//                                                           [--inject-default-off] [--inject-during] [--inject-no-union]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

const F_PLATFORM = 'src/app/api/platform/route.ts'
const F_ADS = 'src/lib/google-ads.ts'
const F_TYPES = 'src/lib/platforms/types.ts'
const F_DASH = 'src/app/dashboard/page.tsx'
const F_KWROUTE = 'src/app/api/keywords/route.ts'
const F_STROUTE = 'src/app/api/google/search-terms/route.ts' // LORAMER_RMF_R70_SEARCH_TERMS_V1
const F_MIDDLEWARE = 'src/middleware.ts'
const F_GATE = 'scripts/rmf-adapter-gate.mjs'

const DROP_SELECT = process.argv.includes('--inject-drop-select')
const DROP_MAPPER = process.argv.includes('--inject-drop-mapper')
const DEFAULT_OFF = process.argv.includes('--inject-default-off')
const USE_DURING = process.argv.includes('--inject-during')
const NO_UNION = process.argv.includes('--inject-no-union')

// The keyword fields, in ONE place, so the product GAQL and the adapter gate are compared against the same list.
const KEYWORD_FIELDS = [
  'ad_group_criterion.status',
  'ad_group_criterion.position_estimates.first_page_cpc_micros',
  'ad_group_criterion.position_estimates.first_position_cpc_micros',
  'ad_group_criterion.quality_info.quality_score',
]

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
export function decideRmfDefaults(i) {
  const f = []
  // R.10 + R.20 — all_conversions, all three legs
  if (!i.platformSelectsAllConv) f.push(`${F_PLATFORM}: the campaign GAQL no longer selects \`metrics.all_conversions\`. RMF R.10 and R.20 both require all_conversions as a default column, and this one query feeds both (the account totals are summed from these rows).`)
  if (!i.platformMapsAllConv) f.push(`${F_PLATFORM}: \`allConversions\` is no longer carried by the campaign mapper. Selecting a field and discarding it is the \`ad_group_criterion.status\` defect with an extra step — the column goes permanently empty and nothing fails.`)
  if (!i.platformSumsAllConv) f.push(`${F_PLATFORM}: the account totals no longer sum \`allConversions\`. RMF R.10 (Account) is served by that sum; without it the Overview tile cannot render.`)
  if (!i.adsSelectsAllConv) f.push(`${F_ADS}: getCampaigns no longer selects \`metrics.all_conversions\` (feeds /api/campaigns → getAccountSummary).`)
  if (!i.adsMapsAllConv) f.push(`${F_ADS}: getCampaigns no longer maps \`allConversions\`.`)
  // R.20 / R.40 — shared table defaults
  if (!i.impressionsDefaultOn) f.push(`${F_TYPES}: the \`impressions\` ColumnDef is no longer defaultOn. RMF R.20 (Campaign) and R.40 (Ad) both require impressions BY DEFAULT, and this single def drives the campaign, ad-group and ad tables.`)
  if (!i.allConvColumnDefaultOn) f.push(`${F_TYPES}: the \`allConversions\` ColumnDef is missing or no longer defaultOn (RMF R.20).`)
  if (!i.allConvColumnGoogleOnly) f.push(`${F_TYPES}: the \`allConversions\` ColumnDef is no longer scoped to google only. Meta serves no all_conversions, so listing it for meta/combined ships a structurally-empty column — the exact defect Quality Score had before this flight.`)
  // R.50 — keyword query + mapper + defaults + status
  for (const field of i.missingKeywordSelects) f.push(`${F_ADS}: the keyword GAQL no longer selects \`${field}\` (RMF R.50).`)
  for (const key of i.missingKeywordMaps) f.push(`${F_ADS}: the keyword mapper no longer carries \`${key}\`. The field would be fetched and thrown away, which is how status stayed invisible for months.`)
  for (const id of i.keywordDefaultsOff) f.push(`${F_DASH}: keyword column \`${id}\` is no longer defaultOn (RMF R.50 requires it by default).`)
  if (!i.keywordStatusRendered) f.push(`${F_DASH}: the Keywords table no longer renders a Status column (RMF R.50), which Campaign and Ad already show.`)
  // Date window
  if (!i.keywordUsesResolver) f.push(`${F_ADS}: the keyword GAQL no longer resolves its window through resolveDateWindow. \`segments.date DURING <preset>\` is a HARD GAQL ERROR for LAST_90_DAYS and CUSTOM — neither is a GAQL enum — so the screen would 500 the moment a reviewer changed the date range.`)
  if (i.keywordUsesDuring) f.push(`${F_ADS}: the keyword GAQL is back on \`segments.date DURING\`. See above — it breaks on the presets the date picker actually offers.`)
  if (!i.keywordRoutePassesRange) f.push(`${F_KWROUTE}: /api/keywords no longer forwards dateRange to getKeywords. It silently ignored it until 2026-08-14, so the Keywords date picker did nothing at all; RMF expects a working range on each displayed level.`)
  // Null preservation
  if (!i.microsPreservesNull) f.push(`${F_ADS}: the keyword micros helper no longer preserves null. \`Number(null || 0)\` turns "Google did not estimate this bid" into "$0.00" — a confident wrong number, measured null on 293 of 293 live rows.`)
  if (!i.estimateCellsNullSafe) f.push(`${F_DASH}: the first-page / first-position CPC cells no longer null-check before rendering, so a missing estimate would print as $0.00.`)
  // R.70 Search Term
  for (const field of i.missingSearchTermSelects) f.push(`${F_ADS}: the search-term GAQL no longer selects \`${field}\` (RMF R.70 requires it by default).`)
  if (!i.stMapsMatchType) f.push(`${F_ADS}: getSearchTerms no longer carries matchType through the enum name-map. Either the field is fetched-and-dropped (the keyword-status defect, third instance) or a bare integer enum reaches the screen.`)
  for (const id of i.stDefaultsOff) f.push(`${F_DASH}: search-term column \`${id}\` is no longer defaultOn (RMF R.70 requires it by default).`)
  if (!i.stTabMounted) f.push(`${F_DASH}: the SearchTermsTab mount for activeTab==='searchterms' is gone — R.70 would be claimed with no screen displaying it.`)
  if (!i.stRoutePassesRange) f.push(`${F_STROUTE}: /api/google/search-terms no longer forwards dateRange+customs to getSearchTerms — the inert-date-picker defect the keywords route shipped with.`)
  if (!i.stRouteInMiddleware) f.push(`${F_MIDDLEWARE}: '/api/google/search-terms' is missing from the legacy matcher. The route is session-only over the shared MCC (the H1 shape); outside the matcher every authenticated user can call it — H2 reopens for this route.`)
  if (!i.unionAtSearchTermPicker) f.push(`${F_DASH}: rmfEnsure() is gone from the search-term column state (the stale-localStorage hole).`)
  // Anti-stale
  if (!i.unionAtCampaignPicker) f.push(`${F_DASH}: rmfEnsure() is gone from the campaign column state. It seeds from localStorage, so without the union a saved preference silently drops a required column — on exactly the browser being reviewed.`)
  if (!i.unionAtKeywordPicker) f.push(`${F_DASH}: rmfEnsure() is gone from the keyword column state (same stale-localStorage hole).`)
  // Gate pinning
  for (const field of i.gateDrift) f.push(`${F_GATE}: the adapter gate no longer tests \`${field}\` while the product still ships it. A gate that proves a different query than the one deployed is a green that means nothing.`)
  return { findings: f, ok: f.length === 0 }
}

// ── INPUTS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const platform = read(F_PLATFORM), ads = read(F_ADS), types = read(F_TYPES), dash = read(F_DASH)
const kwroute = read(F_KWROUTE), stroute = read(F_STROUTE), middleware = read(F_MIDDLEWARE), gate = read(F_GATE)
for (const [n, s] of [[F_PLATFORM, platform], [F_ADS, ads], [F_TYPES, types], [F_DASH, dash], [F_KWROUTE, kwroute], [F_STROUTE, stroute], [F_MIDDLEWARE, middleware], [F_GATE, gate]]) {
  if (!s) { console.error(`✗ ${n} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
}

// Isolate the two GAQL blocks so a field mentioned in a COMMENT cannot satisfy a SELECT assertion.
// ⛔ THE BLOCK MUST RUN TO THE CLOSING BACKTICK, NOT TO `FROM <resource>`. A first cut of this guard anchored on
// `SELECT[\s\S]*?FROM\s+keyword_view` and so captured everything EXCEPT the WHERE clause — then reported that the
// date window had regressed when the code was correct. That is ★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE in miniature,
// caught here only because the finding was checked against the file instead of believed.
const block = (src, from) => { const m = new RegExp(`SELECT[\\s\\S]*?FROM\\s+${from}[\\s\\S]*?\``).exec(src); return m ? m[0] : '' }
// Scope an id-lookup to ONE declaration. `{ id: 'impressions' … }` also matches chart-series defs earlier in
// dashboard/page.tsx (lines 329/403/667), and a bare .exec() returns the FIRST of those — another false RED.
const arrayBlock = (src, decl) => { const m = new RegExp(`const ${decl}\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\]`).exec(src); return m ? m[1] : '' }
const campaignGaqlPlatform = DROP_SELECT ? '' : block(platform, 'campaign')
const campaignGaqlAds = DROP_SELECT ? '' : block(ads, 'campaign')
const keywordGaql = DROP_SELECT ? '' : block(ads, 'keyword_view')
if (!campaignGaqlPlatform && !DROP_SELECT) { console.error(`✗ could not locate the campaign GAQL in ${F_PLATFORM} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
if (!keywordGaql && !DROP_SELECT) { console.error(`✗ could not locate the keyword GAQL in ${F_ADS} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }

const colDefsBlock = arrayBlock(types, 'COLUMN_DEFS: ColumnDef\\[\\]')
const kwColsBlock = arrayBlock(dash, 'kwCols')
if (!colDefsBlock) { console.error(`✗ could not locate COLUMN_DEFS in ${F_TYPES} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
if (!kwColsBlock) { console.error(`✗ could not locate kwCols in ${F_DASH} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const colDef = (id) => new RegExp(`\\{\\s*id:\\s*'${id}'[^}]*\\}`).exec(colDefsBlock)?.[0] || ''
const impressionsDef = colDef('impressions'), allConvDef = colDef('allConversions')
const kwColDef = (id) => new RegExp(`\\{\\s*id:\\s*'${id}'[^}]*\\}`).exec(kwColsBlock)?.[0] || ''

const i = {
  platformSelectsAllConv: campaignGaqlPlatform.includes('metrics.all_conversions'),
  platformMapsAllConv: !DROP_MAPPER && /allConversions,\s*\/\/ LORAMER_RMF/.test(platform),
  platformSumsAllConv: !DROP_MAPPER && /totalAllConversions\s*=\s*campaigns\.reduce/.test(platform) && /allConversions:\s*totalAllConversions/.test(platform),
  adsSelectsAllConv: campaignGaqlAds.includes('metrics.all_conversions'),
  adsMapsAllConv: !DROP_MAPPER && /allConversions:\s*Number\(row\.metrics\?\.all_conversions/.test(ads),

  impressionsDefaultOn: !DEFAULT_OFF && /defaultOn:\s*true/.test(impressionsDef),
  allConvColumnDefaultOn: !DEFAULT_OFF && allConvDef !== '' && /defaultOn:\s*true/.test(allConvDef),
  allConvColumnGoogleOnly: allConvDef !== '' && /platforms:\s*\['google'\]/.test(allConvDef),

  missingKeywordSelects: KEYWORD_FIELDS.filter((f) => !keywordGaql.includes(f)),
  missingKeywordMaps: DROP_MAPPER ? ['status', 'firstPageCpc', 'firstPositionCpc', 'qualityScore']
    : ['status', 'firstPageCpc', 'firstPositionCpc', 'qualityScore'].filter((k) => !new RegExp(`^\\s*${k}:`, 'm').test(ads)),
  keywordDefaultsOff: DEFAULT_OFF ? ['impressions', 'conversions', 'firstPageCpc', 'firstPositionCpc']
    : ['impressions', 'conversions', 'firstPageCpc', 'firstPositionCpc'].filter((id) => !/defaultOn:\s*true/.test(kwColDef(id))),
  keywordStatusRendered: /statusBadgeClass\(normalizeGoogleStatus\(k\.status/.test(dash),

  keywordUsesResolver: !USE_DURING && /const \{ startDate, endDate \} = resolveDateWindow\(dateRange, customStart, customEnd\)/.test(ads) && keywordGaql.includes("segments.date BETWEEN '${startDate}' AND '${endDate}'"),
  keywordUsesDuring: USE_DURING || /FROM\s+keyword_view[\s\S]{0,200}?segments\.date DURING/.test(ads) || /segments\.date DURING \$\{dateRange\}[\s\S]{0,200}?keyword_view/.test(ads),
  keywordRoutePassesRange: /getKeywords\(session\.refreshToken,\s*accountId,\s*dateRange/.test(kwroute),

  microsPreservesNull: /const micros[\s\S]{0,160}?v === null \|\| v === undefined \? null/.test(ads),
  estimateCellsNullSafe: /k\.firstPageCpc != null/.test(dash) && /k\.firstPositionCpc != null/.test(dash),

  unionAtCampaignPicker: !NO_UNION && /rmfEnsure\(lsJson\(storageKey, defaultCols\)/.test(dash),
  unionAtKeywordPicker: !NO_UNION && /rmfEnsure\(lsJson\('advar-kw-cols'/.test(dash),

  // R.70 (LORAMER_RMF_R70_SEARCH_TERMS_V1)
  missingSearchTermSelects: (() => {
    const g = DROP_SELECT ? '' : block(ads, 'search_term_view')
    return ['search_term_view.search_term', 'segments.search_term_match_type', 'metrics.clicks', 'metrics.cost_micros', 'metrics.impressions'].filter((f) => !g.includes(f))
  })(),
  stMapsMatchType: !DROP_MAPPER && /matchType:\s*mtName\(row\.segments\?\.search_term_match_type\)/.test(ads) && /enums\.SearchTermMatchType/.test(ads),
  stDefaultsOff: (() => {
    const stBlock = arrayBlock(dash, 'stCols')
    if (!stBlock) return ['spend', 'clicks', 'impressions']
    const def = (id) => new RegExp(`\\{\\s*id:\\s*'${id}'[^}]*\\}`).exec(stBlock)?.[0] || ''
    return DEFAULT_OFF ? ['spend', 'clicks', 'impressions'] : ['spend', 'clicks', 'impressions'].filter((id) => !/defaultOn:\s*true/.test(def(id)))
  })(),
  stTabMounted: /activeTab === 'searchterms'[\s\S]{0,200}?<SearchTermsTab/.test(dash),
  stRoutePassesRange: /getSearchTerms\(session\.refreshToken,\s*accountId,\s*dateRange,\s*customStart,\s*customEnd\)/.test(stroute),
  stRouteInMiddleware: /'\/api\/google\/search-terms'/.test(middleware),
  unionAtSearchTermPicker: !NO_UNION && /rmfEnsure\(lsJson\('advar-st-cols'/.test(dash),

  gateDrift: [...KEYWORD_FIELDS, 'metrics.all_conversions'].filter((f) => !gate.includes(f)),
}

for (const [flag, note] of [
  [DROP_SELECT, '[--inject-drop-select] blanked both GAQL blocks in the check INPUT (no file written)'],
  [DROP_MAPPER, '[--inject-drop-mapper] treated every mapper carry as absent in the check INPUT'],
  [DEFAULT_OFF, '[--inject-default-off] treated every required column as default-off in the check INPUT'],
  [USE_DURING, '[--inject-during] simulated the DURING regression in the check INPUT'],
  [NO_UNION, '[--inject-no-union] removed the rmfEnsure unions in the check INPUT'],
]) if (flag) console.log(`  ${note} — it must go RED.`)

// ── REPORT, ALWAYS WITH ITS DENOMINATOR ─────────────────────────────────────────────────────────────────────────
const v = decideRmfDefaults(i)
console.log('[rmf-reporting-defaults] LEGACY /dashboard — the surface a Google reviewer is given.')
console.log(`[rmf-reporting-defaults] R.10+R.20 all_conversions: select=${i.platformSelectsAllConv} map=${i.platformMapsAllConv} sum=${i.platformSumsAllConv} · getCampaigns select=${i.adsSelectsAllConv} map=${i.adsMapsAllConv}`)
console.log(`[rmf-reporting-defaults] R.20/R.40 columns: impressions defaultOn=${i.impressionsDefaultOn} · allConversions defaultOn=${i.allConvColumnDefaultOn} googleOnly=${i.allConvColumnGoogleOnly}`)
console.log(`[rmf-reporting-defaults] R.50 keyword: ${KEYWORD_FIELDS.length - i.missingKeywordSelects.length}/${KEYWORD_FIELDS.length} fields selected · ${4 - i.missingKeywordMaps.length}/4 mapper carries · ${4 - i.keywordDefaultsOff.length}/4 defaults on · status column=${i.keywordStatusRendered}`)
console.log(`[rmf-reporting-defaults] window: resolver=${i.keywordUsesResolver} during-regression=${i.keywordUsesDuring} route-forwards-range=${i.keywordRoutePassesRange}`)
console.log(`[rmf-reporting-defaults] null-preservation: micros=${i.microsPreservesNull} cells=${i.estimateCellsNullSafe} · anti-stale unions: campaign=${i.unionAtCampaignPicker} keyword=${i.unionAtKeywordPicker} search-term=${i.unionAtSearchTermPicker}`)
console.log(`[rmf-reporting-defaults] R.70 search-term: ${5 - i.missingSearchTermSelects.length}/5 fields selected · matchType mapped=${i.stMapsMatchType} · ${3 - i.stDefaultsOff.length}/3 defaults on · tab mounted=${i.stTabMounted} · route range=${i.stRoutePassesRange} · middleware-gated=${i.stRouteInMiddleware}`)
console.log(`[rmf-reporting-defaults] adapter-gate pinning: ${5 - i.gateDrift.length}/5 fields also under live test`)
console.log('[rmf-reporting-defaults] STATIC READ — proves the wiring, NOT that Google returned a value and NOT that a pixel rendered. See the header.')
if (!v.ok) {
  console.error(`✗ rmf-reporting-defaults FAIL — ${v.findings.length} finding(s):`)
  for (const f of v.findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ rmf-reporting-defaults OK — every RMF-required field is selected, carried, default-on, and pinned to the live gate.')
process.exit(0)
