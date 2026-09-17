#!/usr/bin/env node
// LORAMER_RUN_PUMP_V1 — THE CONTINUOUS RUN IS DRIVEN BY A CRON-TRIGGERED PUMP THAT STEPS INSIDE ONE INVOCATION;
// NOTHING IN THE CHAIN REQUESTS ITS OWN DEPLOYMENT.
//
// ⛔ THE MEASURED DEFECT (2026-09-17, round 9): the run chained by having each step fetch its own route through
// waitUntil(fetch(same deployment)). Vercel's loop detector ("x-vercel-id … allows Vercel to automatically prevent
// infinite loops"; INFINITE_LOOP_DETECTED "when the application is making an infinite number of requests to itself";
// no threshold is published) refused the FOURTH hop with HTTP 508 — start → step 1 → step 2 → step 3 → step 4's fire
// fetch died, exactly where a community case (thread 37450) died. A run on Vercel can never be deeper than ~3
// self-requests, so a self-kicked chain cannot reach a floor.
//
// THE SHAPE: a Vercel cron (platform → function, depth 0) invokes the pump every minute; the pump claims ONE active
// lane and runs step after step INSIDE its own invocation (each step's fire fetch is depth 1, the same shape the
// driver has always used), with no delay between steps, until the run ends or the invocation's deadline reserve is
// reached; the next minute's pump resumes. No request from any function to its own deployment exists in the chain.
//
// LEGS — behavioural on the pure loop (pumpLane) with an injected step, and source on the wiring:
//  (i)   at least ten steps complete inside one invocation, and NOT ONE request in the chain targets the run route or
//        the pump route (the fire fetch is the only outbound call and it is depth 1)
//  (ii)  the invocation ends cleanly before its duration cap: with the reserve in force it never starts a step that
//        could not finish before the deadline
//  (iii) a duplicate kick is refused: a step whose compare-and-set loses (another pump owns the lane) ends the loop
//        without another step
//  (iv)  the shipped stop limits still end the run: a step that reports the run ended (failed/done/stopping) ends the
//        loop with that status and reason
//  (v)   a fatal ends it as failed with its reason, carried out of the loop verbatim
//  (vi)  the trigger goes quiet when no run is active: the pump route makes zero fires and returns immediately
//  (vii) SOURCE: the run route and the step module contain no waitUntil(fetch(...universe-run...)) and no fetch of the
//        pump; vercel.json schedules the pump every minute and never the run route; the pump is authenticated
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const PUMP_LIB = 'src/lib/backfill/universe-run-pump.ts'
const STEP_LIB = 'src/lib/backfill/universe-run-step.ts'
const RUN_ROUTE = 'src/app/api/backfill/universe-run/route.ts'
const PUMP_ROUTE = 'src/app/api/cron/universe-run-pump/route.ts'

