#!/usr/bin/env node
// LORAMER_GA_DIM_COMPLETION_HONESTY_V1 — guard the boolean that lied.
//
// WHAT IT PROVES: it drives the REAL exported `decideGaDimCompletion` from ga-dimensional-backfill.ts —
// transpiled with the installed tsc, not a re-implementation — over the four states that matter, each with a
// known correct answer.
//   (i)   REACHED FLOOR *WITH* A SKIPPED FAMILY -> NOT complete.  ⬅ THE WHOLE POINT. This is the exact state that
//         produced the 2026-07-30 defect: the walk crossed 100+ months to HARD_FLOOR 2015-08-14 while a family GA
//         could not serve had disabled the empty-month floor detector, so it arrived at the floor having written
//         nothing and reported complete=true. 13,103 recoverable client-days sat behind three such booleans.
//         Pre-fix code returns TRUE here; that mismatch is the mutation proof, not merely an absence.
//   (ii)  REACHED FLOOR CLEAN                   -> complete. The fix must not make completion unreachable — a
//         guard that can only ever say "not done" would stall every GA backfill forever.
//   (iii) SIX CLEAN-EMPTY MONTHS (reachedStart) -> complete, EVEN WITH skips. Honest floor detection wins: if the
//         detector fired, the property's data-start was found by clean empties and the walk is genuinely done.
//   (iv)  TIMED OUT AT THE FLOOR                -> NOT complete. Resume, never claim.
// Plus: an ERRORED walk at the floor -> NOT complete (the pre-existing clause, asserted so a refactor cannot drop
// it while adding the new one).
//
// ⚠ HONEST LIMIT: this proves the DECISION. It does NOT prove the call site passes the right arguments, and it
// cannot prove GA's behaviour — which family threw on those three clients, and why GA stopped serving at
// 2026-01-01 / 2024-02-01 / 2023-01-01, remains UNVERIFIED and needs a probe. The DB-side half of this class
// (complete=true while the family's actual min(date) is later than the cursor) is QUEUE ★COMPLETE-FLAG-AUDIT and
// belongs in check:data, not here.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[ga-dim-completion-honesty] FAIL — ${m}`); process.exit(1) }

const SRC = 'src/lib/backfill/ga-dimensional-backfill.ts'
if (!existsSync(resolve(ROOT, SRC))) fail(`${SRC} is missing.`)

