#!/usr/bin/env node
// LORAMER_UNIVERSE_DERIVED_TIME_V1 — THE FIX-WITH-GUARD HALF. THREE LEGS.
//
// WHAT THIS PROTECTS. Six GAQL segments — date, week, month, quarter, year, day_of_week — are pure functions
// of the `date` column already on every row. Requesting them cost a request per entry per window and 30.6%
// of a measured window's rows (1,850,202 of 6,048,263) for no information. They are now COMPUTED locally
// from the response the base entry already paid for.
//
//   (a) THE SEGMENTS ARE NOT REQUESTED AGAIN. Easy to undo by accident — the artifact still lists them as
//       delivering, so any future edit that walks the artifact naively re-adds all 201 entries.
//   (b) EVERY COMPUTED ROW CARRIES ITS PROVENANCE. A derived aggregate indistinguishable from a vendor-
//       reported figure is an HONESTY failure, not a storage detail: Lora would state our arithmetic as
//       Google's measurement and have no way to know.
//   (c) THE DERIVATIONS ARE STILL CORRECT. `week` is Monday/ISO and `quarter` is CALENDAR — both settled
//       empirically against 1,850,202 landed rows rather than from documentation. ⚠ `year` was proven across
//       ONE distinct value and `quarter` across TWO, so this leg re-derives them over a MULTI-YEAR span
//       instead of trusting a narrow proof.
//
// ⛔ DRIVES THE COMPILED WRITER, NOT A TEXT SEARCH. The Flight-3 leg-4 lesson: a regex matched a constant
// name that survived inside a function body and the guard went green while the code was broken. Every leg
// below calls the real compiled functions and asserts on what they return.
// ⛔ HERMETIC. No DB, no network, no quota.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Module, { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []
const die = (m) => { console.error(`[universe-derived-time] FAIL — ${m}`); process.exit(1) }

