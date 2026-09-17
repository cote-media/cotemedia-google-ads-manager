#!/usr/bin/env node
// LORAMER_CONTINUOUS_RUN_V1 — STEPS FOLLOW EACH OTHER, A LOOP CANNOT SPIN, AND THE LANE HAS NO VENDOR IN IT.
//
// ⛔ THE MEASURED PROBLEM, Round 8: 17 fires per client per day, average gap 85.3 minutes, each fire ~90 s of
// a 300 s ceiling. The engine was not slow, it was STOPPED — and the press bought exactly one fire.
//
// ⛔ THE RISK THE CHAIN CREATES, AND WHY MOST OF THIS GUARD IS ABOUT IT. Removing the 5-minute wait removes
// the thing that used to hide a no-progress loop behind its own slowness. A chain spins as fast as the engine
// can go, so the no-progress bound stops being a nicety and becomes the safety property.
//
// LEGS
//  (a) BEHAVIOURAL: a step that gained ground chains, with no delay anywhere in the decision
//  (b) BEHAVIOURAL — LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1: the no-progress stop is a WINDOW OF TIME SPENT ASKING
//      (NO_PROGRESS_WINDOW_MS), never a step count: (i) 2 s steps asking without progress for 6 s do NOT stop the
//      run; (ii) asking past the window DOES, as FAILED with a reason that says so — never silently as `done`;
//      (iii) held steps alone never trip it, however long the hold; (iv) the run ends at RUN_CEILING_MS elapsed,
//      never at a step count
//  (c) BEHAVIOURAL: only `atFloor` ends a run as `done`
//  (d) BEHAVIOURAL: an operator stop is honoured even while the run is doing well, and the running step is
//      allowed to finish rather than being killed mid-work
//  (e) BEHAVIOURAL: a held step still chains (a hold clears on its own) and NEVER counts as no progress — only a
//      step that OPENED requests and retired no owed days does (Russ, 2026-09-17)
//  (f) the run path names NO platform, and the vendor is never defaulted to a literal
//  (g) progress is read from the CONSUMER ledger (day_committed), never from the producer's own count
//  (h) the chain is immediate — no setTimeout, no sleep, no cron, no delay parameter on the self-invoke
//  (i) two chains cannot both drive one lane (compare-and-set on the step counter)
//  (j) daily upkeep is untouched: the cron list still holds its entries and the resume route is not edited
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}

const MOD = 'src/lib/backfill/continuous-run.ts'
const ROUTE = 'src/app/api/backfill/universe-run/route.ts'

