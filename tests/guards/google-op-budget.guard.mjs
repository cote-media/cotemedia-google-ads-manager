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
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
// --db — the LIVE leg, wired into `npm run check:data` and DELIBERATELY NOT into `npm run guard`.
// It reads the database, and `guard` runs inside `next build` on Vercel: a DB read in the deploy path is the
// posture this repo already rejected for check:data. Static legs prove the SHAPE on every build; this proves
// the NUMBER before a push.
const WITH_DB = process.argv.includes('--db')
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

// ── (j) FORWARD IS WITNESSED FROM ITS OWN LEDGER — LORAMER_FORWARD_OBSERVATION_LOG_V1 ─────────────────
// Until 2026-09-05 forward's requests were DERIVED: connections_attempted × GAQL_REQUESTS_PER_CONNECTION_DAY
// (603 = 9 × 67 on the day it was measured), and a killed fire — 26 of 541 in 30 days — never wrote its
// connection count at all, so the derivation under-billed exactly the fires that spent the most. The forward
// lane now RECORDS every vendor call in forward_observation_log; the fleet meter reads that sum (same `since`
// as the other ledgers) and the cron_runs connection count survives only as the cross-witness (units.forward,
// leg (e)) that check-fleet-meter-visibility compares it against.
{
  check(!/forward:\s*units\.forward\s*\*\s*GAQL_REQUESTS_PER_CONNECTION_DAY/.test(code),
    `(j) byLane.forward is still DERIVED as units.forward × GAQL_REQUESTS_PER_CONNECTION_DAY — forward writes its own ledger now (forward_observation_log); a derived figure beside a measured one is the drift the fleet meter exists to catch.`)
  check(/forward:\s*forwardObservationRequests\b/.test(code),
    `(j) byLane.forward does not come from forwardObservationRequests (the observation ledger's sum).`)
  check(/import\s*\{[^}]*\breadForwardObservationSpendToday\b[^}]*\}\s*from\s*['"]\.\/forward-observation-log['"]/.test(code),
    `(j) google-op-budget.ts does not import readForwardObservationSpendToday from ./forward-observation-log — the one reader module is the only lawful path to the table.`)
  check(/readForwardObservationSpendToday\(\s*WALK_ATTEMPT_LOG_VENDOR\s*,\s*since\s*\)/.test(code),
    `(j) the forward ledger is not read with the SAME vendor literal and the SAME \`since\` as the walk's ledgers — two windows would make the fleet total a sum of two different days.`)
}

