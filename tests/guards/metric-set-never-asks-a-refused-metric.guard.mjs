#!/usr/bin/env node
// LORAMER_METRIC_SET_HONOURS_REFUSAL_V1 — AN ENTRY THAT RECORDS A REFUSAL MAY NEVER BE ASKED FOR THE
// METRIC IT RECORDS AS REFUSED.
//
// ⛔ THE DEFECT, DIAGNOSED 2026-08-25 AND CONFIRMED AGAINST THE VENDOR. Two catalogue entries —
// detail_content_suitability_placement_view and group_content_suitability_placement_view — carry
// `metricCount: 1` and `servesMetrics: []`. The probe wrote `[]` to mean "MEASURED: none of our five
// metrics work here". `buildGaql` reads it through `entry.servesMetrics && entry.servesMetrics.length`,
// so an empty array is FALSY and it falls through to DEFAULT_METRICS — the exact five the probe had
// just proven were refused. Every window then returned:
//   {"query_error":49} Cannot select or filter on the following metrics: 'clicks'(could not support
//   requested resources: 'DETAIL_CONTENT_SUITABILITY_PLACEMENT_VIEW'), 'conversions'(…), …
// 73 and 71 error attempts. The refusals were then promoted into a `vendor refusal wall 2026-08-06`
// by composeWalkStop, the anchor sat below it, and BOTH SURFACES SEALED as floor_stop — permanently
// excluded from the scan on the strength of our own malformed SELECT clause.
//
// ⛔ WHAT WAS ACTUALLY THERE. Asked correctly (impressions only), March 2026, Foam OH:
//   detail_content_suitability_placement_view  86,005 rows · 31 of 31 days · 2,000,260 impressions
//   group_content_suitability_placement_view   77,052 rows · 31 of 31 days · 2,200,882 impressions
// 4.2 million impressions recorded as an unwalkable wall.
//
// ⛔ WHY A GUARD AND NOT JUST A DATA FIX. The artifact is GENERATED. A re-probe that hits the same
// vendor refusal writes `[]` again, and without this guard the fault returns silently and seals the
// surfaces a second time. The data fix stops today's bleeding; this stops the recurrence.
//
// BEHAVIOURAL: it drives the REAL transpiled buildGaql against the REAL artifact. A guard that greps
// the JSON proves nothing about the string that reaches Google.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SRC = 'src/lib/backfill/google-ads-universe-writer.ts'
const ART = 'docs/google-ads-capture-universe.json'
const findings = []
const die = (m) => { console.error(`[metric-set-refusal] CANNOT RUN — ${m}`); process.exit(1) }

for (const f of [SRC, ART]) if (!existsSync(resolve(ROOT, f))) die(`${f} is missing`)

const out = mkdtempSync(join(tmpdir(), 'loramer-metric-set-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs',
  '--moduleResolution', 'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); die(`could not run tsc — ${r.error.message}`) }
const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = new Proxy({}, { get: () => (() => {}) })')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) return stub
  return origResolve.call(this, request, ...rest)
}
let mod
try { mod = createRequire(import.meta.url)(join(out, 'src/lib/backfill/google-ads-universe-writer.js')) }
catch (e) { Module._resolveFilename = origResolve; rmSync(out, { recursive: true, force: true }); die(`compiled writer did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })

const buildGaql = mod.buildGaql
if (typeof buildGaql !== 'function') die(`${SRC} does not export buildGaql()`)

const doc = JSON.parse(readFileSync(resolve(ROOT, ART), 'utf8'))
const entries = doc.entries || []
if (!entries.length) die(`${ART} has no entries`)

// ── (a) NO ENTRY MAY BE ASKED FOR A METRIC IT RECORDS AS REFUSED ────────────────────────────────────
let checked = 0
for (const e of entries) {
  const refused = e.refusesMetrics
  if (!Array.isArray(refused) || refused.length === 0) continue
  checked++
  const gaql = buildGaql(e, '2026-03-01', '2026-03-31')
  const asked = refused.filter((m) => gaql.includes(m))
  if (asked.length) {
    findings.push({
      what: `${e.resource}${e.segment ? ' / ' + e.segment : ''} is asked for ${asked.length} metric(s) it records as REFUSED`,
      detail: `refused: ${refused.join(', ')}\n      asked anyway: ${asked.join(', ')}\n      servesMetrics: ${JSON.stringify(e.servesMetrics)} · metricShape: ${JSON.stringify(e.metricShape ?? null)} · metricCount: ${e.metricCount ?? '(absent)'}\n      GAQL: ${gaql.replace(/\s+/g, ' ').slice(0, 220)}`,
    })
  }
}

// ── (b) A RECORDED EMPTY servesMetrics MUST NEVER RESOLVE TO THE DEFAULT FIVE ───────────────────────
// `[]` is a MEASURED NEGATIVE. Whatever the writer does with it, asking the five that were just
// refused is the one answer that cannot be right.
for (const e of entries) {
  if (!Array.isArray(e.servesMetrics) || e.servesMetrics.length !== 0) continue
  let gaql = null
  try { gaql = buildGaql(e, '2026-03-01', '2026-03-31') } catch { continue } // a throw IS an acceptable answer
  if (gaql === null) continue
  const five = ['metrics.cost_micros', 'metrics.impressions', 'metrics.clicks', 'metrics.conversions', 'metrics.conversions_value']
  const askedAll = five.every((m) => gaql.includes(m))
  if (askedAll) {
    findings.push({
      what: `${e.resource}${e.segment ? ' / ' + e.segment : ''} records servesMetrics: [] (MEASURED: none work) and is asked for all five anyway`,
      detail: `an empty measured set is being read as "no information". GAQL: ${gaql.replace(/\s+/g, ' ').slice(0, 220)}`,
    })
  }
}

if (findings.length === 0) {
  console.log(`metric-set-refusal: PASSED — ${checked} entr(y/ies) record refusals and none is asked for a refused metric; no recorded-empty metric set resolves to the default five.`)
  process.exit(0)
}
console.error(`metric-set-refusal: FAILED — ${findings.length} finding(s)\n`)
for (const f of findings) console.error(`  ✗ ${f.what}\n      ${f.detail}\n`)
process.exit(1)
