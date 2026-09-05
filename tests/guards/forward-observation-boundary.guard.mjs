#!/usr/bin/env node
// LORAMER_FORWARD_OBSERVATION_LOG_V1 — THE SEAL IS STRUCTURAL: A FORWARD OBSERVATION CAN NEVER BE READ AS AN ATTEST.
//
// Round 1 (2026-09-05) settled the table question on one fact: windowCoverage needs no forward observation —
// COVERED comes from metrics_daily rows written either way, and ATTESTED-EMPTY may never come from a forward
// zero (a yesterday zero is a lagging day, not an empty one; the top-edge lane's 12 sealed surface-days are the
// precedent). So forward's records live in their OWN table and the walk's readers cannot see them by
// construction, not by a lane predicate: universe-coverage.ts, universe-resumer.ts, the rotation view, the
// lane-spend RPC and the walk's check:data legs read universe_attempt_log, which this ledger never touches.
//
// LEGS
//  (a) `.from('forward_observation_log')` and `rpc('forward_observation_spend_today'` appear in exactly ONE
//      module — src/lib/backfill/forward-observation-log.ts — and that module holds at least one such read
//      (the NEED set — hole map, op-budget, checks — reads through its functions, never the table)
//  (b) universe-coverage.ts and universe-resumer.ts never import the observation module
//  (c) no migration adds 'forward' to universe_attempt_log_lane_chk — the walk's ledger keeps exactly two lanes
//  (d) registered in scripts/run-guards.mjs
// RED-FIRST is proven with a LORAMER_GUARD_ROOT fixture carrying a planted read (house practice), because a
// ban-style guard passes trivially on a tree that has not yet crossed the line.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*|--)/.test(l)).join('\n')
const walk = (dir, out = []) => {
  let entries = []
  try { entries = readdirSync(resolve(ROOT, dir)) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    let s; try { s = statSync(resolve(ROOT, p)) } catch { continue }
    if (s.isDirectory()) { if (e !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p)
  }
  return out
}

const MODULE = 'src/lib/backfill/forward-observation-log.ts'
const SELF = 'tests/guards/forward-observation-boundary.guard.mjs'
const TABLE_READ = /\.from\(\s*['"`]forward_observation_log['"`]\s*\)/
const RPC_READ = /rpc\(\s*['"`]forward_observation_spend_today['"`]/

// (a) exactly one reader module
const readers = []
for (const f of [...walk('src'), ...walk('scripts'), ...walk('tests')]) {
  if (f === SELF) continue
  const code = strip(readFileSync(resolve(ROOT, f), 'utf8'))
  if (TABLE_READ.test(code) || RPC_READ.test(code)) readers.push(f)
}
const outside = readers.filter((f) => f !== MODULE)
for (const f of outside) findings.push(`(a) ${f} reads forward_observation_log (or its spend RPC) directly — the ledger has ONE reader module (${MODULE}); every consumer goes through its functions so the observation-vs-attest distinction is enforced in one place`)
if (!readers.includes(MODULE)) findings.push(`(a) ${MODULE} holds no read of forward_observation_log — the one reader module does not exist (or reads nothing), so the NEED set has nothing to read through`)

// (b) the walk's coverage and resumer never see it
for (const f of ['src/lib/backfill/universe-coverage.ts', 'src/lib/backfill/universe-resumer.ts']) {
  const code = strip(read(f))
  if (!code) { findings.push(`UNREADABLE ${f}`); continue }
  if (/from\s+['"](@\/lib\/backfill\/forward-observation-log|\.\/forward-observation-log)['"]/.test(code)) findings.push(`(b) ${f} imports the observation module — a forward observation reaching the walk's coverage or anchor decision is the seal-by-branch the separate table exists to make impossible`)
  if (/forward_observation_log/.test(code)) findings.push(`(b) ${f} names forward_observation_log`)
}

// (c) the walk's lane CHECK keeps exactly two values
try {
  for (const f of readdirSync(resolve(ROOT, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    const code = read(`migrations/${f}`).split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    for (const m of code.matchAll(/ADD\s+CONSTRAINT\s+universe_attempt_log_lane_chk\b[\s\S]{0,300}?ARRAY\s*\[([^\]]*)\]/gi)) {
      const values = m[1].split(',').map((s) => s.trim().replace(/::text$/, '').replace(/^'|'$/g, ''))
      if (values.includes('forward')) findings.push(`(c) migrations/${f} adds 'forward' to universe_attempt_log_lane_chk — the walk's ledger is not the forward lane's store; a third lane there re-creates the seal-by-branch and the rotation coupling that froze the top-edge lane`)
    }
  }
} catch (e) { findings.push(`(c) cannot read migrations/ — ${e.message}`) }

// (d) registered
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/forward-observation-boundary.guard.mjs')) findings.push('(d) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length === 0) {
  console.log(`forward-observation-boundary: PASSED — forward_observation_log has exactly one reader module (${MODULE}); universe-coverage.ts and universe-resumer.ts never import it; universe_attempt_log_lane_chk carries no 'forward'. The seal is structural.`)
  process.exit(0)
}
console.error(`forward-observation-boundary: FAILED — ${findings.length} finding(s)`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
