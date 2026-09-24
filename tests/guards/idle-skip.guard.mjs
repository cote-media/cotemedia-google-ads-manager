#!/usr/bin/env node
// LORAMER_IDLE_SKIP_V1 — AN IDLE WINDOW RETIRES ACROSS EVERY SURFACE FOR ONE REQUEST, ON GOOGLE'S OWN ANSWER ONLY.
//
// Measured 2026-09-17 23:13–00:27Z: 840 descend requests on Tri-Copy, every one 'zero' — an idle year asked 349 times
// per window. One account-level request per window answers it for all surfaces.
//
// Legs: (a) CORRECTNESS: an idle verdict rests on a SUCCESSFUL answer; a day the answer names is never idle; a failed
//           answer yields no verdict; past the wall without a served canary yields no verdict
//       (b) a mixed window is 'active' (walks whole), never 'idle' — it names the active range and the idle days
//       (c) the memo asks each window ONCE per fire, shares the answer across concurrent units, and is bounded
//       (d) SOURCE: the worker attests an idle window for a surface with a 0-request 'zero' row carrying the marker and
//           returns before the range loop; an active window reaches the range loop (every surface still walks); the
//           account request is charged under ACCOUNT_ACTIVITY_RESOURCE with requestsSpent 1; the fire route creates the
//           memo and passes it through unitOpts without fetching; the instrument reports the tallies
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const LIB = 'src/lib/backfill/universe-idle-skip.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'

let M = null
const tmp = mkdtempSync(join(tmpdir(), 'idle-skip-'))
try {
  const src = read(LIB)
    .replace(/import type \{ CanaryState \} from '@\/lib\/backfill\/retention-wall'\n/, '')
    .replace(/import \{ isPastWall \} from '@\/lib\/backfill\/retention-wall'/, 'const isPastWall = (end, wall) => end < wall')
  writeFileSync(join(tmp, 'idle.ts'), src)
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noResolve', '--skipLibCheck', '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'node', '--outDir', tmp, join(tmp, 'idle.ts')], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  M = await import(pathToFileURL(join(tmp, 'idle.js')).href)
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (M) {
  // LORAMER_WALL_HOLD_NEVER_RETIRE_V1 (Q6, 2026-09-18): no idle verdict is issued PAST the wall, so the verdict fixtures sit ABOVE it.
  const W = { windowStart: '2025-05-01', windowEnd: '2025-06-03', wallLine: '2023-08-18' }
  // (a) a failed answer → unknown, never idle
  const failed = M.idleVerdict({ ...W, canary: 'served', answer: { ok: false, error: 'network' } })
  check(failed.kind === 'unknown', `(a) ⛔ a FAILED account answer produced '${failed.kind}' — no answer, no verdict; the window must walk surface by surface.`)
  // (a) an answer naming a day in the window → never idle (the account spent)
  const spent = M.idleVerdict({ ...W, canary: 'served', answer: { ok: true, activeDays: ['2025-05-20'] } })
  check(spent.kind !== 'idle', `(a) ⛔ the account SPENT on 2025-05-20 and the window read '${spent.kind}' — a day Google names active can never be marked idle.`)
  // (a) days named OUTSIDE the window do not make it active; none inside → idle
  const idle = M.idleVerdict({ ...W, canary: 'served', answer: { ok: true, activeDays: ['2025-04-20', '2025-07-01'] } })
  check(idle.kind === 'idle', `(a) an answer naming no day INSIDE the window must read 'idle' (got ${idle.kind}).`)
  // (a) empty answer with an empty day list: idle only from ok:true
  const emptyOk = M.idleVerdict({ ...W, canary: 'served', answer: { ok: true, activeDays: [] } })
  check(emptyOk.kind === 'idle', `(a) a successful answer naming no day must read 'idle' (got ${emptyOk.kind}).`)
  // (a) past the line → 'idle' on an empty answer, whatever the canary (the probe answers there; the round-42 hold is lifted)
  for (const c of ['unknown', 'served']) {
    const past = M.idleVerdict({ windowStart: '2016-05-01', windowEnd: '2016-06-03', wallLine: '2023-08-18', canary: c, answer: { ok: true, activeDays: [] } })
    check(past.kind === 'idle', `(a) ⛔ past the line with canary '${c}' an empty account answer read '${past.kind}' — LORAMER_IDLE_SEED_RETRACTION_V1 (2026-09-24): the account probe ANSWERS past the line (312 ok rows naming 130–360 days on Tri-Copy; two direct re-asks zero at customer and campaign level); the round-42 hold rested on a wrong cause and is lifted. An empty answer is 'idle' past the line exactly as above it.`)
  }
  const above = M.idleVerdict({ windowStart: '2025-11-10', windowEnd: '2025-12-13', wallLine: '2023-08-18', canary: 'unknown', answer: { ok: true, activeDays: [] } })
  check(above.kind === 'idle', `(a) above the wall the canary is irrelevant: an empty answer must read 'idle' (got ${above.kind}).`)
  // (b) mixed → active with the range and the split
  const mixed = M.idleVerdict({ ...W, canary: 'served', answer: { ok: true, activeDays: ['2025-05-10', '2025-05-12'] } })
  check(mixed.kind === 'active' && mixed.activeStart === '2025-05-10' && mixed.activeEnd === '2025-05-12' && mixed.activeDays === 2 && mixed.idleDays === 32, `(b) a mixed window must read 'active' naming the range 2025-05-10..12 with 2 active / 32 idle days (got ${JSON.stringify(mixed)}).`)
  // (c) the memo asks once per window, shares across concurrent callers, and is bounded
  let asks = 0
  const stream = (gaql) => (async function* () { asks++; if (/2025-05-01/.test(gaql)) return; yield { segments: { date: '2026-01-05' } } })()
  const ledgered = []
  const memo = M.createIdleMemo({ wallLine: '2023-08-18', canary: 'served', maxWindows: 2 })
  const ledger = async (w, a) => { ledgered.push({ w, ok: a.ok }) }
  const [v1, v2, v3] = await Promise.all([
    memo.verdictFor({ windowStart: '2025-05-01', windowEnd: '2025-06-03', stream, ledger }),
    memo.verdictFor({ windowStart: '2025-05-01', windowEnd: '2025-06-03', stream, ledger }),
    memo.verdictFor({ windowStart: '2025-05-01', windowEnd: '2025-06-03', stream, ledger }),
  ])
  check(asks === 1 && ledgered.length === 1, `(c) ⛔ three concurrent units on ONE window asked the vendor ${asks} time(s) and ledgered ${ledgered.length} — the memo must ask once and share the promise.`)
  check(v1.kind === 'idle' && v2.kind === 'idle' && v3.kind === 'idle', `(c) all three units must receive the same idle verdict.`)
  const v4 = await memo.verdictFor({ windowStart: '2026-01-01', windowEnd: '2026-02-03', stream, ledger })
  check(v4.kind === 'active' && asks === 2, `(c) a second window is asked once and reads active (got ${v4.kind}, asks ${asks}).`)
  const v5 = await memo.verdictFor({ windowStart: '2026-03-01', windowEnd: '2026-04-03', stream, ledger })
  check(v5.kind === 'unknown' && asks === 2, `(c) ⛔ the third window exceeded maxWindows=2 and must read 'unknown' with NO request (got ${v5.kind}, asks ${asks}).`)
  check(memo.stats.windowsAsked === 2 && memo.stats.requestsSpent === 2 && memo.stats.idle === 1 && memo.stats.active === 1 && memo.stats.unknown === 1, `(c) stats must read asked 2 / spent 2 / idle 1 / active 1 / unknown 1 (got ${JSON.stringify(memo.stats)}).`)
  // (a) the GAQL is account-level with segments.date and the broad metric set
  const g = M.activityGaql('2016-05-01', '2016-06-03')
  check(/^SELECT segments\.date, metrics\.cost_micros, .* FROM customer WHERE segments\.date BETWEEN '2016-05-01' AND '2016-06-03'$/.test(g) && !/video_views/.test(g), `(a) the activity GAQL must be customer-level, dated, with the proven metric set and without metrics.video_views (got ${g}).`)
}

