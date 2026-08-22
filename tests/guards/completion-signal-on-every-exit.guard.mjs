#!/usr/bin/env node
// LORAMER_COMPLETION_SIGNAL_V1 — THE TERMINAL ROW MUST BE UNAVOIDABLE, NOT REMEMBERED.
//
// ⛔ WHY A STRUCTURE GUARD AND NOT A PER-RETURN ONE. The v2 consumer has NINE exits: eight bare returns
// (:154 quota-hold · :260 covered-skip · :270 floor-stop · :286 BROKEN · :336 mis-size-held · :349 mis-sized ·
// :491 budget-stop · :516 normal fall-through) AND AN UNCAUGHT THROW, because its only `try` wrapped one
// range. A guard that enumerates `return` statements covers eight of nine and misses the ninth — which is the
// one that matters, since `appendAttemptStarted`/`appendAttemptFinished` throw BY DESIGN and the paths most
// likely to end badly were the paths least likely to record it. It would also pass a handler that later grew
// a tenth exit inside a nested block.
//
// ⛔ SO THE FIX IS STRUCTURAL AND THIS GUARD CHECKS THE STRUCTURE: the body is a named function, the handler
// wraps it in ONE try/catch/finally, and the terminal write lives in the `finally`. Then every path — present
// and future — passes through one site, and there is nothing to remember.
//
// THREE LEGS, none of them happy-path:
//   (a) the handler wraps the body and the terminal write is inside a `finally`.
//   (b) ⛔ THE BODY FUNCTION CONTAINS NO `handleCallback` AND THE HANDLER CONTAINS NO EXIT OF ITS OWN BEFORE
//       THE `try` — an early return added above the try would bypass the finally silently, which is exactly
//       the class this replaces.
//   (c) the catch RETHROWS. Swallowing would convert a crash into a 2xx and hand the queue a success for work
//       that did not happen — the precise inversion of what the terminal row exists to prevent.
// PLUS: the finally's own write must be wrapped, because a throw from a `finally` REPLACES the exception in
// flight and would erase the real fault.
//
// ⚠ WHAT THIS GUARD CANNOT REACH, STATED SO ITS GREEN IS NOT OVER-READ: that the terminal row's CONTENT is
// right. A `finally` writing the wrong window, the wrong key or a stale invocation id passes every leg here.
// And a PLATFORM KILL still writes nothing — that case is INDETERMINATE by construction and is the drive's
// ceiling to detect, not this guard's.
//
// USAGE: node tests/guards/completion-signal-on-every-exit.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const ROUTE = 'src/lib/backfill/universe-v2-worker.ts'
const findings = []

