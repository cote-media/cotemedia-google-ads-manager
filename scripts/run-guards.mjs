#!/usr/bin/env node
// LORAMER_GUARD_RUNALL_V1 — run every guard, collect the failures, report once, exit non-zero.
//
// WHY THIS REPLACED THE && CHAIN. `npm run guard` was 24 segments joined by `&&`, so the shell stopped at the
// FIRST non-zero exit and every later guard was never invoked. A RED build therefore reported ONE finding and
// hid an unknown number of others — and a green tail that never executed is indistinguishable, in the output,
// from a green tail that passed. That is the narrow-green class this repo has banked repeatedly, turned inward
// on the guards themselves. It was found on 2026-07-29 only because a human ran the remaining 11 by hand after
// a failure at segment 13; nothing in the tooling said they had been skipped.
//
// ADAPT-VS-AUTHOR, decided against the published option and stated (WEB-FIRST law). npm-run-all2's
// `--continue-on-error` is the maintained implementation of exactly this idea: run everything, collect, exit
// non-zero at the end. It was REJECTED, for three concrete reasons rather than taste:
//   1. It orchestrates NPM SCRIPTS, not commands. Our guards are bare `node <path>` invocations, so adopting it
//      means first inventing 24 npm script entries whose only purpose is to be named by the runner.
//   2. It treats every non-zero exit the same. It cannot give the FAILED-vs-CRASHED split, which is the whole
//      point here — verify-the-instrument applies to the guards themselves, and a guard that could not RUN is a
//      different severity from a guard that ran and found something.
//   3. It would be a new dependency ON THE BUILD PATH (`npm run build` -> `npm run guard`, executed on Vercel).
//      Same call as the Vercel-AI-SDK rejection in LORAMER_CHAT_STREAMING_V1: not worth a dependency to buy
//      framing we can write in sixty lines.
// The PATTERN is theirs (spawn, collect, report, non-zero at the end); the script is ours because the three
// requirements above are not in it.
//
// THREE BUCKETS, NOT TWO:
//   PASSED   exit 0.
//   FAILED   the guard RAN and its own assertion failed. Its output is the finding.
//   CRASHED  the guard could not run — missing file, bad import, syntax error, killed by a signal. A BROKEN
//            INSTRUMENT. It is not evidence that the code is fine and it is not evidence that it is broken; it
//            is evidence that we currently cannot tell, which is worse than either and is why it is its own bucket.
// ⚠ HONEST LIMIT of the split: Node exits 1 for an uncaught throw AND our guards exit 1 for an assertion
// failure, so the exit code alone cannot separate them. The classifier reads the stderr SHAPE (module-load
// errors, or an Error line with a stack frame) plus signals and exit codes > 1. That is a heuristic. A guard
// whose own failure text happens to print a stack-shaped string could be mislabelled CRASHED — which is the
// SAFE direction (it over-reports a broken instrument rather than hiding one), but it is a heuristic and is
// named as one rather than sold as a proof.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// THE ORDER IS THE OLD && CHAIN, SEGMENT FOR SEGMENT. Do not reorder casually: two positions are load-bearing
// and are asserted below.
const GUARDS = [
  'tests/guards/meta-breadth-forward.guard.mjs',
  'tests/guards/shell-client-context.guard.mjs',
  'tests/guards/fetch-errors-rendered.guard.mjs',
  'tests/guards/source-parity.guard.mjs',
  'tests/guards/chat-failure-branches.guard.mjs',
  'tests/guards/chat-stream-consumers.guard.mjs',
  'tests/guards/chat-scroll-chain.guard.mjs',
  'tests/guards/chat-timer-ordering.guard.mjs',
  'tests/guards/fetcher-swallow.guard.mjs',
  'tests/guards/shopify-api-version-pin.guard.mjs',
  'tests/guards/order-grain-writer.guard.mjs',
  'tests/guards/metrics-payload-uniformity.guard.mjs',
  'tests/guards/metrics-upsert-chunked.guard.mjs',
  'tests/guards/meta-breakdown-dedupe.guard.mjs',
  'tests/guards/canonical-client-identity.guard.mjs',
  'tests/guards/ga-dim-completion-honesty.guard.mjs',
  'tests/guards/ga-auth-honesty.guard.mjs',
  'tests/guards/token-freshness-and-validation.guard.mjs',
  'tests/guards/coverage-breakdown-grain.guard.mjs',
  'tests/guards/capture-limit-is-measured.guard.mjs',
  'tests/guards/entity-state-scd2.guard.mjs',
  'tests/guards/google-op-budget.guard.mjs',
  // LORAMER_NO_CACHED_DB_READ_V1 — a read that gates a write, or reports live state, may never be served from
  // Next's Data Cache. Enforced at the ONE source (supabaseAdmin) rather than across 105 route files.
  'tests/guards/no-cached-live-state-read.guard.mjs',
  'tests/guards/connection-outcome-honesty.guard.mjs',
  'tests/guards/rangelap-completion-honesty.guard.mjs',
  'tests/guards/google-quota-read-fails-open.guard.mjs',
  'tests/guards/next-step-obeys-ranking.guard.mjs',
  'tests/guards/breakdown-registry-drift.guard.mjs',
  'tests/guards/digest-queue-coverage.guard.mjs',
  'tests/guards/docs-queue-coverage.guard.mjs',
  'scripts/check-capture-completeness.mjs',
  'scripts/check-lora-grounding.mjs',
  'scripts/check-connection-failure-recording.mjs',
  'scripts/check-connection-degraded-readers.mjs',
  'scripts/check-query-completeness.mjs',
  'tests/guards/resume-digest-freshness.guard.mjs',
]

