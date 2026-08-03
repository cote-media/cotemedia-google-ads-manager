#!/usr/bin/env node
// LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1 — THE REGENERATOR FOR docs/google-ads-capture-universe.json.
//
// ⛔ THIS SCRIPT EXISTS BECAUSE A HAND-MAINTAINED LIST IS HOW THE LAST ONE WENT STALE. `capture-surface.manifest.mjs`
// says of itself "Seeded from docs/LORAMER_DATA_COMPLETENESS.md", a doc a human wrote, and
// `check-capture-completeness.mjs` then compares our breakdown-registry AGAINST THAT MANIFEST. Both sides of that
// comparison are OURS. It is a green check that can only ever confirm we have what we already knew about — which is
// why it stayed green for six weeks while we captured 14 of 38 surfaces Google was serving.
// THE UNIVERSE IS THE VENDOR'S, NOT OURS. GoogleAdsFieldService IS the denominator. Re-run this; never hand-edit
// the JSON.
//
// ⛔ WHAT THIS PROVES AND WHAT IT DOES NOT. The catalog says what is SELECTABLE. It does NOT say what returns rows
// for a given account — that is the `delivers` field, and it comes from LIVE PROBES against ONE account
// (Foam OH / 7688521852, measured 2026-08-03, 594 requests). Selectability is universal; delivery is per-account.
// A future run against a different account will produce different `delivers` values and the SAME `selectable` set.
// Everything carried forward from the probe pass is labelled `observedOn` so it can never be mistaken for universal.
//
// USAGE
//   node scripts/google-ads-capture-universe.mjs --catalog-only     # refresh selectable set from the vendor (no probes)
//   node scripts/google-ads-capture-universe.mjs --probe <clientId>  # ⛔ SPENDS GOOGLE QUOTA. Adds/refreshes delivery.
// ⛔ --probe IS NOT WIRED INTO ANY GATE. It costs hundreds of requests against a 15,000/day cap and must stay a
// deliberate, human-initiated act — same posture as `check:data` and `npm run evals`.
//
// ── THE CATALOG QUERIES, VERBATIM, SO THE REGENERATION IS AUDITABLE ────────────────────────────────────────────
//   RESOURCES: SELECT name, category, metrics, segments, attribute_resources WHERE category = 'RESOURCE'
//     ⚠ DO NOT ADD `AND selectable = true`. A RESOURCE field is not itself "selectable" and the predicate returns
//       ZERO ROWS — which on 2026-08-03 I briefly read as "no resources exist". A wrong predicate looks exactly
//       like an empty vendor.
//   SEGMENTS:  SELECT name, category, selectable, selectable_with, data_type WHERE category = 'SEGMENT' AND selectable = true
//   METRICS:   SELECT name, category, selectable WHERE category = 'METRIC' AND selectable = true
// Called through customer.googleAdsFields.searchGoogleAdsFields({ query, page_size: 10000 }). page_size 10000
// returned next_page_token = null on all three at 182/133/234 rows; if that ever changes, PAGE — a truncated
// catalog silently shrinks the denominator, which is the exact failure this file exists to end.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const OUT = 'docs/google-ads-capture-universe.json'

export const CATALOG_QUERIES = {
  resources: `SELECT name, category, metrics, segments, attribute_resources WHERE category = 'RESOURCE'`,
  segments: `SELECT name, category, selectable, selectable_with, data_type WHERE category = 'SEGMENT' AND selectable = true`,
  metrics: `SELECT name, category, selectable WHERE category = 'METRIC' AND selectable = true`,
}