const out = mkdtempSync(join(tmpdir(), 'loramer-continuous-run-'))
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, MOD), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const M = createRequire(import.meta.url)(join(out, 'src/lib/backfill/continuous-run.js'))

  const S = (over = {}) => ({ status: 'running', steps: 1, stepsWithoutProgress: 0, runElapsedMs: 60_000, askingWithoutProgressMs: null, ...over })
  const O = (over = {}) => ({ requestsOpened: 40, daysNoLongerOwed: 30, atFloor: false, held: null, fatal: null, ...over })

  // (a) gained ground → chain
  const good = M.decideChain(S(), O())
  if (good.chain !== true) findings.push(`(a) a step that retired 30 owed days did not chain: ${JSON.stringify(good)}. The whole flight is that the next step follows immediately.`)

  // (c) only atFloor ends as done
  const floor = M.decideChain(S(), O({ atFloor: true, daysNoLongerOwed: 0 }))
  if (floor.chain !== false || floor.status !== 'done') findings.push(`(c) reaching the floor did not end the run as done: ${JSON.stringify(floor)}.`)
  for (const [label, o] of [['no progress', O({ daysNoLongerOwed: 0 })], ['fatal', O({ fatal: 'boom' })]]) {
    let st = S({ askingWithoutProgressMs: M.NO_PROGRESS_WINDOW_MS })
    const v = M.decideChain(st, o)
    if (v.chain === false && v.status === 'done') {
      findings.push(`(c) a run ended as DONE on "${label}". Only the FLOOR is an arrival; everything else that ends must be failed WITH a reason, or a button will report a stalled lane as finished.`)
    }
  }

  // (b) THE NO-PROGRESS STOP IS TIME SPENT ASKING, NOT A STEP COUNT — LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1
  if (typeof M.NO_PROGRESS_WINDOW_MS !== 'number' || typeof M.RUN_CEILING_MS !== 'number') {
    findings.push(`(b) NO_PROGRESS_WINDOW_MS / RUN_CEILING_MS are not exported numbers. The bounds were derived at ~90 s/step and the chain measured 2 s/step: a step count of 3 is 6 seconds of tolerance, and 2,000 steps is 67 minutes — both must be TIME.`)
  } else {
    if (M.NO_PROGRESS_WINDOW_MS !== 270_000) findings.push(`(b) NO_PROGRESS_WINDOW_MS is ${M.NO_PROGRESS_WINDOW_MS}, not 270000 — the tolerance the old bound was derived for (3 steps × ~90 s).`)
    if (M.RUN_CEILING_MS !== 180_000_000) findings.push(`(b) RUN_CEILING_MS is ${M.RUN_CEILING_MS}, not 180000000 — the ceiling the old bound was derived for (2,000 steps × ~90 s).`)
    if ('MAX_STEPS_WITHOUT_PROGRESS' in M || 'MAX_STEPS_PER_RUN' in M) findings.push(`(b) the step-count bounds are still exported; a second bound on the same property is how one of them gets forgotten.`)
    // (i) 2 s steps, no progress for 6 s → still chains
    const asking = O({ daysNoLongerOwed: 0, requestsOpened: 40 })
    const six = M.decideChain(S({ askingWithoutProgressMs: 6_000 }), asking)
    if (six.chain !== true) findings.push(`(b)(i) ⛔ SIX SECONDS OF ASKING WITHOUT PROGRESS ENDED THE RUN: ${JSON.stringify(six)}. At 2 s/step that is three steps — one vendor hiccup — and the bound was derived for 4.5 minutes.`)
    // spin check: many fast no-progress steps inside the window never stop it; the window does
    let st = S({ askingWithoutProgressMs: 0 }); let ended = null
    for (let i = 1; i <= 200; i++) {
      const v = M.decideChain(st, asking)
      if (!v.chain) { ended = { i, v }; break }
      st = { ...M.applyStep(st, asking), askingWithoutProgressMs: i * 2_000 }
    }
    if (!ended) findings.push(`(b)(ii) ⛔ THE RUN SPUN: 200 no-progress steps (400 s of asking) chained without the window firing (window ${M.NO_PROGRESS_WINDOW_MS} ms).`)
    else {
      if (ended.i * 2_000 < M.NO_PROGRESS_WINDOW_MS) findings.push(`(b)(ii) the run ended after ${ended.i * 2_000} ms of asking, before the ${M.NO_PROGRESS_WINDOW_MS} ms window.`)
      if (ended.v.status !== 'failed') findings.push(`(b)(ii) the window ended the run as ${ended.v.status}, not failed.`)
      if (!/retired no owed days/.test(ended.v.reason) || !/asking/i.test(ended.v.reason)) findings.push(`(b)(ii) the ending gave no usable reason: ${ended.v.reason}`)
    }
    // a step at exactly the window ends it
    const atWindow = M.decideChain(S({ askingWithoutProgressMs: M.NO_PROGRESS_WINDOW_MS }), asking)
    if (atWindow.chain !== false || atWindow.status !== 'failed') findings.push(`(b)(ii) asking for the full window without progress did not end the run as failed: ${JSON.stringify(atWindow)}.`)
    // (iii) held steps alone never trip it, however long
    const heldLong = M.decideChain(S({ askingWithoutProgressMs: M.NO_PROGRESS_WINDOW_MS * 10 }), O({ daysNoLongerOwed: 0, requestsOpened: 0, held: 'quota paused until tomorrow' }))
    if (heldLong.chain !== true) findings.push(`(b)(iii) ⛔ A HELD STEP TRIPPED THE NO-PROGRESS STOP: ${JSON.stringify(heldLong)}. A hold clears on its own; a held step never counts as no progress.`)
    const heldWithAsk = M.decideChain(S({ askingWithoutProgressMs: M.NO_PROGRESS_WINDOW_MS * 10 }), O({ daysNoLongerOwed: 0, requestsOpened: 5, held: 'meter held' }))
    if (heldWithAsk.chain !== true) findings.push(`(b)(iii) a held step that also opened requests tripped the stop: ${JSON.stringify(heldWithAsk)}.`)
    const nothingAsked = M.decideChain(S({ askingWithoutProgressMs: M.NO_PROGRESS_WINDOW_MS * 10 }), O({ daysNoLongerOwed: 0, requestsOpened: 0 }))
    if (nothingAsked.chain !== true) findings.push(`(b)(iii) a step that opened NO requests counted as no progress: ${JSON.stringify(nothingAsked)}. Only a step that asked and retired nothing counts.`)
    // (iv) the ceiling is elapsed time, not steps
    const byTime = M.decideChain(S({ steps: 5, runElapsedMs: M.RUN_CEILING_MS }), O())
    if (byTime.chain !== false || byTime.status !== 'failed' || !/SAFETY BOUND, not an arrival/i.test(byTime.reason)) findings.push(`(b)(iv) reaching RUN_CEILING_MS did not end the run as failed with the safety-bound wording: ${JSON.stringify(byTime)}.`)
    const bySteps = M.decideChain(S({ steps: 5_000, runElapsedMs: 60_000 }), O())
    if (bySteps.chain !== true) findings.push(`(b)(iv) ⛔ A STEP COUNT ENDED THE RUN: ${JSON.stringify(bySteps)}. 5,000 steps in one minute is a fast chain, not a runaway; the ceiling is elapsed time.`)
  }
  // progress RESETS the streak counter — one good step must clear the path to a long run
  const reset = M.applyStep(S({ stepsWithoutProgress: 2 }), O({ daysNoLongerOwed: 5 }))
  if (reset.stepsWithoutProgress !== 0) findings.push(`(b) a step that gained ground did not reset the no-progress counter (${reset.stepsWithoutProgress}). A long healthy run would then die of old sins.`)

  // (d) operator stop wins even while healthy
  const stopping = M.decideChain(S({ status: 'stopping' }), O())
  if (stopping.chain !== false || stopping.status !== 'stopping') {
    findings.push(`(d) an operator stop did not end the chain while the run was doing well: ${JSON.stringify(stopping)}. A stop that can be outvoted by progress is not a stop.`)
  }
  if (!/finished rather than being killed/.test(stopping.reason)) {
    findings.push(`(d) the stop does not say the running step was allowed to finish. Killing a step mid-work is the outcome refuse-and-record exists to prevent.`)
  }

  // (e) a held step chains and never counts as no progress
  const held = M.decideChain(S(), O({ daysNoLongerOwed: 0, requestsOpened: 0, held: 'quota paused' }))
  if (held.chain !== true) findings.push(`(e) a HELD step ended the run. A hold clears on its own and the next step re-reads it; ending would turn a pause into an abandonment the button reports as finished.`)
  const heldState = M.applyStep(S({ stepsWithoutProgress: 2 }), O({ daysNoLongerOwed: 0, requestsOpened: 0, held: 'quota paused' }))
  if (heldState.stepsWithoutProgress !== 2) findings.push(`(e) a held step changed the no-progress streak (${heldState.stepsWithoutProgress}); a hold neither counts nor resets.`)
  const askedState = M.applyStep(S({ stepsWithoutProgress: 2 }), O({ daysNoLongerOwed: 0, requestsOpened: 40 }))
  if (askedState.stepsWithoutProgress !== 3) findings.push(`(e) a step that asked and retired nothing did not count toward the streak (${askedState.stepsWithoutProgress}).`)
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