// A guard whose GREEN means nothing when its prerequisite is red. breakdown-registry-drift asserts that the
// claude-tools query_breakdown enums are GENERATED from breakdown-registry; the two dependents both reason over
// registry-derived sets (check-lora-grounding asserts every type in the GENERATED enum is named in hand-written
// prose). If the registry has drifted, their green is a statement about a stale artifact. They still RUN — the
// finding may be useful — but they are never printed as a bare PASS.
const UNRELIABLE_WHEN = {
  'tests/guards/breakdown-registry-drift.guard.mjs': [
    'scripts/check-capture-completeness.mjs',
    'scripts/check-lora-grounding.mjs',
  ],
}

// resume-digest-freshness compares digest -> manifest -> files, and only means something after the wrap
// sequence has run. Anywhere but last it produces a false RED.
const MUST_BE_LAST = 'tests/guards/resume-digest-freshness.guard.mjs'
if (GUARDS[GUARDS.length - 1] !== MUST_BE_LAST) {
  console.error(`[run-guards] LIST ERROR — ${MUST_BE_LAST} must be the LAST entry (it is order-locked; see header).`)
  process.exit(2)
}

const CRASH_MODULE = /ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|ERR_UNSUPPORTED_ESM_URL_SCHEME/
const CRASH_STACK_ERR = /^\s*[A-Za-z]*Error(:|\b)/m
const CRASH_STACK_FRAME = /^\s*at\s+\S+/m

function classify(res) {
  const err = String(res.stderr || '')
  if (res.error) return 'CRASHED' // spawn itself failed
  if (res.signal) return 'CRASHED'
  if (res.status === 0) return 'PASSED'
  if (res.status !== 1) return 'CRASHED' // our guards use exit 1 for a finding; anything else is not a finding
  if (CRASH_MODULE.test(err)) return 'CRASHED'
  if (CRASH_STACK_ERR.test(err) && CRASH_STACK_FRAME.test(err)) return 'CRASHED'
  return 'FAILED'
}

const results = []
for (const rel of GUARDS) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    env: process.env, // carries LORAMER_GUARD_ROOT through so the seen-RED proof still works
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  results.push({
    name: rel,
    bucket: classify(res),
    status: res.status,
    signal: res.signal,
    ms: Date.now() - started,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    spawnError: res.error ? String(res.error.message) : null,
  })
}

// Apply UNRELIABLE after the fact — a dependent that PASSED while its prerequisite did not is downgraded.
const byName = Object.fromEntries(results.map((r) => [r.name, r]))
for (const [prereq, dependents] of Object.entries(UNRELIABLE_WHEN)) {
  const p = byName[prereq]
  if (!p || p.bucket === 'PASSED') continue
  for (const d of dependents) {
    const r = byName[d]
    if (r && r.bucket === 'PASSED') {
      r.bucket = 'UNRELIABLE'
      r.unreliableBecause = `${prereq} is ${p.bucket} — this guard reasons over registry-derived sets, so its green describes a possibly-stale artifact.`
    }
  }
}

const passed = results.filter((r) => r.bucket === 'PASSED')
const failed = results.filter((r) => r.bucket === 'FAILED')
const crashed = results.filter((r) => r.bucket === 'CRASHED')
const unreliable = results.filter((r) => r.bucket === 'UNRELIABLE')

console.log('')
console.log('════════ [run-guards] SCOREBOARD — LORAMER_GUARD_RUNALL_V1 ════════')
console.log(`  ${GUARDS.length} guards RAN (every one — this runner does not short-circuit)`)
console.log(`  PASSED ${passed.length} · FAILED ${failed.length} · CRASHED ${crashed.length} · UNRELIABLE ${unreliable.length}`)
console.log('')
for (const [i, r] of results.entries()) {
  const mark = r.bucket === 'PASSED' ? 'ok  ' : r.bucket === 'FAILED' ? 'FAIL' : r.bucket === 'CRASHED' ? 'CRASH' : 'UNREL'
  console.log(`  ${String(i + 1).padStart(2)}  ${mark.padEnd(5)} ${String(r.ms).padStart(6)}ms  ${r.name}`)
  if (r.unreliableBecause) console.log(`          ↳ UNRELIABLE: ${r.unreliableBecause}`)
}
console.log('')

function reprint(list, heading) {
  if (!list.length) return
  console.error(`════════ ${heading} — full output, verbatim, in list order ════════`)
  for (const r of list) {
    console.error('')
    console.error(`──── ${r.name}  [${r.bucket}]  exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''}${r.spawnError ? ` spawnError=${r.spawnError}` : ''}`)
    if (r.stdout.trim()) console.error(r.stdout.replace(/\n$/, ''))
    if (r.stderr.trim()) console.error(r.stderr.replace(/\n$/, ''))
  }
  console.error('')
}
// CRASHED first: a broken instrument is read before a finding, because it bounds what the run can claim.
reprint(crashed, 'CRASHED — the guard could not RUN. Fix the instrument before trusting anything else in this run')
reprint(failed, 'FAILED — the guard ran and found something')

if (crashed.length || failed.length) {
  console.error(`[run-guards] EXIT 1 — ${failed.length} failed, ${crashed.length} crashed.`)
  process.exit(1)
}
console.log(`[run-guards] ALL GREEN — ${GUARDS.length}/${GUARDS.length} guards ran and passed.`)
