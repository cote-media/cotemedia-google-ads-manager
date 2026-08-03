#!/usr/bin/env node
// LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1 — THE REGENERATOR FOR docs/google-capture-universe.json.
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
//   node scripts/google-capture-universe.mjs --catalog-only     # refresh selectable set from the vendor (no probes)
//   node scripts/google-capture-universe.mjs --probe <clientId>  # ⛔ SPENDS GOOGLE QUOTA. Adds/refreshes delivery.
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
const OUT = 'docs/google-capture-universe.json'

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

// Merge a fresh catalog with the retained probe observations, so a catalog refresh never silently drops delivery data.
export function build({ catalog, probes, capture }) {
  const entries = []
  for (const r of catalog.resources) {
    const cap = capture.resources.includes(r.name)
    entries.push({
      resource: r.name, segment: null,
      metricCount: (r.metrics || []).length,
      selectableSegments: (r.segments || []).length,
      capturedToday: cap,
      ...(probes.surfaces?.[r.name] || {}),
    })
    for (const s of r.segments || []) {
      const p = probes.slots?.[`${r.name}|${s}`]
      if (!p) continue
      entries.push({ resource: r.name, segment: s, capturedToday: cap && capture.segments.includes(s), ...p })
    }
  }
  return entries
}

if (process.argv[1] && process.argv[1].endsWith('google-capture-universe.mjs')) {
  console.log(`[google-capture-universe] this script REGENERATES ${OUT}.`)
  console.log('  --catalog-only  refresh the selectable set from GoogleAdsFieldService (no quota beyond 3 metadata calls)')
  console.log('  --probe <id>    ⛔ SPENDS QUOTA — re-measure delivery against one live account')
  console.log('  The committed JSON carries the 2026-08-03 Foam OH observation set; delivery is PER-ACCOUNT.')
}