let src = ''
try { src = readFileSync(resolve(ROOT, ROUTE), 'utf8') } catch (e) {
  console.error(`[completion-signal-on-every-exit] CANNOT RUN — ${ROUTE} unreadable (${e.message}). A guard that cannot read its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}

// ── (a) THE SHAPE ─────────────────────────────────────────────────────────────────────────────────────────
if (!/async function runOneMessage\s*\(/.test(src)) {
  findings.push(`(a) ${ROUTE} has no \`runOneMessage\` body function. The handler body must be a NAMED function so the handler can wrap it — with the body inline there is no single site every exit passes through, and the terminal row goes back to being remembered per-return.`)
}
// ⛔ THE SUBJECT IS THE WRAPPER, LOCATED BY WHAT IT DOES, NOT BY WHAT IT IS CALLED — LORAMER_POLL_MODE_EXTRACT_V1.
// This guard used to anchor on the literal `const handler = handleCallback(` and slice to end-of-file, which
// silently assumed the try/catch/finally lived inside the push callback itself. The moment the body was lifted
// out so a POLL lane could call it too, the anchor pointed at a three-line delegation and the guard reported
// the invariant broken while it was in fact intact. **THAT IS THE GUARD BEING COUPLED TO A VARIABLE NAME
// RATHER THAN TO THE CLASS IT PROTECTS.** The wrapper is now found structurally: the enclosing function of the
// `await runOneMessage(` call. Rename it, move it, or hand it to a second delivery lane — the guard follows.
const roIdx = src.indexOf('await runOneMessage(')
const hIdx = roIdx === -1 ? -1 : src.lastIndexOf('async function ', roIdx)
if (roIdx === -1) {
  findings.push(`(a) ${ROUTE} never calls \`await runOneMessage(\` — the body is no longer wrapped by anything and this guard is measuring nothing.`)
} else if (hIdx === -1) {
  findings.push(`(a) the \`await runOneMessage(\` call in ${ROUTE} is not inside an \`async function\` declaration — there is no named wrapper to carry the terminal row.`)
} else {
  const handler = src.slice(hIdx)
  if (!/\btry\s*\{/.test(handler) || !/\}\s*finally\s*\{/.test(handler)) {
    findings.push(`(a) the handler does not wrap its body in try/…/finally. EVERY exit — eight bare returns and an uncaught throw — must pass through ONE site, or the terminal row is optional again.`)
  }
  const fIdx = handler.indexOf('finally {')
  const finallyBlock = fIdx === -1 ? '' : handler.slice(fIdx)
  if (!/appendMessageFinished\s*\(/.test(finallyBlock)) {
    findings.push(`(a) \`appendMessageFinished\` is not called inside the handler's \`finally\`. Called anywhere else it is a per-path write wearing a structural costume — the uncaught-throw path would still write nothing.`)
  }
  // ── (b) NO EXIT BEFORE THE TRY ──────────────────────────────────────────────────────────────────────────
  const tIdx = handler.indexOf('try {')
  const preamble = tIdx === -1 ? handler : handler.slice(0, tIdx)
  if (/\breturn\b/.test(preamble)) {
    findings.push(`(b) the handler RETURNS before its \`try\` block. An exit above the try bypasses the finally silently, which is the exact class this design replaces — nine exits, one of them invisible.`)
  }
  // ── (c) THE CATCH RETHROWS ──────────────────────────────────────────────────────────────────────────────
  const cIdx = handler.indexOf('catch (')
  if (cIdx !== -1 && fIdx !== -1) {
    const catchBlock = handler.slice(cIdx, fIdx)
    if (!/\bthrow\b/.test(catchBlock)) {
      findings.push(`(c) the handler's \`catch\` does not RETHROW. Swallowing turns a crash into a 2xx and tells the queue the work succeeded — the inversion of what the terminal row exists to prevent.`)
    }
  }
  // ── THE FINALLY'S OWN WRITE MUST NOT MASK THE ORIGINAL ERROR ────────────────────────────────────────────
  if (finallyBlock && !/try\s*\{[\s\S]{0,400}appendMessageFinished/.test(finallyBlock)) {
    findings.push(`(d) the terminal write inside \`finally\` is not itself wrapped in try/catch. A throw from a finally REPLACES the exception in flight, so a failed bookkeeping write would erase the real fault and send the next reader to the wrong subsystem.`)
  }
  // ── (e) THE PUSH CALLBACK IS A PURE DELEGATION ─────────────────────────────────────────────────────────
  // ⛔ NEW WITH THE EXTRACTION, AND IT CLOSES A HOLE THE OLD SHAPE COULD NOT HAVE: now that the wrapper is a
  // separate function, the push callback is a place where logic could be added ABOVE the wrapper — an early
  // return, a swallow, a second try — and every leg above would still read green because it is inspecting the
  // wrapper. A delivery lane that decides anything before the wrapper is a tenth exit outside the one site.
  // ⛔ RE-ANCHORED AGAIN BY LORAMER_POLL_MODE_CUTOVER_V1, AND THE SUBJECT IS NOW THE LANE, NOT THE PUSH
  // CALLBACK. This leg used to look for `const handler = handleCallback(` in the same file. Delivery has
  // moved to a cron-driven poller, so the callback that hands a message to the wrapper lives in a DELIVERY
  // LANE under src/app. The property is identical and the reason is identical: whatever calls the wrapper
  // must decide NOTHING of its own, because legs (a)-(d) inspect the wrapper and cannot see an exit added
  // above it. ⛔ ZERO LANES IS A FINDING: a wrapper nothing calls is a topic nothing reads.
  const wrapperName = (src.slice(hIdx).match(/^async function ([A-Za-z0-9_$]+)/) || [])[1] ?? null
  // RE-ANCHORED BY LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 - the third consumer relocation this leg has
  // survived. The queue lanes are gone; the callers are now the INLINE EXECUTION HOSTS: the scheduled
  // fire and the operator drive (the worker's own mis-size continuation is internal, not a lane).
  const LANES = ['src/app/api/cron/universe-resume/route.ts', 'src/app/api/backfill/universe-drive/route.ts']
  const live = []
  for (const lane of LANES) {
    let laneSrc = ''
    try { laneSrc = readFileSync(resolve(ROOT, lane), 'utf8') } catch { continue }
    if (!wrapperName || !new RegExp(`\\b${wrapperName}\\s*\\(`).test(laneSrc)) continue
    live.push(lane)
    // ⛔ THE PURE-DELEGATION TEST DIED WITH THE QUEUE, AND ITS SUCCESSOR IS STATED, NOT ASSUMED. Under
    // push, the lane was handleCallback's closure: an early exit there bypassed the wrapper's finally, so
    // preamble control flow was a tenth exit. INLINE, the finally lives INSIDE the wrapper itself — a host
    // that returns before calling never STARTED a unit (no attempt_started, nothing to terminate), so
    // caller-side control flow cannot orphan a terminal. What CAN: a call that is not awaited — a dropped
    // promise detaches the unit from the fire's budget, its lease, and its heartbeat.
    const callSites = [...laneSrc.matchAll(new RegExp(`(await\\s+)?${wrapperName}\\(`, 'g'))]
    for (const m of callSites) {
      if (!m[1]) findings.push(`(e) ${lane} calls \`${wrapperName}\` WITHOUT await — a dropped promise runs the unit outside the fire's budget, lease and heartbeat, and its throw lands on nobody.`)
    }
  }
  if (!live.length) {
    findings.push(`(e) NO delivery lane calls \`${wrapperName ?? 'the wrapper'}\`. Looked in: ${LANES.join(', ')}. A wrapper nothing invokes is a walk nothing executes — the ★V2-CONSUMER-HAS-NO-TRIGGER-REGISTRATION shape, one layer up.`)
  }
}

if (findings.length) {
  console.error(`[completion-signal-on-every-exit] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ SPEC: DECISIONS LORAMER_COMPLETION_SIGNAL_DESIGN_V1. Silence is not completion — Airbyte, Temporal and SQS all say so, and this consumer emitted no terminal fact at all until migrations/083.`)
  process.exitCode = 1
} else {
  console.log(`[completion-signal-on-every-exit] PASS — the body is a named function, the handler wraps it in try/catch/finally, the terminal write lives in the finally and is itself guarded, the catch rethrows, and no exit precedes the try. ⛔ LIMIT: this proves the SHAPE, never that the row's content is right, and a platform kill still writes nothing (INDETERMINATE by construction).`)
}
