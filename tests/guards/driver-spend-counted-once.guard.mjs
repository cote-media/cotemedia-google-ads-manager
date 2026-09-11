#!/usr/bin/env node
// LORAMER_ONE_CLICK_WALK_V1 (2/2 A) — THE DRIVER'S REQUESTS ARE COUNTED EXACTLY ONCE, IN THEIR OWN LANE.
//
// Measured 2026-09-11 00:41Z: every consumer message logged "[google-op-budget] cron_runs row with UNRECOGNISED
// mode='driver' — counted against the fleet cap, attributed to no lane". The driver's real requests were ALREADY inside
// byLane.forward (087's spend function sums every producer), and each driver cron_runs row added connections_attempted × 67
// phantom requests to unattributedRaw. Fix: ONE producer-split read (migration 089 forward_observation_spend_split →
// readForwardObservationSpendSplit) feeds byLane.forward (producers NOT like 'driver-%') and byLane.driver (like
// 'driver-%'); mode='driver' rows add nothing to the units×67 term; the governor's product-spent sum includes driver.
//
// LEGS
//  (a) migrations/089_forward_observation_spend_split.sql defines forward_observation_spend_split with the two FILTER sums
//  (b) forward-observation-log.ts exports readForwardObservationSpendSplit calling that RPC; NO other src file names the
//      unsplit forward_observation_spend_today in a spend path except the module itself (the one reader module)
//  (c) google-op-budget.ts: byLane.forward and byLane.driver both come from the split read (`split.forward` / `split.driver`),
//      the reader carries a `mode === 'driver'` branch that adds NOTHING to units or unattributed, and the code never sums
//      readForwardObservationSpendToday into a lane
//  (d) 'driver' is a BudgetLane, in BUDGET_LANES, in LANE_PRIORITY and in LANE_ALLOCATIONS
//  (e) universe-governor.ts productSpent includes f.byLane.driver
//  (f) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*|--)/.test(l)).join('\n')

const MIG = 'migrations/089_forward_observation_spend_split.sql'
const FOL = 'src/lib/backfill/forward-observation-log.ts'
const BUD = 'src/lib/backfill/google-op-budget.ts'
const GOV = 'src/lib/backfill/universe-governor.ts'

const mig = strip(read(MIG))
if (!mig) findings.push(`(a) ${MIG} missing`)
else {
  if (!/create or replace function public\.forward_observation_spend_split\s*\(\s*p_vendor text,\s*p_since timestamptz\s*\)/i.test(mig)) findings.push(`(a) ${MIG} does not define forward_observation_spend_split(p_vendor text, p_since timestamptz)`)
  if (!/filter\s*\(\s*where producer not like 'driver-%'\s*\)/i.test(mig) || !/filter\s*\(\s*where producer like 'driver-%'\s*\)/i.test(mig)) findings.push(`(a) ${MIG} lacks the two producer FILTER sums (not like / like 'driver-%')`)
}
const fol = strip(read(FOL))
if (!/export async function readForwardObservationSpendSplit\s*\(/.test(fol)) findings.push(`(b) ${FOL} does not export readForwardObservationSpendSplit`)
if (!/rpc\(\s*['"]forward_observation_spend_split['"]/.test(fol)) findings.push(`(b) ${FOL} does not call the forward_observation_spend_split RPC`)
const bud = strip(read(BUD))
if (!bud) findings.push(`(c) ${BUD} missing`)
else {
  if (!/readForwardObservationSpendSplit\s*\(\s*WALK_ATTEMPT_LOG_VENDOR\s*,\s*since\s*\)/.test(bud)) findings.push(`(c) ${BUD} does not read the split with the walk's vendor literal and the same \`since\``)
  if (!/forward:\s*split\.forward\b/.test(bud) || !/driver:\s*split\.driver\b/.test(bud)) findings.push(`(c) byLane.forward / byLane.driver do not both come from the ONE split read (expected forward: split.forward, driver: split.driver)`)
  if (/readForwardObservationSpendToday\s*\(/.test(bud)) findings.push(`(c) ${BUD} still calls the UNSPLIT readForwardObservationSpendToday — that sum contains the driver's requests and would count them twice`)
  if (!/mode === ['"]driver['"]/.test(bud)) findings.push(`(c) the cron_runs reader has no mode === 'driver' branch — driver rows fall into the unattributed × 67 term`)
  const drvBranch = bud.slice(bud.indexOf("mode === 'driver'"), bud.indexOf("mode === 'driver'") + 260)
  if (/units\.[a-z]+\s*\+=|unattributedUnits\s*\+=/.test(drvBranch.split('} else')[0])) findings.push(`(c) the mode === 'driver' branch adds to units or unattributed — it must add NOTHING (the driver's spend is the ledger's producer split)`)
  if (!/export type BudgetLane\s*=[^\n]*'driver'/.test(bud)) findings.push(`(d) 'driver' is not a BudgetLane`)
  if (!/BUDGET_LANES[^\n]*'driver'/.test(bud)) findings.push(`(d) 'driver' is not in BUDGET_LANES`)
  if (!/LANE_PRIORITY[^\n]*'driver'/.test(bud)) findings.push(`(d) 'driver' is not in LANE_PRIORITY`)
  if (!/driver:\s*DRIVER_ALLOCATION|driver:\s*6_?900/.test(bud)) findings.push(`(d) LANE_ALLOCATIONS carries no driver allocation`)
}
const gov = strip(read(GOV))
if (gov && !/productSpent\s*=[^\n]*byLane\.driver/.test(gov)) findings.push(`(e) ${GOV} productSpent does not include f.byLane.driver — the walk's governor would ignore the driver's product-side spend`)
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-spend-counted-once.guard.mjs')) findings.push('(f) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) { console.error('✗ driver-spend-counted-once FAILED:'); for (const f of findings) console.error('  ' + f); process.exit(1) }
console.log("[driver-spend-counted-once] PASS — one producer-split read (089) feeds byLane.forward and byLane.driver; mode='driver' rows add nothing to units×67; 'driver' is a lane with an allocation and a priority; the governor's product-spent includes it.")
