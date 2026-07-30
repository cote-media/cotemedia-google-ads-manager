#!/usr/bin/env node
// LORAMER_METRICS_UPSERT_CHUNKED_V1 — guard the CLASS, not today's instance.
//
// THE RULE: nothing writes metrics_daily with a bare `.from('metrics_daily').upsert(array)`. Every write goes
// through src/lib/metrics-upsert.ts → upsertMetricsChunked, which slices the payload so one statement cannot
// blow the 8s PostgREST ceiling, and which calls normalizeMetricsRows internally so the union-of-keys guard
// (LORAMER_SHOPIFY_DEPTH_NOTNULL_FIX_V1) cannot be skipped by a new caller.
//
// WHY A GUARD AND NOT A CONVENTION: the pattern lives in ~25 files. We fix files; we do not enforce rules.
// Collapsing to one source and guarding THAT is the settleRevenue / META_BREADTH_FORWARD shape — the only
// version of this that survives the next writer.
//
// THE ALLOWLIST IS A DEBT LEDGER, NOT PERMISSION. Flight 1 migrates exactly one call site (google-geo). Every
// other site is listed below by file:line and MUST still be a real call site — if a listed line no longer
// holds a bare metrics_daily upsert (migrated, moved, or deleted), the guard FAILS and demands the entry be
// removed. That is what stops the list rotting into a permanent exemption.
//
// HONEST LIMIT: this proves the CALL goes through the chunker. It cannot prove the chunk size is small enough
// for any given row shape — that needs a live timing against the 8s ceiling, which no static check can take.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SRC = path.join(ROOT, 'src')
const HELPER = 'src/lib/metrics-upsert.ts'

// Call sites NOT yet migrated. Flight 1 = google-geo only; every file here is FLIGHT 2 — pending.
//
// ⚠ KEYED BY FILE + COUNT, NOT file:line — AND THAT IS A CORRECTION, NOT A PREFERENCE. The first cut pinned
// line numbers. It was built from a DIRTY working tree (the uncommitted Google Tier-1 widen rewrites ~224
// lines of cron/sync and moves every upsert below it) so it read GREEN locally and RED against a clean
// checkout of the very commit it would ship in. Counting per file is immune to that drift and keeps the
// anti-rot property intact: the observed count must EQUAL the listed count, so paying a file's debt FAILS
// until the ledger is updated, and adding a new site FAILS immediately.
//
// ⚠ SECOND TRAP, also learned the hard way: a one-line grep finds ~half of these. This repo writes the call
// across two lines (`.from('metrics_daily')` then `.upsert(` on the next), so the scan uses a 4-line window.
// That is why the guard derives its own inventory instead of trusting a hand-written list.
//
// THE COUNTS DESCRIBE THE COMMITTED SHAPE: clean HEAD plus this flight (google-geo migrated to 0, so it is
// absent below). Total at HEAD = 53; after Flight 1 = 52 unmigrated + 1 in the helper.
const ALLOWLIST = {
  'src/app/api/cron/catchup/route.ts': 13,                  // FLIGHT 2 — pending
  'src/app/api/cron/sync/route.ts': 13,                     // FLIGHT 2 — pending
  // LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — 2 → 1. The RECOVER path's raw upsert is migrated to
  // upsertMetricsChunked (it now flushes per family, so the one-statement-per-window shape is gone). The remaining
  // site is the DRAIN path (runGaDimensionalBackfill), deliberately untouched: that is FLIGHT 2's blast radius, not
  // this flight's. Paying a file's debt FAILS this guard until the ledger is dropped — that is the anti-rot property
  // working as designed, not an obstacle.
  'src/lib/backfill/ga-dimensional-backfill.ts': 1,         // FLIGHT 2 — drain path only; recover path migrated
  'src/lib/backfill/google-adgroup-ad-backfill.ts': 1,      // FLIGHT 2 — pending
  'src/lib/backfill/google-campaign-backfill.ts': 1,        // FLIGHT 2 — pending
  'src/lib/backfill/google-demographic-backfill.ts': 1,     // FLIGHT 2 — pending
  'src/lib/backfill/google-device-backfill.ts': 1,          // FLIGHT 2 — pending
  'src/lib/backfill/google-dimensional-backfill.ts': 1,     // FLIGHT 2 — pending
  'src/lib/backfill/google-hour-backfill.ts': 1,            // FLIGHT 2 — pending
  'src/lib/backfill/meta-action-type-backfill.ts': 1,       // FLIGHT 2 — pending
  'src/lib/backfill/meta-adset-ad-backfill.ts': 1,          // FLIGHT 2 — pending
  'src/lib/backfill/meta-age-gender-backfill.ts': 1,        // FLIGHT 2 — pending
  'src/lib/backfill/meta-asset-backfill.ts': 1,             // FLIGHT 2 — pending
  'src/lib/backfill/meta-attribution-window-backfill.ts': 1, // FLIGHT 2 — pending
  'src/lib/backfill/meta-campaign-backfill.ts': 1,          // FLIGHT 2 — pending
  'src/lib/backfill/meta-device-backfill.ts': 1,            // FLIGHT 2 — pending
  'src/lib/backfill/meta-geo-backfill.ts': 1,               // FLIGHT 2 — pending
  'src/lib/backfill/meta-hour-backfill.ts': 1,              // FLIGHT 2 — pending
  'src/lib/backfill/meta-placement-backfill.ts': 1,         // FLIGHT 2 — pending
  'src/lib/backfill/meta-simple-breakdown-core.ts': 2,      // FLIGHT 2 — pending
  'src/lib/backfill/meta-video-backfill.ts': 1,             // FLIGHT 2 — pending
  'src/lib/backfill/run-backfill.ts': 1,                    // FLIGHT 2 — pending
  'src/lib/backfill/shopify-dimensional-backfill.ts': 2,    // FLIGHT 2 — pending
  'src/lib/backfill/woo-cohort-backfill.ts': 1,             // FLIGHT 2 — pending
  'src/lib/backfill/woocommerce-backfill.ts': 1,            // FLIGHT 2 — pending
}

