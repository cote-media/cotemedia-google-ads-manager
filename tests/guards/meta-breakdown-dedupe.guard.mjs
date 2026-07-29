#!/usr/bin/env node
// LORAMER_META_BREAKDOWN_DEDUPE_V1 — guard the merge that stops a duplicate conflict key losing a whole day.
//
// WHAT IT PROVES: it drives the REAL exported dedupeBreakdownRows from meta-simple-breakdown-core.ts —
// transpiled with the installed tsc, not a re-implementation — over three synthetic groups whose correct
// answers are known, and asserts each branch independently.
//   (i)   SLICE PAIR, metrics differ  -> SUM. Fixture is the REAL production shape: The Escential Group
//         2026-04-29, campaign 6896654646797, "43340981010520, Amber Musk Fragrance",
//         0.08/4/0 + 4.93/106/5 -> 5.01/110/5.
//   (ii)  VERBATIM REPEAT            -> COLLAPSE to one, metrics UNCHANGED. Summing here would double-count
//         a pagination artifact (meta-graph-paged pushes j.data with no de-dup).
//   (iii) CLEAN SINGLETON            -> UNTOUCHED.
//   (iv)  RATIOS RECOMPUTED, NOT SUMMED — asserted as its own case, because a merge that summed ctr/cpc/cpm
//         would still pass every count-based check while shipping a plausible-looking wrong CPC. The
//         discriminator is arithmetic: summing the two input CTRs gives 4.717, recomputing from the merged
//         totals gives 4.5455. A guard that only checked "ctr exists" could not tell those apart.
//
// ⚠ HONEST LIMIT: this proves the MERGE. It does not prove Meta only ever produces the two shapes above —
// the verdict that these are distinct slices rests on one read-only call (act_1993803118152438, 2026-04-29),
// documented in the core's header. If a third shape appears, this guard will not know.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[meta-breakdown-dedupe] FAIL — ${m}`); process.exit(1) }

const CORE = 'src/lib/backfill/meta-simple-breakdown-core.ts'
if (!existsSync(resolve(ROOT, CORE))) fail(`${CORE} is missing.`)