const out = mkdtempSync(join(tmpdir(), 'loramer-gadim-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

// The module imports '@/lib/supabase', '@/lib/metrics-normalize' and '@/lib/ga-token' at module scope.
// decideGaDimCompletion touches NONE of them, but the requires would throw on load, so the aliases are stubbed.
// Stubbing is confined to state that cannot exist without a DB or a token — the DECISION is the real function.
const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = { supabaseAdmin: {}, normalizeMetricsRows: (r) => r, getValidGaToken: async () => ({ ok: false }) }\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/lib/')) return stub
  return origResolve.call(this, request, ...rest)
}

const req = createRequire(import.meta.url)
let mod
try { mod = req(join(out, 'src/lib/backfill/ga-dimensional-backfill.js')) }
catch (e) { rmSync(out, { recursive: true, force: true }); fail(`compiled module did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
rmSync(out, { recursive: true, force: true })

if (typeof mod.decideGaDimCompletion !== 'function') {
  fail(`${SRC} does not export decideGaDimCompletion — the completion decision is inlined again, which is what made it untestable and let it lie. Extract it.`)
}
const decide = mod.decideGaDimCompletion

const FLOOR = '2015-08-14'
const base = { reachedStart: false, earliestWritten: FLOOR, targetStart: FLOOR, errorCount: 0, timedOut: false, skippedCount: 0 }

const CASES = [
  {
    name: 'reached-floor-WITH-a-skipped-family',
    args: { ...base, skippedCount: 1 },
    expect: false,
    why: 'THE 2026-07-30 DEFECT. A walk that met an unserved family does not know what it crossed, so it cannot claim the ground. Pre-fix code returns true here and seals the cursor at 2015-08-14 over unwritten years.',
  },
  {
    name: 'reached-floor-clean',
    args: { ...base },
    expect: true,
    why: 'Completion must stay REACHABLE. If this returns false the fix has stalled every GA backfill permanently.',
  },
  {
    name: 'six-clean-empty-months (reachedStart) even WITH skips',
    args: { ...base, reachedStart: true, earliestWritten: '2024-03-01', skippedCount: 2 },
    expect: true,
    why: 'Honest floor detection wins: consecutiveEmpty only counts CLEAN empty months, so if it fired the property data-start was genuinely found.',
  },
  {
    name: 'timed-out-at-the-floor',
    args: { ...base, timedOut: true },
    expect: false,
    why: 'A budget-exhausted lap resumes; it never claims done.',
  },
  {
    name: 'errored-at-the-floor (pre-existing clause, asserted so a refactor cannot drop it)',
    args: { ...base, errorCount: 1 },
    expect: false,
    why: 'A thrown month means the cursor was not advanced past it; claiming done would strand it.',
  },
  {
    name: 'short-of-the-floor, clean',
    args: { ...base, earliestWritten: '2024-01-01' },
    expect: false,
    why: 'Not at the floor and no honest data-start detected — more walking to do.',
  },
]

for (const c of CASES) {
  let got
  try { got = decide(c.args) } catch (e) { findings.push(`${c.name}: threw — ${e.message}`); continue }
  if (got !== c.expect) findings.push(`${c.name}: expected complete=${c.expect}, got ${got}. ${c.why}`)
}

// ── LORAMER_GA_DIM_ZERO_WORK_RESTART_V1 — THE ZERO-WORK BRANCH ─────────────────────────────────────────────────
// ⚠ THIS CASE IS NOT EXPRESSIBLE THROUGH decideGaDimCompletion, AND THE ASSERTION IS NOT WEAKENED TO FIT.
// The pre-fix branch never CALLED the completion decision — it wrote `complete=true` directly and returned, having
// walked zero months. So the real decision point is the WALK WINDOW, extracted as resolveGaDimWindowEnd. Asserted
// there, plus a source-level check that the literal zero-work seal is gone (the un-evadable half: a re-inlined
// branch would pass every behavioural test by simply not being reached).
if (typeof mod.resolveGaDimWindowEnd !== 'function') {
  findings.push(`does not export resolveGaDimWindowEnd — the zero-work branch (upsertCursor(…, true) with zero months walked) has no testable decision point. Extract it.`)
} else {
  const w = mod.resolveGaDimWindowEnd
  const WINDOW_CASES = [
    { name: 'never-walked (null cursor) -> start at yesterday', got: () => w(null, '2026-07-29', FLOOR), expect: '2026-07-29',
      why: 'A cursor with no row must walk backward from the end date. Pre-existing behaviour, pinned so the fix cannot change it.' },
    { name: 'ZERO-WORK: cursor already AT the floor -> RESTART at endDate, do not seal', got: () => w(FLOOR, '2026-07-29', FLOOR), expect: '2026-07-29',
      why: 'THE 2026-07-30 DEFECT. Pre-fix this branch asserted complete=true with zero months walked and zero rows written, and it is only reachable when complete=false, so the state is anomalous by construction. It must WALK, not seal.' },
    { name: 'cursor BELOW the floor -> RESTART at endDate', got: () => w('2010-01-01', '2026-07-29', FLOOR), expect: '2026-07-29',
      why: 'Same branch, reached from a value further below the floor.' },
    { name: 'normal resume -> the day before the cursor', got: () => w('2024-01-01', '2026-07-29', FLOOR), expect: '2023-12-31',
      why: 'The ordinary path must be untouched, or the fix has broken every healthy GA backfill.' },
  ]
  for (const c of WINDOW_CASES) {
    let got
    try { got = c.got() } catch (e) { findings.push(`${c.name}: threw — ${e.message}`); continue }
    if (got !== c.expect) findings.push(`${c.name}: expected ${c.expect}, got ${got}. ${c.why}`)
  }
}
// SOURCE ASSERTION — the literal zero-work seal must not exist. Behavioural tests cannot see a branch that
// short-circuits before the decision functions are reached, so this one reads the file.
// QUOTATION IS NOT ASSERTION — the same lesson the canonical-identity guard already paid for. The header of the
// module under test QUOTES the defective line verbatim to teach why the rule exists, so comment lines are stripped
// before the check. Otherwise the fix's own documentation would fail the guard, and a guard that forbids recording
// the bug gets deleted.
const src = readFileSync(resolve(ROOT, SRC), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
if (/upsertCursor\(\s*clientId\s*,\s*targetStart\s*,\s*targetStart\s*,\s*true\s*\)/.test(src)) {
  findings.push(`${SRC} still contains upsertCursor(clientId, targetStart, targetStart, true) — the zero-work seal. That call marks a cursor complete having walked no months and written no rows.`)
}

// ── LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — LEG (a): THE RECOVER ROUTE CANNOT CLAIM COMPLETION WITHOUT LANDED ROWS
// The recover path had NO completion concept at all — it did one fetch + one upsert for the whole window and returned
// rowsWritten, so a maxDuration kill produced no claim, no rows and no resume point (ATOMIC-NOTHING, verified live on
// Foam OH 2023-07). Now it decides, so the decision is asserted. The permissive direction is pinned too: a fully clean
// walk MUST be able to complete, or a recovery could never be declared finished and a human would re-run it forever.
if (typeof mod.decideGaRecoverCompletion !== 'function') {
  findings.push(`does not export decideGaRecoverCompletion — the recover route's completion claim has no testable decision point. Extract it.`)
} else {
  const d = mod.decideGaRecoverCompletion
  const rbase = { slicesWalked: 3, slicesTotal: 3, errorCount: 0, skippedCount: 0, timedOut: false, rowsWritten: 500 }
  const RECOVER_CASES = [
    { name: 'timed out mid-window WITH rows landed -> NOT complete', args: { ...rbase, slicesWalked: 1, timedOut: true },
      complete: false, why: 'THE DEFECT. Durable partial progress must never read as a finished window — that is the claim the completion-claim invariant exists to catch.' },
    { name: 'unwalked slices remain -> NOT complete', args: { ...rbase, slicesWalked: 2 },
      complete: false, why: 'Ground never asked for cannot be claimed, even with no error and no timeout flag.' },
    { name: 'a family GA REFUSED -> NOT complete even on a full walk', args: { ...rbase, skippedCount: 1 },
      complete: false, why: 'A skipped family is UNKNOWN coverage, not empty coverage. This is what sealed three golden cursors on 2026-07-30.' },
    { name: 'a slice threw -> NOT complete', args: { ...rbase, errorCount: 1 },
      complete: false, why: 'What the thrown slice held is unknown.' },
    { name: 'zero slices (empty window) -> NOT complete', args: { ...rbase, slicesWalked: 0, slicesTotal: 0, rowsWritten: 0 },
      complete: false, why: 'A walk of nothing is not a completed walk; slicesTotal>0 is required so a degenerate range cannot claim done.' },
    { name: 'full clean walk WITH rows -> complete + rowsCovered', args: { ...rbase },
      complete: true, rowsCovered: true, why: 'Completion must stay REACHABLE, or every recovery stalls permanently.' },
    { name: 'full clean walk, ZERO rows -> complete but rowsCovered FALSE (honest empty, named)', args: { ...rbase, rowsWritten: 0 },
      complete: true, rowsCovered: false, why: 'The one narrowing from the brief, stated on its face: GA served nothing and every family answered, so the window is genuinely empty. rowsCovered:false is the LOUD signal; it is not folded into complete.' },
  ]
  for (const c of RECOVER_CASES) {
    let got
    try { got = d(c.args) } catch (e) { findings.push(`recover/${c.name}: threw — ${e.message}`); continue }
    if (got?.complete !== c.complete) findings.push(`recover/${c.name}: expected complete=${c.complete}, got ${got?.complete}. ${c.why}`)
    if (c.rowsCovered !== undefined && got?.rowsCovered !== c.rowsCovered) {
      findings.push(`recover/${c.name}: expected rowsCovered=${c.rowsCovered}, got ${got?.rowsCovered}. ${c.why}`)
    }
  }
}

// SOURCE ASSERTION — the atomic-nothing shape must be gone from the recover path. A behavioural test on the decision
// cannot see a route that never reaches it, which is the same hole the zero-work seal exploited above.
if (!/onFamilyRows/.test(src)) {
  findings.push(`${SRC} has no onFamilyRows flush — the recover path writes once at the END of its window, so a maxDuration kill loses every row for that window (ATOMIC-NOTHING). Flush incrementally.`)
}
if (typeof mod.daySlices !== 'function') {
  findings.push(`does not export daySlices — the recover walk cannot be proven to slice SUB-MONTH, and a calendar month is measurably not survivable on a heavy property (229s measured, one month over the 300s ceiling).`)
} else {
  const sl = mod.daySlices('2023-07-01', '2023-07-31', 10)
  if (sl.length !== 4) findings.push(`daySlices('2023-07-01','2023-07-31',10) produced ${sl.length} slices, expected 4 — sub-month slicing is not in force.`)
  if (sl[0]?.from !== '2023-07-01' || sl[0]?.to !== '2023-07-10') findings.push(`daySlices first slice was ${sl[0]?.from}..${sl[0]?.to}, expected 2023-07-01..2023-07-10.`)
  if (sl[sl.length - 1]?.to !== '2023-07-31') findings.push(`daySlices last slice ended ${sl[sl.length - 1]?.to}, expected the window end 2023-07-31 — a slicer that overshoots or truncates the range silently changes what was recovered.`)
  const one = mod.daySlices('2023-07-05', '2023-07-05', 10)
  if (one.length !== 1 || one[0].from !== '2023-07-05' || one[0].to !== '2023-07-05') findings.push(`daySlices on a single day did not return exactly that day.`)
}

// ── LORAMER_GA_RECOVER_QUOTA_VISIBILITY_V1 — THE QUOTA HARD STOP ─────────────────────────────────────────────────
// ~1,104 GA reports run against a PER-PROPERTY daily cap that tomorrow morning's forward GA capture shares. Three
// properties are mechanically checkable, and each one failing has a distinct, expensive consequence.
// ⚠ WHAT IS NOT CHECKABLE HERE, NAMED: a real RESOURCE_EXHAUSTED cannot be induced — it is external service state,
// the narrow case the verification laws permit stubbing for. So the CLASSIFICATION and the PLUMBING are asserted; that
// GA actually returns the status on a real wall is taken from the vendor reference, not from our own observation.
if (typeof mod.gaQuotaPctRemaining !== 'function') {
  findings.push(`does not export gaQuotaPctRemaining — the quota floor has no drivable decision, so nothing proves it errs toward stopping early.`)
} else {
  const p = mod.gaQuotaPctRemaining
  const CAP = mod.GA_STANDARD_TOKENS_PER_DAY
  if (CAP !== 200_000) findings.push(`GA_STANDARD_TOKENS_PER_DAY is ${CAP}, expected 200000 (VERIFIED 2026-07-30, GA4 Data API quotas: standard property Core tokensPerDay).`)
  const QCASES = [
    { name: 'fresh standard property -> ~100%', got: () => p(200_000, 200_000), want: (v) => v >= 0.99,
      why: 'A full cap must not read as depleted, or the chain refuses to start.' },
    { name: 'below the floor on a standard cap -> under 20%', got: () => p(39_000, 39_000), want: (v) => v < 0.20,
      why: 'THE STOP. 39k of 200k is 19.5%; if this reads above the floor the chain keeps spending into tomorrow morning.' },
    { name: 'just above the floor -> not stopped', got: () => p(41_000, 41_000), want: (v) => v >= 0.20,
      why: 'A floor that fires early on a healthy quota trains the operator to raise it, which is how a stop gets removed.' },
    { name: 'A360-sized observed remaining widens the denominator (safe direction)', got: () => p(300_000, 2_000_000), want: (v) => v < 0.20,
      why: 'The LARGER of (documented cap, max observed) must win. 300k left on a 2M property IS low; measuring it against the 200k standard cap would read as 150% and never stop.' },
  ]
  for (const c of QCASES) {
    let v
    try { v = c.got() } catch (e) { findings.push(`quota/${c.name}: threw — ${e.message}`); continue }
    if (!c.want(v)) findings.push(`quota/${c.name}: got ${v}. ${c.why}`)
  }
}
if (typeof mod.GaQuotaExhaustedError !== 'function') {
  findings.push(`does not export GaQuotaExhaustedError — without a TYPED error a quota wall cannot be told apart from a family GA simply cannot serve.`)
}
// SOURCE: a quota wall must be RETHROWN out of the per-family catch. Swallowed, ONE wall becomes TWELVE fake
// "skipped" families, the loop hits it eleven more times, and the report names entirely the wrong cause.
// ⚠ WIDENED 2026-07-30 (LORAMER_GA_AUTH_IS_AN_ERROR_V1). The pattern demanded the literal `throw e` and went RED
// when FIX 3 changed it to `throw attachPartial(e)` — which still rethrows, and now carries the family lists the
// old form dropped on the floor. The assertion that MATTERS is "the typed error leaves the catch", not the exact
// expression, so it now accepts `throw <anything>(e)` too. This is a widening to the guard's real intent, NOT a
// relaxation: a swallowed quota error still fails, and the behavioural half is proven live by the sibling
// ga-auth-honesty guard, which drives a real 429 through the function and asserts the throw.
if (!/if\s*\(\s*e\s+instanceof\s+GaQuotaExhaustedError\s*\)\s*throw\s+(e\b|\w+\(\s*e\s*\))/.test(src)) {
  findings.push(`${SRC} does not rethrow GaQuotaExhaustedError from the per-family catch — a quota refusal would be recorded as a family GA cannot serve, and the walk would keep hitting the wall.`)
}
// SOURCE: returnPropertyQuota must be OPT-IN. Added unconditionally it would change the request body of the FORWARD,
// CATCHUP and DRAIN lanes — a live capture-path change this flight has no business making.
if (!/if\s*\(\s*opts\.returnPropertyQuota\s*\)\s*body\.returnPropertyQuota\s*=\s*true/.test(src)) {
  findings.push(`${SRC} does not gate returnPropertyQuota behind an opt-in flag — the scheduled capture lanes' request bodies must stay byte-identical.`)
}

// ── LEG (b): NO TIME BUDGET MAY EQUAL OR EXCEED THE LAMBDA CEILING ────────────────────────────────────────────────
// A budget EQUAL to maxDuration is not a budget: the check passes at t=299s, the next unit of work starts, and the
// lambda is killed mid-flight. maxDuration is RE-DERIVED from the route files rather than hardcoded here, so moving a
// route's ceiling cannot leave this guard asserting against a number that is no longer true.
const ROUTES = [
  'src/app/api/backfill/ga-dimensional-recover/route.ts',
  'src/app/api/cron/drain/route.ts',
]
let ceilingMs = null
for (const rp of ROUTES) {
  const p = resolve(ROOT, rp)
  if (!existsSync(p)) continue
  const m = readFileSync(p, 'utf8').match(/export\s+const\s+maxDuration\s*=\s*(\d+)/)
  if (!m) continue
  const ms = Number(m[1]) * 1000
  if (ceilingMs === null || ms < ceilingMs) ceilingMs = ms
}
if (ceilingMs === null) {
  findings.push(`could not re-derive maxDuration from any of ${ROUTES.join(', ')} — the budget assertion would be measuring nothing, which is worse than no assertion.`)
} else {
  const budgets = [...src.matchAll(/const\s+(DEFAULT_TIME_BUDGET_MS|RECOVER_BUDGET_MS)\s*=\s*([0-9_]+)/g)]
    .map((m) => ({ name: m[1], ms: Number(m[2].replace(/_/g, '')) }))
  if (budgets.length < 2) {
    findings.push(`expected both DEFAULT_TIME_BUDGET_MS and RECOVER_BUDGET_MS in ${SRC}; found ${budgets.map((b) => b.name).join(', ') || 'none'}.`)
  }
  for (const b of budgets) {
    if (b.ms >= ceilingMs) {
      findings.push(`${b.name}=${b.ms}ms is >= the route ceiling maxDuration=${ceilingMs}ms. A budget equal to the ceiling passes its own check at the last instant and then overruns — LORAMER_META_ASSET_BUDGET_HEADROOM_V1, two live 504s.`)
    }
  }
}

console.log(`[ga-dim-completion-honesty] drove the real decideGaDimCompletion over ${CASES.length} states, the window decision, the recover completion decision, daySlices, the source checks, and the budget-vs-maxDuration ceiling (${ceilingMs}ms)`)
if (findings.length) {
  console.error(`[ga-dim-completion-honesty] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('  COMPLETION IS A CLAIM ABOUT WHAT WAS WRITTEN, NEVER ABOUT HOW FAR THE WALK GOT.')
  process.exit(1)
}
console.log('[ga-dim-completion-honesty] OK')
