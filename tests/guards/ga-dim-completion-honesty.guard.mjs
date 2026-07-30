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

console.log(`[ga-dim-completion-honesty] drove the real decideGaDimCompletion over ${CASES.length} states, plus the window decision and the source check`)
if (findings.length) {
  console.error(`[ga-dim-completion-honesty] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('  COMPLETION IS A CLAIM ABOUT WHAT WAS WRITTEN, NEVER ABOUT HOW FAR THE WALK GOT.')
  process.exit(1)
}
console.log('[ga-dim-completion-honesty] OK')
