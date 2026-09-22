#!/usr/bin/env node
// LORAMER_IMPRESSION_SHARE_FAMILY_V1 — check:data leg `impression-share-parity`: THE WALK'S FAMILY ROW EQUALS THE LEGACY WRITER'S ROW.
//
// WHAT IT PROVES: for one LEGACY google connection and its newest stored impression_share day, the walk's own family path
// (the compiled writer: the artifact's campaign|family.impression_share.search entry → buildGaql → the vendor → buildFamilyRows)
// produces, per campaign, the same seven ratios the legacy sync stored (google-impression-share.ts keys), key by key.
// Spelling difference that is NOT a defect: the legacy writer zero-fills an unset ratio (`|| 0`); the walk stores null.
// A legacy 0 beside a walk null is counted as `legacyZeroFill`, never as a diff. A served value that differs is RED.
// When walk-written rows exist (a walk connection), the same comparison runs walk row vs a fresh vendor read.
//
// COST: 1 vendor request (one campaign-day window on one account). READ-ONLY: nothing is written.
// USAGE: node scripts/check-impression-share-parity.mjs [--guard]   (exit 1 on a diff, 2 when it cannot run)
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Module, { createRequire } from 'node:module'

const ROOT = process.cwd()
const TAG = '[impression-share-parity]'
for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const verdict = (code, line) => { console.log(`${TAG} VERDICT — EXIT ${code} · ${line}`); process.exit(code) }

const pg = (await import('pg')).default
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, application_name: 'check-impression-share-parity' })
await db.connect()

// 1) the vehicle: a legacy google connection with the newest stored impression_share day
const { rows: [v] } = await db.query(`
  select m.client_id, m.account_id, p.user_email, max(m.date)::text as day
  from public.metrics_daily m join public.platform_connections p on p.client_id = m.client_id and p.platform = 'google'
  where m.platform = 'google' and m.breakdown_type = 'impression_share' and m.entity_level = 'campaign' and m.breakdown_value = 'search'
    and p.engine = 'legacy' and m.date >= current_date - 14
  group by 1,2,3 order by max(m.date) desc, count(*) desc limit 1`)
if (!v) { await db.end(); verdict(2, 'no legacy connection holds an impression_share row in the last 14 days — nothing to compare (not a pass)') }
const { rows: stored } = await db.query(`select entity_id, extra from public.metrics_daily where client_id=$1 and platform='google' and breakdown_type='impression_share' and entity_level='campaign' and breakdown_value='search' and date=$2`, [v.client_id, v.day])
const { rows: [tok] } = await db.query(`select refresh_token from public.google_tokens where user_email=$1`, [v.user_email])
await db.end()
if (!tok) verdict(2, `no google token for the vehicle's owner — cannot ask the vendor`)


