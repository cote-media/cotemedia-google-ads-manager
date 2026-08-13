#!/usr/bin/env node
// LORAMER_CHECKDATA_VERDICT_LINE_V1 — run every data check, then print ONE machine-final VERDICT line,
// LAST, carrying the exit code and every red BY NAME — so no pipe can hide a red again.
//
// WHY THIS REPLACED THE package.json `;`-CHAIN. The chain ran all 13 checks and exited with the MAX of
// their codes — correct — but printed NO terminal verdict. Twice in three days that gap produced a false
// clean report:
//   · 2026-08-10 — the drain-throttle red's banner ("✗ THROTTLE HAS OUTLIVED ITS REASON") contains neither
//     "PASS" nor "FAIL", so push reports grepping those words showed a clean sweep over a failing gate.
//   · 2026-08-12 — the gate was invoked as `npm run check:data 2>&1 | tail -12`. The pipe kept only the
//     last 12 lines (the final three checks, all green) AND replaced the exit code with tail's 0 — POSIX
//     2.9.2: "the exit status shall be the exit status of the last command specified in the pipeline."
//     A push report then said "check:data exit 0, ZERO reds" while the gate stood at exit 1 on four reds.
// A red that no report pattern matches is invisible (★CHECKDATA-STANDING-REDS-OWNED named this class).
// The mechanical fix: the truth rides IN the last line of output, where `tail` — the truncation that bit —
// cannot drop it. The reporting rule (DECISIONS LORAMER_CHECKDATA_VERDICT_LINE_V1): a flight report quotes
// the VERDICT line verbatim; a report without it is treated as NO GATE RUN. A `head`-truncated log, a hang,
// or a runner killed before the verdict all read as "no gate run" — fail-closed by rule, because a dead
// process cannot print its own absence.
//
// ⛔ NO process.exit() IN THIS FILE — THE VERDICT MUST FLUSH. Node docs (process.exit): "Calling
// process.exit() will force the process to exit as quickly as possible even if there are still asynchronous
// operations pending ... including I/O operations to process.stdout"; "writes to process.stdout in Node.js
// are sometimes asynchronous" (they are async to PIPES, and a pipe is exactly the consumer that bit).
// The documented alternative is process.exitCode + natural exit, which is what this runner uses. A guard
// leg (tests/guards/checkdata-verdict-line.guard.mjs) pins the absence of process.exit and the roster below.
//
// EXIT SEMANTICS PRESERVED: max over child exits — canonical-key-spelling.guard.mjs:272 and
// drain-alias-coverage.guard.mjs:197 both bank "check:data takes the MAX exit of its legs, so a special
// code would outrank and mask a real failure". prepush (`npm run build && npm run check:data`) needs only
// non-zero-on-red, which max gives.
//
// THE HOUSE PATTERN IS run-guards.mjs (spawn, collect, classify PASSED/FAILED/CRASHED, report once); the
// classifier regexes are copied from there with the same honest limit: it is a heuristic that separates
// "the check found something" from "the check could not run", and it errs toward CRASHED — a broken
// instrument outranks a finding because it bounds what the run can claim.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// THE ROSTER IS THE OLD CHAIN, SEGMENT FOR SEGMENT, FLAGS INCLUDED. A check that is not named here never
// runs (the run-guards list taught this: an unregistered guard is the purest narrow green). The guard pins
// this list so porting chain→runner could not silently drop a check, and future edits move the pin with it.
// ROSTER-START
const CHECKS = [
  { name: 'check-capture-landing', cmd: ['scripts/check-capture-landing.mjs', '--invariant-only', '--guard'] },
  { name: 'check-frozen-cursors', cmd: ['scripts/check-frozen-cursors.mjs', '--guard'] },
  { name: 'canonical-client-identity', cmd: ['tests/guards/canonical-client-identity.guard.mjs', '--db'] },
  { name: 'breakdown-reachability', cmd: ['scripts/breakdown-reachability-check.mjs', '--gate'] },
  { name: 'check-completion-claims', cmd: ['scripts/check-completion-claims.mjs', '--guard'] },
  { name: 'check-doc-ownership-data', cmd: ['scripts/check-doc-ownership-data.mjs'] },
  { name: 'check-drain-throttle', cmd: ['scripts/check-drain-throttle.mjs', '--guard'] },
  { name: 'check-parent-analyze', cmd: ['scripts/check-parent-analyze.mjs', '--gate'] },
  // LORAMER_RPC_GRANT_POSTURE_V1 — the LIVE-ACL half. The build guard reads migration source and runs on
  // Vercel with no database; this reads pg_proc and is the only half that can see a GRANT typed by hand
  // straight into the SQL editor, which leaves no trace in migrations/.
  { name: 'check-rpc-grant-posture', cmd: ['scripts/check-rpc-grant-posture.mjs'] },
  { name: 'google-op-budget', cmd: ['tests/guards/google-op-budget.guard.mjs', '--db'] },
  { name: 'universe-failure-is-durable', cmd: ['tests/guards/universe-failure-is-durable.guard.mjs', '--db'] },
  { name: 'universe-attempt-append-only', cmd: ['tests/guards/universe-attempt-append-only.guard.mjs', '--db'] },
  { name: 'canonical-key-spelling', cmd: ['tests/guards/canonical-key-spelling.guard.mjs', '--db'] },
  { name: 'drain-alias-coverage', cmd: ['tests/guards/drain-alias-coverage.guard.mjs', '--db'] },
]
// ROSTER-END

