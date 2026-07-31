#!/usr/bin/env node
// LORAMER_GOOGLE_OP_BUDGET_V1 — guard ALLOCATE-BEFORE-SPENDING (★GOOGLE-QUOTA-PRIORITY-INVERSION).
// LORAMER_GOOGLE_OP_BUDGET_LANE_ACCOUNTING_V2 — 2026-07-31: + LANE ATTRIBUTION, the drain's write path, and
// the fleet-cap backstop. THE V1 LEGS BELOW ARE PRESERVED VERBATIM IN INTENT — extending a shipped enforcer
// must not loosen it, which is the standing rule that kept A2's negation gap open deliberately.
//
// WHAT WE HAD WAS STOP-WHEN-DEAD. `holdGoogleWork` is REACTIVE — it reads a sentinel Google set AFTER the 15k
// Basic-Access cap was already gone, so it cannot stop the lane that spent it.
//
// ⛔ AND THEN V1 REPRODUCED THAT INVERSION INSIDE THE BUDGET. It selected `mode` from cron_runs and never read
// it, summing every google lane into ONE total billed to whichever lane asked. MEASURED 2026-07-31: the DRAIN
// was charged ~44,120 estimated ops against its 10,500 allocation, of which catchup spent 42,311 and forward
// 1,809 and the drain ZERO — because the drain wrote no cron_runs rows at all. The ranked geo lap was declined
// every five minutes from ~09:05Z while Foam OH and Veterinary mastermind bled recoverable geo. The arithmetic
// was internally consistent; only the ATTRIBUTION was wrong, which is why nothing caught it.
//
// EIGHT FAILURES, each independent:
//  (a) a capture lane that can spend Google operations WITHOUT consulting the budget
//  (b) catchup able to spend into the RESERVE that forward / the geo lap / scoped recovery live in
//  (c) a lane DECLINING without recording it (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1)
//  (d) the budget degrading to NOT-BLOCKED when it cannot be READ
//  (e) NEW — the spend query not attributed per lane by `mode`, or a lane billing another mode's column
//  (f) NEW — a lane that can request budget with no cron_runs WRITE path (it would be billed for others' work)
//  (g) NEW — the FLEET-total-vs-cap backstop absent or unable to block
//  (h) NEW — Math.max(conns, days) reappearing as a LANE's unit source (v1's hedge)
//
// Drives the REAL transpiled decision function; the lane wiring is pinned at source because a route cannot be
// executed hermetically inside `npm run build`. That split is stated rather than sold as a full proof.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const fail = (m) => { console.error(`[google-op-budget] FAIL — ${m}`); process.exit(1) }
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

const SRC = 'src/lib/backfill/google-op-budget.ts'
if (!existsSync(resolve(ROOT, SRC))) fail(`${SRC} is missing — there is no budget, so every lane still spends until Google says stop. That is the reactive posture ★GOOGLE-QUOTA-PRIORITY-INVERSION describes.`)

// ── SOURCE-LEVEL LEGS FIRST. They name the real defect unambiguously even when the module's signature has
// shifted underneath the behavioural legs, so a RED against pre-fix HEAD is readable rather than noisy.
// Line comments are stripped: QUOTATION IS NOT ASSERTION (banked twice — canonical-client-identity, ga-dim).
const rawSrc = read(SRC)
const code = rawSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

// ── (h) THE MAX HEDGE MUST NOT BE A LANE'S UNIT SOURCE ─────────────────────────────────────────────────
for (const m of [...code.matchAll(/Math\.max\(\s*conns\s*,\s*days\s*\)/g)]) {
  const before = code.slice(Math.max(0, m.index - 400), m.index)
  check(/unattributed/i.test(before),
    `(h) Math.max(conns, days) is a LANE's unit source. That is v1's hedge, and it is what made catchup's 421 re-counted connection-units outrank its real 207 gap-days on 2026-07-31. A lane bills from ONE column. (It is permitted ONLY on the unattributed branch, which is not a lane.)`)
}

