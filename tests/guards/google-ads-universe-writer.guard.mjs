#!/usr/bin/env node
// LORAMER_GOOGLE_ADS_UNIVERSE_WRITER_V1 — GUARD. THREE LEGS.
//
//  (a) NO CLOCK CAN SEAL A WALK. The existing drain seals on `subStart <= floor36()` — a line 36 months before
//      the day the lap runs — and that produced 214 cursors reading backfill_complete=true while Google still
//      served years more. On this path, completion is decided ONLY by the vendor returning zero rows. Asserted
//      BEHAVIOURALLY (drive decideVendorExhaustion) AND structurally (no floor36/Date/month arithmetic).
//  (b) NO PER-SURFACE BRANCHING. The surface list comes from the artifact and nowhere else. Asserted by
//      matching resource names from the artifact against the writer's source: if the writer names a surface,
//      it has stopped being generic.
//  (c) AN UNSATISFIABLE structuralRequirement IS RECORDED, NEVER SILENTLY DROPPED. Driven against the real
//      compiled function with a requirement whose filter is not supplied.
//
// ⛔ WHAT THIS DOES NOT ASSERT: that the GAQL is accepted by Google, that the rows are correct, or that the
// artifact's `delivers` values are still true. Those need the vendor. Gate-A on real rows is the report's job.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[google-ads-universe-writer] FAIL — ${m}`); process.exit(1) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }

const SRC = 'src/lib/backfill/google-ads-universe-writer.ts'
const ART = 'docs/google-ads-capture-universe.json'
for (const f of [SRC, ART]) if (!existsSync(resolve(ROOT, f))) fail(`${f} is missing — the guard cannot see its subject, and that is not a pass.`)

// ⛔ STRIP COMMENTS FIRST. Bitten three times on 2026-08-02/03: the fix comments NAME the things they removed
// ("floor36() is NOT imported here"), and a raw-text scan reads the explanation as the code.
const raw = read(SRC)
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

