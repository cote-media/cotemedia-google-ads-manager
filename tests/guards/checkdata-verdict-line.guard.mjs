#!/usr/bin/env node
// LORAMER_CHECKDATA_VERDICT_LINE_V1 — the check:data VERDICT line is the enforcer for the
// red-no-report-pattern-matches class (two bites in three days: the 2026-08-10 throttle banner that
// matched no PASS/FAIL grep, and the 2026-08-12 `| tail -12` that truncated the reds AND replaced the
// exit code with tail's 0 — POSIX 2.9.2, pipeline status is the LAST command's). The fix is a
// machine-final line, LAST in the output, carrying the exit code and every red BY NAME, printed by
// scripts/run-checkdata.mjs. This guard pins the pieces that make the line trustworthy:
//   (a) package.json's check:data actually invokes the runner (not a resurrected chain)
//   (b) the roster is EXACTLY the list in EXPECTED_ROSTER below — the port could not silently drop one,
//       ⛔ NO COUNT IN THIS SENTENCE: it read "the 15 checks" while the pin held 22. The list IS the count.
//       and neither can a future edit without moving this pin deliberately
//   (c) the runner never calls process.exit — Node docs: process.exit "will force the process to exit
//       ... even if there are still asynchronous operations pending ... including I/O operations to
//       process.stdout"; writes to a PIPE are asynchronous, and a pipe is exactly the consumer that bit.
//       process.exitCode + natural exit is the documented alternative and the only flush-safe shape.
//       The catch path must also speak: a crashed runner prints a VERDICT marked CRASHED.
//   (d) this guard is REGISTERED in run-guards.mjs — an unregistered guard never runs
//   (e) BEHAVIOURAL, against the real runner code with a swapped throwaway roster (pass · ✗-fail ·
//       crash): the VERDICT is the LAST line (that is the whole tail-survival property), it carries
//       EXIT in text, it names the red with its banner and the crash by name, and the process exits
//       non-zero. The roster swap edits a COPY in tmp, never the real file.
// LIMIT, stated: no guard can force a report to QUOTE the line — that half is the DECISIONS reporting
// rule (a report without the verdict line is treated as NO gate run). This guards the instrument.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

// ── (a) THE SCRIPT POINTS AT THE RUNNER ─────────────────────────────────────────────────────────────
let pkg
try { pkg = JSON.parse(read('package.json')) } catch (e) { pkg = null; findings.push(`(a) package.json unreadable — ${e?.message}`) }
if (pkg && pkg.scripts?.['check:data'] !== 'node scripts/run-checkdata.mjs') {
  findings.push(`(a) package.json check:data is ${JSON.stringify(pkg?.scripts?.['check:data'])} — not the verdict runner. The \`;\`-chain prints no terminal verdict, which is the exact gap that produced two false-clean reports.`)
}