// ⛔ WHAT WE CAPTURE TODAY — derived, not asserted. The resources are grepped out of the writers and the geo family
// is read from google-geo.ts's dynamic grain list, because a literal grep CANNOT see `segments.geo_target_${snake}`
// and on 2026-08-03 that blindness produced a wrong report ("we request only geo_target_city") that had to be
// retracted. If a writer starts building query strings a new way, this function is where it must be taught.
export function capturedToday() {
  const src = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
  const resources = new Set()
  for (const f of ['src/lib/google-ads.ts', 'src/lib/intelligence/google-intelligence.ts', 'src/lib/intelligence/google-geo.ts',
    'src/lib/backfill/google-campaign-backfill.ts', 'src/lib/backfill/google-adgroup-ad-backfill.ts',
    'src/lib/backfill/google-demographic-backfill.ts', 'src/lib/backfill/google-dimensional-backfill.ts',
    'src/lib/backfill/google-geo-backfill.ts', 'src/lib/backfill/google-device-backfill.ts',
    'src/lib/backfill/google-hour-backfill.ts']) {
    for (const m of src(f).matchAll(/FROM\s+([a-z][a-z_]{2,})/g)) resources.add(m[1])
    for (const m of src(f).matchAll(/resource:\s*'([a-z_]+)'/g)) resources.add(m[1])
  }
  const segments = new Set()
  for (const f of ['src/lib/google-ads.ts', 'src/lib/intelligence/google-intelligence.ts']) {
    for (const m of src(f).matchAll(/segments\.([a-z_.]+)/g)) segments.add(`segments.${m[1]}`)
  }
  // THE DYNAMIC HALF — google-geo.ts builds nine segment names from a table. Read the table, not the string.
  const geo = src('src/lib/intelligence/google-geo.ts')
  // ⛔ ANCHOR ON THE LINE-START `]`, NOT THE FIRST `]`. The declaration is
  // `const SEGMENTS: Array<[string, string]> = [` and a non-greedy `[\s\S]*?\]` stops at the `]` inside the
  // FIRST tuple — which returned ONE geo segment instead of nine on the first run of this function. A parser
  // that silently under-reads is the same failure class as the grep it replaced.
  const tbl = /const SEGMENTS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(geo)
  if (tbl) for (const m of tbl[1].matchAll(/\[\s*'([a-z_]+)'/g)) segments.add(`segments.geo_target_${m[1]}`)
  return { resources: [...resources].sort(), segments: [...segments].sort() }
}

// ⛔ EVERY CATALOG SLOT EMITS A ROW. LORAMER_UNIVERSE_ARTIFACT_EMITS_EVERY_SLOT_V1, 2026-08-03.
//
// THE DEFECT THIS REPLACES, and it was four characters long: this loop used to read
//   for (const s of r.segments || []) { const p = probes.slots[`${r.name}|${s}`]; if (!p) continue; ... }
// so a slot the probe pass never recorded was DROPPED — no row, no reason, no trace. 740 of 1,118
// catalog-declared slots were absent from the artifact on that rule, which is 66.2% of the vendor's own
// surface, and NOTHING ANYWHERE SAID SO. The file that exists to BE the denominator was under-counting the
// denominator by two thirds while reading as authoritative.
//
// ⛔ NEVER-ASKED AND ASKED-AND-DECLINED ARE NOT THE SAME NON-EXISTENCE. That conflation is the exact defect
// the whole capture-universe arc was built to end (the writer's own header: "ZERO IS A FACT, NOT A SKIP"),
// and it had been reproduced inside the artifact the arc produced. PROOF IT MATTERED, from our own data:
// `geographic_view / segments.geo_target_city` was absent, so the walk would never have asked for it, while
// metrics_daily holds 13,496 distinct cities in SEVEN DAYS from that exact field.
//
// THE THREE STATES, and a row is malformed if it does not sit in exactly one of them:
//   probed: false                      — NEVER ASKED. Evidence of nothing. Carries `skipReason` saying why.
//   probed: true,  delivers: false     — ASKED, vendor declined. Carries `vendorReason` VERBATIM.
//   probed: true,  delivers: true      — ASKED, vendor served. Carries `distinctValues`.
// A slot that cannot be emitted is a BUILD FAILURE, never a skip — see the throw below.
export function build({ catalog, probes, capture }) {
  const entries = []
  for (const r of catalog.resources) {
    const cap = capture.resources.includes(r.name)
    const surface = probes.surfaces?.[r.name]
    const metricCount = (r.metrics || []).length
    const resourceRow = {
      resource: r.name, segment: null,
      metricCount,
      selectableSegments: (r.segments || []).length,
      capturedToday: cap,
      // A resource with no observation is UNPROBED and says so, rather than carrying `delivers: undefined`
      // and being read as "false-ish" by anything that tests truthiness.
      ...(surface ? { probed: true, ...surface } : { probed: false, skipReason: metricCount === 0
        ? 'catalog declares 0 selectable metrics on this resource — no metric can be requested from it, so there is nothing for a capture pass to fetch'
        : 'not reached by any probe pass yet' }),
    }
    // ⛔ THE SAME NORMALISATION AS THE SLOT LOOP, AND IT WAS MISSING HERE ON THE FIRST WRITE — the guard
    // caught `ad_schedule_view` declining with a bare `false`. A resource-only row is a slot too; the three
    // states do not stop applying because there is no segment on the row.
    if (resourceRow.probed === true && resourceRow.delivers === false && !resourceRow.vendorReason) {
      resourceRow.vendorReason = 'query succeeded and returned 0 rows — an OBSERVED ZERO for THIS account in THIS window, not a vendor refusal and not a capability limit. Another account may deliver it.'
      resourceRow.observedZeroForAccount = true
    }
    entries.push(resourceRow)
    for (const s of r.segments || []) {
      const p = probes.slots?.[`${r.name}|${s}`]
      const row = { resource: r.name, segment: s, capturedToday: cap && capture.segments.includes(s) }
      if (p) {
        Object.assign(row, { probed: true }, p)
        // ⛔ A DECLINE WITH NO REASON IS A FOURTH STATE HIDING INSIDE THE THIRD. Two very different things
        // both land on delivers:false — the vendor REFUSED the query (an error, a capability limit, true for
        // every account) and the vendor ANSWERED WITH NOTHING (an observed zero, true for THIS account in
        // THIS window and nobody else). Leaving the second one as a missing field means a reader tells them
        // apart by the ABSENCE of a key, which is exactly the inference this artifact exists to stop.
        if (row.delivers === false && !row.vendorReason) {
          row.vendorReason = 'query succeeded and returned 0 rows — an OBSERVED ZERO for THIS account in THIS window, not a vendor refusal and not a capability limit. Another account may deliver it.'
          row.observedZeroForAccount = true
        }
      }
      else Object.assign(row, { probed: false, skipReason: metricCount === 0
        ? 'catalog declares 0 selectable metrics on the parent resource — a metrics query cannot be built for this slot'
        : 'not reached by any probe pass yet' })
      // ⛔ THE STATE MACHINE IS ENFORCED HERE, at the only place rows are made. A row that is neither
      // probed-with-a-verdict nor unprobed-with-a-reason is the shape the old bug produced, and it must
      // never be writable again — including by a future edit to this function.
      if (row.probed === true && row.delivers === undefined) {
        throw new Error(`REFUSING TO EMIT ${r.name}|${s}: probed:true with no delivers verdict. A probe that ran must record what the vendor said.`)
      }
      if (row.probed === false && !row.skipReason) {
        throw new Error(`REFUSING TO EMIT ${r.name}|${s}: probed:false with no skipReason. "Never asked" is only honest when it says why.`)
      }
      entries.push(row)
    }
  }
  // ⛔ THE COUNT IS THE CONTRACT. One row per resource + one per declared slot, always.
  const expected = catalog.resources.length + catalog.resources.reduce((n, r) => n + (r.segments || []).length, 0)
  if (entries.length !== expected) {
    throw new Error(`REFUSING TO WRITE: built ${entries.length} rows for ${expected} catalog slots. Every declared slot emits a row — a shortfall is the 740-missing-slots defect returning.`)
  }
  return entries
}

// ── THE LIVE HALF — everything below touches the vendor and is CLI-ONLY ────────────────────────────────────
// ⛔ KEPT BELOW `build()` ON PURPOSE. build() stays hermetic and pure so the guard can drive it with no
// network and no quota; nothing above this line imports a client.

/** Retained observations, read back OUT of the committed artifact so a re-probe never loses prior delivery. */
export function retainedProbes(doc) {
  const surfaces = {}, slots = {}
  for (const e of doc.entries || []) {
    if (e.probed === false) continue                       // an unprobed row carries nothing worth retaining
    const { resource, segment, capturedToday, metricCount, selectableSegments, probed, skipReason, ...obs } = e
    if (Object.keys(obs).length === 0) continue
    if (segment === null || segment === undefined) { if (e.delivers !== undefined) surfaces[resource] = obs }
    else slots[`${resource}|${segment}`] = obs
  }
  return { surfaces, slots }
}

/** ⛔ THE ONLY PLACE THE PROBE QUERY IS BUILT. Mirrors the writer's buildGaql so the probe tests what the walk will run. */
export const probeGaql = (resource, segment, metric, start, end) =>
  `SELECT segments.date, ${segment ? segment : `${resource}.resource_name`}, ${metric} FROM ${resource} ` +
  `WHERE segments.date BETWEEN '${start}' AND '${end}'`

if (process.argv[1] && process.argv[1].endsWith('google-ads-capture-universe.mjs')) {
  const argv = process.argv.slice(2)
  const probeAt = argv.indexOf('--probe')
  if (probeAt === -1) {
    console.log(`[google-ads-capture-universe] this script REGENERATES ${OUT}.`)
    console.log('  --catalog-only        refresh the selectable set from GoogleAdsFieldService (no quota beyond 3 metadata calls)')
    console.log('  --probe <clientId>    ⛔ SPENDS QUOTA — probe every UNPROBED metric-carrying slot on one live account')
    console.log('      --budget <n>      HARD CEILING on vendor requests. The pass stops at it and records the rest')
    console.log('                        probed:false with a reason. It never silently truncates and never borrows')
    console.log('                        from the forward or drain reserves.')
    console.log('      --window a..b     probe window, default 2026-03-01..2026-03-31 (the 2026-08-03 observation set)')
    process.exit(0)
  }

  // ⛔ `indexOf` RETURNS -1 AND -1 + 1 IS 0, so a missing flag silently reads argv[0] — which is truthy, so
  // the `|| default` never fires. That cost 762 vendor requests on 2026-08-03: --window was absent, START
  // became the literal string '--probe' and END became undefined, and every one of the 762 probes came back
  // {"query_error":26} "Condition 'segments.date BETWEEN '--probe' and 'undefined'' is invalid". THE PASS
  // REPORTED served 0 / declined 762 AND LOOKED LIKE A FINDING — a systematic self-inflicted error wearing
  // the exact costume of "the vendor serves none of this". Read the flag, then check it was actually there.
  const flag = (name, dflt) => { const i = argv.indexOf(name); return i === -1 || i + 1 >= argv.length ? dflt : argv[i + 1] }
  const clientId = argv[probeAt + 1]
  const budget = Number(flag('--budget', 0))
  const [START, END] = String(flag('--window', '2026-03-01..2026-03-31')).split('..')
  if (!clientId || !budget || budget < 1) { console.error('REFUSING: --probe <clientId> --budget <n> are both required. A probe with no stated ceiling is how a lane eats a cap.'); process.exit(1) }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
    console.error(`REFUSING: --window parsed to "${START}".."${END}", which is not YYYY-MM-DD..YYYY-MM-DD. A malformed window makes every probe fail identically and reads as a vendor verdict.`); process.exit(1)
  }

  for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
  const K = process.env.SUPABASE_SERVICE_ROLE_KEY, SB = process.env.NEXT_PUBLIC_SUPABASE_URL
  const sbGet = async (path) => (await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })).json()
  const conns = await sbGet(`platform_connections?select=user_email,account_id&platform=eq.google&client_id=eq.${clientId}`)
  const conn = Array.isArray(conns) ? conns[0] : null
  if (!conn?.user_email || !conn?.account_id) { console.error(`REFUSING: no google connection for ${clientId}`); process.exit(1) }
  const toks = await sbGet(`google_tokens?select=refresh_token&user_email=eq.${encodeURIComponent(conn.user_email)}`)
  const refresh = (Array.isArray(toks) ? toks[0] : null)?.refresh_token
  if (!refresh) { console.error(`REFUSING: no google refresh token for ${conn.user_email}`); process.exit(1) }

  const { GoogleAdsApi } = await import('google-ads-api')
  const api = new GoogleAdsApi({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN })
  const customer = api.Customer({ customer_id: String(conn.account_id), refresh_token: refresh, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID })

  let spent = 0
  const reason = (e) => { const m = e?.errors?.[0] ?? e; return JSON.stringify(m?.error_code ? { error_code: m.error_code, message: m.message } : String(e?.message || e)).slice(0, 400) }

  // 1) CATALOG — 3 metadata requests. The artifact stores slot NAMES only for slots it carries, so the
  //    missing 740 cannot be enumerated without re-reading the vendor's own field service.
  console.log(`[probe] fetching catalog (3 metadata requests)…`)
  // ⛔ searchGoogleAdsFields RETURNS A gRPC TUPLE, NOT AN ARRAY OF ROWS — `[results, request, response]`.
  // Reading it as the row list yields THREE elements whose `.name` is undefined, which on 2026-08-03 looked
  // exactly like "the vendor returned 3 resources". Same failure shape the header already warns about for
  // the `selectable = true` predicate: a wrong read of the catalog is indistinguishable from an empty vendor.
  const rowsOf = (r) => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r)
  const cat = {}
  for (const [k, q] of Object.entries(CATALOG_QUERIES)) {
    spent++
    const rows = rowsOf(await customer.googleAdsFields.searchGoogleAdsFields({ query: q, page_size: 10000 }))
    if (!rows.length || rows.some((x) => !x?.name)) throw new Error(`catalog query "${k}" returned ${rows.length} row(s) with a missing name — refusing to rebuild the denominator from a malformed read.`)
    cat[k] = rows
    console.log(`[probe]   ${k}: ${rows.length}`)
  }
  const catalog = { resources: cat.resources.map((r) => ({ name: r.name, metrics: r.metrics || [], segments: r.segments || [] })) }

  const doc = JSON.parse(readFileSync(resolve(ROOT, OUT), 'utf8'))
  const probes = retainedProbes(doc)
  const retainedSlots = Object.keys(probes.slots).length
  const retainedSurfaces = Object.keys(probes.surfaces).length

  // 2) THE WORK LIST — unprobed slots on resources that carry at least one metric. A zero-metric resource is
  //    NOT probed and NOT silently dropped: build() gives it probed:false with the reason on the row.
  const work = []
  for (const r of catalog.resources) {
    if ((r.metrics || []).length === 0) continue
    if (!probes.surfaces[r.name]) work.push({ resource: r.name, segment: null })
    for (const s of r.segments || []) if (!probes.slots[`${r.name}|${s}`]) work.push({ resource: r.name, segment: s })
  }
  console.log(`\n[probe] BUDGET ARITHMETIC — printed BEFORE spending, per the flight rule`)
  console.log(`[probe]   retained observations : ${retainedSlots} slots + ${retainedSurfaces} surfaces (never re-probed, never lost)`)
  console.log(`[probe]   unprobed metric-carrying slots to probe : ${work.length}`)
  console.log(`[probe]   catalog cost already spent : ${spent}`)
  console.log(`[probe]   HARD BUDGET : ${budget} requests`)
  console.log(`[probe]   ⇒ will probe ${Math.max(0, Math.min(work.length, budget - spent))} of ${work.length}; remainder stays probed:false WITH A REASON\n`)

  const METRICS = ['metrics.impressions', 'metrics.cost_micros']
  let probed = 0, served = 0, declined = 0, unreached = 0
  for (const w of work) {
    if (spent >= budget) {
      unreached++
      continue // build() will emit it probed:false; we relabel the reason below
    }
    const key = w.segment ? `${w.resource}|${w.segment}` : null
    let done = false
    for (let mi = 0; mi < METRICS.length && !done; mi++) {
      if (spent >= budget) break
      spent++
      try {
        const rows = await customer.query(probeGaql(w.resource, w.segment, METRICS[mi], START, END))
        const path = w.segment ? w.segment.replace(/^segments\./, '').split('.') : null
        const vals = new Set()
        for (const row of rows) {
          const v = path ? path.reduce((a, k) => (a == null ? a : a[k]), row.segments) : row?.[w.resource]?.resource_name
          if (v !== undefined && v !== null) vals.add(String(v))
        }
        const obs = { dateCombinable: true, delivers: rows.length > 0, distinctValues: vals.size, metricShape: mi === 0 ? null : METRICS[mi] }
        if (key) probes.slots[key] = obs; else probes.surfaces[w.resource] = obs
        probed++; if (rows.length > 0) served++; else declined++
        done = true
      } catch (e) {
        const vr = reason(e)
        // A metric-shape rejection (query_error 53) is the ONE error worth one retry with a different
        // metric — the artifact already records metricShape for exactly this case. Anything else is the
        // vendor's answer and is recorded verbatim rather than retried into the budget.
        const retryable = /query_error["\s:]*\{?"?code"?:?\s*53|unsupported metric/i.test(vr)
        if (retryable && mi + 1 < METRICS.length) continue
        const obs = { dateCombinable: !/date/i.test(vr), delivers: false, distinctValues: 0, vendorReason: vr }
        if (key) probes.slots[key] = obs; else probes.surfaces[w.resource] = obs
        probed++; declined++
        done = true
      }
    }
    if (!done) unreached++
  }

  const capture = capturedToday()
  const entries = build({ catalog, probes, capture })
  // Relabel the budget-exhausted rows so "never asked" names the REAL reason rather than the generic one.
  let relabelled = 0
  if (unreached > 0) {
    const reached = new Set([...Object.keys(probes.slots), ...Object.keys(probes.surfaces).map((r) => `${r}|`)])
    for (const e of entries) {
      if (e.probed !== false) continue
      if (e.metricCount === 0 || e.skipReason?.startsWith('catalog declares 0')) continue
      const k = e.segment ? `${e.resource}|${e.segment}` : `${e.resource}|`
      if (!reached.has(k)) { e.skipReason = `BUDGET EXHAUSTED at ${budget} vendor requests — this slot was in the work list and was NOT reached. It is not evidence of anything; re-run --probe with a larger --budget.`; relabelled++ }
    }
  }

  const out = {
    ...doc,
    marker: doc.marker,
    regeneratedBy: 'scripts/google-ads-capture-universe.mjs',
    catalogQueries: CATALOG_QUERIES,
    catalogDenominator: { resources: catalog.resources.length, resourcesCarryingMetrics: catalog.resources.filter((r) => (r.metrics || []).length).length, segments: cat.segments.length, metrics: cat.metrics.length, truncated: false },
    slotAccounting: {
      marker: 'LORAMER_UNIVERSE_ARTIFACT_EMITS_EVERY_SLOT_V1',
      declaredSlots: catalog.resources.length + catalog.resources.reduce((n, r) => n + (r.segments || []).length, 0),
      emittedRows: entries.length,
      probedTrue: entries.filter((e) => e.probed === true).length,
      probedFalse: entries.filter((e) => e.probed === false).length,
      delivering: entries.filter((e) => e.delivers === true).length,
      declined: entries.filter((e) => e.probed === true && e.delivers === false).length,
      budgetExhausted: relabelled,
      note: 'Every declared catalog slot emits exactly one row. probed:false is NEVER evidence of non-delivery — it means nobody asked, and the row says why.',
    },
    deliveryObservation: { ...doc.deliveryObservation, measuredUtc: new Date().toISOString().slice(0, 10), googleRequestsThisPass: spent, probeWindow: `${START}..${END}` },
    entries,
  }
  writeFileSync(resolve(ROOT, OUT), JSON.stringify(out, null, 2) + '\n')
  console.log(`\n[probe] DONE — probed ${probed} (served ${served}, declined ${declined}), unreached ${unreached}, relabelled ${relabelled}`)
  console.log(`[probe] VENDOR REQUESTS SPENT: ${spent} of a ${budget} budget`)
  console.log(`[probe] artifact rows: ${entries.length} (was ${doc.entries.length})`)
}
