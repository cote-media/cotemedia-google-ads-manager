#!/usr/bin/env node
// LORAMER_METRICS_PAYLOAD_UNIFORMITY_GUARD_V1
//
// FAILS if any metrics_daily upsert payload reaches the write boundary with a NOT-NULL column present on
// SOME rows and absent on OTHERS.
//
// THE BUG IT GUARDS (found 2026-07-27, live in production since 2026-07-19): PostgREST builds ONE column
// list from the UNION of keys across a bulk payload, and any object missing a key that a SIBLING supplies
// is sent as an explicit NULL — NOT the column DEFAULT. buildShopifyDepthRows omitted `conversions` on
// product_type / product_vendor while every sibling family set it, so every Shopify depth write 23502'd:
// "null value in column \"conversions\" of relation \"metrics_daily\" violates not-null constraint".
// 32 such rejections plus 16 more naming "spend" across four stores. The account row was written by a
// SEPARATE statement and kept landing, so cron returned 200, connection health stayed green, sync_state
// advanced, and TWELVE breakdown families held zero rows for eight days while nothing anywhere went red.
//
// IT GUARDS THE CLASS, NOT THE TWO FIELDS. Nothing here lists a family or a column by hand:
//   · the payload shapes are DERIVED BY EXECUTING THE REAL BUILDERS (never parsed, never from a doc — a doc
//     can be honest-but-false, and a text scan cannot see which rows land in the SAME upsert);
//   · the NOT-NULL set is READ FROM information_schema (via the committed snapshot — see below), so adding
//     a NOT-NULL column to metrics_daily extends the guard automatically;
//   · nullable columns are EXEMPT BY NULLABILITY, not by name. entity_name and parent_entity_id are
//     legitimately non-uniform today and must stay legal.
// A sixth platform, or an 18th Shopify family that forgets a column its siblings set, fails this guard.
//
// WHERE IT ASSERTS, AND WHY THAT IS THE RIGHT PLACE: at the WRITE BOUNDARY — after normalizeMetricsRows,
// which is what every caller actually sends. A builder omission that normalize fills is not a defect (the
// row writes, with the value the column would have defaulted to); a non-uniformity that SURVIVES normalize
// is a guaranteed 23502. The guard also PRINTS raw pre-normalize non-uniformity as INFO so a reviewer can
// see which builders lean on normalize, without turning a non-defect into a red build.
//
// NULLABILITY SOURCE — a deliberate, stated deviation. Reading information_schema at guard time would put a
// DB dependency inside `npm run guard` -> `npm run build`, which runs on Vercel with no DB and no
// service-role key; this repo deliberately keeps DB work out of the build path (that is why check:data is
// separate). So the set is read from information_schema and COMMITTED to tests/guards/metrics-daily-schema.json,
// with the exact regeneration query in that file. Verified equal to live production on 2026-07-27.
//
// HERMETIC AT RUNTIME: no network, no DB, no vendor API, no writes to metrics_daily. It DOES shell out to the
// repo's own tsc to compile the five builders into a temp dir, because executing them is the whole point.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fail = (msg) => { console.error(`✗ metrics-payload-uniformity guard: ${msg}`); process.exit(2) }

// ── 1. NOT-NULL set, read from the information_schema snapshot ──────────────────────────────────────────
let schema
try { schema = JSON.parse(readFileSync(resolve(ROOT, 'tests/guards/metrics-daily-schema.json'), 'utf8')) }
catch (e) { fail(`cannot read tests/guards/metrics-daily-schema.json — ${e.message}`) }
if (!Array.isArray(schema?.columns) || schema.columns.length < 20) fail('schema snapshot is missing or truncated')
const NOT_NULL = new Set(schema.columns.filter((c) => c.is_nullable === 'NO').map((c) => c.column))
const NULLABLE = schema.columns.filter((c) => c.is_nullable === 'YES').map((c) => c.column)
if (NOT_NULL.size < 10) fail(`only ${NOT_NULL.size} NOT-NULL columns parsed — snapshot shape changed`)

