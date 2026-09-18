#!/usr/bin/env node
// LORAMER_STATUS_RUN_FIELDS_V1 — THE READOUT CARRIES THE RUN, ADDITIVELY, AND A DEAD PUMP READS 'STALLED', NOT 'IMPORTING'.
//
// /api/backfill/status is read by the legacy /clients page (BackfillControl.tsx: `status.complete`, `status.earliestDate`)
// and by the -next profile (those two + `state`). Flight 2 adds `run`, `progress` and `stalled` on platforms.google.
// This guard proves:
//   (a) PURE runView(row, nowMs): finished_at WINS over a stale last_invocation (a finished row is never live); a live
//       row with no step for RUN_STALL_MINUTES reads stalled; a live row stepped 2 min ago does not; endKind rides along
//   (b) the google readout keeps its three state literals and its minimum key set (earliestDate, complete, state,
//       sealed, catalogSize, inception) — additive only — and the shared route still returns { clientId, backfillable, platforms }
//   (c) the route composes run/progress/stalled from the lib (googleRunStatus) beside googleWalkStatus, never replacing it
//   (d) RUN_STALL_MINUTES = 10 is a constant in continuous-run.ts, derived in the view, never written to the row
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const RUN = 'src/lib/backfill/continuous-run.ts'
const LIB = 'src/lib/backfill/google-walk-status.ts'
const ROUTE = 'src/app/api/backfill/status/route.ts'

// (a)
const out = mkdtempSync(join(tmpdir(), 'status-run-fields-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, RUN), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/continuous-run.js'))
  if (typeof R.runView !== 'function') throw new Error('runView is not exported from continuous-run.ts')
  check(R.RUN_STALL_MINUTES === 10, `(d) RUN_STALL_MINUTES must be 10 — got ${R.RUN_STALL_MINUTES}`)
  const NOW = Date.parse('2026-09-18T16:00:00Z')
  const finishedStale = R.runView({ status: 'failed', steps: 4, requests_opened: 0, days_committed: 0, started_at: '2026-09-17T18:48:18Z', last_step_at: '2026-09-17T18:50:35Z', finished_at: '2026-09-17T18:50:35Z', stop_reason: 'step reported a fatal condition: step returned HTTP 508: null', last_invocation: '1789671034450-8qg7ux' }, NOW)
  check(finishedStale.live === false && finishedStale.stalled === false && finishedStale.endKind === 'failed', `(a) a FINISHED row with a stale last_invocation must read not live, not stalled, endKind failed — got ${JSON.stringify(finishedStale)}`)
  const liveStalled = R.runView({ status: 'running', steps: 3, requests_opened: 90, days_committed: 2000, started_at: '2026-09-18T15:00:00Z', last_step_at: '2026-09-18T15:45:00Z', finished_at: null, stop_reason: null, last_invocation: null }, NOW)
  check(liveStalled.live === true && liveStalled.stalled === true && liveStalled.endKind === null, `(a) a live row with no step for 15 min must read stalled — got ${JSON.stringify(liveStalled)}`)
  const liveFresh = R.runView({ status: 'running', steps: 3, requests_opened: 90, days_committed: 2000, started_at: '2026-09-18T15:00:00Z', last_step_at: '2026-09-18T15:58:00Z', finished_at: null, stop_reason: null, last_invocation: 'x' }, NOW)
  check(liveFresh.live === true && liveFresh.stalled === false, `(a) a live row stepped 2 min ago must not read stalled — got ${JSON.stringify(liveFresh)}`)
  const queued = R.runView({ status: 'running', steps: 0, requests_opened: 0, days_committed: 0, started_at: '2026-09-18T15:59:30Z', last_step_at: null, finished_at: null, stop_reason: null, last_invocation: null }, NOW)
  check(queued.live === true && queued.stalled === false && queued.steps === 0, `(a) a just-started row (no step yet, 30 s old) is live and not stalled — got ${JSON.stringify(queued)}`)
  const neverStepped = R.runView({ status: 'running', steps: 0, requests_opened: 0, days_committed: 0, started_at: '2026-09-18T15:30:00Z', last_step_at: null, finished_at: null, stop_reason: null, last_invocation: null }, NOW)
  check(neverStepped.stalled === true, `(a) a row started 30 min ago that never stepped is stalled (started_at is the fallback clock) — got ${JSON.stringify(neverStepped)}`)
  const stopping = R.runView({ status: 'stopping', steps: 3, requests_opened: 9, days_committed: 20, started_at: '2026-09-18T15:00:00Z', last_step_at: '2026-09-18T15:59:00Z', finished_at: null, stop_reason: null, last_invocation: 'y' }, NOW)
  check(stopping.live === true && stopping.endKind === null, `(a) 'stopping' is live with no end kind — got ${JSON.stringify(stopping)}`)
  check(R.runView(null, NOW) === null, `(a) no row → null view`)
} catch (e) {
  findings.push(`(a) could not drive runView — ${e.message}. A guard that cannot run its subject FAILS.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// (b)(c)
{
  const lib = strip(read(LIB))
  check(/export async function googleWalkStatus\(/.test(lib), `(b) ${LIB} must export googleWalkStatus (moved out of the route so the button route can read the same readout).`)
  for (const s of ["'not-started'", "'complete'", "'partial'"]) check(lib.includes(s), `(b) ${LIB} lacks the state literal ${s}`)
  for (const k of ['earliestDate', 'complete', 'sealed', 'catalogSize', 'inception']) check(new RegExp(`\\b${k}\\b`).test(lib), `(b) ${LIB} no longer returns ${k} — the minimum key set is pinned (legacy reads earliestDate/complete by name).`)
  check(/export async function googleRunStatus\(/.test(lib) && /runView\(/.test(lib) && /daysNoLongerOwedSince\(/.test(lib), `(c) ${LIB} must export googleRunStatus composing runView + the client-scoped ledger progress (daysNoLongerOwedSince).`)
  check(/denominator/.test(lib) && /stalled/.test(lib), `(c) ${LIB}: googleRunStatus must return progress.denominator and stalled.`)
  const route = strip(read(ROUTE))
  check(/googleWalkStatus\(clientId\)/.test(route) && /googleRunStatus\(clientId/.test(route), `(c) ${ROUTE} must compose platforms.google from googleWalkStatus AND googleRunStatus.`)
  check(/NextResponse\.json\(\{ clientId, backfillable, platforms \}\)/.test(route), `(b) ${ROUTE} response shape { clientId, backfillable, platforms } must be unchanged.`)
  check(/from '@\/lib\/backfill\/google-walk-status'/.test(route), `(c) ${ROUTE} must import the readout from the lib module.`)
}

if (findings.length) {
  console.error(`[status-run-fields] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[status-run-fields] PASS — runView lets finished_at win over a stale claim and reads a dead pump as stalled (10 min); the readout keeps its literals and minimum keys; the route composes run/progress/stalled additively.')
