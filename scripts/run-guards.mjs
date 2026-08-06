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
  // LORAMER_WIRE_COVERAGE_INSTRUMENT_V1 — the breakdown-grain verdict must REACH Lora, CHANGE what she is told
  // to say, and stay off query_metrics and the per-turn path.
  'tests/guards/breakdown-coverage-wired.guard.mjs',
  // LORAMER_DOC_OWNERSHIP_GUARD_V1 — a doc may POINT at a fact, never STATE a value another source owns.
  // Hermetic half only (model ids, version pins, file facts); the DB half is in check:data.
  'tests/guards/doc-ownership.guard.mjs',
  // LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1 — every sentinel reader either arms it or is allowlisted with a
  // reason; every Google error boundary arms; the swallow point marks an outage so it cannot read as absence.
  'tests/guards/quota-sentinel-armed.guard.mjs',
  'tests/guards/connection-outcome-honesty.guard.mjs',
  'tests/guards/rangelap-completion-honesty.guard.mjs',
  'tests/guards/drain-fair-share-order.guard.mjs', // LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1
  'tests/guards/chat-status-line.guard.mjs', // LORAMER_CHAT_STATUS_SUBJECT_V1
  // LORAMER_CHAT_STATUS_FIRST_V1 — the three Gate-B device defects of 2026-08-02: status must LEAD the turn
  // (and release the route's commit gate), the LM mark must mount BOTH as working indicator and as avatar,
  // and the WebKit facts that killed the sweep and the mark (pathLength, negative dash offset, the
  // background-clip pairing) may not come back. Visual behaviour is Gate-B, not assertable here.
  'tests/guards/chat-status-visible.guard.mjs',
  'tests/guards/one-working-indicator.guard.mjs',
  'tests/guards/chat-deadline-margin.guard.mjs',
  'tests/guards/lora-thread-shared.guard.mjs',
  'tests/guards/chat-screen-tracks-server.guard.mjs',
  'tests/guards/lora-back-parity.guard.mjs',
  'tests/guards/chat-status-truthful.guard.mjs',
  'tests/guards/chat-status-fits.guard.mjs',
  'tests/guards/google-quota-read-fails-open.guard.mjs',
  'tests/guards/next-step-obeys-ranking.guard.mjs',
  'tests/guards/breakdown-registry-drift.guard.mjs',
  'tests/guards/digest-queue-coverage.guard.mjs',
  'tests/guards/docs-queue-coverage.guard.mjs',
  // LORAMER_DECISION_TOPIC_INDEX_V1 — §L must be GENERATED (recompute + diff), must agree with §H on every
  // token's status, and must keep reporting its own untokened backlog.
  'tests/guards/decision-topic-index.guard.mjs',
  // LORAMER_ONE_BLOCK_OUTPUT_V1 — PLACEMENT ONLY. No guard can observe chat output; this asserts the rule is
  // at the TOP of CLAUDE.md / ESSENCE governing law / RESUME_INSTRUCTIONS and reached the generated digest.
  'tests/guards/one-block-output.guard.mjs',
  // LORAMER_THREE_SOURCE_PRECONDITION_V1 — every DECIDED/DECISION/SHIPPED/LAW entry banked on or after
  // 2026-08-02 must carry a THREE-SOURCE header (PRIOR CHATS · WEB · REPO), all three legs non-empty.
  // Enforces the ARTIFACT only — no guard can see whether a chat or web search actually happened.
  'tests/guards/three-source-header.guard.mjs',
  // LORAMER_GOOGLE_ADS_UNIVERSE_WRITER_V1 — no clock may seal a walk (vendor-exhausted only), no per-surface
  // branching (the surface list comes ONLY from docs/google-ads-capture-universe.json), and an unsatisfiable
  // structural requirement is RECORDED rather than silently dropped.
  'tests/guards/google-ads-universe-writer.guard.mjs',
  // LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — a redelivered message must land on identical conflict keys
  // (Queues is at-least-once), the governor must reserve headroom for forward+drain and stop BEFORE the
  // cap, completion may come only from the writer's vendor-exhausted proof, and NO cron may fire the path.
  'tests/guards/universe-runner.guard.mjs',
  'tests/guards/universe-entity-axis.guard.mjs',
  'tests/guards/universe-artifact-slots.guard.mjs',
  'tests/guards/universe-derived-time.guard.mjs',
  'tests/guards/universe-window-log.guard.mjs',
  'tests/guards/refused-ratio-is-null.guard.mjs',
  'tests/guards/backfill-yields-to-product.guard.mjs',
  // LORAMER_EVAL_SPEND_LEDGER_V1 — the harness price table may not drift from production MODEL_PRICING, an
  // unknown model may not be priced at zero, and a run that cannot cost itself must exit non-zero.
  'tests/guards/eval-spend-ledger.guard.mjs',
  // LORAMER_DRAIN_EXTENDED_DURATION_V1 — the drain runs above the 800s GA ceiling on Vercel's BETA extended
  // duration. Asserts the parts that are mechanically checkable (value ≤ 1800, scoped to this one route, no
  // vercel.json project default above 800, eligibility marker intact, BUDGET_MS able to actually use the ceiling)
  // and states on its own face that the runtime version and Secure-Compute/Static-IP status are Vercel project
  // settings it cannot see.
  'tests/guards/drain-extended-duration.guard.mjs',
  // LORAMER_CAPTURE_FACTS_V1 — every platform in DRAIN_REGISTRY must have a section in
  // docs/LORAMER_CAPTURE_FACTS.md, so a new platform cannot ship without its retention walls,
  // forward-only families and capability limits written down. COVERAGE check only — it cannot
  // verify a wall is true or current, and says so on its own face.
  'tests/guards/capture-facts-cover-platforms.guard.mjs',
  // LORAMER_CAPTURE_FACTS_V1 — the capture-boundaries block must STAY in the cache_control prefix and keep
  // all five boundary kinds, its vendor numbers and its UNESTABLISHED carriers. Structural ordering check
  // against the prefixLines/suffixLines swap, so a context refactor cannot silently move it.
  'tests/guards/capture-facts-in-prefix.guard.mjs',
  // LORAMER_COMPLETION_CLAIM_DENOMINATOR_V1 — every DRAIN_REGISTRY step must be visible to the completion
  // gate. It iterated required-steps (27) while the drain runs 34; 60 sealed claims were never checked.
  'tests/guards/completion-gate-covers-drain.guard.mjs',
  // LORAMER_CAMPAIGN_TYPE_MATRIX_V1 — the campaign backfill must keep SELECTING and STORING channel type,
  // and the entity_state_history precedence rule must stay attached. Dropping the field breaks nothing
  // and throws nothing — it just silently restores the criteria-vs-account-spend misclassification.
  'tests/guards/campaign-channel-type-captured.guard.mjs',
  // LORAMER_CHANNEL_TYPE_ENUM_V1 — every AdvertisingChannelType ordinal must render as a NAME. Lora was
  // being shown [10] and [2], and the old map called MULTI_CHANNEL (App) 'Performance Max'.
  'tests/guards/channel-type-enum-mapped.guard.mjs',
  // LORAMER_CAPABILITY_DENOMINATOR_V1 — no family may be judged against account spend by default. Every
  // row-checkable step must DECLARE its capability; silence is the defect that produced 43 false violations.
  'tests/guards/capability-denominator.guard.mjs',
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