// ── (g) THE FLEET-CAP BACKSTOP ─────────────────────────────────────────────────────────────────────────
{
  check(/fleetRemaining\s*=\s*Math\.max\(\s*0\s*,\s*cap\s*-\s*fleetOps\s*\)/.test(code),
    `(g) no FLEET total vs cap computation. The per-lane numbers are now correct, but the operations-per-request ratio is STILL unknown (★GAQL-OP-METER) — the cap backstop is not optional.`)
  // ⛔ WINDOW WIDENED 2026-08-05, AND THE REASON IS RECORDED SO IT IS NOT READ AS A LOOSENING:
  // LORAMER_FLEET_CEILING_HAS_A_PRIORITY_ORDER_V1 inserts a priority branch between the `if` and the blocked
  // return, so a 300-character lookahead no longer reaches it. The ASSERTION IS UNCHANGED and is now stricter —
  // the fleet-exhausted path must still contain a blocked return AND must name fleet_cap as the check that
  // fired. The behavioural leg below proves it BITES; this one proves it EXISTS.
  check(/if\s*\(\s*fleetRemaining\s*<=\s*0\s*\)[\s\S]{0,2400}?state:\s*'blocked',\s*blockedBy:\s*'fleet_cap'/.test(code),
    `(g) the fleet-cap check cannot BLOCK — it must still return state:'blocked' with blockedBy:'fleet_cap' when nothing lower can yield. A priority order decides WHO is refused; it may never remove the refusal.`)
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

const { decideBudget, holdForBudget, CATCHUP_ALLOCATION, RANKED_RESERVE, GOOGLE_DAILY_OP_CAP, OPS_PER_REQUEST, LANE_ALLOCATIONS, allocationFor } = mod
// Helper: build the per-lane spend shape the fixed reader returns.
const spend = (o = {}) => ({ byLane: { forward: 0, catchup: 0, drain: 0, backfill: 0, ...o }, unattributedRaw: o.unattributedRaw || 0 })

// ── (d) UNREADABLE MUST NOT BE HEADROOM ────────────────────────────────────────────────────────────────
{
  const b = decideBudget('catchup', null)
  check(b.state === 'unknown', `(d) an UNREADABLE budget resolved '${b.state}' — it must be 'unknown'. A failed read returning headroom is how 178 gap-days went out against an exhausted quota on 2026-07-28.`)
  check(holdForBudget(b) === true, `(d) holdForBudget did not HOLD on 'unknown'. The rule is identical to holdGoogleWork and for the identical reason.`)
  // ⛔ THE POSITIVE CONTROL MOVED FROM 'catchup' TO 'backfill' ON 2026-08-11 AND THE PROPERTY DID NOT CHANGE.
  // Under LORAMER_WALK_TAKES_THE_LANE_V1 catchup's allocation is ZERO BY DECISION, so a zero-spend catchup is
  // CORRECTLY held — the control's premise ("this lane has headroom") died with the reallocation, not the
  // property it protects. The lane that can still demonstrate "a healthy budget does not hold" is the one that
  // now carries the allowance. Kept and re-pointed, never deleted: Lesson 68 shape (a) is an assertion
  // encoding a superseded model, and this is what repairing one looks like.
  check(holdForBudget(decideBudget('backfill', spend())) === false, `POSITIVE CONTROL: a healthy budget HELD — the gate can only ever say stop, so it says nothing.`)
}

// ── (b) CATCHUP MAY NOT SPEND INTO THE RESERVE ─────────────────────────────────────────────────────────
{
  check(CATCHUP_ALLOCATION + RANKED_RESERVE === GOOGLE_DAILY_OP_CAP,
    `(b) allocation ${CATCHUP_ALLOCATION} + reserve ${RANKED_RESERVE} != cap ${GOOGLE_DAILY_OP_CAP}.`)
  check(CATCHUP_ALLOCATION < RANKED_RESERVE,
    `(b) catchup's allocation (${CATCHUP_ALLOCATION}) is not smaller than the ranked reserve (${RANKED_RESERVE}) — the deep-history lane must be the MINORITY spender.`)
  // ⛔ RE-POINTED 2026-08-09 (LORAMER_GOOGLE_LANE_ALLOCATION_V1). The multiplier is GONE — the vendor settles
  // one request at one operation — so "at its limit" is now simply its allocation, not allocation/1.5.
  const atLimit = Math.ceil(CATCHUP_ALLOCATION / OPS_PER_REQUEST)
  const c = decideBudget('catchup', spend({ catchup: atLimit }))
  check(c.state === 'blocked', `(b) catchup at its full allocation resolved '${c.state}' — it can spend into the reserve.`)
  // ⛔ THE REGRESSION THIS WHOLE FLIGHT EXISTS TO PREVENT: a lower lane's spend must NOT block a ranked lane.
  // ⛔ THE ASKER MOVED FROM 'drain' TO 'forward' ON 2026-08-11 AND THE PROPERTY IS UNCHANGED. Under
  // LORAMER_WALK_TAKES_THE_LANE_V1 the drain's allocation is ZERO BY DECISION, so it is blocked on check (a)
  // before the priority rule is ever reached — the leg would report a priority inversion that is not there.
  // FORWARD still carries an allocation (the un-gated reserve) and still ranks above catchup, so it is the lane
  // that can demonstrate the guarantee. The guarantee itself — a lane inside its own allocation is not refused
  // for a LOWER lane's spend — is exactly what it always was.
  const d = decideBudget('forward', spend({ catchup: atLimit }))
  check(d.state === 'not_blocked',
    `(f) THE 2026-07-31 DEFECT: the RANKED lane was blocked by CATCHUP's spend ('${d.state}'). Forward spent none of it. This is the priority inversion reproduced inside the budget — forward and the geo lap starve exactly as they did.`)
  // ⛔ REWRITTEN, AND THE CHANGE IS THE POINT. It used to assert that a ranked lane's allocation exceeds
  // catchup's, which was true only because every non-catchup lane inherited the whole 10,500 remainder — the
  // construction that gave 'backfill' a share nobody sized. Under the four-lane table catchup (4,000) is
  // LARGER than drain (3,000) and forward (2,000) BY DESIGN: it is the dominant spender being cut, not a
  // minority lane being kept small. The property that survives is the one that always mattered — a lane is
  // bounded by ITS OWN allocation and cannot reach another's.
  check(d.allocation === LANE_ALLOCATIONS.forward && c.allocation === LANE_ALLOCATIONS.catchup,
    `(b) a lane's allocation did not come from LANE_ALLOCATIONS (forward got ${d.allocation}, catchup ${c.allocation}). No lane may be computed as "everyone else".`)
  check(allocationFor('mystery-lane') === 0,
    `(b) an UNKNOWN lane received ${allocationFor('mystery-lane')} rather than 0. Fail-closed: a lane nobody sized may never inherit a remainder.`)
}

// ── (g) BEHAVIOURAL: the fleet cap blocks even when the LANE still has room ────────────────────────────
{
  // Split the cap across two OTHER lanes so no single lane is over its own allocation, but the fleet is.
  // ⛔ THE ASKER MOVED FROM 'drain' TO 'catchup' ON 2026-08-05 AND THE PROPERTY DID NOT CHANGE. Under
  // LORAMER_FLEET_CEILING_HAS_A_PRIORITY_ORDER_V1 the drain is no longer refused for a ceiling that CATCHUP
  // helped exhaust — catchup ranks below it and yields first, which is the whole point of the flight. The
  // property this leg protects is "the cap bites even when the LANE still has room", and the lane that can
  // demonstrate it is now one with nothing below it holding spend. Kept, not deleted: an enforcer that is
  // rewritten because the behaviour changed must still assert the original guarantee.
  // ⛔ AND THE ASKER MOVED AGAIN ON 2026-08-11, FROM 'catchup' TO 'backfill', FOR THE SAME REASON AS LEG (f):
  // catchup's allocation is now ZERO, so check (a) fires first and the leg would read 'lane_allocation' while
  // claiming to test the FLEET backstop — it would have gone green for the wrong reason, which is worse than red.
  // 'backfill' has 13,500 of room and ranks LAST, so no lower lane can hold spend and the ceiling must refuse it.
  const perLane = Math.ceil(GOOGLE_DAILY_OP_CAP * 0.6)
  const b = decideBudget('backfill', spend({ forward: perLane, drain: perLane }))
  check(b.state === 'blocked' && b.blockedBy === 'fleet_cap',
    `(g) the FLEET total exceeded the ${GOOGLE_DAILY_OP_CAP} cap and the lane was still allowed ('${b.state}'/'${b.blockedBy}'). The ops-per-request ratio is unknown, so the cap backstop must bite independently of any lane's allocation.`)
  const lane = decideBudget('catchup', spend({ catchup: Math.ceil(CATCHUP_ALLOCATION / OPS_PER_REQUEST) }))
  check(lane.blockedBy === 'lane_allocation',
    `(g) a lane over its OWN allocation did not report blockedBy='lane_allocation' (got '${lane.blockedBy}') — a decline must name which check fired.`)
}

// ── the estimate must be a LOWER BOUND and must SAY SO IN THE DATA ─────────────────────────────────────
{
  const b = decideBudget('catchup', spend({ catchup: 100 }))
  check(b.isLowerBound === true, `(units) the budget does not declare itself a lower bound. Google bills OPERATIONS, not requests — ★GAQL-OP-COUNT-DISCREPANCY.`)
  check(b.rawRequestsToday === 100 && b.estimatedOpsSpentToday >= 100,
    `(units) this LANE's raw request count is not preserved alongside the multiplied estimate — the assumption must be visible, not inherited.`)
  // ⛔ INVERTED 2026-08-09, AND THE OLD ASSERTION WAS A CLAIM GOOGLE CONTRADICTS. It demanded a multiplier
  // ABOVE 1 on the reasoning "ops >= requests, so over-count and stop EARLY". The vendor states a Search or
  // SearchStream request counts as ONE operation irrespective of batches, and valid-token pagination is not
  // counted at all — so ops <= requests, never more. The 1.5 was not conservatism; it was a 50% fiction that
  // measurably refused catchup on days Google would have served it.
  check(b.safetyMultiplier === 1,
    `(units) the ops-per-request ratio is ${b.safetyMultiplier}, not 1. The vendor settles it at one request = one operation; anything else is a claim about Google that Google contradicts.`)
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

// ── (i) THE FLEET CEILING HAS A PRIORITY ORDER ─────────────────────────────────────────────────────────
// ⛔ LORAMER_FLEET_CEILING_HAS_A_PRIORITY_ORDER_V1. Check (b) used to read fleetRemaining ALONE, so once the
// ceiling was gone every lane was refused and the one actually refused was whoever asked NEXT — on a normal
// morning that is forward at 08:00Z. Priority lived only in the per-lane allocations of check (a); the ceiling
// had none, which made LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1 unenforceable exactly when it mattered.
{
  const { LANE_PRIORITY, priorityOf } = mod
  // ⛔ A MISSING EXPORT MUST READ AS A FINDING, NOT A STACK TRACE. Run against a pre-fix body this block would
  // throw on the first call and the guard would CRASH — and a crash is not a readable RED (run-guards scores it
  // separately, and the reader learns nothing about which property was lost). The ordering legs degrade to one
  // named finding and the BEHAVIOURAL legs below still execute against the old function, which is where the
  // real red proof lives.
  const hasOrder = Array.isArray(LANE_PRIORITY) && LANE_PRIORITY.length >= 4 && typeof priorityOf === 'function'
  check(hasOrder,
    `(i) LANE_PRIORITY / priorityOf are absent — the fleet ceiling has NO ORDER, so once it binds the refusal falls on whoever asks next, and on a normal morning that is forward at 08:00Z carrying today's customer data.`)
  // The two LOCKED ends, and the DERIVED middle. Drain outranks catchup because only the drain's work expires
  // against a moving vendor wall (floor36); catchup repairs a 35-day window that stays fetchable for months.
  const order = ['forward', 'drain', 'catchup', 'backfill']
  if (hasOrder) {
    for (let i = 0; i + 1 < order.length; i++) {
      check(priorityOf(order[i]) < priorityOf(order[i + 1]),
        `(i) ${order[i]} does not outrank ${order[i + 1]}. Locked: forward is refused LAST, backfill FIRST. Derived: drain > catchup, because a deferred drain day crosses the ~37-month wall and is gone, while a deferred catchup day is merely stale.`)
    }
  }

  // ⛔ FIXTURES RESCALED 2026-08-09, AND THIS IS NOT A LOOSENING. They used to exhaust the ceiling at
  // 10,000 raw requests because the old ×1.5 multiplier turned that into 15,000 ops. With the vendor-settled
  // ratio of 1, 10,000 raw is 10,000 ops and no longer reaches the cap — so every one of these legs would
  // have passed for the WRONG REASON (nothing was exhausted at all). The numbers moved; the property each leg
  // asserts is unchanged, and each still requires a genuinely exhausted ceiling to mean anything.
  // (a) FORWARD IS NEVER REFUSED WHILE A LOWER LANE HOLDS SPEND. Fleet ceiling blown by catchup + drain.
  {
    const s = spend({ forward: 100, catchup: 7500, drain: 7500 })
    const b = decideBudget('forward', s)
    check(b.state === 'not_blocked' && !holdForBudget(b),
      `(i.a) FORWARD was refused (${b.state}/${b.blockedBy}) with the ceiling exhausted by catchup and drain while forward sat at ${b.estimatedOpsSpentToday}/${b.allocation} of its own allocation. Forward carries TODAY's customer data and is refused LAST — the lanes below it yield first.`)
  }
  // (b) ⛔ REWRITTEN 2026-08-11 (LORAMER_WALK_TAKES_THE_LANE_V1), AND THE REWRITE IS THE HONEST MOVE RATHER
  // THAN A WEAKENING. It used to assert "the same protection one rung down": drain, inside its allocation,
  // above catchup. UNDER THIS POLICY THERE IS NO SUCH RUNG — drain and catchup are both ZERO, and the only
  // lanes carrying an allocation are forward (the un-gated reserve, top of the order) and backfill (bottom).
  // A leg whose premise no longer exists cannot be repaired by swapping the lane; leg (i.a) already keeps the
  // priority guarantee alive with forward. WHAT REPLACES IT IS THE GUARANTEE THAT NOW MATTERS MOST: a lane
  // zeroed BY DECISION must decline on its OWN allocation and say so, never be misreported as a fleet problem.
  // ⛔ WHY THAT IS WORTH A LEG: the decline reason is the only place a silenced lane explains itself. If a
  // 0-allocation drain reported 'fleet_cap', every operator reading it — and Lora, reading the same field —
  // would conclude Google was exhausted, when in fact Russ turned the lane off. A purchased silence must not
  // masquerade as a vendor refusal.
  {
    for (const zeroed of ['drain', 'catchup']) {
      const b = decideBudget(zeroed, spend({ [zeroed]: 100, backfill: 200 }))
      check(b.state === 'blocked' && b.blockedBy === 'lane_allocation',
        `(i.b) the ZEROED lane '${zeroed}' declined as ${b.state}/${b.blockedBy} instead of blocked/lane_allocation. A lane silenced by LORAMER_WALK_TAKES_THE_LANE_V1 must attribute its decline to its OWN allocation — reporting 'fleet_cap' would tell every reader, including Lora, that GOOGLE refused when the truth is that Russ turned the lane off. A purchased silence must never look like a vendor outage.`)
      check(Number(b.allocation) === 0,
        `(i.b) '${zeroed}' reported allocation ${b.allocation}, not 0 — the decline must carry the real denominator (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1), and 0 is the number that explains it.`)
    }
  }
  // ⛔ AND THE ORDER MUST ACTUALLY BITE — this is not "everyone is admitted". With only HIGHER lanes holding
  // spend, the lane at the bottom of those with spend IS refused.
  // ⛔ ASKER MOVED FROM 'catchup' TO 'backfill' 2026-08-11: catchup now has no allocation, so check (a) fires
  // first and this leg would have gone GREEN reading 'lane_allocation' while claiming to prove the CEILING
  // bites — green for the wrong reason. 'backfill' has 13,500 of room and ranks LAST, so nothing below it can
  // yield and the ceiling must refuse it. Same guarantee, a lane that can still demonstrate it.
  {
    const b = decideBudget('backfill', spend({ forward: 14900, backfill: 100 }))
    check(b.state === 'blocked' && b.blockedBy === 'fleet_cap',
      `(i.b2) the BOTTOM lane was ADMITTED (${b.state}) on an exhausted ceiling with no lower-priority lane holding spend. Nothing below it can yield, so it must yield itself — otherwise the ordering admits everyone and protects nobody.`)
  }
  // (c) FAIL-OPEN: an unknown lane identity must sort LAST, never inherit forward's seat.
  {
    // ⛔ THE MESSAGE MUST NOT CALL THE THING IT IS REPORTING MISSING. A template literal is evaluated when the
    // argument is BUILT, not when the check fails, so interpolating priorityOf() here crashed the whole guard
    // against a pre-fix body — the second time this leg turned a RED into a stack trace.
    const pMystery = hasOrder ? priorityOf('mystery-lane') : 'ABSENT'
    check(hasOrder && pMystery === LANE_PRIORITY.length && pMystery > priorityOf('forward'),
      `(i.c) an UNKNOWN lane resolved to priority ${pMystery} — it must sort LAST. A typo or a future lane inheriting top priority is the fail-open this ordering exists to prevent, and it hands an unaudited spender the seat that belongs to today's data.`)
    const b = decideBudget('mystery-lane', spend({ forward: 14900, catchup: 100 }))
    check(b.state === 'blocked',
      `(i.c) an UNKNOWN lane was ADMITTED on an exhausted ceiling. Unknown identity fails CLOSED.`)
  }
  // (d) UNATTRIBUTED SPEND IS NOT A LANE AND CANNOT BE BLAMED — fail closed when nothing below can yield.
  {
    const b = decideBudget('forward', spend({ forward: 100, unattributedRaw: 15000 }))
    check(b.state === 'blocked' && b.blockedBy === 'fleet_cap',
      `(i.d) the ceiling was consumed by UNATTRIBUTED spend and forward was still admitted. Unattributed belongs to no lane, so there is nobody below to refuse first — that is the fail-closed branch.`)
  }
  // (e) THE BACKFILL LANE IS WIRED **AND COUNTED** — flight 2 of 2.
  {
    check((mod.BUDGET_LANES || []).includes('backfill'),
      `(i.e) 'backfill' is not a BudgetLane. The universe walk spends Google operations; a spender that is not a lane cannot be ordered, counted, or refused.`)
    const s = spend()
    check(Object.prototype.hasOwnProperty.call(s.byLane, 'backfill') || true, 'shape')
    check(decideBudget('backfill', spend({ forward: 14900, catchup: 100 })).state === 'blocked',
      `(i.e) the BACKFILL lane was admitted on an exhausted ceiling. It is the lowest priority there is — it yields to everything.`)
    // ⛔ AND THE WALK'S SPEND MUST REACH THE OTHER LANES' DENOMINATOR. Flight 1 shipped the ordering with the
    // number missing, so the walk could exhaust the fleet ceiling while every lane read the fleet as empty.
    const b = decideBudget('forward', spend({ forward: 100, backfill: 14000 }))
    check(b.fleetRawRequestsToday >= 14000,
      `(i.e2) the BACKFILL lane's spend (14000) is not reaching the FLEET total (got ${b.fleetRawRequestsToday}). The walk is the largest single Google spender in the system; a fleet total that cannot see it is measuring ~15% of the fleet.`)
  }
}

// ── (j) FLIGHT 2 — THE BACKFILL LANE IS SOURCED FROM THE WALK'S LEDGER, NOT FROM A STRUCTURAL ZERO ──────
// ⛔ LORAMER_GOOGLE_OP_BUDGET_BACKFILL_LANE_COUNTED_V3. The pre-fix reader wrote
// `backfill: units.backfill * GAQL_REQUESTS_PER_CONNECTION_DAY` where `units.backfill` was NEVER ASSIGNED —
// there is no `mode === 'backfill'` branch, because the walk writes no cron_runs row at all. That is not a
// measurement that happens to be zero; it is arithmetic that CANNOT be non-zero, and it read as a lane
// spending nothing for the eleven hours the walk spent 13,230 requests.
// THIS LEG GUARDS THE CLASS, not today's expression: any future backfill source that routes through the
// cron_runs `units` map is the same defect wearing a different name.
{
  check(/universe-window-log/.test(code) && /readLaneSpendToday/.test(code),
    `(j) google-op-budget does not read readLaneSpendToday from universe-window-log. The walk's spend exists ONLY in universe_window_log — a fleet total assembled without it is structurally blind to its largest spender.`)
  check(!/backfill:\s*units\.backfill/.test(code),
    `(j) the backfill lane is still sourced from the cron_runs \`units\` map. \`units.backfill\` is never assigned (there is no mode === 'backfill' branch), so that expression can only ever be 0 — a zero that LOOKS like a measurement.`)
  check(!/units\.backfill/.test(code),
    `(j) a \`units.backfill\` key still exists in the cron_runs accumulator. The walk writes no cron_runs row, so any such key is a permanent zero pretending to be data — it must not exist for a future reader to pick up.`)
  // ⛔ THE UNIT TRAP. requests_spent is ALREADY requests; the three cron lanes are WORK UNITS × 67.
  check(!/backfill:\s*[A-Za-z_.]*\s*\*\s*GAQL_REQUESTS_PER_CONNECTION_DAY/.test(code),
    `(j) the backfill lane is multiplied by GAQL_REQUESTS_PER_CONNECTION_DAY. universe_window_log.requests_spent is ALREADY in requests — multiplying it over-states the walk by 67× and would refuse every lane on a ceiling that does not exist.`)
  check(/backfill:\s*backfillRequests/.test(code),
    `(j) the backfill lane is not assigned from the walk-ledger read.`)
  // ⛔ FAIL CLOSED. The walk-ledger read must sit INSIDE the try whose catch returns null → 'unknown' → hold.
  // A backfill read that defaults to 0 on failure is the 2026-08-05 defect exactly: an unreadable counter
  // arriving as "nothing spent" is the most permissive answer a governor can be given.
  const reader = (code.match(/export async function readGoogleSpendToday[\s\S]*?\n}\n/) || [''])[0]
  check(/readLaneSpendToday\(/.test(reader),
    `(j) the walk-ledger read is not inside readGoogleSpendToday — it must share that function's try/catch so an unreadable ledger HOLDS every lane instead of reading as zero spend.`)
  check(!/readLaneSpendToday\([\s\S]{0,120}?\.catch\(/.test(reader) && !/catch\s*\{\s*return\s*0/.test(reader),
    `(j) the walk-ledger read swallows its own failure and yields a number. It must THROW to this function's catch, which returns null → 'unknown' → every lane holds.`)
  // Both halves of the fleet total must be read from ONE `since`, or the total mixes two days.
  check(/readLaneSpendToday\(\s*since\s*\)/.test(code),
    `(j) the walk-ledger read does not reuse the cron_runs \`since\`. Two independently-computed midnights make the fleet total a sum across two different days.`)
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

// ── (k) LIVE: THE BACKFILL LANE MUST NOT READ ZERO WHILE THE WALK LEDGER SHOWS SPEND ───────────────────
// ⛔ THE STATIC LEGS ABOVE PROVE THE SHAPE. THIS PROVES THE NUMBER, and they are not substitutes: flight 1's
// `units.backfill * 67` was a perfectly well-shaped expression that could only ever return 0. This drives the
// REAL transpiled reader against the REAL database — no synthetic spend shape — and fails if the lane reports
// nothing over a window in which universe_window_log records vendor requests.
if (WITH_DB) {
  const readRoot = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return '' } }
  for (const line of readRoot('.env.local').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!process.env.SUPABASE_DB_URL) {
    rmSync(out, { recursive: true, force: true })
    fail(`--db requested but SUPABASE_DB_URL is missing (.env.local). Refusing to pass quietly — a skipped spend check reads exactly like a passing one, which is the failure mode this whole file exists to prevent.`)
  }
  const pg = (await import('pg')).default
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const q = async (sql, params) => (await db.query(sql, params)).rows

  // A supabaseAdmin stand-in backed by real SQL, so the reader's OWN code path decides the number.
  const makeSb = () => ({
    from: () => {
      const st = { platform: null, since: null }
      const chain = {
        select: () => chain,
        eq: (c, v) => { if (c === 'platform') st.platform = v; return chain },
        gte: (c, v) => { if (c === 'started_at') st.since = v; return chain },
        then: (res, rej) =>
          q(`select mode, connections_attempted, days_filled from cron_runs where platform = $1 and started_at >= $2`,
            [st.platform, st.since])
            .then((rows) => res({ data: rows, error: null }), rej),
      }
      return chain
    },
    rpc: async (fn, args) => {
      // ⛔ BOTH walk aggregates are served — LORAMER_FLEET_METER_SEES_THE_WALK_V1. The reader now sums the v1
      // AND v2 ledgers; a stub that answers only the first turns the second call into a throw → null →
      // leg (k) reporting UNREADABLE, which is this harness failing, not the reader. (Seen live 2026-08-15,
      // the day the second read shipped.)
      // ⛔ AND THE FORWARD LEDGER — LORAMER_FORWARD_OBSERVATION_LOG_V1, 2026-09-05. The reader now measures forward
      // from forward_observation_spend_today instead of deriving it; this stub answered only the two walk
      // aggregates and turned the third call into a throw → null → (k) UNREADABLE on the day it shipped — the
      // harness failing, exactly as the comment above predicted for the second read. Same fix, same shape.
      if (fn !== 'universe_lane_spend_today' && fn !== 'universe_attempt_lane_spend_today' && fn !== 'forward_observation_spend_today') {
        return { data: null, error: { message: `unexpected rpc ${fn}` } }
      }
      const rows = await q(`select public.${fn}($1, $2::timestamptz) as v`, [args.p_vendor, args.p_since])
      return { data: rows[0]?.v ?? null, error: null }
    },
  })

  // ⛔ THE WINDOW IS OVERRIDABLE, AND THAT IS HOW THIS LEG WAS PROVEN TO FAIL. The walk is halted, so the
  // trailing 24h is empty and the leg is vacuous today — a check nobody has watched fail is a comment
  // (FIX-WITH-GUARD). LORAMER_OPBUDGET_DB_SINCE points it at a REAL PAST WINDOW (2026-08-05, when the walk
  // spent 13,230 requests across 12,547 windows), which is where its RED was demonstrated against the pre-fix
  // reader. Default and CI behaviour is unchanged: trailing 24h.
  const sinceOverride = process.env.LORAMER_OPBUDGET_DB_SINCE
  const since = sinceOverride ? new Date(sinceOverride) : new Date(Date.now() - 24 * 3600 * 1000)
  // ⛔ THE WITNESS SUMS BOTH WALK LEDGERS — LORAMER_FLEET_METER_SEES_THE_WALK_V1, 2026-08-15. This leg's
  // original witness was universe_window_log ALONE, and that is exactly why it never caught the blindness:
  // when the walk's billing moved to universe_attempt_log the witness went quiet WITH the reader, and the leg
  // printed "VACUOUS today" for three days of 960-requests/day spend. A witness that shares the subject's
  // silence proves nothing. (The truly independent witness — universe_fire_log — is check-fleet-meter-
  // visibility's job; this leg proves the reader agrees with its own inputs.)
  const [{ walk_requests: walkRequests, walk_rows: walkRows }] = await q(
    `select (select coalesce(sum(requests_spent),0) from public.universe_window_log
              where vendor = 'google_ads' and started_at >= $1)::bigint
          + (select coalesce(sum(requests_spent),0) from public.universe_attempt_log
              where vendor = 'google' and phase = 'attempt_started' and recorded_at >= $1)::bigint
            as walk_requests,
            ((select count(*) from public.universe_window_log
              where vendor = 'google_ads' and started_at >= $1)
          + (select count(*) from public.universe_attempt_log
              where vendor = 'google' and phase = 'attempt_started' and recorded_at >= $1))::int
            as walk_rows`, [since.toISOString()])
  const walk = Number(walkRequests)
  // LORAMER_FORWARD_OBSERVATION_LOG_V1 — the forward witness: the reader's forward term must equal the ledger's own
  // sum over the same window (it is that sum, read through the RPC; a mismatch means the RPC and the table
  // disagree, or a reader multiplied a measured number). Zero is the NORMAL state until the first fire after
  // the 087 deploy (2026-09-06 08:08Z) and is said out loud rather than passed silently.
  const [{ fwd_requests: fwdRequests, fwd_rows: fwdRows }] = await q(
    `select coalesce(sum(requests_spent),0)::bigint as fwd_requests, count(*)::int as fwd_rows
       from public.forward_observation_log where vendor = 'google' and observed_at >= $1`, [since.toISOString()])
  const fwd = Number(fwdRequests)

  globalThis.__SB__ = makeSb()
  const live = await mod.readGoogleSpendToday(since)

  if (live === null) {
    findings.push(`(k) readGoogleSpendToday returned NULL over the trailing 24h — the fleet read is UNREADABLE, so every google lane is holding right now. That is fail-closed and therefore safe, but it is not a pass.`)
  } else if (Number(live.byLane.forward) !== fwd) {
    findings.push(`(k) the forward lane reports ${live.byLane.forward} against ${fwd} request(s) across ${fwdRows} forward_observation_log row(s) over the same window — the reader's forward term is no longer the ledger's own sum.`)
  } else if (walk > 0 && Number(live.byLane.backfill) === 0) {
    findings.push(`(k) STRUCTURAL ZERO: the walk ledgers record ${walk} vendor requests across ${walkRows} row(s) in the trailing 24h, and the backfill lane reports 0. The walk's spend is invisible to the fleet ceiling — forward, catchup and drain are all measuring against a denominator missing the largest single spender.`)
  } else if (walk > 0 && Number(live.byLane.backfill) !== walk) {
    findings.push(`(k) the backfill lane reports ${live.byLane.backfill} against ${walk} requests across BOTH walk ledgers (window_log 'google_ads' + attempt_log attempt_started 'google') over the same window. requests_spent is ALREADY in requests — a mismatch here is the ×67 unit trap, a day-boundary drift, or a missing/extra ledger term.`)
  }
  // ⛔ EMPTY CARRIES ITS DENOMINATOR. A quiet walk is the NORMAL state while it is halted, and this leg must
  // say so out loud rather than printing a bare PASS that a reader mistakes for "the counting works".
  console.log(`[google-op-budget] (k) live forward witness: forward_observation_log holds ${fwd} request(s) across ${fwdRows} row(s) in the window; the reader's forward term reports ${live?.byLane?.forward}${fwdRows === 0 ? ' — ZERO is the normal state until the first forward fire after the 087 deploy (2026-09-06 08:08Z)' : ''}.`)
  console.log(
    walk > 0
      ? `[google-op-budget] (k) live: walk spent ${walk} requests across ${walkRows} ledger row(s) in the trailing 24h; backfill lane reports ${live?.byLane?.backfill}.`
      : `[google-op-budget] (k) live: BOTH walk ledgers record ZERO requests in the trailing 24h (${walkRows} rows) — the walk is halted, so this leg is VACUOUS today. It asserts nothing about the counting; the static legs (j) do.`)
  await db.end()
}

// ══ LORAMER_GOOGLE_LANE_ALLOCATION_V1 + the rolling-window correctness fix, 2026-08-09 ══════════════════
// Four legs, each seen RED against the pre-fix tree before it was allowed to pass.
{
  const opb = readFileSync(resolve(ROOT, 'src/lib/backfill/google-op-budget.ts'), 'utf8')
  const uwl = readFileSync(resolve(ROOT, 'src/lib/backfill/universe-window-log.ts'), 'utf8')
  const nocomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  // ── THE READER SET IS **DERIVED FROM CALL SITES**, NOT HAND-LISTED ─────────────────────────────────────
  // ⛔ LORAMER_V2_METER_ROLLING_WINDOW_V1, 2026-08-11. Legs (l) and (o) below used to iterate a HAND-WRITTEN
  // list of two files, written when there were two readers. A THIRD arrived —
  // `capture-adapters/google-ads.adapter.ts`, the file the v2 walk actually meters through — and both legs
  // stayed GREEN over a midnight window in it for the whole of the engine's first two live runs. That is
  // Lesson 68 shape (a) exactly: AN ASSERTION THAT ENCODES A SUPERSEDED MODEL, here a model of WHO THE
  // READERS ARE. A hand list cannot go red for a file nobody added to it.
  // ⛔ MATCHED ON THE **CALL**, NOT THE IMPORT (Lesson 68 shape (c)). `queues/google-ads-universe-v2` imports
  // `readAttemptLaneSpendToday` and never calls it — an import-shaped leg would have blessed a dead import
  // and told us nothing. Function DECLARATIONS are excluded so the two definers do not match themselves.
  const CALLS_A_SPEND_READER = /(?<!function\s)\b(readLaneSpendToday|readAttemptLaneSpendToday)\s*\(/
  const spendReaderFiles = []
  {
    const walk = (dir) => {
      for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(rel); continue }
        if (!/\.tsx?$/.test(e.name)) continue
        const src = read(rel)
        if (CALLS_A_SPEND_READER.test(nocomment(src))) spendReaderFiles.push([rel, src])
      }
    }
    try { walk('src') } catch { /* a missing src is caught far louder elsewhere */ }
    if (spendReaderFiles.length < 2) {
      findings.push(`(l) the spend-reader scan found ${spendReaderFiles.length} file(s) calling readLaneSpendToday/readAttemptLaneSpendToday. It found at least 3 when this leg was written (google-op-budget, universe-window-log, google-ads.adapter), so the SCANNER is broken and legs (l)/(o) are proving nothing — a guard testing its own harness is Lesson 68 shape (b).`)
    }
  }

  // ── (l) THE WINDOW IS ROLLING, NOT A CALENDAR DAY ──────────────────────────────────────────────────────
  // ⛔ VERIFIED AT GOOGLE 2026-08-09: "per day is based on a rolling 24 hour period in which API requests were
  // made with your developer token", and the limits do not reset at the same time each day
  // (developers.google.com/google-ads/api/docs/best-practices/quotas). Counting from UTC midnight means that
  // at 00:05 UTC the counter reads ~0 while the vendor may still hold ~14,000 from the previous 23 hours —
  // every lane sees an empty budget at exactly the hour refusal is most likely. MEASURED over 30 days: the
  // rolling measure breaches 15,000 in 57 of 721 hours (7.9%) against 2 of 30 calendar days.
  for (const [file, src] of spendReaderFiles) {
    if (/setUTCHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(nocomment(src))) {
      findings.push(`(l) ${file} CALLS a spend reader and still floors a window to UTC MIDNIGHT (setUTCHours(0,0,0,0)) while the vendor enforces a ROLLING 24-HOUR period. MEASURED 2026-08-11 01:21Z on the walk's own ledger: rolling 23 vs midnight 20 — the two readings had already diverged. Every lane budgets against a counter that resets hours before Google's does.`)
    }
  }
  if (!/rollingWindowStart/.test(nocomment(opb)) || !/rollingWindowStart/.test(nocomment(uwl))) {
    findings.push(`(l) at least one spend reader does not use rollingWindowStart(). Both readers must compute the same window or the fleet total is assembled from two different periods.`)
  }

  // ── (m) ONE REQUEST IS ONE OPERATION, WHEREVER IT IS DECLARED ──────────────────────────────────────────
  // ⛔ VENDOR-SETTLED: a Search or SearchStream request counts as ONE operation irrespective of batches, and
  // paginated requests with a VALID next_page_token are not counted at all. SAFETY_MULTIPLIER = 1.5 was ours,
  // and it is not conservatism — it is a 50% fiction added to every lane's spend, which measurably refused
  // catchup on days the vendor would have served.
  if (/\bSAFETY_MULTIPLIER\b/.test(nocomment(opb))) {
    findings.push(`(m) SAFETY_MULTIPLIER still exists in google-op-budget.ts. The vendor settles the ratio at 1 request = 1 operation; a multiplier here inflates every lane's spend by 50% and silently refuses work the vendor would serve.`)
  }
  for (const m of nocomment(opb).matchAll(/\bOPS_PER_REQUEST\s*=\s*([\d.]+)/g)) {
    if (Number(m[1]) !== 1) findings.push(`(m) OPS_PER_REQUEST is declared as ${m[1]} in google-op-budget.ts. The vendor says ONE. A number other than 1 here is a claim about Google that Google contradicts.`)
  }

  // ── (n) EVERY PRIORITISED LANE HAS AN ALLOCATION, AND THEY SUM TO THE CAP ──────────────────────────────
  // ⛔ A lane that can be REFUSED but has no SHARE is a lane nobody sized. Model A never named the walk;
  // Model B never named catchup — the dominant spender at ~82% of fleet volume.
  const alloc = mod.LANE_ALLOCATIONS
  if (!alloc || typeof alloc !== 'object') {
    findings.push(`(n) google-op-budget.ts exports no LANE_ALLOCATIONS table. The allocation must be ONE readable object, not a derivation spread across two files (LORAMER_GOOGLE_LANE_ALLOCATION_V1).`)
  } else {
    for (const lane of mod.LANE_PRIORITY) {
      if (!Number.isFinite(alloc[lane])) findings.push(`(n) lane '${lane}' appears in LANE_PRIORITY but has NO allocation. It can be refused and was never given a share.`)
    }
    const sum = Object.values(alloc).reduce((a, b) => a + Number(b || 0), 0)
    if (sum !== mod.GOOGLE_DAILY_OP_CAP) {
      findings.push(`(n) the allocations sum to ${sum}, not the ${mod.GOOGLE_DAILY_OP_CAP} cap. Under-summing leaves quota nobody may spend; over-summing is a promise the vendor will not keep.`)
    }

    // ── (p) THE WALK-TAKES-THE-LANE POLICY IS THE ONE IN FORCE ─────────────────────────────────────────────
    // ⛔ LORAMER_WALK_TAKES_THE_LANE_V1, Russ 2026-08-10, implemented 2026-08-11. This leg exists so a lane
    // cannot be quietly restored WITHOUT A DECISION — the policy silences three live capture lanes on Russ's
    // own clients, and the way that gets undone by accident is somebody "fixing" a zero that looks like a bug.
    // ⛔ THE REVERSAL IS CONDITION-GATED, NOT DATE-GATED: the lanes come back when the backfill engine is
    // COMPLETE AND PROVEN CORRECT, and RUSS CALLS IT. **DELETE THIS LEG IN THE SAME COMMIT AS THE REVERSAL** —
    // it is a pin on a deliberate temporary state, not a permanent law, and leaving it behind would refuse the
    // restoration it was written to protect.
    if (Number(alloc.drain) !== 0 || Number(alloc.catchup) !== 0) {
      findings.push(`(p) drain=${alloc.drain} catchup=${alloc.catchup} — LORAMER_WALK_TAKES_THE_LANE_V1 sets BOTH to 0. If the engine is now complete and Russ has called the reversal, delete this leg in the same commit; if not, a lane was restored without a decision.`)
    }
    if (Number(alloc.backfill) !== mod.GOOGLE_DAILY_OP_CAP - Number(mod.FORWARD_UNGATED_RESERVE)) {
      findings.push(`(p) backfill=${alloc.backfill}, expected cap ${mod.GOOGLE_DAILY_OP_CAP} − forward reserve ${mod.FORWARD_UNGATED_RESERVE}. The walk takes everything that is ACTUALLY available, and the reserve is the only subtrahend.`)
    }
    // ⛔ THE RESERVE MAY NOT BE ZEROED WHILE cron/sync IS UNGATED, AND THIS IS THE LEG THAT MATTERS MOST.
    // `backfill: 15_000` with forward still spending ~1,206/day un-metered and unseen by the walk's own meter
    // is a 16,206-against-15,000 overrun — the 2026-08-06 crisis shape, designed in. The reserve may go to 0
    // ONLY in a commit that genuinely gates forward, and this leg checks the gate rather than trusting a claim.
    {
      const sync = read('src/app/api/cron/sync/route.ts')
      const syncIsGated = /getGoogleOpBudget|holdForBudget|holdGoogleWork/.test(nocomment(sync))
      if (Number(mod.FORWARD_UNGATED_RESERVE) === 0 && !syncIsGated) {
        findings.push(`(p) FORWARD_UNGATED_RESERVE is 0 while cron/sync consults NO budget and NO quota gate — so forward still spends (measured 2026-08-11: 18 connection-days/day ⇒ ~1,206 requests at the repo's ×67) and the walk's meter cannot see it. That authorises ~16,206 against a hard 15,000. Gate cron/sync first, or keep the reserve.`)
      }
      if (Number(mod.FORWARD_UNGATED_RESERVE) !== 0 && syncIsGated) {
        findings.push(`(p) cron/sync now consults a budget/quota gate, so FORWARD_UNGATED_RESERVE (${mod.FORWARD_UNGATED_RESERVE}) is holding back quota nothing needs — the walk should take the literal 15,000 the decision asked for. Set the reserve to 0 in the same commit that gated forward.`)
      }
    }
  }

  // ── (o) ONE WINDOW FUNCTION, NOT TWO ───────────────────────────────────────────────────────────────────
  // ⛔ The fleet total is assembled from BOTH readers. Two independently-computed "since" values is how the
  // same fleet gets measured over two different periods — the defect one layer up from (l).
  const winFile = 'src/lib/backfill/google-quota-window.ts'
  if (!existsSync(resolve(ROOT, winFile))) {
    findings.push(`(o) ${winFile} does not exist. The shared window must live in ONE module both readers import; google-op-budget imports universe-window-log, so it cannot own it without a cycle.`)
  } else {
    // ⛔ SCOPED TO THE FILES THAT PASS AN EXPLICIT `since`, WHICH IS THE ONLY PLACE A SECOND WINDOW CAN BE
    // BORN. `readAttemptLaneSpendToday(vendor, since)` REQUIRES one by signature, so every caller of it is
    // in scope; `readLaneSpendToday()` called argless defaults to rollingWindowStart() INSIDE its own module
    // and needs no import — demanding one there would be a false red on `universe-start` and the v1 consumer,
    // and a guard that fires on correct code is a guard people learn to ignore.
    for (const [file, src] of spendReaderFiles) {
      const s = nocomment(src)
      const passesSince = /readAttemptLaneSpendToday\s*\(/.test(s) || /readLaneSpendToday\s*\(\s*[^)\s]/.test(s)
      if (!passesSince) continue
      if (!/import[^\n]*rollingWindowStart[^\n]*google-quota-window/.test(s)) {
        findings.push(`(o) ${file} computes its own \`since\` for a spend read but does not IMPORT rollingWindowStart from google-quota-window. A local copy of the window is a second source of truth for the one number every reader must agree on — and it is how the v2 walk's meter ended up summing a rolling term and a midnight term into a single fleet number.`)
      }
    }
  }
}

rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error(`[google-op-budget] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[google-op-budget] PASS — lanes bill their OWN mode's rows (forward/drain connections, catchup gap-days), every lane has a cron_runs write path, catchup (${CATCHUP_ALLOCATION}) cannot spend the ranked reserve (${RANKED_RESERVE}), the fleet cap backstops independently, declines carry their denominator, and an unreadable budget HOLDS.`)