const mod = read(MOD)
const route = read(ROUTE)
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

// ── (f) NO PLATFORM IN THE RUN PATH ─────────────────────────────────────────────────────────────────
const PLATFORM_WORDS = /\b(google|googleads|google_ads|gaql|shopify|woocommerce|ga4|facebook|meta_)\b/i
for (const f of [MOD, ROUTE]) {
  const src = f === MOD ? mod : route
  if (!src) continue
  stripComments(src).split('\n').forEach((line, i) => {
    const bare = line.replace(/from\s+'[^']*'/g, '').replace(/['"][^'"]*universe-[a-z-]+['"]/g, '')
    const m = PLATFORM_WORDS.exec(bare)
    if (m) findings.push(`(f) ${f}:${i + 1} names a platform in CODE — "${m[0]}" in \`${line.trim().slice(0, 90)}\`. The run is addressed by (client, vendor); a vendor literal here is the rotation's google filter returning in a new place.`)
  })
}
if (route && /vendor\s*=\s*[^;\n]*\|\|\s*'[a-z_]+'/.test(stripComments(route))) {
  findings.push(`(f) ${ROUTE} DEFAULTS the vendor to a literal. A default is this file knowing which vendor it serves, which is the thing Round 1 found wrong with the rotation.`)
}

// ── (g) PROGRESS FROM THE CONSUMER LEDGER ───────────────────────────────────────────────────────────
// LORAMER_RUN_PROGRESS_SIGNAL_V1 — the ledger read moved into universe-coverage.ts (daysNoLongerOwedSince), beside the
// owed-set derivation it must agree with; the route must call it and nothing else for progress.
if (route && !/daysNoLongerOwedSince\(/.test(stripComments(route))) {
  findings.push(`(g) ${ROUTE} does not count progress through daysNoLongerOwedSince (universe_attempt_log: day_committed rows + attesting-lane terminals). Chaining on the producer's own count is LORAMER_ADJACENT_NUMBER_V1 exactly — it is the number check-walk-liveness read while the consumer had been dead for eleven hours.`)
}
if (route && /days(Committed|NoLongerOwed):\s*(body|inst)\./.test(stripComments(route))) {
  findings.push(`(g) ${ROUTE} takes daysCommitted straight from the step's own response. The step reporting its own progress is the producer grading itself.`)
}

// ── (h) THE CHAIN IS IMMEDIATE ──────────────────────────────────────────────────────────────────────
if (route) {
  const code = stripComments(route)
  for (const [pat, why] of [
    [/setTimeout\s*\(/, 'a setTimeout between steps is a cron wait wearing a different name'],
    [/\bsleep\s*\(/, 'a sleep between steps re-introduces exactly the idle this flight removes'],
    [/delay(Ms|Seconds)?\s*[:=]/, 'a delay parameter on the self-invoke is the 5-minute wait, parameterised'],
  ]) {
    if (pat.test(code)) findings.push(`(h) ${ROUTE}: ${why}.`)
  }
  if (!/waitUntil\(fetch\(/.test(code)) {
    findings.push(`(h) ${ROUTE} does not self-invoke the next step through waitUntil(fetch(…)). That is the kick pattern this repo already runs and the only thing making the chain continuous.`)
  }
}

// ── (i) TWO CHAINS CANNOT BOTH DRIVE ONE LANE ───────────────────────────────────────────────────────
if (route && !/\.eq\('steps',\s*run\.steps\)/.test(route)) {
  findings.push(`(i) ${ROUTE}'s step update is not a compare-and-set on the step counter. Without it two chains that both believe they are the run would both advance it, double-spending the lane.`)
}
if (route && !/another chain advanced this run/.test(route)) {
  findings.push(`(i) ${ROUTE} does not exit quietly when it loses the compare-and-set — a loser that retries is a race with extra steps.`)
}

// ── (j) DAILY UPKEEP IS UNTOUCHED ───────────────────────────────────────────────────────────────────
{
  let cron = null
  try { cron = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) } catch (e) { findings.push(`(j) vercel.json unreadable — ${e.message}`) }
  if (cron) {
    const paths = (cron.crons || []).map((c) => c.path)
    for (const needed of ['/api/cron/universe-resume', '/api/cron/forward-driver', '/api/cron/sync']) {
      if (!paths.some((p) => p.startsWith(needed))) {
        findings.push(`(j) vercel.json no longer schedules ${needed}. This flight adds a run alongside daily upkeep; it must not replace it — other clients keep their rotation.`)
      }
    }
    if (paths.some((p) => p.startsWith('/api/backfill/universe-run'))) {
      findings.push(`(j) the run route is on a CRON. It is started per (client, vendor) by a caller and chains itself; scheduling it would re-create the take-turns regime this flight removes.`)
    }
  }
}

if (findings.length) {
  console.error(`[continuous-run] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[continuous-run] PASS — a step that gained ground chains with no delay · asking without progress past NO_PROGRESS_WINDOW_MS ENDS the run as failed with a reason, six seconds of it does not · only the floor ends it as done · the ceiling is RUN_CEILING_MS elapsed, never a step count · an operator stop wins over progress and lets the step finish · a held step chains and never counts as no progress · the run path names no platform and never defaults the vendor · progress is read from the consumer ledger · the chain is immediate · a losing chain exits rather than racing · daily upkeep is still scheduled and the run is not.`)
