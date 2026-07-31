#!/usr/bin/env node
// LORAMER_GOOGLE_OP_BUDGET_V1 — guard ALLOCATE-BEFORE-SPENDING (★GOOGLE-QUOTA-PRIORITY-INVERSION).
//
// WHAT WE HAD WAS STOP-WHEN-DEAD. `holdGoogleWork` is REACTIVE — it reads a sentinel Google set AFTER the 15k
// Basic-Access cap was already gone, so it cannot stop the lane that spent it. The developer-scope quota was
// exhausted before the ranked geo lap could run on three consecutive days, and catchup is the lane with no
// allocation of any kind. This guard pins the allocate half.
//
// FOUR FAILURES, each independent:
//  (a) a capture lane that can spend Google operations WITHOUT consulting the budget
//  (b) catchup able to spend into the RESERVE that forward / the geo lap / scoped recovery live in
//  (c) a lane DECLINING without recording it — a silent no-op is indistinguishable from a lane that never
//      fired, which is the ambiguity removed on 2026-07-31 (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1)
//  (d) the budget degrading to NOT-BLOCKED when it cannot be READ — an unreadable budget is not headroom, and
//      a failed read returning "fine" is how 178 gap-days went out against an exhausted quota on 2026-07-28
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

for (const n of ['decideBudget', 'holdForBudget', 'getGoogleOpBudget', 'recordLaneDeclined', 'readGoogleRequestsToday']) {
  if (typeof mod[n] !== 'function') fail(`${SRC} does not export ${n}.`)
}
const { decideBudget, holdForBudget, CATCHUP_ALLOCATION, RANKED_RESERVE, GOOGLE_DAILY_OP_CAP, SAFETY_MULTIPLIER } = mod

// ── (d) UNREADABLE MUST NOT BE HEADROOM ────────────────────────────────────────────────────────────────
{
  const b = decideBudget('catchup', null)
  check(b.state === 'unknown', `(d) an UNREADABLE budget resolved '${b.state}' — it must be 'unknown'. A failed read returning headroom is how 178 gap-days went out against an exhausted quota on 2026-07-28.`)
  check(b.state !== 'not_blocked', `(d) an unreadable budget resolved NOT-BLOCKED — the lane would spend.`)
  check(holdForBudget(b) === true, `(d) holdForBudget did not HOLD on 'unknown'. The rule is identical to holdGoogleWork and for the identical reason.`)
  check(decideBudget('catchup', NaN).state === 'unknown', `(d) a NaN spend reading did not resolve 'unknown'.`)
  check(holdForBudget(decideBudget('catchup', 0)) === false, `POSITIVE CONTROL: a healthy budget HELD — the gate can only ever say stop, so it says nothing.`)
}

// ── (b) CATCHUP MAY NOT SPEND INTO THE RESERVE ─────────────────────────────────────────────────────────
{
  check(CATCHUP_ALLOCATION + RANKED_RESERVE === GOOGLE_DAILY_OP_CAP,
    `(b) allocation ${CATCHUP_ALLOCATION} + reserve ${RANKED_RESERVE} != cap ${GOOGLE_DAILY_OP_CAP} — the split does not account for the whole cap.`)
  check(CATCHUP_ALLOCATION < RANKED_RESERVE,
    `(b) catchup's allocation (${CATCHUP_ALLOCATION}) is not smaller than the ranked reserve (${RANKED_RESERVE}) — the deep-history lane must be the MINORITY spender; it is the one that emptied the cap three days running.`)
  // spend right up to catchup's allocation → blocked, while the ranked lane still has room.
  const atLimit = Math.ceil(CATCHUP_ALLOCATION / SAFETY_MULTIPLIER)
  const c = decideBudget('catchup', atLimit)
  check(c.state === 'blocked', `(b) catchup at its full allocation resolved '${c.state}' — it can spend into the reserve.`)
  const d = decideBudget('drain', atLimit)
  check(d.state === 'not_blocked', `(b) the RANKED lane was blocked by catchup's spend (${d.state}) — the reserve is not reserved; forward and the geo lap would starve exactly as they have been.`)
  check(d.allocation > c.allocation, `(b) the ranked lane's allocation is not larger than catchup's.`)
}