const out = mkdtempSync(join(tmpdir(), 'loramer-run-pump-'))
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, PUMP_LIB), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const M = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-run-pump.js'))

  // A fake clock and a fake step. Every outbound URL the step would call is recorded so leg (i) can prove depth.
  const mk = (opts = {}) => {
    let now = 0
    const urls = []
    let n = 0
    const step = async () => {
      n++
      urls.push('https://app.example/api/cron/universe-resume?clientId=c&dryRun=0') // the fire: depth 1
      now += opts.stepMs ?? 2_000
      if (opts.script) { const s = opts.script(n); if (s) return s }
      return { chained: true, status: 'running', reason: `retired 3 owed day(s), 40 request(s) opened`, casLost: false }
    }
    return { deps: { step, now: () => now, deadlineMs: opts.deadlineMs ?? 800_000, reserveMs: opts.reserveMs ?? 320_000, log: () => {} }, urls, count: () => n }
  }

  // (i) ten+ steps in one invocation, zero self-requests
  {
    const f = mk({ stepMs: 2_000 })
    const res = await M.pumpLane(f.deps)
    check(f.count() >= 10, `(i) only ${f.count()} step(s) ran inside one invocation with 800 s available and 2 s steps — the pump must chain many steps per invocation, or the cron minute becomes the step gap.`)
    check(!f.urls.some((u) => /universe-run/.test(u)), `(i) ⛔ A REQUEST IN THE CHAIN TARGETS THE RUN OR PUMP ROUTE: ${f.urls.find((u) => /universe-run/.test(u))}. Vercel refuses the fourth self-request with 508; the chain must never request its own deployment's run path.`)
    check(res.stoppedBecause === 'deadline', `(i) a healthy run stopped for "${res.stoppedBecause}", not the deadline reserve.`)
  }
  // (i-b) a run SURVIVES THREE SLICE BOUNDARIES: three invocations over one shared run, each ending at its deadline
  // reserve, the run still chaining, and not one request in any of them
  {
    let shared = 0; const urls = []
    const invocation = () => { let now = 0; return { step: async () => { shared++; urls.push('https://app.example/api/cron/universe-resume?clientId=c&dryRun=0'); now += 30_000; return { chained: true, status: 'running', reason: 'retired 2 owed day(s), 40 request(s) opened', casLost: false } }, now: () => now, deadlineMs: 800_000, reserveMs: 320_000, log: () => {} } }
    const outs = []
    for (let i = 0; i < 3; i++) outs.push(await M.pumpLane(invocation()))
    check(outs.every((o) => o.stoppedBecause === 'deadline' && o.status === 'running'), `(i-b) a slice did not end on its deadline reserve with the run still chaining: ${JSON.stringify(outs)}`)
    check(shared >= 30, `(i-b) only ${shared} steps across three slices — the run did not carry across slice boundaries.`)
    check(!urls.some((u) => /universe-run/.test(u)), '(i-b) a slice requested the run or pump route.')
  }
  // (ii) ends before the cap: with 100 s steps and a 320 s reserve, the last step starts before 480 s
  {
    const f = mk({ stepMs: 100_000, deadlineMs: 800_000, reserveMs: 320_000 })
    const res = await M.pumpLane(f.deps)
    check(f.count() === 5, `(ii) ${f.count()} step(s) ran with 100 s steps, an 800 s deadline and a 320 s reserve — expected 5 (starts at 0,100,200,300,400 s; a start at 480 s would breach the reserve).`)
    check(f.deps.now() <= 800_000 - 320_000 + 100_000, `(ii) the invocation ran past its reserve: now=${f.deps.now()} ms.`)
    check(res.stoppedBecause === 'deadline' && res.steps === 5, `(ii) wrong stop: ${JSON.stringify(res)}`)
  }
  // (iii) a lost compare-and-set ends the loop — another pump owns the lane
  {
    const f = mk({ script: (n) => n === 3 ? { chained: false, status: 'running', reason: 'another chain advanced this run — exiting rather than racing it', casLost: true } : null })
    const res = await M.pumpLane(f.deps)
    check(f.count() === 3 && res.stoppedBecause === 'cas-lost', `(iii) a lost compare-and-set did not end the loop (${f.count()} steps, ${JSON.stringify(res)}). Two pumps on one lane would double-spend it.`)
  }
  // (iv) the shipped stop limits end the loop with their status and reason
  {
    const f = mk({ script: (n) => n === 4 ? { chained: false, status: 'failed', reason: 'retired no owed days for 271 s of asking (window 270000 ms, 7 asking step(s)) and the lane is NOT at its floor. Ground was offered and not taken — ending rather than spinning.', casLost: false } : null })
    const res = await M.pumpLane(f.deps)
    check(f.count() === 4 && res.stoppedBecause === 'run-ended' && res.status === 'failed' && /retired no owed days/.test(res.reason), `(iv) the no-progress window's end did not carry out of the loop: ${JSON.stringify(res)}`)
    const g = mk({ script: (n) => n === 2 ? { chained: false, status: 'done', reason: 'the lane reached its floor — nothing is owed above inception', casLost: false } : null })
    const res2 = await M.pumpLane(g.deps)
    check(res2.status === 'done' && g.count() === 2, `(iv) the floor did not end the loop as done: ${JSON.stringify(res2)}`)
  }
  // (v) a fatal ends it as failed with its reason, verbatim
  {
    const f = mk({ script: (n) => n === 1 ? { chained: false, status: 'failed', reason: 'step reported a fatal condition: step returned HTTP 500: {"ok":false}', casLost: false } : null })
    const res = await M.pumpLane(f.deps)
    check(res.status === 'failed' && res.reason === 'step reported a fatal condition: step returned HTTP 500: {"ok":false}' && f.count() === 1, `(v) a fatal was not carried out verbatim: ${JSON.stringify(res)}`)
  }
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// (vi)+(vii) SOURCE
{
  const run = stripComments(read(RUN_ROUTE))
  const step = stripComments(read(STEP_LIB))
  const pump = stripComments(read(PUMP_ROUTE))
  for (const [name, src] of [[RUN_ROUTE, run], [STEP_LIB, step], [PUMP_ROUTE, pump]]) {
    check(!/waitUntil\s*\(/.test(src), `(vii) ${name} still uses waitUntil — the self-kick is the thing Vercel refuses at the fourth hop.`)
    // ⛔ NO HTTP IN THE CHAIN AT ALL (LORAMER_NO_HTTP_TO_SELF_V1): a fetch of our own run path met the loop detector; a
    // fetch of our own fire met Vercel Authentication on the deployment-URL origin (an SSO page read as "nothing asked").
    check(!/\bfetch\s*\(/.test(src), `(vii) ${name} makes an HTTP request. The chain must make none: the fire is called in-process (universe-run-fire.ts), never over the deployment's own URL.`)
  }
  check(/action === 'start'/.test(run) && !/fetch\(`\$\{origin\}\/api\/backfill\/universe-run/.test(run), `(vii) ${RUN_ROUTE}'s start still kicks the first step by fetching itself; the pump picks a started run up within a minute.`)
  check(/inProcessFire\(/.test(pump) && /inProcessFire\(/.test(run), `(vii) the pump or the run route does not call the fire in-process (inProcessFire). A URL is a second way to be wrong about which code runs.`)
  // a chaining step must not write status back — an operator's stop landed between a step's read and its write
  // the step now has TWO updates under the compare-and-set: the claim at start (updated_at only) and the write at end;
  // the rule binds the one that carries the verdict clause
  const upd = [...step.matchAll(/\.update\(\{([\s\S]*?)\}\)\s*\n\s*\.eq\('client_id'/g)].map((m) => m[1]).find((u) => /verdict\.chain/.test(u)) ?? ''
  check(upd.length > 0 && !/^\s*status:/m.test(upd) && /verdict\.chain \? \{\} : \{ status: verdict\.status/.test(upd), `(vii) ${STEP_LIB}'s chaining update writes \`status\`. It would write the status it READ back over an operator's stop; only an ending step may write status.`)
  // the picker skips a lane stepped inside the last reserve window
  check(/\.lt\('updated_at',\s*busyAfter\)/.test(pump), `(vii) ${PUMP_ROUTE}'s picker does not skip a lane TOUCHED inside the reserve window (updated_at). last_step_at is written at step END, so a lane whose first step is in flight looks free — the second pump then fires into the lease (measured 21:54Z).`)
  // the step claims the lane at START under the same compare-and-set, before it fires anything
  const claim = /\.update\(\{\s*updated_at:\s*stepStartedAt[^}]*\}\)[\s\S]{0,200}\.eq\('steps',\s*run\.steps\)/.test(step)
  check(claim, `(vii) ${STEP_LIB} does not claim the lane at step start (update updated_at under the steps compare-and-set) before firing. Without the claim the picker cannot see an in-flight first step.`)
  const fireAfterClaim = step.indexOf('a.fire()') > step.indexOf('updated_at: stepStartedAt')
  check(fireAfterClaim, `(vii) ${STEP_LIB} fires before it claims the lane.`)
  // the floor needs an instrument
  check(/const scanned = body\?\.instrument != null/.test(step) && /&& scanned\s*\n/.test(step), `(vii) ${STEP_LIB}'s atFloor does not require the fire's instrument; a lease-held answer (no instrument) read as the floor and ended a run with 60 candidates (21:54Z).`)
  check(/CRON_SECRET/.test(pump) && /status: 401/.test(pump), `(vii) ${PUMP_ROUTE} is not CRON_SECRET-gated.`)
  check(/no active run/i.test(pump) || /nothing to pump/i.test(pump), `(vii)(vi) ${PUMP_ROUTE} has no quiet path for "no active run" — the trigger must go quiet, not scan.`)
  check(/maxDuration = 800/.test(read(PUMP_ROUTE)), `(vii) ${PUMP_ROUTE} does not declare maxDuration = 800 — the pump must outlive the fire it awaits (300 s) by the same margin the run route did.`)
  let cron = null
  try { cron = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) } catch (e) { findings.push(`(vii) vercel.json unreadable — ${e.message}`) }
  if (cron) {
    const entries = (cron.crons || []).filter((c) => String(c.path || '').startsWith('/api/cron/universe-run-pump'))
    check(entries.length === 1 && entries[0].schedule === '* * * * *', `(vii) vercel.json does not schedule /api/cron/universe-run-pump every minute (found ${JSON.stringify(entries)}). Pro's minimum interval is once per minute; the pump's gap between invocations is that minute.`)
    check(!(cron.crons || []).some((c) => String(c.path || '').startsWith('/api/backfill/universe-run')), '(vii) the run route itself is on a cron — the pump is the scheduled thing, never the run route.')
  }
}

if (findings.length) {
  console.error(`[run-pump] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[run-pump] PASS — ten+ steps per invocation with zero self-requests · the invocation stops inside its deadline reserve · a lost compare-and-set ends the loop · the shipped stop limits and a fatal carry out with their reasons · the pump is cron-scheduled every minute, secret-gated, and quiet with no active run.')