// ── (e) PER-LANE ATTRIBUTION BY `mode` ─────────────────────────────────────────────────────────────────
{
  check(/\.select\(\s*['"]mode,\s*connections_attempted,\s*days_filled['"]\s*\)/.test(code),
    `(e) the cron_runs spend query no longer selects mode + connections_attempted + days_filled.`)
  check(/const\s+mode\s*=\s*String\(\s*\(r as any\)\.mode/.test(code),
    `(e) \`mode\` is SELECTED but never read into a variable — this is the v1 defect verbatim: one fleet-wide total billed to every lane, which charged the drain 44,120 ops it had not spent.`)
  const wants = [
    ['catchup', 'days_filled', /mode === 'catchup'[\s\S]{0,400}?units\.catchup\s*\+=\s*days/],
    ['forward', 'connections_attempted', /mode === 'forward'[\s\S]{0,400}?units\.forward\s*\+=\s*conns/],
    ['drain', 'connections_attempted', /mode === 'drain'[\s\S]{0,400}?units\.drain\s*\+=\s*conns/],
  ]
  for (const [lane, col, re] of wants) {
    check(re.test(code),
      `(e) lane '${lane}' does not accumulate from its OWN mode's rows using ${col} — per the file's own contract, forward/drain bill connections_attempted and catchup bills days_filled.`)
  }
  check(!/mode === 'catchup'[\s\S]{0,300}?units\.catchup\s*\+=\s*conns/.test(code),
    `(e) lane 'catchup' is billing connections_attempted — it fans out per GAP-DAY, and billing connections re-counts the same ~18 connections once per run (421 vs the real 207 on 2026-07-31).`)
  check(!/mode === 'forward'[\s\S]{0,300}?units\.forward\s*\+=\s*days/.test(code),
    `(e) lane 'forward' is billing days_filled — forward bills per connection-day.`)
}

// ── (g) THE FLEET-CAP BACKSTOP ─────────────────────────────────────────────────────────────────────────
{
  check(/fleetRemaining\s*=\s*Math\.max\(\s*0\s*,\s*cap\s*-\s*fleetOps\s*\)/.test(code),
    `(g) no FLEET total vs cap computation. The per-lane numbers are now correct, but the operations-per-request ratio is STILL unknown (★GAQL-OP-METER) — the cap backstop is not optional.`)
  check(/if\s*\(\s*fleetRemaining\s*<=\s*0\s*\)[\s\S]{0,300}?state:\s*'blocked'/.test(code),
    `(g) the fleet-cap check cannot BLOCK — it must return state:'blocked' independently of the lane check.`)
  check(/if\s*\(\s*laneRemaining\s*<=\s*0\s*\)[\s\S]{0,300}?state:\s*'blocked'/.test(code),
    `(g) the lane-allocation check cannot BLOCK.`)
  check(/blockedBy/.test(code), `(g) a decline does not name WHICH check fired (blockedBy).`)
  for (const f of ['fleetRawRequestsToday', 'fleetEstimatedOpsToday', 'byLaneRawRequests', 'catchupAllocation', 'laneRemaining', 'fleetRemaining']) {
    check(code.includes(f), `(g) GoogleOpBudget no longer carries '${f}' — the denominator law requires a decline to state what it examined.`)
  }
}

// ── (f) EVERY LANE THAT CAN REQUEST BUDGET HAS A cron_runs WRITE PATH ──────────────────────────────────
{
  const cronRuns = read('src/lib/cron-runs.ts')
  const modeUnion = (cronRuns.match(/export type CronMode\s*=\s*([^\n]+)/) || [])[1] || ''
  const laneWriters = {
    forward: ['src/app/api/cron/sync/route.ts'],
    catchup: ['src/app/api/cron/catchup/route.ts'],
    drain: ['src/app/api/cron/drain/route.ts'],
  }
  for (const [lane, files] of Object.entries(laneWriters)) {
    check(modeUnion.includes(`'${lane}'`),
      `(f) lane '${lane}' can call getGoogleOpBudget but is not a legal CronMode — it cannot record spend, so the budget bills it for other lanes' work. That is exactly what happened to the drain.`)
    const wrote = files.some((f) => new RegExp(`startCronRuns\\(\\s*\\{[\\s\\S]{0,220}?mode:\\s*'${lane}'`).test(read(f)))
    check(wrote,
      `(f) lane '${lane}' has NO cron_runs write path (no startCronRuns with mode:'${lane}' in ${files.join(', ')}). A lane that can request budget but cannot record spend must not exist.`)
  }
  const drainSrc = read('src/app/api/cron/drain/route.ts')
  check(!/startCronRuns/.test(drainSrc) || /finishCronRun/.test(drainSrc),
    `(f) cron/drain starts cron_runs rows but never finishes them — an unstamped row IS the silent-hole signal, and a monitoring fix must not cause a monitoring outage.`)
}

// ── BEHAVIOURAL: drive the REAL transpiled decision function ───────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-opbudget-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }
const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = { get supabaseAdmin() { return globalThis.__SB__ || {} } }\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (q, ...rest) { return q.startsWith('@/lib/') ? stub : origResolve.call(this, q, ...rest) }
const mod = require(join(out, 'src/lib/backfill/google-op-budget.js'))
Module._resolveFilename = origResolve

for (const n of ['decideBudget', 'holdForBudget', 'getGoogleOpBudget', 'recordLaneDeclined']) {
  if (typeof mod[n] !== 'function') { rmSync(out, { recursive: true, force: true }); fail(`${SRC} does not export ${n}.`) }
}
check(typeof mod.readGoogleSpendToday === 'function',
  `(e) readGoogleSpendToday is not exported — the reader must return PER-LANE spend, not one fleet total (v1's readGoogleRequestsToday returned a single number, which is the defect).`)

const { decideBudget, holdForBudget, CATCHUP_ALLOCATION, RANKED_RESERVE, GOOGLE_DAILY_OP_CAP, SAFETY_MULTIPLIER } = mod
// Helper: build the per-lane spend shape the fixed reader returns.
const spend = (o = {}) => ({ byLane: { forward: 0, catchup: 0, drain: 0, ...o }, unattributedRaw: o.unattributedRaw || 0 })

// ── (d) UNREADABLE MUST NOT BE HEADROOM ────────────────────────────────────────────────────────────────
{
  const b = decideBudget('catchup', null)
  check(b.state === 'unknown', `(d) an UNREADABLE budget resolved '${b.state}' — it must be 'unknown'. A failed read returning headroom is how 178 gap-days went out against an exhausted quota on 2026-07-28.`)
  check(holdForBudget(b) === true, `(d) holdForBudget did not HOLD on 'unknown'. The rule is identical to holdGoogleWork and for the identical reason.`)
  check(holdForBudget(decideBudget('catchup', spend())) === false, `POSITIVE CONTROL: a healthy budget HELD — the gate can only ever say stop, so it says nothing.`)
}

// ── (b) CATCHUP MAY NOT SPEND INTO THE RESERVE ─────────────────────────────────────────────────────────
{
  check(CATCHUP_ALLOCATION + RANKED_RESERVE === GOOGLE_DAILY_OP_CAP,
    `(b) allocation ${CATCHUP_ALLOCATION} + reserve ${RANKED_RESERVE} != cap ${GOOGLE_DAILY_OP_CAP}.`)
  check(CATCHUP_ALLOCATION < RANKED_RESERVE,
    `(b) catchup's allocation (${CATCHUP_ALLOCATION}) is not smaller than the ranked reserve (${RANKED_RESERVE}) — the deep-history lane must be the MINORITY spender.`)
  const atLimit = Math.ceil(CATCHUP_ALLOCATION / SAFETY_MULTIPLIER)
  const c = decideBudget('catchup', spend({ catchup: atLimit }))
  check(c.state === 'blocked', `(b) catchup at its full allocation resolved '${c.state}' — it can spend into the reserve.`)
  // ⛔ THE REGRESSION THIS WHOLE FLIGHT EXISTS TO PREVENT: catchup's spend must NOT block the ranked lane.
  const d = decideBudget('drain', spend({ catchup: atLimit }))
  check(d.state === 'not_blocked',
    `(f) THE 2026-07-31 DEFECT: the RANKED lane was blocked by CATCHUP's spend ('${d.state}'). The drain spent none of it. This is the priority inversion reproduced inside the budget — forward and the geo lap starve exactly as they did.`)
  check(d.allocation > c.allocation, `(b) the ranked lane's allocation is not larger than catchup's.`)
}

// ── (g) BEHAVIOURAL: the fleet cap blocks even when the LANE still has room ────────────────────────────
{
  // Split the cap across two OTHER lanes so no single lane is over its own allocation, but the fleet is.
  const perLane = Math.ceil((GOOGLE_DAILY_OP_CAP / SAFETY_MULTIPLIER) * 0.6)
  const b = decideBudget('drain', spend({ forward: perLane, catchup: perLane }))
  check(b.state === 'blocked' && b.blockedBy === 'fleet_cap',
    `(g) the FLEET total exceeded the ${GOOGLE_DAILY_OP_CAP} cap and the lane was still allowed ('${b.state}'/'${b.blockedBy}'). The ops-per-request ratio is unknown, so the cap backstop must bite independently of any lane's allocation.`)
  const lane = decideBudget('catchup', spend({ catchup: Math.ceil(CATCHUP_ALLOCATION / SAFETY_MULTIPLIER) }))
  check(lane.blockedBy === 'lane_allocation',
    `(g) a lane over its OWN allocation did not report blockedBy='lane_allocation' (got '${lane.blockedBy}') — a decline must name which check fired.`)
}

// ── the estimate must be a LOWER BOUND and must SAY SO IN THE DATA ─────────────────────────────────────
{
  const b = decideBudget('catchup', spend({ catchup: 100 }))
  check(b.isLowerBound === true, `(units) the budget does not declare itself a lower bound. Google bills OPERATIONS, not requests — ★GAQL-OP-COUNT-DISCREPANCY.`)
  check(b.rawRequestsToday === 100 && b.estimatedOpsSpentToday >= 100,
    `(units) this LANE's raw request count is not preserved alongside the multiplied estimate — the assumption must be visible, not inherited.`)
  check(b.safetyMultiplier > 1, `(units) the safety multiplier is <= 1; ops >= requests, so the estimate must over-count and stop EARLY.`)
  // FIX 4 — the denominator: the decline/allow text must carry the lane, both allocations and the per-lane split.
  const decl = decideBudget('drain', spend({ forward: 10, catchup: 20, drain: 30 })).reason
  for (const frag of ['lane=drain', 'fleet_ops', 'catchup', 'forward', 'drain']) {
    check(decl.includes(frag), `(c) the budget's reason string omits '${frag}' — a decline must state what it examined.`)
  }
}

// ── (a) EVERY SPENDING LANE CONSULTS THE BUDGET ────────────────────────────────────────────────────────
const LANES = [
  ['src/app/api/cron/catchup/route.ts', 'catchup'],
  ['src/app/api/cron/drain/route.ts', 'drain'],
]
for (const [f] of LANES) {
  const src = read(f)
  check(!!src, `(a) ${f} is unreadable.`)
  if (!src) continue
  check(/getGoogleOpBudget\(/.test(src),
    `(a) ${f} spends Google operations WITHOUT consulting the budget.`)
  check(/holdForBudget\(/.test(src),
    `(a) ${f} reads the budget but never applies holdForBudget — reading a limit without honouring it is not a limit.`)
  check(/recordLaneDeclined\(/.test(src),
    `(c) ${f} can decline WITHOUT recording it. A lane that no-ops silently is indistinguishable from a lane that never fired.`)
}
{
  const src = read('src/app/api/cron/catchup/route.ts')
  check(/googleQuotaPaused \|\| googleBudgetHold/.test(src),
    `(a) catchup computes a budget hold but the google fan-out gate does not include it — the value is dead and the lane still spends.`)
}
{
  const src = read('src/app/api/cron/drain/route.ts')
  // ⚠ ANCHOR ON THE CALL, NOT THE IDENTIFIER. indexOf('getGoogleOpBudget') matches the IMPORT first, 80 lines
  // above the call site, and the lookback then reads the import block instead of the guard clause.
  const i = src.indexOf("getGoogleOpBudget('drain')")
  const before = src.slice(Math.max(0, i - 600), i)
  check(i > 0 && /if \(!onlyClientId\) \{/.test(before),
    `(a) the drain's budget gate is NOT inside 'if (!onlyClientId)' — a scoped manual recovery would be blocked by the automatic lanes' spend, which must remain possible.`)
}

// ── THE THREE-STATE VOCABULARY IS THE BANKED ONE, NOT A FOURTH DIALECT ─────────────────────────────────
{
  check(/GoogleQuotaReadState/.test(rawSrc),
    `(vocab) the budget declares its own state union instead of reusing GoogleQuotaReadState from google-quota-store.ts.`)
  const states = new Set(['blocked', 'not_blocked', 'unknown'])
  for (const s of [decideBudget('catchup', null).state, decideBudget('catchup', spend()).state, decideBudget('catchup', spend({ catchup: 1e9 })).state]) {
    check(states.has(s), `(vocab) the budget emitted state '${s}', outside the banked three.`)
  }
}

rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error(`[google-op-budget] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[google-op-budget] PASS — lanes bill their OWN mode's rows (forward/drain connections, catchup gap-days), every lane has a cron_runs write path, catchup (${CATCHUP_ALLOCATION}) cannot spend the ranked reserve (${RANKED_RESERVE}), the fleet cap backstops independently, declines carry their denominator, and an unreadable budget HOLDS.`)
