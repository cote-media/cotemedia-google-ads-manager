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

const { decideBudget, holdForBudget, CATCHUP_ALLOCATION, RANKED_RESERVE, GOOGLE_DAILY_OP_CAP, SAFETY_MULTIPLIER } = mod
// Helper: build the per-lane spend shape the fixed reader returns.
const spend = (o = {}) => ({ byLane: { forward: 0, catchup: 0, drain: 0, backfill: 0, ...o }, unattributedRaw: o.unattributedRaw || 0 })

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
  // ⛔ THE ASKER MOVED FROM 'drain' TO 'catchup' ON 2026-08-05 AND THE PROPERTY DID NOT CHANGE. Under
  // LORAMER_FLEET_CEILING_HAS_A_PRIORITY_ORDER_V1 the drain is no longer refused for a ceiling that CATCHUP
  // helped exhaust — catchup ranks below it and yields first, which is the whole point of the flight. The
  // property this leg protects is "the cap bites even when the LANE still has room", and the lane that can
  // demonstrate it is now one with nothing below it holding spend. Kept, not deleted: an enforcer that is
  // rewritten because the behaviour changed must still assert the original guarantee.
  const perLane = Math.ceil((GOOGLE_DAILY_OP_CAP / SAFETY_MULTIPLIER) * 0.6)
  const b = decideBudget('catchup', spend({ forward: perLane, drain: perLane }))
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

  // (a) FORWARD IS NEVER REFUSED WHILE A LOWER LANE HOLDS SPEND. Fleet ceiling blown by catchup + drain.
  {
    const s = spend({ forward: 100, catchup: 5000, drain: 5000 })
    const b = decideBudget('forward', s)
    check(b.state === 'not_blocked' && !holdForBudget(b),
      `(i.a) FORWARD was refused (${b.state}/${b.blockedBy}) with the ceiling exhausted by catchup and drain while forward sat at ${b.estimatedOpsSpentToday}/${b.allocation} of its own allocation. Forward carries TODAY's customer data and is refused LAST — the lanes below it yield first.`)
  }
  // (b) THE SAME PROTECTION ONE RUNG DOWN — drain, inside its allocation, above catchup.
  {
    const b = decideBudget('drain', spend({ drain: 100, catchup: 9900 }))
    check(b.state === 'not_blocked',
      `(i.b) DRAIN was refused on a ceiling consumed by CATCHUP, a lower-priority lane, while drain was inside its own allocation. The drain's work expires against a moving wall; catchup's does not.`)
  }
  // ⛔ AND THE ORDER MUST ACTUALLY BITE — this is not "everyone is admitted". With only HIGHER lanes holding
  // spend, the lane at the bottom of those with spend IS refused.
  {
    const b = decideBudget('catchup', spend({ forward: 9900, catchup: 100 }))
    check(b.state === 'blocked' && b.blockedBy === 'fleet_cap',
      `(i.b2) CATCHUP was ADMITTED (${b.state}) on an exhausted ceiling with no lower-priority lane holding spend. Nothing below it can yield, so it must yield itself — otherwise the ordering admits everyone and protects nobody.`)
  }
  // (c) FAIL-OPEN: an unknown lane identity must sort LAST, never inherit forward's seat.
  {
    // ⛔ THE MESSAGE MUST NOT CALL THE THING IT IS REPORTING MISSING. A template literal is evaluated when the
    // argument is BUILT, not when the check fails, so interpolating priorityOf() here crashed the whole guard
    // against a pre-fix body — the second time this leg turned a RED into a stack trace.
    const pMystery = hasOrder ? priorityOf('mystery-lane') : 'ABSENT'
    check(hasOrder && pMystery === LANE_PRIORITY.length && pMystery > priorityOf('forward'),
      `(i.c) an UNKNOWN lane resolved to priority ${pMystery} — it must sort LAST. A typo or a future lane inheriting top priority is the fail-open this ordering exists to prevent, and it hands an unaudited spender the seat that belongs to today's data.`)
    const b = decideBudget('mystery-lane', spend({ forward: 9900, catchup: 100 }))
    check(b.state === 'blocked',
      `(i.c) an UNKNOWN lane was ADMITTED on an exhausted ceiling. Unknown identity fails CLOSED.`)
  }
  // (d) UNATTRIBUTED SPEND IS NOT A LANE AND CANNOT BE BLAMED — fail closed when nothing below can yield.
  {
    const b = decideBudget('forward', spend({ forward: 100, unattributedRaw: 10000 }))
    check(b.state === 'blocked' && b.blockedBy === 'fleet_cap',
      `(i.d) the ceiling was consumed by UNATTRIBUTED spend and forward was still admitted. Unattributed belongs to no lane, so there is nobody below to refuse first — that is the fail-closed branch.`)
  }
  // (e) THE BACKFILL LANE IS WIRED BUT NOT COUNTED — flight 1 of 2, asserted so the gap stays visible.
  {
    check((mod.BUDGET_LANES || []).includes('backfill'),
      `(i.e) 'backfill' is not a BudgetLane. The universe walk spends Google operations; a spender that is not a lane cannot be ordered, counted, or refused.`)
    const s = spend()
    check(Object.prototype.hasOwnProperty.call(s.byLane, 'backfill') || true, 'shape')
    check(decideBudget('backfill', spend({ forward: 9900, catchup: 100 })).state === 'blocked',
      `(i.e) the BACKFILL lane was admitted on an exhausted ceiling. It is the lowest priority there is — it yields to everything.`)
  }
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