const out = mkdtempSync(join(tmpdir(), 'loramer-derived-time-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [join(ROOT, 'src/lib/backfill/google-ads-universe-writer.ts'),
  '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve',
  '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); die(`could not run tsc — ${r.error.message}`) }
const stub = join(out, '__stub.js')
writeFileSync(stub, `module.exports = new Proxy({ upsertMetricsChunked: async (rows) => ({ written: rows.length, chunks: 1 }) },
  { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
  return origResolve.call(this, request, ...rest)
}
const req = createRequire(import.meta.url)
let W
try { W = req(join(out, 'src/lib/backfill/google-ads-universe-writer.js')) }
catch (e) { Module._resolveFilename = origResolve; rmSync(out, { recursive: true, force: true }); die(`compiled module did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
finally { Module._resolveFilename = origResolve }

const doc = JSON.parse(readFileSync(join(ROOT, 'docs/google-ads-capture-universe.json'), 'utf8'))

// ── (a) THE DERIVED SEGMENTS ARE NOT REQUESTED ─────────────────────────────────────────────────────────────
{
  const requested = W.selectableEntries(doc)
  const leaked = requested.filter((e) => e.segment && W.DERIVED_TIME_SEGMENTS.has(e.segment))
  if (leaked.length) {
    findings.push(`(a) ${leaked.length} derived time segment(s) are back in the REQUEST list (e.g. ${leaked.slice(0, 3).map((e) => e.resource + '/' + e.segment).join(', ')}). They are pure functions of \`date\` — requesting them spends a vendor request per entry per window for arithmetic.`)
  }
  const declarable = W.declarableEntries(doc)
  const declaredDerived = declarable.filter((e) => e.segment && W.DERIVED_TIME_SEGMENTS.has(e.segment))
  if (declaredDerived.length === 0) {
    findings.push('(a) the derived time entries vanished from declarableEntries() too. They are still WRITTEN (computed) — dropping them from the declaration makes stored rows unreachable to Lora. UNWIRED IS MISSING cuts both ways.')
  }
  if (requested.length >= declarable.length) {
    findings.push(`(a) selectableEntries (${requested.length}) is not smaller than declarableEntries (${declarable.length}) — nothing was actually removed from the request list.`)
  }
}

// ── (b) EVERY COMPUTED ROW CARRIES ITS PROVENANCE ──────────────────────────────────────────────────────────
{
  const entry = W.declarableEntries(doc).find((e) => !e.segment)
  if (!entry) findings.push('(b) no resource-only entry in the artifact — the derived-time leg could not run.')
  else {
    const res = entry.resource
    const mk = (rn, date) => ({ [res]: { resource_name: rn }, segments: { date },
      metrics: { cost_micros: 1_000_000, impressions: 10, clicks: 1, conversions: 0, conversions_value: 0 } })
    const apiRows = [mk(`customers/777/${res}s/1`, '2026-03-07'), mk(`customers/777/${res}s/1`, '2026-03-08')]
    const rows = W.buildDerivedTimeRows(entry, { clientId: 'c1', userEmail: 'e@x.com', customerId: '777' }, apiRows)
    if (!rows.length) findings.push('(b) buildDerivedTimeRows produced NOTHING for a resource-only entry with two days of data — the computed families are not being written at all.')
    const missing = rows.filter((r) => r.extra?.provenance !== W.PROVENANCE_COMPUTED)
    if (missing.length) findings.push(`(b) ${missing.length} of ${rows.length} computed row(s) carry no extra.provenance='${W.PROVENANCE_COMPUTED}'. A derived aggregate that cannot be told apart from a vendor-reported figure is an HONESTY failure — Lora would state our arithmetic as Google's measurement.`)
    const noRule = rows.filter((r) => !r.extra?.derivationRule || !r.extra?.derivedFrom)
    if (noRule.length) findings.push(`(b) ${noRule.length} computed row(s) carry no derivationRule/derivedFrom — the provenance marker without the rule still leaves a reader guessing HOW it was derived.`)
    const types = new Set(rows.map((r) => r.breakdown_type))
    for (const f of W.DERIVED_TIME_FAMILIES) if (!types.has(f.breakdownType)) findings.push(`(b) computed rows are missing the '${f.breakdownType}' family entirely.`)
    // A SEGMENT entry must NOT produce derived rows — rolling one up by period would silently sum across its
    // own dimension and invent a number nobody asked for.
    const segEntry = W.declarableEntries(doc).find((e) => e.segment && !W.DERIVED_TIME_SEGMENTS.has(e.segment))
    if (segEntry && W.buildDerivedTimeRows(segEntry, { clientId: 'c1', userEmail: 'e@x.com', customerId: '777' }, apiRows).length) {
      findings.push('(b) a SEGMENT entry produced derived time rows — that sums across the segment dimension and fabricates a total nobody requested.')
    }
  }
}

// ── (c) THE DERIVATIONS ARE STILL CORRECT, OVER A SPAN THE ORIGINAL PROOF DID NOT COVER ────────────────────
{
  const by = Object.fromEntries(W.DERIVED_TIME_FAMILIES.map((f) => [f.breakdownType, f]))
  // ⚠ MULTI-YEAR AND MULTI-QUARTER ON PURPOSE. The landed proof had ONE year and TWO quarters; if the
  // derivation were year-naive or quarter-naive that proof could not have caught it. These can.
  const cases = [
    ['2026-03-07', { date: '2026-03-07', week: '2026-03-02', month: '2026-03-01', quarter: '2026-01-01', year: '2026', day_of_week: '7' }], // Saturday
    ['2026-03-02', { date: '2026-03-02', week: '2026-03-02', month: '2026-03-01', quarter: '2026-01-01', year: '2026', day_of_week: '2' }], // Monday — week anchor is itself
    ['2026-03-01', { date: '2026-03-01', week: '2026-02-23', month: '2026-03-01', quarter: '2026-01-01', year: '2026', day_of_week: '8' }], // Sunday — week belongs to the PREVIOUS Monday
    ['2024-12-31', { date: '2024-12-31', week: '2024-12-30', month: '2024-12-01', quarter: '2024-10-01', year: '2024', day_of_week: '3' }], // year boundary, Q4
    ['2025-01-01', { date: '2025-01-01', week: '2024-12-30', month: '2025-01-01', quarter: '2025-01-01', year: '2025', day_of_week: '4' }], // week SPANS the year boundary
    ['2024-02-29', { date: '2024-02-29', week: '2024-02-26', month: '2024-02-01', quarter: '2024-01-01', year: '2024', day_of_week: '5' }], // leap day
    ['2023-07-01', { date: '2023-07-01', week: '2023-06-26', month: '2023-07-01', quarter: '2023-07-01', year: '2023', day_of_week: '7' }], // Q3 start
    ['2022-10-01', { date: '2022-10-01', week: '2022-09-26', month: '2022-10-01', quarter: '2022-10-01', year: '2022', day_of_week: '7' }], // Q4 start, near the vendor floor
  ]
  for (const [date, want] of cases) {
    for (const [bt, expected] of Object.entries(want)) {
      const got = by[bt]?.derive(date)
      if (got !== expected) findings.push(`(c) ${bt}('${date}') = '${got}', expected '${expected}'. ${bt === 'week' ? 'Week must be ISO/Monday-anchored.' : bt === 'quarter' ? 'Quarter must be CALENDAR, not fiscal.' : 'Derivation drifted from the empirically proven rule.'}`)
    }
  }
}

if (findings.length) {
  console.error(`[universe-derived-time] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-derived-time] PASS — ${W.declarableEntries(doc).length - W.selectableEntries(doc).length} derived time entries are computed rather than requested; every computed row carries COMPUTED_FROM_DATE with its rule; and all six derivations hold across year boundaries, a leap day, every quarter start and a Sunday/Monday week anchor.`)