// ── 2. compile the REAL builders (+ the real normalizer) and load them ──────────────────────────────────
const SRC = [
  'src/lib/intelligence/shopify-metrics-row.ts',
  'src/lib/intelligence/woocommerce-metrics-row.ts',
  'src/lib/intelligence/meta-metrics-row.ts',
  'src/lib/intelligence/google-metrics-row.ts',
  'src/lib/intelligence/ga-metrics-row.ts',
  'src/lib/metrics-normalize.ts',
]
const out = mkdtempSync(join(tmpdir(), 'loramer-payload-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [...SRC.map((f) => resolve(ROOT, f)), '--target', 'es2020', '--module', 'commonjs',
  '--moduleResolution', 'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }
const req = createRequire(import.meta.url)
const load = (rel) => req(join(out, rel.replace(/\.ts$/, '.js')))
let SH, WOO, META, GOOG, GA, NORM
try {
  SH = load('src/lib/intelligence/shopify-metrics-row.ts')
  WOO = load('src/lib/intelligence/woocommerce-metrics-row.ts')
  META = load('src/lib/intelligence/meta-metrics-row.ts')
  GOOG = load('src/lib/intelligence/google-metrics-row.ts')
  GA = load('src/lib/intelligence/ga-metrics-row.ts')
  NORM = load('src/lib/metrics-normalize.ts')
} catch (e) { rmSync(out, { recursive: true, force: true }); fail(`compiled builders did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }

// ── 3. fixtures — the minimum input that makes every family emit at least one row ───────────────────────
const C = 'guard-client', E = 'guard@loramer.test', D = '2026-07-19'
const met = () => ({ spend: 10, impressions: 100, clicks: 5, conversions: 2, conversionValue: 50 })
const shopLean = {
  totalOrders: 1, totalRevenue: 109, avgOrderValue: 109, currencyCode: 'USD',
  productsCapture: [{ id: 'p1', name: 'P', netRevenue: 109, grossRevenue: 109, units: 1 }],
  variantsCapture: [{ id: 'v1', name: 'V', parentProductId: 'p1', netRevenue: 109, grossRevenue: 109, units: 1, sku: 'S' }],
  geoCountries: [{ country: 'US', netRevenue: 109, orders: 1, refunded: 0 }],
  geoRegions: [{ region: 'US-OH', netRevenue: 109, orders: 1 }],
  geoCities: [{ city: 'US-OH-Columbus', netRevenue: 109, orders: 1 }],
  productTypeCapture: [{ productType: 'T', netRevenue: 109 }],
  productVendorCapture: [{ vendor: 'V', netRevenue: 109 }],
  productTagCapture: [{ tag: 'g', netRevenue: 109, units: 1 }],
  productCollectionCapture: [{ collection: 'C', netRevenue: 109, products: 1 }],
  customerCohortCapture: [{ bucket: '1', netRevenue: 109, orders: 1, customers: 1, avgLifetimeSpent: 109 }],
  financialStatusCapture: [{ status: 'PAID', netRevenue: 109, orders: 1 }],
  fulfillmentStatusCapture: [{ status: 'FULFILLED', netRevenue: 109, orders: 1 }],
  salesChannelCapture: [{ channel: 'online_store', channelName: 'Online Store', netRevenue: 109, orders: 1 }],
  orderTimesCapture: [{ orderId: 'o1', createdAt: '2026-07-19T14:03:27Z', netRevenue: 109 }],
}
// RICH = a day that also carries a family which DOES set spend/impressions/clicks/conversion_value.
// This is the shape behind the 16 production "spend" rejections; a lean-only fixture would miss it.
const shopRich = {
  ...shopLean,
  discountCodeCapture: [{ code: 'SAVE10', discountedAmount: 10.9, orders: 1 }],
  discountTypeCapture: [{ type: 'code', discountedAmount: 10.9, orders: 1, label: 'Code' }],
  abandonedCheckoutCount: 2, abandonedCheckoutValue: 250,
}
const wooDay = {
  totalRevenue: 82.44, totalOrders: 2, avgOrderValue: 41.22,
  productsCapture: [{ id: '1', name: 'C', revenue: 82.44, units: 2 }],
  variantsCapture: [{ id: '1:0', name: 'C', parentProductId: '1', revenue: 82.44, units: 2, sku: 'C' }],
  wooBreadth: {
    geoCountries: [{ value: 'US', netRevenue: 82.44, orders: 2 }], geoRegions: [{ value: 'US-TX', netRevenue: 82.44, orders: 2 }],
    geoCities: [{ value: 'US-TX-Austin', netRevenue: 82.44, orders: 2 }],
    paymentMethods: [{ value: 'Stripe', slug: 'stripe', netRevenue: 82.44, orders: 2 }],
    orderStatuses: [{ value: 'completed', orderValue: 82.44, orders: 2, isSale: true }],
    shippingMethods: [{ value: 'Flat', methodId: 'flat', shippingCharge: 5, orders: 2 }],
    couponCodes: [{ value: 'S5', discountAmount: 5, discountTax: 0, orders: 1 }],
    couponTypes: [{ value: 'fixed_cart', discountAmount: 5, orders: 1 }],
    orderTimes: [{ orderId: '1', createdAtUtc: '2026-07-16T18:00:00Z', rawGmt: 'g', rawSiteLocal: 'l', netRevenue: 82.44, gmtAvailable: true }],
  },
  wooProductCategoryCapture: [{ value: 'Cat', netRevenue: 82.44, units: 2, products: 1 }],
  wooProductTagCapture: [], wooProductAttrsCapturedAt: '2026-07-27T00:00:00Z',
}
const adsIntel = {
  totals: met(), campaigns: [{ id: 'c1', name: 'C1', metrics: met() }],
  adGroups: [{ id: 'g1', name: 'G1', campaignId: 'c1', metrics: met() }],
  ads: [{ id: 'a1', name: 'A1', adGroupId: 'g1', adSetId: 'g1', metrics: met() }],
  campaignPlacements: [{ campaignId: 'c1', campaignName: 'C1', placements: [{ publisher: 'facebook', position: 'feed', metrics: met() }] }],
}
const shopA = SH.buildShopifyMetricsRows(C, E, D, 'shop', shopLean), shopDA = SH.buildShopifyDepthRows(C, E, D, 'shop', shopLean)
const shopB = SH.buildShopifyMetricsRows(C, E, D, 'shop', shopRich), shopDB = SH.buildShopifyDepthRows(C, E, D, 'shop', shopRich)

// PAYLOAD = one array as handed to a single supabase .upsert(). Forward and backfill differ where the
// caller batches differently, so both are declared.
const PAYLOADS = [
  ['shopify', 'forward · account statement (cron/sync:319)', shopA],
  ['shopify', 'forward · depth statement, lean day (cron/sync:337)', shopDA],
  ['shopify', 'forward · depth statement, discount day (cron/sync:337)', shopDB],
  ['shopify', 'backfill · account+depth, lean day (shopify-dimensional-backfill:317)', [...shopA, ...shopDA]],
  ['shopify', 'backfill · account+depth, discount day (shopify-dimensional-backfill:317)', [...shopB, ...shopDB]],
  ['woocommerce', 'forward+backfill · one statement (cron/sync:976, woocommerce-backfill:280)', WOO.buildWooMetricsRows(C, E, D, 'https://s.test', wooDay)],
  ['meta', 'forward · account+campaign+adset+ad+placement (cron/sync)', META.buildMetaMetricsRows(C, E, D, 'act_1', 'A', adsIntel)],
  ['google', 'forward · account+campaign+ad_group+ad (cron/sync)', GOOG.buildGoogleMetricsRows(C, E, D, '123-456', 'G', adsIntel)],
  ['ga', 'forward · property account row (cron/sync)', GA.buildGaMetricsRows(C, E, D, 'prop', 'P', { sessions: 100, totalUsers: 80, newUsers: 40, conversions: 3, totalRevenue: 250, transactions: 3, engagementRate: 0.55 })],
]

// ── 4. the invariant ────────────────────────────────────────────────────────────────────────────────────
const splitCols = (rows) => {
  const keys = new Set(); rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)))
  return [...keys].filter((k) => { const h = rows.filter((r) => k in r).length; return h !== 0 && h !== rows.length })
}
const label = (r) => r.breakdown_type ? String(r.breakdown_type) : `${r.entity_level}/base`

const findings = [], info = []
let checked = 0
for (const [platform, where, raw] of PAYLOADS) {
  if (!Array.isArray(raw) || raw.length === 0) { findings.push({ platform, where, msg: 'builder produced NO rows — fixture or builder broke' }); continue }
  checked++
  const rawSplit = splitCols(raw).filter((c) => NOT_NULL.has(c))
  if (rawSplit.length) info.push(`${platform} · ${where} — relies on normalize for: ${rawSplit.join(', ')}`)
  const sent = NORM.normalizeMetricsRows(raw.map((r) => ({ ...r })))
  for (const col of splitCols(sent)) {
    if (!NOT_NULL.has(col)) continue // nullable → an explicit NULL is legal
    const missing = [...new Set(sent.filter((r) => !(col in r)).map(label))]
    findings.push({ platform, where, msg: `NOT-NULL column "${col}" present on ${sent.filter((r) => col in r).length}/${sent.length} rows — PostgREST sends explicit NULL → 23502 rejects the WHOLE statement. Missing on: ${missing.join(', ')}` })
  }
}
rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`\n✗ metrics-payload-uniformity guard FAILED — ${findings.length} payload violation(s)\n`)
  for (const f of findings) console.error(`  [${f.platform}] ${f.where}\n      ${f.msg}`)
  console.error('\n  FIX: give every row in the payload the same NOT-NULL keys (an explicit 0 is fine and equals the column default),')
  console.error('  or let src/lib/metrics-normalize.ts union-fill it. NEVER omit a key a sibling row in the same upsert supplies.\n')
  process.exit(1)
}
console.log(`✓ metrics-payload-uniformity: ${checked} payload shapes across 5 platforms, ${NOT_NULL.size} NOT-NULL columns, all uniform at the write boundary`)
if (info.length) { console.log('  (info — non-uniform BEFORE normalize, filled at the write boundary, not a defect:)'); for (const i of info) console.log(`    ${i}`) }
console.log(`  (exempt by nullability, not by name: ${NULLABLE.length} nullable columns incl. ${NULLABLE.slice(0, 3).join(', ')})`)