// ── LEG (a) · STRUCTURAL: no clock reachable ──────────────────────────────────────────────────────────────
for (const [pat, why] of [
  [/\bfloor36\b/, 'imports or calls floor36() — the 36-month clock that produced 214 false completes'],
  [/new Date\(/, 'constructs a Date — a walk on this path may not consult a clock at all'],
  [/setUTCMonth|setMonth|setFullYear/, 'does month/year arithmetic, which is how a clock-derived floor gets rebuilt by hand'],
  [/Date\.now\(/, 'reads Date.now()'],
]) {
  if (pat.test(code)) findings.push(`(a) ${SRC} ${why}. COMPLETE MEANS VENDOR-EXHAUSTED: the only input that may end a walk is the vendor returning zero rows.`)
}

// ── LEG (b) · STRUCTURAL: no per-surface branching ────────────────────────────────────────────────────────
{
  const art = JSON.parse(read(ART))
  const resources = [...new Set(art.entries.map((e) => e.resource))]
  if (resources.length < 50) findings.push(`(b) the artifact lists only ${resources.length} resources — that is not the catalog, and leg (b) would be comparing against a stub.`)
  const named = resources.filter((r) => new RegExp(`['"\`]${r}['"\`]`).test(code))
  if (named.length) {
    findings.push(`(b) ${SRC} NAMES ${named.length} surface(s) from the artifact as string literals: ${named.slice(0, 6).join(', ')}. The surface list must come ONLY from docs/google-ads-capture-universe.json — a name in the code is a per-surface branch waiting to happen, and 24 hand-written writers is how 24 surfaces went uncaptured.`)
  }
  if (/switch\s*\(/.test(code)) findings.push(`(b) ${SRC} contains a switch statement. Adding a surface must be a DATA change, never a code change.`)
  if (!/readFileSync|loadUniverse/.test(code)) findings.push(`(b) ${SRC} never reads the artifact — a writer that does not load the universe cannot be driven by it.`)
}

// ── LEGS (a)+(c) · BEHAVIOURAL: drive the REAL compiled module ────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-universe-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
  '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }
const stub = join(out, '__stub.js')
writeFileSync(stub, `module.exports = new Proxy({ upsertMetricsChunked: async (rows) => ({ written: rows.length, chunks: 1 }) },
  { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
  return origResolve.call(this, request, ...rest)
}
const req = createRequire(import.meta.url)
let mod
try { mod = req(join(out, 'src/lib/backfill/google-ads-universe-writer.js')) }
catch (e) { Module._resolveFilename = origResolve; rmSync(out, { recursive: true, force: true }); fail(`compiled module did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }

// (a) BEHAVIOURAL — a walk with rows continues; a walk with zero rows completes, and carries its proof.
{
  const going = mod.decideVendorExhaustion({ windowStart: '2019-01-01', rowsReturned: 7, gaql: 'SELECT x' })
  if (going.complete) findings.push(`(a) decideVendorExhaustion declared COMPLETE while the vendor returned 7 rows at 2019-01-01 — a date 36 months before today would seal here under the old rule, and that is exactly the bug.`)
  const done = mod.decideVendorExhaustion({ windowStart: '2019-01-01', rowsReturned: 0, gaql: 'SELECT y' })
  if (!done.complete) findings.push(`(a) decideVendorExhaustion did NOT complete on a genuine vendor zero — the walk would never end.`)
  if (done.exhaustedBelow !== '2019-01-01') findings.push(`(a) completion did not record the date the vendor was exhausted below (got ${JSON.stringify(done.exhaustedBelow)}).`)
  if (!/0 rows/.test(done.proof || '')) findings.push(`(a) completion carries no PROOF string. A boolean with no evidence is a claim, and the 214 false completes were all booleans with no evidence.`)
}

// (c) BEHAVIOURAL — an unsatisfiable structural requirement is RECORDED.
let cResult = null
if (!findings.some((f) => f.startsWith('(a) decideVendorExhaustion'))) {
  cResult = await mod.captureUniverseEntry({
    entry: { resource: 'final_url_expansion_asset_view', segment: null, structuralRequirement: 'campaign.id = <id> AND campaign.advertising_channel_type = PERFORMANCE_MAX', delivers: true },
    ctx: { clientId: 'c', userEmail: 'e', customerId: '1' },
    startDate: '2026-03-01', endDate: '2026-03-31',
    query: async () => { throw new Error('THE QUERY MUST NOT RUN — the entry is unsatisfiable and must be skipped BEFORE any request is spent') },
    supplied: {}, dryRun: true,
  })
  if (!cResult.skipped) findings.push(`(c) an entry with an UNSATISFIABLE structuralRequirement was not recorded as skipped (skipped=${JSON.stringify(cResult.skipped)}). A surface nobody asked for and nobody logged is indistinguishable from one that returned nothing — which is how 24 surfaces went unnoticed.`)
  else if (!cResult.skipped.recorded) findings.push(`(c) the skip was produced but not marked recorded.`)
  else if (!/unsatisfied/.test(cResult.skipped.requirement)) findings.push(`(c) the skip does not name WHICH filter was missing — an unnamed skip cannot be acted on.`)
  if (cResult.gaql !== null) findings.push(`(c) a GAQL was built for an unsatisfiable entry — the request would have been spent before the skip.`)

  // AND THE SATISFIED CASE STILL RUNS — otherwise leg (c) could pass by skipping everything.
  const okRes = await mod.captureUniverseEntry({
    entry: { resource: 'final_url_expansion_asset_view', segment: null, structuralRequirement: 'campaign.id = <id> AND campaign.advertising_channel_type = PERFORMANCE_MAX', delivers: true },
    ctx: { clientId: 'c', userEmail: 'e', customerId: '1' },
    startDate: '2026-03-01', endDate: '2026-03-31',
    query: async (g) => (/campaign\.id = 123/.test(g) && /PERFORMANCE_MAX/.test(g) ? [{ segments: { date: '2026-03-01' }, metrics: { impressions: 5, cost_micros: 1000000 } }] : []),
    supplied: { 'campaign.id': '123', 'campaign.advertising_channel_type': 'PERFORMANCE_MAX' }, dryRun: true,
  })
  if (okRes.skipped) findings.push(`(c) a SATISFIABLE structural requirement was skipped — leg (c) would then pass by refusing everything.`)
  if (okRes.apiRows !== 1) findings.push(`(c) the satisfied entry did not reach the vendor with both filters (apiRows=${okRes.apiRows}).`)

  // ZERO IS A FACT — a surface that returns nothing must be RECORDED as an observed zero.
  const zero = await mod.captureUniverseEntry({
    entry: { resource: 'topic_view', segment: null, delivers: true },
    ctx: { clientId: 'c', userEmail: 'e', customerId: '1' },
    startDate: '2026-03-01', endDate: '2026-03-31', query: async () => [], dryRun: true,
  })
  if (!zero.observedZero) findings.push(`(c) a vendor zero was not recorded as observedZero. "We asked and there was nothing" must stay distinguishable from "nobody asked".`)
}

Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`[google-ads-universe-writer] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[google-ads-universe-writer] PASS — no clock is reachable (no floor36, no Date, no month arithmetic; completion driven only by a vendor zero and carrying its proof); the writer names ZERO of the artifact's surfaces and contains no switch; an unsatisfiable structural requirement is recorded before a request is spent, a satisfiable one still runs, and a vendor zero is recorded as a fact. ⛔ NOT ASSERTED: that Google accepts the GAQL or that the artifact's delivers values are still true — those need the vendor.`)