// ── (b) THE ROSTER PIN — flags included, in order. ⛔ NO COUNT IN THIS LINE: it read "20 checks" while the
// list below held 21, and a count in prose is a fact with a shelf life. The list IS the count.  ────────
// ⛔ MOVED 2026-08-18 FROM 25 → 26, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION.
// `parent-window-check-rejects` writes deliberately-invalid parent pairs and asserts Postgres refuses each
// with 23514, inside a transaction it always rolls back. It is red until migrations/082 is applied, which is
// exactly what makes it the mechanical proof of that apply.
// ⛔ MOVED 2026-08-18 FROM 24 → 25, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `no-owed-day-left-behind` is the DATA-LAYER half of the anchor work: `anchor-recedes-by-window` drives
// `deriveAnchorEnd` and can only see the STEP SIZE, while both live skip mechanisms sit at that function's
// CALLERS and are invisible to it. This one asks the warehouse whether any asked-for day sits above the
// walk's own frontier holding nothing — a question that survives the fix and outlives the mechanism.
// ⛔ MOVED 2026-08-15 FROM 19 → 20, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `check-fleet-meter-visibility` is LORAMER_FLEET_METER_SEES_THE_WALK_V1's live half, and the reason it must
// be a CHECK rather than only a guard is the defect it exists to catch: the fleet meter summed a ledger that
// had gone quiet, and a sum over zero rows is a clean, finite, plausible 0 that no static reading and no
// fail-closed throw can distinguish from "spent nothing". It witnesses the walk through `universe_fire_log`,
// a table NEITHER spend aggregate reads — because a check whose witness shares the subject's source is how
// google-op-budget leg (k) sat printing "VACUOUS today" for three days while the fleet ran blind.
// ⛔ MOVED 2026-08-15 FROM 18 → 19, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `check-coverage-density` is LORAMER_COVERAGE_DENSITY_V1's live half AND a drift monitor: it re-measures the
// recent-window flip rate every run, because the fleet numbers behind the 7-day threshold are a snapshot and
// a degrading client shows up there first.
// ⛔ MOVED 2026-08-15 FROM 17 → 18, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `check-binding-coverage` is LORAMER_BINDING_COVERAGE_V1's live half: the build guard drives the pure
// decider, this proves a pre-floor window really is uncovered in the data the resolver reads.
// ⛔ MOVED 2026-08-14 FROM 16 → 17, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `check-lora-named-entity` is LORAMER_LORA_NAMED_ENTITY_READ_V1's live half — it reads a NAME back out of the
// warehouse per grain. It went RED on its first run and the red is TRUE (google/ad names 1.7% populated), which
// is the check doing its job on day one rather than a reason to soften it.
// ⛔ MOVED 2026-08-14 FROM 15 → 16, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `check-walk-liveness` is LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1's loud surface: fires-with-no-output-and-
// no-floor is a WEDGE red; all-at-inception-floor is the DONE green. The 2026-08-13/14 wedge ran 21+ hours
// invisible precisely because no owned check watched the walk's output.
// ⛔ MOVED 2026-08-14 FROM 14 → 15, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `check-extra-metrics-serving` is the LIVE half of LORAMER_EXTRA_METRIC_REACHABILITY_V1. Its build-time
// sibling is hermetic and can only prove wiring; this one reads four hand-certified GA figures back through
// the shipped RPC. The distinction is the whole point: on 2026-08-14 every hermetic check was green while six
// scored eval questions failed, because "the enum is present" and "the number reaches the user" are different
// claims and only the second one is the product.
// ⛔ MOVED 2026-08-13 FROM 13 → 14, DELIBERATELY, IN THE SAME COMMIT AS THE ADDITION THE PIN CAUGHT.
// `check-rpc-grant-posture` is the LIVE-ACL half of LORAMER_RPC_GRANT_POSTURE_V1: the build guard reads
// migration source and runs on Vercel with no database, so this is the only half that can see a GRANT typed
// straight into the SQL editor. The pin fired on the addition exactly as designed — a check that is not on
// this roster NEVER RUNS, and that is the failure mode this leg exists to prevent.
const EXPECTED_ROSTER = [
  'scripts/check-capture-landing.mjs --invariant-only --guard',
  'scripts/check-frozen-cursors.mjs --guard',
  'tests/guards/canonical-client-identity.guard.mjs --db',
  'scripts/breakdown-reachability-check.mjs --gate',
  'scripts/check-completion-claims.mjs --guard',
  'scripts/check-doc-ownership-data.mjs',
  'scripts/check-drain-throttle.mjs --guard',
  'scripts/check-parent-analyze.mjs --gate',
  'scripts/check-rpc-grant-posture.mjs',
  'tests/guards/google-op-budget.guard.mjs --db',
  'tests/guards/universe-failure-is-durable.guard.mjs --db',
  'tests/guards/universe-attempt-append-only.guard.mjs --db',
  'tests/guards/canonical-key-spelling.guard.mjs --db',
  'tests/guards/drain-alias-coverage.guard.mjs --db',
  'scripts/check-extra-metrics-serving.mjs',
  'scripts/check-walk-liveness.mjs --guard',
  'scripts/check-lora-named-entity.mjs --guard',
  'scripts/check-binding-coverage.mjs --guard',
  'scripts/check-coverage-density.mjs --guard',
  'scripts/check-fleet-meter-visibility.mjs --guard',
  'scripts/check-topwindow-frontier.mjs',
  'scripts/check-consumer-liveness.mjs --guard',
  // LORAMER_GOOGLE_RESTATE_PRUNE_V1 — pin moved DELIBERATELY, in the same commit as the addition, exactly as
  // leg (b)'s own failure text instructs. The check writes to the database (synthetic client, wiped on entry
  // and exit), which is why it is on this roster and not in `npm run guard`.
  'scripts/check-restate-prune-live.mjs',
  'scripts/check-google-forward-account-day.mjs', // LORAMER_GOOGLE_ACCOUNT_ZERO_DAY_V1 — pinned in the same commit that registered it
  // LORAMER_ORDINAL_DEVICE_RESPELL_V1 — pin moved deliberately, in the same commit as the registration.
  'tests/guards/device-respell-scope.guard.mjs',
  'scripts/check-nongrain-window-resolves.mjs',
  'tests/guards/anchor-recedes-by-window.guard.mjs',
  'tests/guards/no-owed-day-left-behind.guard.mjs',
  'tests/guards/parent-window-check-rejects.guard.mjs',
  'tests/guards/top-edge-is-held.guard.mjs',
  'tests/guards/top-edge-never-attests.guard.mjs',
]
let runnerSrc = ''
try { runnerSrc = read('scripts/run-checkdata.mjs') } catch (e) { findings.push(`(b) runner missing — ${e?.message}`) }
const rosterBlock = runnerSrc.split('// ROSTER-START')[1]?.split('// ROSTER-END')[0] ?? ''
const parsed = [...rosterBlock.matchAll(/cmd:\s*\[([^\]]*)\]/g)].map((m) =>
  [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join(' '))
if (parsed.length !== EXPECTED_ROSTER.length ||
    parsed.some((p, i) => p !== EXPECTED_ROSTER[i])) {
  findings.push(`(b) roster drift — runner runs ${parsed.length} check(s) ${JSON.stringify(parsed)}; the pin holds ${EXPECTED_ROSTER.length}. A check missing here NEVER RUNS; if the change is deliberate, move this pin in the same commit.`)
}

// ── (c) FLUSH-SAFE EXIT + A CATCH THAT SPEAKS ───────────────────────────────────────────────────────
if (runnerSrc) {
  const code = runnerSrc.replace(/\/\/[^\n]*/g, '') // comments may NAME process.exit; code may not call it
  if (/process\.exit\s*\(/.test(code)) {
    findings.push(`(c) the runner calls process.exit() — Node docs: it forces exit even with pending async stdout writes, and stdout to a PIPE is async. The verdict line could be truncated by the very consumer it exists for. Use process.exitCode.`)
  }
  if (!/process\.exitCode\s*=/.test(code)) findings.push(`(c) the runner never sets process.exitCode — the gate would exit 0 on red.`)
  if (!/catch[\s\S]*RUNNER CRASHED/.test(runnerSrc)) {
    findings.push(`(c) the runner's catch path prints no CRASHED verdict — a runner that dies silently reads exactly like a clean tail.`)
  }
}

// ── (d) REGISTERED — an unregistered guard never runs ───────────────────────────────────────────────
try {
  if (!read('scripts/run-guards.mjs').includes('tests/guards/checkdata-verdict-line.guard.mjs')) {
    findings.push(`(d) this guard is not in run-guards.mjs GUARDS — it never runs, and the pin above is decoration.`)
  }
} catch (e) { findings.push(`(d) run-guards.mjs unreadable — ${e?.message}`) }

// ── (e) BEHAVIOURAL — the real runner code, a throwaway roster, three outcomes ──────────────────────
if (runnerSrc && rosterBlock) {
  const tmp = mkdtempSync(join(tmpdir(), 'loramer-verdict-guard-'))
  try {
    writeFileSync(join(tmp, 'pass.mjs'), `console.log('fine')\n`)
    writeFileSync(join(tmp, 'fail.mjs'), `console.log('✗ FAKE RED BANNER — the thing failed'); process.exitCode = 1\n`)
    const swapped = runnerSrc.replace(
      /\/\/ ROSTER-START[\s\S]*\/\/ ROSTER-END/,
      `const CHECKS = [
        { name: 'fake-pass', cmd: ['pass.mjs'] },
        { name: 'fake-fail', cmd: ['fail.mjs'] },
        { name: 'fake-crash', cmd: ['does-not-exist.mjs'] },
      ]`)
    const runnerCopy = join(tmp, 'runner-copy.mjs')
    writeFileSync(runnerCopy, swapped)
    const res = spawnSync(process.execPath, [runnerCopy], {
      env: { ...process.env, LORAMER_GUARD_ROOT: tmp }, encoding: 'utf8', timeout: 30_000,
    })
    const outLines = String(res.stdout || '').split('\n').filter((l) => l.trim() !== '')
    const last = outLines[outLines.length - 1] ?? ''
    if (!last.startsWith('[check:data] VERDICT — EXIT ')) {
      findings.push(`(e) the VERDICT is not the LAST stdout line (got: ${JSON.stringify(last.slice(0, 120))}). Last-ness IS the tail-survival property — anywhere else, \`| tail -N\` can drop it again.`)
    }
    if (!/1 red \(fake-fail: "FAKE RED BANNER — the thing failed"\)/.test(last)) {
      findings.push(`(e) the verdict does not name the red by NAME with its ✗ banner — got ${JSON.stringify(last.slice(0, 200))}. Reds by name is the requirement; a bare count is another pattern a report can misread.`)
    }
    if (!/1 crashed \(fake-crash:/.test(last)) {
      findings.push(`(e) the verdict does not name the CRASH — a check that could not run must not read as anything else.`)
    }
    if (res.status === 0) {
      findings.push(`(e) the runner exited 0 over a red and a crash — prepush would pass a failing gate.`)
    }
  } catch (e) {
    findings.push(`(e) could not drive the runner copy — ${e?.message}. A leg that cannot run is not a pass.`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (findings.length) {
  console.error(`[checkdata-verdict-line] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[checkdata-verdict-line] PASS — check:data runs the verdict runner over EXACTLY the ${EXPECTED_ROSTER.length} pinned checks · the runner never calls process.exit (the verdict flushes to a pipe) and its catch path prints a CRASHED verdict · it is registered in run-guards · and the compiled-in-place behavioural leg proved the VERDICT is the LAST line, names reds by name with their ✗ banners, names crashes, and exits non-zero. LIMIT: whether a report QUOTES the line is the DECISIONS reporting rule — no guard can see chat output.`)
