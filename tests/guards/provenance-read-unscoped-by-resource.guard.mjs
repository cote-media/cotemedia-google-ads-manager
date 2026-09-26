#!/usr/bin/env node
// LORAMER_PLAN_PHASE_REGION_INDEX_V1 — leg (c): THE LANE-PROVENANCE READS STAY UNSCOPED BY RESOURCE, AND AN INDEX CARRIES THEM.
//
// ⛔ WHAT WAS MEASURED, 2026-09-26 (round 353). The three `.eq('phase','attempt_started').in('message_key', keys)` reads in
// universe-coverage.ts had no index on message_key: a Parallel Index Scan over every started row in the fleet
// (~224k, 200k buffers), 582.6 ms mean in pg_stat_statements, the single largest term in a fire's plan phase.
// Round 352 proposed adding `.eq('resource', …)` on the reasoning that message_key embeds the resource. MEASURED on
// 3 clients × 20 real key sets, that DROPPED ROWS: Tri-Copy 531 → 524, Bath Fitter 634 → 625 (14 sets differed),
// because the idle probe writes attempt_started under the SAME message_key with resource '__account_activity'
// (2,704 keys fleet-wide; '__account_inception' 25 more). Those rows feed resolveTerminalLane — a resource filter
// changes which lane a zero is attributed to, i.e. which days read attested-empty. A reasoned equivalence was not a
// measured one.
//
// ⛔ SO THE QUERY TEXT DOES NOT MOVE; A PARTIAL INDEX WITH THE QUERY'S OWN PREDICATE DOES THE WORK. Identical rows by
// construction, and every reader of these functions (the fire, the drive, the pump, /api/next/*, /api/intelligence)
// gets the speed without a behaviour change.
//
// LEGS
//  (c1) universe-coverage.ts holds exactly three `.in('message_key'` reads, each on universe_attempt_log with
//       `.eq('phase', 'attempt_started')`
//  (c2) none of the three carries a resource filter
//  (c3) migrations/110 builds `(message_key) WHERE phase = 'attempt_started'` CONCURRENTLY, outside a transaction
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const COV = 'src/lib/backfill/universe-coverage.ts'
const MIG = 'migrations/110_attempt_log_started_message_key_idx.sql'
const cov = read(COV)

// Each read's chain: from the nearest preceding `supabaseAdmin` to its `.in('message_key'`.
const reads = []
let at = cov.indexOf(".in('message_key'")
while (at !== -1) {
  const start = cov.lastIndexOf('supabaseAdmin', at)
  reads.push({ line: cov.slice(0, at).split('\n').length, chain: cov.slice(start, at + 40) })
  at = cov.indexOf(".in('message_key'", at + 1)
}
if (reads.length !== 3) findings.push(`(c1) ${COV}: expected exactly 3 \`.in('message_key'\` provenance reads, found ${reads.length}. A new one must be measured for equivalence and index use before this count moves.`)
for (const r of reads) {
  if (!/\.from\('universe_attempt_log'\)/.test(r.chain)) findings.push(`(c1) ${COV}:${r.line}: the provenance read is not on universe_attempt_log.`)
  if (!/\.eq\('phase',\s*'attempt_started'\)/.test(r.chain)) findings.push(`(c1) ${COV}:${r.line}: the provenance read lost \`.eq('phase', 'attempt_started')\` — the partial index's predicate. Without it the planner cannot use the index and the read returns to a fleet-wide scan.`)
  if (/\.eq\('resource'/.test(r.chain)) findings.push(`(c2) ${COV}:${r.line}: the provenance read carries a resource filter. MEASURED NON-EQUIVALENT (round 353): it drops the '__account_activity' / '__account_inception' starts that share the message_key, which changes resolveTerminalLane's input.`)
}

const mig = read(MIG).replace(/--.*$/gm, '')
if (mig) {
  if (!/create\s+index\s+concurrently\s+if\s+not\s+exists\s+universe_attempt_log_started_message_key_idx\s+on\s+public\.universe_attempt_log\s*\(\s*message_key\s*\)\s*where\s+phase\s*=\s*'attempt_started'/i.test(mig)) {
    findings.push(`(c3) ${MIG}: must \`create index concurrently if not exists universe_attempt_log_started_message_key_idx on public.universe_attempt_log (message_key) where phase = 'attempt_started'\` — the predicate must match the reads' own filter.`)
  }
  if (/\bbegin\b|\bcommit\b/i.test(mig)) findings.push(`(c3) ${MIG}: CREATE INDEX CONCURRENTLY cannot run inside a transaction block; the file must not open one.`)
}

if (findings.length) {
  console.error(`✗ provenance-read-unscoped-by-resource FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ provenance-read-unscoped-by-resource OK — the 3 lane-provenance reads keep phase='attempt_started', carry no resource filter, and migrations/110 indexes (message_key) under that same predicate, concurrently.`)
