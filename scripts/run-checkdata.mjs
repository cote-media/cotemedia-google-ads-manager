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
  // LORAMER_EXTRA_METRIC_REACHABILITY_V1 — the LIVE half. The build guard is hermetic and proves WIRING; this
  // reads the four hand-certified GA figures back THROUGH the shipped RPC and fails with the numbers on the
  // face if what we serve stops matching what we store. Every hermetic check was green on 2026-08-14 while six
  // eval questions failed on exactly this.
  { name: 'check-extra-metrics-serving', cmd: ['scripts/check-extra-metrics-serving.mjs'] },
  // LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — the walk liveness invariant. Fires-with-no-output-and-no-floor
  // is a WEDGE (the 2026-08-13/14 21-hour silence, RED); all-surfaces-at-inception-floor is DONE (GREEN).
  { name: 'check-walk-liveness', cmd: ['scripts/check-walk-liveness.mjs', '--guard'] },
  // LORAMER_LORA_NAMED_ENTITY_READ_V1 — the LIVE half. The build guard proves the tool is wired; this proves a
  // NAME actually comes back at each grain. Both claims are needed: on 2026-08-14 every hermetic check was
  // green while the named read did not exist at all.
  { name: 'check-lora-named-entity', cmd: ['scripts/check-lora-named-entity.mjs', '--guard'] },
  // LORAMER_BINDING_COVERAGE_V1 — the LIVE half: a pre-floor window must not read as covered, or every
  // binding downstream is built on a false verdict.
  { name: 'check-binding-coverage', cmd: ['scripts/check-binding-coverage.mjs', '--guard'] },
  // LORAMER_COVERAGE_DENSITY_V1 — DRIFT MONITOR, not only an assertion: recent-window flips FAIL (the demo
  // surface, 0/30 at build time), historical flip rates are PRINTED so capture degradation is visible here
  // rather than discovered on stage.
  { name: 'check-coverage-density', cmd: ['scripts/check-coverage-density.mjs', '--guard'] },
  // LORAMER_FLEET_METER_SEES_THE_WALK_V1 — witnesses the walk's spend through universe_fire_log, a table
  // neither spend aggregate reads. The static guard cannot see a ledger that has gone quiet; this can.
  { name: 'check-fleet-meter-visibility', cmd: ['scripts/check-fleet-meter-visibility.mjs', '--guard'] },
  // LORAMER_COMMITTED_DAY_CLOSES_V1 — the FIX-WITH-GUARD half, and it is a LIVE check by necessity: the
  // defect is a disagreement between what the walk COMMITTED (universe_attempt_log) and what coverage COUNTS
  // (metrics_daily), so no hermetic fixture can hold it. Observed RED 4/4 against the pre-fix code at 7218bbd
  // and GREEN 4/4 after, both on live rows through the real rangesStillOwed entry.
  { name: 'check-topwindow-frontier', cmd: ['scripts/check-topwindow-frontier.mjs'] },
  // LORAMER_CONSUMER_LIVENESS_V1 — DELIVERY, witnessed from the consumer's side only. It sits BESIDE
  // check-walk-liveness rather than replacing it: that one asks whether the SCHEDULER is alive, this one
  // whether what it publishes is being CONSUMED. On 2026-08-17 the first read ALIVE for 10h+ through a dead
  // consumer because `published > 0` is the producer's own count; this reads universe_attempt_log and
  // nothing else, and goes red inside 45 minutes.
  { name: 'check-consumer-liveness', cmd: ['scripts/check-consumer-liveness.mjs', '--guard'] },
  // LORAMER_GOOGLE_RESTATE_PRUNE_V1 — the BEHAVIOURAL half: a re-pulled day must equal the fresh payload.
  // It lives HERE rather than in `npm run guard` because IT WRITES TO THE DATABASE, and guards run on Vercel
  // during every deploy. Every row it writes is keyed to a synthetic client and an account_id no capture
  // uses, and it wipes them on entry and on exit — a client's rows are never at risk. The static scope half
  // (five legs on the delete's predicates) is the build guard `google-restate-prune-capped`.
  { name: 'check-restate-prune-live', cmd: ['scripts/check-restate-prune-live.mjs'] },
  // LORAMER_ORDINAL_DEVICE_RESPELL_V1 — registered ONLY AFTER the Russ-authorized execution flipped it
  // green (it was designed-red before that, and registering a designed-red check would have painted the
  // board red for a state that was awaiting his word). Leg (a) holds the repaired state — zero ordinal
  // device rows at detail_placement_view; legs (b1)/(b2) pin the repair's scope: the script must carry
  // every predicate, and no OUT-OF-SCOPE ordinal population (group_placement_view, the legacy levels,
  // search_term_view, same-level other-bt) may ever SHRINK against its pinned baseline.
  { name: 'device-respell-scope', cmd: ['tests/guards/device-respell-scope.guard.mjs'] },
  // LORAMER_NONGRAIN_ATTESTS_V1 — the FIX-WITH-GUARD half. It asserts the PROPERTY, not the remedy: a window a
  // completed pass has answered must end up COVERED or ATTESTED, never still owed. ⛔ IT SHIPS RED AND STAYS
  // RED UNTIL THE FIX IS DEPLOYED — the attesting rows cannot exist until the fixed consumer runs, so this is
  // the one check whose green is GATE-B by construction rather than by choice.
  { name: 'check-nongrain-window-resolves', cmd: ['scripts/check-nongrain-window-resolves.mjs'] },
  // LORAMER_ANCHOR_RECEDES_BY_WINDOW_V1 — THE HEAD OF THE QUEUE, SHIPPED RED ON PURPOSE. A fully-answered
  // 30-day window must recede the anchor ~30 days; today it recedes by the width of the LAST RANGE WRITTEN,
  // usually one day. It lives here rather than in `npm run guard` for the same reason the nongrain check does:
  // it is red until the fix lands, and a red in the BUILD would block every unrelated push.
  { name: 'anchor-recedes-by-window', cmd: ['tests/guards/anchor-recedes-by-window.guard.mjs'] },
  // LORAMER_NO_OWED_DAY_LEFT_BEHIND_V1 — the PROPERTY behind the entry above, measured against the WAREHOUSE
  // instead of against the function. The anchor guard is a unit drive of `deriveAnchorEnd` and is blind to the
  // two skip mechanisms that live at its CALLERS (the ungated hold branch; the mis-sized upper half dropped at
  // publish). This one asks only "did the walk leave owed ground above its own frontier", which stays a valid
  // question after the anchor is re-plumbed. Red like its neighbour, and here for the same reason.
  { name: 'no-owed-day-left-behind', cmd: ['tests/guards/no-owed-day-left-behind.guard.mjs'] },
  // LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — the DATABASE half of the parent-window fix, proven by WRITING the
  // bad rows rather than by reading the migration that declares the CHECK. Red until migrations/082 is
  // applied, and that red IS the mechanical proof of the apply. Rolls back everything it writes.
  { name: 'parent-window-check-rejects', cmd: ['tests/guards/parent-window-check-rejects.guard.mjs'] },
  // LORAMER_TOP_EDGE_LANE_V1 — the ONE property no other detector can see. `no-owed-day-left-behind` defines
  // its own subject as days INSIDE the asked band, so ground ABOVE the highest window ever asked is invisible
  // to it by construction. This asks whether the top of the calendar is held at all. ⛔ IT SHIPS RED — 346 of
  // 346 surfaces sat 6 days behind when it landed — and goes green only after the top-edge lane has run a
  // full cycle (~14.4h). Same posture as check-nongrain-window-resolves.
  { name: 'top-edge-is-held', cmd: ['tests/guards/top-edge-is-held.guard.mjs'] },
  // LORAMER_TOP_EDGE_ATTESTS_BY_MESSAGE_V1 — the SAFETY half, and it reads WHAT LANDED rather than what the
  // code says. Drives the real compiled attestedEmptyDays over live rows and fails if any day is sealed on
  // the evidence of a top-edge message alone. RED-PROVEN against the pre-fix reader: 12 surfaces × 6 days.
  { name: 'top-edge-never-attests', cmd: ['tests/guards/top-edge-never-attests.guard.mjs'] },
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