const SRC = [CORE, 'src/lib/metrics-normalize.ts', 'src/lib/backfill/meta-graph-paged.ts', 'src/lib/backfill/reconcile-day.ts']
const out = mkdtempSync(join(tmpdir(), 'loramer-dedupe-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [...SRC.map((f) => resolve(ROOT, f)), '--target', 'es2020', '--module', 'commonjs',
  '--moduleResolution', 'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

// The core imports '@/lib/supabase' at module scope. dedupeBreakdownRows never touches it, but the require
// would throw on load, so the alias is redirected to a stub. Stubbing is confined to state that cannot exist
// without a DB — the merge itself is the REAL compiled function.
const stub = join(out, '__supabase_stub.js')
writeFileSync(stub, 'module.exports = { supabaseAdmin: {} }\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === '@/lib/supabase') return stub
  if (request === '@/lib/metrics-normalize') return join(out, 'src/lib/metrics-normalize.js')
  return origResolve.call(this, request, ...rest)
}

const req = createRequire(import.meta.url)
let core
try { core = req(join(out, 'src/lib/backfill/meta-simple-breakdown-core.js')) }
catch (e) { rmSync(out, { recursive: true, force: true }); fail(`compiled core did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }

if (typeof core.dedupeBreakdownRows !== 'function') {
  rmSync(out, { recursive: true, force: true })
  fail(`${CORE} does not export dedupeBreakdownRows — the merge is missing, so a duplicate conflict key still rejects the whole day's statement.`)
}

const base = (over) => ({
  client_id: 'guard-client', user_email: 'guard@loramer.test', platform: 'meta', account_id: 'act_1',
  entity_level: 'campaign', entity_id: '6896654646797', entity_name: "Sales - April '26",
  parent_entity_id: 'act_1', date: '2026-04-29', breakdown_type: 'product_id',
  conversions: 0, conversion_value: 0, revenue: 0,
  extra: { metaBreakdown: 'product_id', anchorMode: 'none' }, ...over,
})
const ratio = (a, b, s = 1) => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)
const AMBER = '43340981010520, Amber Musk Fragrance'

const input = [
  // (i) slice pair — the real 2026-04-29 shape
  base({ breakdown_value: AMBER, spend: 0.08, impressions: 4, clicks: 0, extra: { metaBreakdown: 'product_id', anchorMode: 'none', ctr: ratio(0, 4, 100), cpc: ratio(0.08, 0), cpm: ratio(0.08, 4, 1000) } }),
  base({ breakdown_value: AMBER, spend: 4.93, impressions: 106, clicks: 5, extra: { metaBreakdown: 'product_id', anchorMode: 'none', ctr: ratio(5, 106, 100), cpc: ratio(4.93, 5), cpm: ratio(4.93, 106, 1000) } }),
  // (ii) verbatim repeat
  base({ breakdown_value: 'REPEAT-1', spend: 2.5, impressions: 50, clicks: 2 }),
  base({ breakdown_value: 'REPEAT-1', spend: 2.5, impressions: 50, clicks: 2 }),
  // (iii) clean singleton
  base({ breakdown_value: 'SINGLE-1', spend: 1.23, impressions: 10, clicks: 1 }),
]
const { rows, log } = core.dedupeBreakdownRows(input)

const by = (v) => rows.filter((x) => x.breakdown_value === v)
const amber = by(AMBER), repeat = by('REPEAT-1'), single = by('SINGLE-1')

if (rows.length !== 3) findings.push(`expected 3 merged rows from 5 input rows, got ${rows.length}`)

// (i) SLICE SUM
if (amber.length !== 1) findings.push(`slice pair did not merge to one row (got ${amber.length})`)
else {
  const a = amber[0]
  if (Number(a.spend) !== 5.01) findings.push(`slice-sum spend expected 5.01, got ${a.spend} — last-wins would give 4.93`)
  if (Number(a.impressions) !== 110) findings.push(`slice-sum impressions expected 110, got ${a.impressions}`)
  if (Number(a.clicks) !== 5) findings.push(`slice-sum clicks expected 5, got ${a.clicks}`)
  // (iv) RATIOS RECOMPUTED, NOT SUMMED
  const wantCtr = ratio(5, 110, 100), wantCpc = ratio(5.01, 5), wantCpm = ratio(5.01, 110, 1000)
  const summedCtr = Number((ratio(0, 4, 100) + ratio(5, 106, 100)).toFixed(4))
  if (a.extra?.ctr !== wantCtr) findings.push(`ctr expected ${wantCtr} (recomputed from merged totals), got ${a.extra?.ctr}`)
  if (a.extra?.ctr === summedCtr) findings.push(`ctr equals the SUM of the input ctrs (${summedCtr}) — ratios are being summed, not recomputed`)
  if (a.extra?.cpc !== wantCpc) findings.push(`cpc expected ${wantCpc}, got ${a.extra?.cpc}`)
  if (a.extra?.cpm !== wantCpm) findings.push(`cpm expected ${wantCpm}, got ${a.extra?.cpm}`)
  if (a.extra?.metaBreakdown !== 'product_id' || a.extra?.anchorMode !== 'none') findings.push('non-derivable extra fields were lost in the merge')
}
// (ii) VERBATIM COLLAPSE
if (repeat.length !== 1) findings.push(`verbatim repeat did not collapse to one row (got ${repeat.length})`)
else {
  const p = repeat[0]
  if (Number(p.spend) !== 2.5) findings.push(`verbatim repeat spend expected 2.5 (collapse), got ${p.spend} — a sum here DOUBLE-COUNTS a pagination artifact`)
  if (Number(p.impressions) !== 50) findings.push(`verbatim repeat impressions expected 50, got ${p.impressions}`)
  if (Number(p.clicks) !== 2) findings.push(`verbatim repeat clicks expected 2, got ${p.clicks}`)
}
// (iii) SINGLETON UNTOUCHED
if (single.length !== 1) findings.push(`singleton missing (got ${single.length})`)
else if (Number(single[0].spend) !== 1.23 || Number(single[0].impressions) !== 10 || Number(single[0].clicks) !== 1) {
  findings.push('clean singleton was altered by the merge')
}
// LOG: both branches must be reported, or the class goes quiet again.
const branches = log.map((e) => e.branch).sort()
if (log.length !== 2) findings.push(`expected 2 log entries (one per merged group), got ${log.length}`)
if (!(branches.includes('slice-sum') && branches.includes('repeat-collapse'))) findings.push(`log must name both branches, got ${JSON.stringify(branches)}`)

rmSync(out, { recursive: true, force: true })
Module._resolveFilename = origResolve

console.log(`[meta-breakdown-dedupe] drove the REAL dedupeBreakdownRows over 5 rows -> ${rows.length} merged, ${log.length} merge(s) logged`)
if (findings.length) {
  console.error(`\n[meta-breakdown-dedupe] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  - ' + f)
  process.exit(1)
}
console.log('[meta-breakdown-dedupe] PASS — slice-sum, verbatim-collapse, singleton untouched, ratios recomputed not summed.')