// (d) SOURCE
{
  const w = strip(read(WORKER))
  const iIdle = w.indexOf("if (lane === 'descend' && opts.idle && owed.ranges.length > 0)")
  const iLoop = w.indexOf('for (const range of owed.ranges)')
  check(iIdle > 0 && iLoop > iIdle, `(d) ${WORKER}: the idle check must sit BEFORE the range loop and apply to the descend lane only (idle@${iIdle} loop@${iLoop}).`)
  check(/verdict\.kind === 'idle'[\s\S]{0,400}appendAttemptStarted\(key, 0, \{ startDate, endDate \}, prov, lane\)[\s\S]{0,600}appendAttemptFinished\(key, opened\.attemptNo, 'zero', \{[\s\S]{0,200}requestsSpent: 0[\s\S]{0,300}\$\{IDLE_ATTESTED_MARKER\}[\s\S]{0,400}return 0/.test(w), `(d) ${WORKER}: an idle window must attest for this surface with a 0-request 'zero' row carrying IDLE_ATTESTED_MARKER and return before any range is asked.`)
  check(/resource: ACCOUNT_ACTIVITY_RESOURCE[\s\S]{0,400}appendAttemptStarted\(actKey, 1, undefined, prov, 'descend'\)[\s\S]{0,400}requestsSpent: 1/.test(w), `(d) ${WORKER}: the account request must be charged under ACCOUNT_ACTIVITY_RESOURCE with requestsSpent 1 — an unledgered vendor op is invisible to every governor.`)
  check(!/verdict\.kind === 'active'[\s\S]{0,200}return 0/.test(w.slice(iIdle, iLoop)), `(d) ${WORKER}: an ACTIVE window must fall through to the range loop — every surface still walks.`)
  const r = strip(read(ROUTE))
  // LORAMER_IDLE_REUSE_MONTH_V1 (2026-09-18): the memo is seeded from the ledger's prior answers (prior: idlePrior).
  check(/const idleMemo = createIdleMemo\(\{ wallLine, canary: canary\.state(, prior: idlePrior)? \}\)/.test(r) && /idle: idleMemo/.test(r), `(d) ${ROUTE}: the fire must create ONE memo per fire and pass it through unitOpts.`)
  check(!/askAccountActivity|activityGaql|googleAdsStreamFor/.test(r), `(d) ${ROUTE}: the fire route must not ask the account itself — the scheduler does not fetch.`)
  check(/idleWindowsAsked: idleMemo\.stats\.windowsAsked/.test(r) && /idleSurfacesRetired/.test(r), `(d) ${ROUTE}: the instrument must report the idle tallies.`)
}

if (findings.length) {
  console.error(`[idle-skip] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[idle-skip] PASS — an idle verdict rests on a successful account answer naming no day in the window (a spent day is never idle; a failed answer and a past-wall window without a served canary yield no verdict); a mixed window walks whole; one request per window per fire shared across units and bounded; the worker attests idle windows with 0-request zero rows and charges the account request; the fire route creates the memo without fetching.')