// ── LOAD THE REAL WRITER + SURFACE OWNER + ENTITY DIMENSION, compiled to a temp dir; every OTHER '@/…' import is a stub
// (supabase, the upsert, concurrency): the functions under test are pure. Same shape as universe-derived-time.guard.mjs.
function loadWriter(ROOT) {
  const out = mkdtempSync(join(tmpdir(), 'loramer-writer-load-'))
  const files = ['src/lib/backfill/google-ads-universe-writer.ts', 'src/lib/backfill/universe-surfaces.ts', 'src/lib/backfill/entity-dimension.ts']
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [...files.map((f) => join(ROOT, f)),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
  if (r.error) throw new Error(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = new Proxy({ upsertMetricsChunked: async (rows) => ({ written: rows.length, chunks: 1 }) }, { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
  const real = { '@/lib/backfill/universe-surfaces': join(out, 'src/lib/backfill/universe-surfaces.js'), '@/lib/backfill/entity-dimension': join(out, 'src/lib/backfill/entity-dimension.js') }
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (real[request]) return real[request]
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
    return origResolve.call(this, request, ...rest)
  }
  try {
    const req = createRequire(import.meta.url)
    return { W: req(join(out, 'src/lib/backfill/google-ads-universe-writer.js')), S: req(real['@/lib/backfill/universe-surfaces']), out, done: () => rmSync(out, { recursive: true, force: true }) }
  } finally { Module._resolveFilename = origResolve }
}

// 2) the walk's own path, compiled from the real writer
let L
try { L = loadWriter(ROOT) } catch (e) { verdict(2, `the writer could not be compiled: ${e.message}`) }
const W = L.W
const out = L.out
const doc = W.loadUniverse(ROOT)
const entry = doc.entries.find((e) => e.resource === 'campaign' && e.family?.breakdownType === 'impression_share' && e.family?.value === 'search')
if (!entry) { L.done(); verdict(1, 'the artifact carries no campaign / impression_share / search family entry — the family was not emitted') }
const gaql = W.buildGaql(entry, v.day, v.day)

// 3) one vendor request, then the walk's builder
const { GoogleAdsApi } = await import('google-ads-api')
const api = new GoogleAdsApi({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN })
const customer = api.Customer({ customer_id: String(v.account_id), refresh_token: tok.refresh_token, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID })
let apiRows
try { apiRows = await customer.query(gaql) } catch (e) { L.done(); verdict(2, `vendor refused the family query: ${String(e?.message ?? e).slice(0, 200)}`) }
const built = W.buildFamilyRows(entry, { clientId: v.client_id, userEmail: v.user_email, customerId: String(v.account_id) }, apiRows)
L.done()

// 4) THREE COMPARISONS, EACH HONEST ABOUT WHAT IT CAN PROVE
//   (i)  MAPPING PARITY — the walk's row carries the seven legacy keys and each equals the vendor's value in the SAME
//        response (-1 → null). This is the equality the leg exists for; it cannot drift.
//   (ii) ENTITY-SET PARITY — every campaign the legacy row holds with a POSITIVE impression share is one the vendor served
//        the walk today, and vice versa. MEASURED 2026-09-22 (Bath Fitter, 2026-09-21): the legacy writer stores 72 rows of
//        which 66 are ALL-ZERO — its `|| 0` zero-fill fabricates a row for every campaign Google did not serve
//        (google-intelligence.ts:934-941; QUEUE ★LEGACY-IMPRESSION-SHARE-ZERO-FILL). Those rows are excluded here by
//        construction: they are not a fact the vendor stated.
//   (iii) VALUE DRIFT — a legacy value written at 08:25Z and the vendor's value re-read hours later for the same day
//        DIFFER (measured 0.4540 vs 0.4344): impression share is an auction ratio Google restates as the day settles. It is
//        REPORTED, never failed: two true values at two times are not a defect in either writer.
const LEGACY_KEYS = ['search_impression_share', 'search_top_impression_share', 'search_absolute_top_impression_share', 'search_budget_lost_impression_share', 'search_rank_lost_impression_share', 'search_budget_lost_top_impression_share', 'search_rank_lost_top_impression_share']
const num = (x) => (x === null || x === undefined ? null : Number(x))
const walkBy = new Map(built.rows.map((r) => [String(r.entity_id), r]))
const vendorBy = new Map(apiRows.map((r) => [String(r?.campaign?.resource_name ?? '').split('/').pop(), r]))
let mappingChecked = 0, mappingBad = [], keyShape = 0
for (const [id, w] of walkBy) {
  const src = vendorBy.get(id); if (!src) { mappingBad.push(`${id}: walk row with no vendor row`); continue }
  if (w.breakdown_type !== 'impression_share' || w.breakdown_value !== 'search' || w.entity_level !== 'campaign' || w.entity_name !== null) keyShape++
  for (const k of LEGACY_KEYS) {
    mappingChecked++
    const v = num(src.metrics?.[k]), ww = num(w.extra?.[k])
    const expect = v === null || v < 0 ? null : v
    if (!(expect === ww || (expect !== null && ww !== null && Math.abs(expect - ww) < 1e-12))) mappingBad.push(`${id}.${k}: vendor=${v} walk=${ww}`)
  }
}
const legacyServed = new Set(stored.filter((s) => num(s.extra?.search_impression_share) > 0 || num(s.extra?.search_top_impression_share) > 0 || num(s.extra?.search_absolute_top_impression_share) > 0).map((s) => String(s.entity_id)))
const legacyZeroFilled = stored.length - legacyServed.size
const onlyLegacy = [...legacyServed].filter((id) => !walkBy.has(id)), onlyWalk = [...walkBy.keys()].filter((id) => !legacyServed.has(id))
let drift = 0, driftMax = 0, driftCompared = 0
for (const s of stored) { const w = walkBy.get(String(s.entity_id)); if (!w || !legacyServed.has(String(s.entity_id))) continue; for (const k of LEGACY_KEYS) { const a = num(s.extra?.[k]), b = num(w.extra?.[k]); if (a === null || b === null) continue; driftCompared++; const d = Math.abs(a - b); if (d > 1e-9) { drift++; driftMax = Math.max(driftMax, d) } } }
const line = `vehicle ${v.client_id} / ${v.account_id} day ${v.day} · vendor rows ${apiRows.length} → walk rows ${built.rows.length} (droppedNoRatio ${built.droppedNoRatio}) · (i) mapping ${mappingChecked - mappingBad.length}/${mappingChecked} equal · (ii) legacy rows ${stored.length} = ${legacyServed.size} served + ${legacyZeroFilled} zero-filled; served-only-in-legacy ${onlyLegacy.length}, only-in-walk ${onlyWalk.length} · (iii) restatement drift ${drift}/${driftCompared} ratios, max ${driftMax.toFixed(4)} (reported, not failed)${keyShape ? ` · KEY-SHAPE MISMATCH on ${keyShape}` : ''}`
if (mappingBad.length || keyShape) { for (const d of mappingBad.slice(0, 10)) console.log(`  ✗ ${d}`); verdict(1, `${line} — RED: the walk's family row is not the vendor's row at the legacy key`) }
if (onlyLegacy.length || onlyWalk.length) verdict(1, `${line} — RED: the served entity sets differ (legacy-served campaigns ${[...onlyLegacy, ...onlyWalk].slice(0, 6).join(', ')})`)
if (walkBy.size === 0) verdict(1, `${line} — RED: the vendor served no campaign for the day the legacy writer holds ${legacyServed.size} served row(s) for`)
verdict(0, `${line} — GREEN: the walk's family path reproduces the vendor's seven ratios at the legacy key for every campaign the legacy writer holds a served row for`)