// ── the estimate must be a LOWER BOUND and must SAY SO IN THE DATA ─────────────────────────────────────
{
  const b = decideBudget('catchup', 100)
  check(b.isLowerBound === true, `(units) the budget does not declare itself a lower bound. Google bills OPERATIONS, not requests, and the ratio is not derivable from our code — ★GAQL-OP-COUNT-DISCREPANCY.`)
  check(b.rawRequestsToday === 100 && b.estimatedOpsSpentToday >= 100,
    `(units) the raw request count is not preserved alongside the multiplied estimate — the assumption must be visible, not inherited.`)
  check(b.safetyMultiplier > 1, `(units) the safety multiplier is <= 1; ops >= requests, so the estimate must over-count and stop EARLY.`)
}

// ── (a) EVERY SPENDING LANE CONSULTS THE BUDGET ────────────────────────────────────────────────────────
const LANES = [
  ['src/app/api/cron/catchup/route.ts', 'catchup'],
  ['src/app/api/cron/drain/route.ts', 'drain'],
]
for (const [f, lane] of LANES) {
  const src = read(f)
  check(!!src, `(a) ${f} is unreadable.`)
  if (!src) continue
  check(/getGoogleOpBudget\(/.test(src),
    `(a) ${f} spends Google operations WITHOUT consulting the budget — it gates only on the reactive sentinel, which cannot stop the lane that empties the cap.`)
  check(/holdForBudget\(/.test(src),
    `(a) ${f} reads the budget but never applies holdForBudget — reading a limit without honouring it is not a limit.`)
  // (c) declining must be recorded
  check(/recordLaneDeclined\(/.test(src),
    `(c) ${f} can decline WITHOUT recording it. A lane that no-ops silently is indistinguishable from a lane that never fired — the exact ambiguity removed on 2026-07-31.`)
}
// catchup's gate must actually be applied at the fan-out, not merely computed.
{
  const src = read('src/app/api/cron/catchup/route.ts')
  check(/googleQuotaPaused \|\| googleBudgetHold/.test(src),
    `(a) catchup computes a budget hold but the google fan-out gate does not include it — the value is dead and the lane still spends.`)
}
// the scoped bypass must survive: manual recovery has to remain possible.
{
  const src = read('src/app/api/cron/drain/route.ts')
  // ⚠ ANCHOR ON THE CALL, NOT THE IDENTIFIER. indexOf('getGoogleOpBudget') matches the IMPORT first, 80 lines
  // above the call site, and the lookback then reads the import block instead of the guard clause — the check
  // failed while the code was correct. Lesson 60's sibling: a green/red is only as good as what it anchored to.
  const i = src.indexOf("getGoogleOpBudget('drain')")
  const before = src.slice(Math.max(0, i - 600), i)
  check(i > 0 && /if \(!onlyClientId\) \{/.test(before),
    `(a) the drain's budget gate is NOT inside 'if (!onlyClientId)' — a scoped manual recovery would be blocked by the automatic lanes' spend, which must remain possible.`)
}

// ── THE THREE-STATE VOCABULARY IS THE BANKED ONE, NOT A FOURTH DIALECT ─────────────────────────────────
{
  const src = read(SRC)
  check(/GoogleQuotaReadState/.test(src),
    `(vocab) the budget declares its own state union instead of reusing GoogleQuotaReadState ('blocked'|'not_blocked'|'unknown') from google-quota-store.ts.`)
  const states = new Set(['blocked', 'not_blocked', 'unknown'])
  for (const s of [decideBudget('catchup', null).state, decideBudget('catchup', 0).state, decideBudget('catchup', 1e9).state]) {
    check(states.has(s), `(vocab) the budget emitted state '${s}', outside the banked three.`)
  }
}

rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error(`[google-op-budget] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[google-op-budget] PASS — both lanes consult the budget and honour it, catchup (${CATCHUP_ALLOCATION}) cannot spend into the ranked reserve (${RANKED_RESERVE}), declines are recorded, an unreadable budget HOLDS, and the estimate declares itself a lower bound.`)
