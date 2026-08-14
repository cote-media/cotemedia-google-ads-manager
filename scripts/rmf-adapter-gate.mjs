#!/usr/bin/env node
// LORAMER_RMF_REPORTING_DEFAULTS_V1 — THE ADAPTER GATE for the RMF reporting-only field additions.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────────────────
// ADAPTER CHANGE GATE (DECISIONS, 2026-06-11): any platform query/adapter change is machine-validated against the
// REAL API locally before deploy. Every field path in this flight arrived as a HYPOTHESIS in an instruction, and
// ESSENCE LAW 9 is explicit that a named mechanism is a hypothesis to verify, never a premise to build on.
//
// Two things are checked, and they are DIFFERENT QUESTIONS — conflating them is how "the field exists" becomes
// "the column will have data":
//   SELECTABILITY — will Google accept the field in a SELECT against this resource? Universal, account-independent.
//                   A failure here is a hard GAQL error and would 500 the reviewer's screen.
//   DELIVERY      — does a value actually come back for THIS account in THIS window? Per-account, per-window.
//                   A NULL here is legitimate (Google does not populate position estimates for every criterion)
//                   and must render as an em dash, never as a zero.
// The gate reports both, separately, and NEVER lets a null-delivery read as a selectability pass.
//
// ⛔ NOT WIRED INTO `npm run guard` OR THE BUILD. It spends real Google quota and needs .env.local + a live token,
// the same posture as check:data and npm run evals. It is a deliberate, human-initiated pre-deploy act.
//
// ⛔ THE HONEST LIMIT: this proves the VENDOR accepts the query and what it returned TODAY for ONE account. It
// proves nothing about the product code that consumes it — that is the static guard's job
// (tests/guards/rmf-reporting-defaults.guard.mjs), and neither one proves a pixel. Gate-B on device is still owed.
//
// COST: 2 vendor requests per run (1 campaign + 1 keyword). One Search = 1 op regardless of rows returned.
//
// USAGE
//   node scripts/rmf-adapter-gate.mjs --client <clientId> [--window YYYY-MM-DD..YYYY-MM-DD]
//   node scripts/rmf-adapter-gate.mjs --client <clientId> --search-terms
//     --search-terms (LORAMER_RMF_R70_SEARCH_TERMS_V1): validates the R.70 search-term GAQL — the exact
//     SELECT getSearchTerms ships — on LAST_30_DAYS, LAST_90_DAYS and a CUSTOM window (3 ops). The load-bearing
//     hypothesis it settles: `segments.search_term_match_type` selectability FROM search_term_view (the
//     per-resource typings hold attributes only, so no static check can). Reports row counts and match-type
//     delivery per window — an empty reviewer-facing tab is a finding, not a footnote.
//   node scripts/rmf-adapter-gate.mjs --client <clientId> --drill
//     --drill (LORAMER_GAQL_DATE_WINDOW_V1): validates the CORRECTED ad-group + ad drill GAQL — the exact
//     SELECT/WHERE shape /api/google/adgroups and /api/google/ads now emit — against the live API on the
//     resolver-produced windows for LAST_90_DAYS and a CUSTOM range. ~5 ops (1 campaign-id discovery + 4
//     window probes). The DURING form these queries used to emit is a hard vendor error on both ranges;
//     this proves the replacement is accepted and returns rows where rows exist.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

// ── THE EXACT FIELD PATHS UNDER TEST ────────────────────────────────────────────────────────────────────────────
// These are the strings the product code will ship. If a name here drifts from the name in the product GAQL the
// gate is measuring something else, so the static guard pins BOTH to the same list.
export const RMF_CAMPAIGN_FIELDS = ['metrics.all_conversions']
export const RMF_KEYWORD_FIELDS = [
  'ad_group_criterion.status',
  'ad_group_criterion.position_estimates.first_page_cpc_micros',
  'ad_group_criterion.position_estimates.first_position_cpc_micros',
  'ad_group_criterion.quality_info.quality_score',
]

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
// Separated so the verdict logic is testable without a vendor. `selectable` is the only PASS/FAIL axis; delivery
// is REPORTED and never gates, because a legitimate null must not fail a build.
export function decideAdapterGate({ probes }) {
  const failures = []
  for (const p of probes) {
    if (!p.selectable) failures.push(`${p.query} REFUSED by the vendor: ${p.error}`)
  }
  return { failures, ok: failures.length === 0 }
}

const nested = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
// The npm lib returns rows keyed by resource with snake_case leaves; `metrics.all_conversions` reads as
// row.metrics.all_conversions. Read through the SAME dotted path the GAQL used so a rename cannot pass silently.
const readField = (row, field) => nested(row, field)

