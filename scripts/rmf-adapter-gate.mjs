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

  console.log(`[rmf-adapter-gate] account ${conn.account_id} (${conn.account_name || 'unnamed'}) · window ${start}..${end}`)
  console.log(`[rmf-adapter-gate] 2 vendor requests will be spent (1 op each, Basic cap 15,000/day).`)

  const reason = (e) => { const m = e?.errors?.[0] ?? e; return JSON.stringify(m?.error_code ? { error_code: m.error_code, message: m.message } : String(e?.message || e)).slice(0, 500) }
  const probes = []

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