const CRASH_MODULE = /ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|ERR_UNSUPPORTED_ESM_URL_SCHEME/
const CRASH_STACK_ERR = /^\s*[A-Za-z]*Error(:|\b)/m
const CRASH_STACK_FRAME = /^\s*at\s+\S+/m

function classify(res) {
  const err = String(res.stderr || '')
  if (res.error) return 'CRASHED'
  if (res.signal) return 'CRASHED'
  if (res.status === 0) return 'PASSED'
  if (res.status !== 1) return 'CRASHED'
  if (CRASH_MODULE.test(err)) return 'CRASHED'
  if (CRASH_STACK_ERR.test(err) && CRASH_STACK_FRAME.test(err)) return 'CRASHED'
  return 'FAILED'
}

// Every line carrying the red glyph, ✗ stripped and trimmed, capped so the verdict stays one line a phone
// can hold. The scan is INDEPENDENT of the exit code on purpose: a check that printed ✗ but exited 0 is an
// anomaly the verdict must surface, not a green.
function redLines(text) {
  return String(text).split('\n').filter((l) => l.includes('✗'))
    .map((l) => l.replace(/^\s*✗\s*/, '').trim().slice(0, 110))
}

let verdictPrinted = false
function printVerdict(line) { verdictPrinted = true; console.log(line) }

try {
  const results = []
  for (const c of CHECKS) {
    const res = spawnSync(process.execPath, [path.join(ROOT, c.cmd[0]), ...c.cmd.slice(1)], {
      cwd: ROOT, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    const stdout = String(res.stdout || '')
    const stderr = String(res.stderr || '')
    // Re-emit verbatim, in order, as each check finishes — the per-check output stays the evidence.
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    results.push({
      name: c.name, bucket: classify(res),
      status: res.status, signal: res.signal, spawnError: res.error ? String(res.error.message) : null,
      reds: redLines(stdout + '\n' + stderr),
    })
  }

  const red = results.filter((r) => r.bucket === 'FAILED' || (r.bucket === 'PASSED' && r.reds.length > 0))
  const crashed = results.filter((r) => r.bucket === 'CRASHED')
  const green = results.filter((r) => r.bucket === 'PASSED' && r.reds.length === 0)
  const exit = results.reduce((w, r) => Math.max(w,
    r.bucket === 'CRASHED' ? Math.max(2, r.status ?? 2) : (r.status ?? 2)), 0)

  const redPart = red.length
    ? ` (${red.map((r) => `${r.name}${r.bucket === 'PASSED' ? ' [✗-WITH-EXIT-0 ANOMALY]' : ''}: ${r.reds.map((l) => `"${l}"`).join(' + ') || `exit=${r.status}, no ✗ banner`}`).join('; ')})`
    : ''
  const crashPart = crashed.length
    ? ` (${crashed.map((r) => `${r.name}: ${r.spawnError || (r.signal ? `signal=${r.signal}` : `exit=${r.status}`)}`).join('; ')})`
    : ''
  printVerdict(`[check:data] VERDICT — EXIT ${exit} · ${CHECKS.length} checks: ${green.length} green · ${red.length} red${redPart} · ${crashed.length} crashed${crashPart}`)
  process.exitCode = exit
} catch (e) {
  // A runner that dies without a verdict would read exactly like a clean tail. If we can still speak, the
  // last line says CRASHED; if we cannot, the missing VERDICT line is itself the signal (no verdict = no
  // gate run — the reporting rule, banked in DECISIONS).
  if (!verdictPrinted) printVerdict(`[check:data] VERDICT — RUNNER CRASHED before completing: ${e?.message ?? e} · EXIT 2 — a missing or crashed verdict is NEVER a clean gate`)
  process.exitCode = 2
}