async function main() {
  const clientId = flag('--client', '')
  const [START, END] = String(flag('--window', '')).split('..')
  if (!clientId) { console.error('REFUSING: --client <clientId> is required.'); process.exit(2) }

  for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
  const K = process.env.SUPABASE_SERVICE_ROLE_KEY, SB = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!K || !SB) { console.error('REFUSING: Supabase env missing — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }
  const sbGet = async (p) => (await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })).json()

  const conns = await sbGet(`platform_connections?select=user_email,account_id,account_name&platform=eq.google&client_id=eq.${clientId}`)
  const conn = Array.isArray(conns) ? conns[0] : null
  if (!conn?.user_email || !conn?.account_id) { console.error(`REFUSING: no google connection for client ${clientId}`); process.exit(2) }
  const toks = await sbGet(`google_tokens?select=refresh_token&user_email=eq.${encodeURIComponent(conn.user_email)}`)
  const refresh = (Array.isArray(toks) ? toks[0] : null)?.refresh_token
  if (!refresh) { console.error(`REFUSING: no google refresh token for ${conn.user_email}`); process.exit(2) }

  // Default window = the legacy screens' own default (LAST_30_DAYS), resolved to explicit dates so the gate
  // exercises the same BETWEEN shape the product uses rather than a DURING enum the product may not emit.
  const end = END || new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const start = START || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const { GoogleAdsApi } = await import('google-ads-api')
  const api = new GoogleAdsApi({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN })
  const customer = api.Customer({ customer_id: String(conn.account_id), refresh_token: refresh, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID })

  const reason = (e) => { const m = e?.errors?.[0] ?? e; return JSON.stringify(m?.error_code ? { error_code: m.error_code, message: m.message } : String(e?.message || e)).slice(0, 500) }
  const probes = []

  // ── --search-terms (LORAMER_RMF_R70_SEARCH_TERMS_V1): the R.70 GAQL on three windows ──────────────────────
  if (argv.includes('--search-terms')) {
    const iso = (d) => d.toISOString().slice(0, 10)
    const y = new Date(Date.now() - 86400000)
    const windows = [
      { label: 'LAST_30_DAYS(resolved)', start: iso(new Date(y.getTime() - 29 * 86400000)), end: iso(y) },
      { label: 'LAST_90_DAYS(resolved)', start: iso(new Date(y.getTime() - 89 * 86400000)), end: iso(y) },
      { label: 'CUSTOM(2026-05-01..2026-05-31)', start: '2026-05-01', end: '2026-05-31' },
    ]
    console.log(`[rmf-adapter-gate] --search-terms · account ${conn.account_id} (${conn.account_name || 'unnamed'}) · 3 vendor requests (Basic cap 15,000/day).`)
    // The EXACT SELECT the revived getSearchTerms ships (R.70 required fields + the always-carried context cols).
    const stGaql = (w) => `
      SELECT search_term_view.search_term, segments.search_term_match_type,
      search_term_view.status, campaign.name, ad_group.name,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.ctr
      FROM search_term_view
      WHERE segments.date BETWEEN '${w.start}' AND '${w.end}'
      ORDER BY metrics.cost_micros DESC
      LIMIT 500`
    for (const w of windows) {
      try {
        const rows = await customer.query(stGaql(w))
        const mt = rows.filter((r) => r.segments?.search_term_match_type !== null && r.segments?.search_term_match_type !== undefined).length
        probes.push({ query: `search_terms·${w.label}`, selectable: true, error: null, rowCount: rows.length, delivery: {} })
        console.log(`[rmf-adapter-gate] search_terms · ${w.label}: ✓ ACCEPTED · ${rows.length} row(s) · match_type non-null ${mt}/${rows.length}`)
        if (rows.length > 0) console.log(`[rmf-adapter-gate]     first row: ${JSON.stringify({ term: rows[0].search_term_view?.search_term, match_type: rows[0].segments?.search_term_match_type, clicks: rows[0].metrics?.clicks, cost_micros: rows[0].metrics?.cost_micros, impressions: rows[0].metrics?.impressions })}`)
        else console.log(`[rmf-adapter-gate]     ⛔ ZERO ROWS in this window — a reviewer opening this tab on this window sees an EMPTY report. Selectability proven, delivery ABSENT here.`)
      } catch (e) {
        probes.push({ query: `search_terms·${w.label}`, selectable: false, error: reason(e), rowCount: 0, delivery: {} })
        console.log(`[rmf-adapter-gate] search_terms · ${w.label}: ⛔ VENDOR REFUSED — ${reason(e)}`)
      }
    }
    const sv = decideAdapterGate({ probes })
    if (!sv.ok) {
      console.error(`✗ rmf-adapter-gate --search-terms FAIL — ${sv.failures.length} finding(s):`)
      for (const f of sv.failures) console.error(`  - ${f}`)
      process.exit(1)
    }
    console.log('✓ rmf-adapter-gate --search-terms OK — the R.70 GAQL (incl. segments.search_term_match_type) is ACCEPTED on all three windows.')
    process.exit(0)
  }

  // ── --drill (LORAMER_GAQL_DATE_WINDOW_V1): the corrected drill GAQL on the two ranges DURING broke on ──────
  if (argv.includes('--drill')) {
    // The resolver's own arithmetic, mirrored (this .mjs cannot import the TS resolver): LAST_90_DAYS =
    // yesterday-89 .. yesterday, exactly src/lib/date-range.ts:70-74. CUSTOM = a fixed settled month.
    const iso = (d) => d.toISOString().slice(0, 10)
    const y = new Date(Date.now() - 86400000)
    const l90 = { label: 'LAST_90_DAYS(resolved)', start: iso(new Date(y.getTime() - 89 * 86400000)), end: iso(y) }
    const custom = { label: 'CUSTOM(2026-05-01..2026-05-31)', start: '2026-05-01', end: '2026-05-31' }
    console.log(`[rmf-adapter-gate] --drill · account ${conn.account_id} (${conn.account_name || 'unnamed'}) · ~5 vendor requests (Basic cap 15,000/day).`)

    let campaignId = null
    try {
      // GAQL requires ORDER BY fields to be in the SELECT (query_error 16 on first run — instrument, not product).
      const rows = await customer.query(`SELECT campaign.id, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${l90.start}' AND '${l90.end}' AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 1`)
      campaignId = rows[0]?.campaign?.id ? String(rows[0].campaign.id) : null
    } catch (e) { console.error(`✗ campaign-id discovery REFUSED: ${reason(e)} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
    if (!campaignId) { console.error('✗ no campaign with spend in the L90 window — cannot exercise the drill on this account. Pick another --client.'); process.exit(2) }
    console.log(`[rmf-adapter-gate] drill anchor: campaign ${campaignId}`)

    // The EXACT WHERE/SELECT shape the two routes now emit (fields verbatim from the route files).
    const adgroupsGaql = (w) => `
      SELECT ad_group.id, ad_group.name, ad_group.status,
      ad_group.type, ad_group.cpc_bid_micros,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value,
      metrics.ctr, metrics.average_cpc
      FROM ad_group
      WHERE segments.date BETWEEN '${w.start}' AND '${w.end}'
      AND campaign.id = ${campaignId}
      AND ad_group.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC`
    const adsGaql = (w, agId) => `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name,
      ad_group_ad.status, ad_group_ad.ad.type,
      metrics.impressions, metrics.clicks, metrics.cost_micros,
      metrics.conversions, metrics.conversions_value,
      metrics.ctr, metrics.average_cpc
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${w.start}' AND '${w.end}'
      AND ad_group.id = ${agId}
      AND ad_group_ad.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC`

    let adGroupId = null
    for (const w of [l90, custom]) {
      try {
        const rows = await customer.query(adgroupsGaql(w))
        if (!adGroupId && rows[0]?.ad_group?.id) adGroupId = String(rows[0].ad_group.id)
        probes.push({ query: `adgroups·${w.label}`, selectable: true, error: null, rowCount: rows.length, delivery: {} })
        console.log(`[rmf-adapter-gate] adgroups · ${w.label}: ✓ ACCEPTED · ${rows.length} row(s)`)
      } catch (e) {
        probes.push({ query: `adgroups·${w.label}`, selectable: false, error: reason(e), rowCount: 0, delivery: {} })
        console.log(`[rmf-adapter-gate] adgroups · ${w.label}: ⛔ VENDOR REFUSED — ${reason(e)}`)
      }
    }
    if (!adGroupId) { console.error('✗ no ad group returned in either window — the ads half cannot be exercised on this campaign. Findings above still stand.'); }
    for (const w of adGroupId ? [l90, custom] : []) {
      try {
        const rows = await customer.query(adsGaql(w, adGroupId))
        probes.push({ query: `ads·${w.label}`, selectable: true, error: null, rowCount: rows.length, delivery: {} })
        console.log(`[rmf-adapter-gate] ads · ${w.label}: ✓ ACCEPTED · ${rows.length} row(s)`)
      } catch (e) {
        probes.push({ query: `ads·${w.label}`, selectable: false, error: reason(e), rowCount: 0, delivery: {} })
        console.log(`[rmf-adapter-gate] ads · ${w.label}: ⛔ VENDOR REFUSED — ${reason(e)}`)
      }
    }
    const dv = decideAdapterGate({ probes })
    if (!dv.ok) {
      console.error(`✗ rmf-adapter-gate --drill FAIL — ${dv.failures.length} finding(s):`)
      for (const f of dv.failures) console.error(`  - ${f}`)
      process.exit(1)
    }
    console.log('✓ rmf-adapter-gate --drill OK — the corrected drill GAQL is ACCEPTED on LAST_90_DAYS and CUSTOM windows.')
    process.exit(0)
  }

  console.log(`[rmf-adapter-gate] account ${conn.account_id} (${conn.account_name || 'unnamed'}) · window ${start}..${end}`)
  console.log(`[rmf-adapter-gate] 2 vendor requests will be spent (1 op each, Basic cap 15,000/day).`)

  // ── PROBE 1 · CAMPAIGN (R.20) + ACCOUNT (R.10, summed from campaigns by /api/platform) ───────────────────────
  const campaignGaql = `
    SELECT campaign.id, campaign.name, campaign.status,
    campaign_budget.amount_micros, metrics.impressions, metrics.clicks,
    metrics.cost_micros, metrics.conversions, metrics.all_conversions, metrics.conversions_value,
    metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
    AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `
  await probe('campaign', campaignGaql, RMF_CAMPAIGN_FIELDS)

  // ── PROBE 2 · KEYWORD (R.50) ─────────────────────────────────────────────────────────────────────────────────
  const keywordGaql = `
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, ad_group.name, campaign.name,
    ad_group_criterion.position_estimates.first_page_cpc_micros,
    ad_group_criterion.position_estimates.first_position_cpc_micros,
    ad_group_criterion.quality_info.quality_score,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM keyword_view
    WHERE segments.date BETWEEN '${start}' AND '${end}'
    AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `
  await probe('keyword_view', keywordGaql, RMF_KEYWORD_FIELDS)

  async function probe(label, gaql, fields) {
    let rows = null, error = null
    try { rows = await customer.query(gaql) } catch (e) { error = reason(e) }
    if (error) {
      probes.push({ query: label, selectable: false, error, rowCount: 0, delivery: {} })
      console.log(`[rmf-adapter-gate] ${label}: ⛔ VENDOR REFUSED — ${error}`)
      return
    }
    // DELIVERY, per field, WITH ITS DENOMINATOR. An empty result set is reported as such rather than as
    // "0 non-null", because 0-of-0 and 0-of-200 are different findings (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1).
    const delivery = {}
    for (const f of fields) {
      const nonNull = rows.filter((r) => { const v = readField(r, f); return v !== null && v !== undefined }).length
      delivery[f] = { nonNull, of: rows.length }
    }
    probes.push({ query: label, selectable: true, error: null, rowCount: rows.length, delivery })
    console.log(`[rmf-adapter-gate] ${label}: ✓ ACCEPTED · ${rows.length} row(s) returned`)
    for (const f of fields) {
      const d = delivery[f]
      const note = rows.length === 0 ? 'NO ROWS IN WINDOW — selectability proven, delivery UNMEASURED'
        : d.nonNull === 0 ? 'selectable, but NULL on every row here — must render as an em dash, never 0'
        : 'delivering'
      console.log(`[rmf-adapter-gate]     ${f}: ${d.nonNull}/${d.of} non-null — ${note}`)
    }
    if (rows.length > 0) {
      const s = rows[0]
      console.log(`[rmf-adapter-gate]     first-row sample: ${JSON.stringify(fields.reduce((a, f) => (a[f] = readField(s, f) ?? null, a), {}))}`)
    }
  }

  const v = decideAdapterGate({ probes })
  console.log('[rmf-adapter-gate] SELECTABILITY is the only PASS/FAIL axis. A null delivery is REPORTED, never failed — see the header.')
  if (!v.ok) {
    console.error(`✗ rmf-adapter-gate FAIL — ${v.failures.length} finding(s):`)
    for (const f of v.failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('✓ rmf-adapter-gate OK — every field under test was ACCEPTED by the live Google Ads API.')
  process.exit(0)
}

main().catch((e) => { console.error('✗ rmf-adapter-gate CRASHED — BROKEN INSTRUMENT, not a pass:', e?.message || e); process.exit(2) })