const TABLE_RE = /from\(\s*(?:'metrics_daily'|"metrics_daily")\s*\)/
const UPSERT_RE = /\.upsert\(/
const LOOKAHEAD = 4 // .from(...) and .upsert( are often on separate lines in this repo

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const found = []
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_RE.test(lines[i])) continue
    if (!UPSERT_RE.test(lines.slice(i, i + LOOKAHEAD).join('\n'))) continue
    found.push(`${rel}:${i + 1}`)
  }
}

const findings = []
// Observed count per file, excluding the helper itself.
const observed = {}
for (const f of found) {
  const rel = f.slice(0, f.lastIndexOf(':'))
  if (rel === HELPER) continue
  observed[rel] = (observed[rel] || 0) + 1
}
for (const [rel, n] of Object.entries(observed)) {
  if (!(rel in ALLOWLIST)) {
    const lines = found.filter((f) => f.startsWith(rel + ':')).join(', ')
    findings.push(`UNCHUNKED metrics_daily upsert in ${rel} (${n} site(s): ${lines}) — route it through upsertMetricsChunked (${HELPER}).`)
  } else if (n > ALLOWLIST[rel]) {
    findings.push(`NEW UNCHUNKED site in ${rel} — allowlist says ${ALLOWLIST[rel]}, found ${n}. A new bare upsert was added; route it through ${HELPER}.`)
  }
}
// STALE check, file-existence-aware. An entry whose FILE is absent is skipped, not failed: one listed site
// lives in src/lib/backfill/forward-widen-breadth.ts, which is UNTRACKED held work (the Google Tier-1 widen on
// Russ's hold). That file does not exist on a clean checkout or on Vercel, so failing on its absence would
// brick the build for a debt that is not there. An entry whose file EXISTS but no longer holds a bare upsert
// is a real stale entry and FAILS — that is what stops the ledger rotting into permanent permission.
const absentFile = []
for (const [rel, want] of Object.entries(ALLOWLIST)) {
  const n = observed[rel] || 0
  if (n === want) continue
  if (!fs.existsSync(path.join(ROOT, rel))) { absentFile.push(rel); continue }
  findings.push(`STALE ALLOWLIST entry ${rel} — allowlist says ${want}, file now holds ${n}. Debt was paid; drop the count to ${n} (or remove the line at 0). The ledger may not outlive the debt.`)
}
if (!found.some((f) => f.startsWith(HELPER + ':'))) {
  findings.push(`${HELPER} does not contain a metrics_daily upsert — the shared writer is missing or was gutted.`)
}
// The helper must own the conflict key and must normalise inside, or callers can still skip the union guard.
const helperPath = path.join(ROOT, HELPER)
if (fs.existsSync(helperPath)) {
  const src = fs.readFileSync(helperPath, 'utf8')
  if (!/normalizeMetricsRows\(/.test(src)) findings.push(`${HELPER} does not call normalizeMetricsRows — the union-of-keys guard is skippable again.`)
  if (!/client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value/.test(src)) findings.push(`${HELPER} does not carry the 7-col conflict key.`)
  if (!/slice\(/.test(src)) findings.push(`${HELPER} does not slice the payload — it is not chunking.`)
} else {
  findings.push(`${HELPER} is missing.`)
}

console.log(`[metrics-upsert-chunked] scanned ${found.length} metrics_daily upsert call sites`)
console.log(`[metrics-upsert-chunked] chunked (in helper): ${found.filter((f) => f.startsWith(HELPER + ':')).length}`)
const allowTotal = Object.values(ALLOWLIST).reduce((a, b) => a + b, 0)
console.log(`[metrics-upsert-chunked] allowlisted FLIGHT 2 — pending: ${allowTotal} site(s) across ${Object.keys(ALLOWLIST).length} file(s)`)
for (const [rel, want] of Object.entries(ALLOWLIST)) console.log(`    ${want.toString().padStart(2)}  ${rel}`)
if (absentFile.length) console.log(`[metrics-upsert-chunked] allowlist files not present in this checkout (skipped): ${absentFile.join(', ')}`)
if (findings.length) {
  console.error(`\n[metrics-upsert-chunked] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  - ' + f)
  process.exit(1)
}
console.log('[metrics-upsert-chunked] PASS')
