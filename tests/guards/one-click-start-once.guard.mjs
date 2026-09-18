#!/usr/bin/env node
// LORAMER_ONE_CLICK_RUN_V1 — START ONCE, DB-CONDITIONAL; THE SECOND PRESS IS THE METER; PREFLIGHT ON THE CONNECTION'S EMAIL.
//
//   (a) PURE decideStart: live → existing (no write) · stopped → restart · floor-done + complete → meter (no write) ·
//       failed + complete → restart · floor-done + partial → restart · no row → insert
//   (b) STORE startClientRun with injected deps: a live row writes NOTHING and returns the row with its counters intact;
//       an insert that hits the primary key returns the existing row; a restart that changes 0 rows returns the live row
//   (c) PURE tokenEmailFor: the connection's email when set, else the owner's — never the session's; preflightGoogle
//       refuses with a reason when the connection is missing or its email has no token
//   (d) ROUTE: clients/backfill requires ?platform=; the google branch calls preflightGoogle then startClientRun AFTER the
//       two legacy kicks; kickoffWalk and publishWalkStart appear nowhere; the non-google branch keeps both kicks
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

const LIB = 'src/lib/backfill/client-run-start.ts'
const RUN = 'src/lib/backfill/continuous-run.ts'
const ROUTE = 'src/app/api/clients/backfill/route.ts'

let M = null
const tmp = mkdtempSync(join(tmpdir(), 'one-click-start-'))
try {
  writeFileSync(join(tmp, 'continuous-run.ts'), read(RUN))
  const lib = read(LIB)
    .replace(/import \{ supabaseAdmin \} from '@\/lib\/supabase'\n/, 'const supabaseAdmin = null as any\n')
    .replace(/from '@\/lib\/backfill\/continuous-run'/, "from './continuous-run.js'")
    .replace(/import type \{ GoogleWalkState \} from '@\/lib\/backfill\/google-walk-status'\n/, "type GoogleWalkState = 'not-started' | 'complete' | 'partial'\n")
  writeFileSync(join(tmp, 'client-run-start.ts'), lib)
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noResolve', '--skipLibCheck', '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'node', '--outDir', tmp, join(tmp, 'continuous-run.ts'), join(tmp, 'client-run-start.ts')], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  M = await import(pathToFileURL(join(tmp, 'client-run-start.js')).href)
  for (const fn of ['decideStart', 'startClientRun', 'tokenEmailFor', 'preflightGoogle']) if (typeof M[fn] !== 'function') { findings.push(`${LIB} does not export ${fn}()`); M = null }
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const FLOOR = 'the lane reached its floor — nothing is owed above inception'
const STOPPED = 'operator asked the run to stop; the step that was already running finished rather than being killed mid-work'
const row = (o) => ({ status: 'done', steps: 20, requests_opened: 1254, days_committed: 31978, started_at: '2026-09-18T02:17:59Z', last_step_at: '2026-09-18T03:20:45Z', finished_at: '2026-09-18T03:20:45Z', stop_reason: STOPPED, last_invocation: null, ...o })

if (M) {
  // (a)
  check(M.decideStart(row({ status: 'running', finished_at: null, stop_reason: null }), 'partial') === 'existing', `(a) a live row → existing`)
  check(M.decideStart(row({ status: 'stopping', finished_at: null, stop_reason: null }), 'partial') === 'existing', `(a) a stopping row → existing`)
  check(M.decideStart(row({}), 'partial') === 'restart', `(a) operator-stopped → restart`)
  check(M.decideStart(row({ stop_reason: FLOOR }), 'complete') === 'meter', `(a) floor-done + complete → meter (never a full descent)`)
  check(M.decideStart(row({ stop_reason: FLOOR }), 'partial') === 'restart', `(a) floor-done whose readout fell back to partial → restart`)
  check(M.decideStart(row({ status: 'failed', stop_reason: 'step reported a fatal condition: step returned HTTP 508: null' }), 'complete') === 'restart', `(a) failed + complete → restart (one cheap step makes the row truthful)`)
  check(M.decideStart(null, 'not-started') === 'insert', `(a) no row → insert`)

  // (b)
  const NOW = Date.parse('2026-09-18T16:00:00Z')
  const mk = (initial) => {
    const st = { row: initial, inserts: 0, restarts: 0 }
    const deps = {
      read: async () => st.row,
      insert: async (r) => { st.inserts++; if (st.row) return { conflict: true }; st.row = r; return { conflict: false } },
      restart: async (c, v, r) => { st.restarts++; if (!st.row || !st.row.finished_at) return 0; st.row = r; return 1 },
    }
    return { st, deps }
  }
  const live = mk(row({ status: 'running', finished_at: null, stop_reason: null, steps: 7, days_committed: 900 }))
  const r1 = await M.startClientRun({ clientId: 'c', vendor: 'google_ads', readout: 'partial', nowMs: NOW }, live.deps)
  check(r1.action === 'existing' && live.st.inserts === 0 && live.st.restarts === 0 && r1.run.steps === 7 && r1.run.daysNoLongerOwed === 900, `(b) a live row must write nothing and come back with its counters intact — got ${JSON.stringify(r1)} writes ${live.st.inserts}/${live.st.restarts}`)
  const stopped = mk(row({}))
  const r2 = await M.startClientRun({ clientId: 'c', vendor: 'google_ads', readout: 'partial', nowMs: NOW }, stopped.deps)
  check(r2.action === 'restart' && stopped.st.restarts === 1 && r2.run.steps === 0 && r2.run.live === true, `(b) a stopped row must restart (conditional update) — got ${JSON.stringify(r2)}`)
  const floor = mk(row({ stop_reason: FLOOR }))
  const r3 = await M.startClientRun({ clientId: 'c', vendor: 'google_ads', readout: 'complete', nowMs: NOW }, floor.deps)
  check(r3.action === 'meter' && floor.st.inserts === 0 && floor.st.restarts === 0 && r3.run.endKind === 'floor', `(b) floor-done + complete must write nothing — got ${JSON.stringify(r3)}`)
  const wiped = mk(null)
  const r4 = await M.startClientRun({ clientId: 'c', vendor: 'google_ads', readout: 'not-started', nowMs: NOW }, wiped.deps)
  check(r4.action === 'insert' && wiped.st.inserts === 1 && r4.run.status === 'running' && r4.run.steps === 0, `(b) no row must insert a fresh running row — got ${JSON.stringify(r4)}`)
  // the race: a read saw no row, but the insert hits the key
  const raced = { row: null, reads: 0 }
  const raceDeps = { read: async () => (raced.reads++ === 0 ? null : row({ status: 'running', finished_at: null, stop_reason: null, steps: 1 })), insert: async () => ({ conflict: true }), restart: async () => 0 }
  const r5 = await M.startClientRun({ clientId: 'c', vendor: 'google_ads', readout: 'not-started', nowMs: NOW }, raceDeps)
  check(r5.action === 'existing' && r5.run && r5.run.steps === 1, `(b) an insert that hits the primary key must return the other press's row — got ${JSON.stringify(r5)}`)
  const raced2 = mk(row({}))
  raced2.deps.restart = async () => 0 // someone else restarted first
  raced2.deps.read = async () => row({ status: 'running', finished_at: null, stop_reason: null, steps: 2 })
  const r6 = await M.startClientRun({ clientId: 'c', vendor: 'google_ads', readout: 'partial', nowMs: NOW }, raced2.deps)
  check(r6.action === 'existing' && r6.run.steps === 2, `(b) a restart that changed 0 rows must return the live row — got ${JSON.stringify(r6)}`)

  // (c)
  check(M.tokenEmailFor({ user_email: 'connector@example.com' }, 'owner@example.com') === 'connector@example.com', `(c) the connection's email wins over the owner's`)
  check(M.tokenEmailFor({ user_email: null }, 'owner@example.com') === 'owner@example.com', `(c) a connection with no email falls back to the owner`)
  const pf1 = await M.preflightGoogle({ clientId: 'c', ownerEmail: 'owner@example.com' }, { connection: async () => ({ account_id: '123', user_email: 'connector@example.com' }), hasToken: async (e) => e === 'connector@example.com' })
  check(pf1.ok === true && pf1.tokenEmail === 'connector@example.com' && pf1.customerId === '123', `(c) preflight must key the token on the connection's email — got ${JSON.stringify(pf1)}`)
  const pf2 = await M.preflightGoogle({ clientId: 'c', ownerEmail: 'owner@example.com' }, { connection: async () => ({ account_id: '123', user_email: 'connector@example.com' }), hasToken: async (e) => e === 'owner@example.com' })
  check(pf2.ok === false && /connector@example\.com/.test(pf2.reason), `(c) a token on the OWNER's email does not satisfy a connection made by another login — got ${JSON.stringify(pf2)}`)
  const pf3 = await M.preflightGoogle({ clientId: 'c', ownerEmail: 'owner@example.com' }, { connection: async () => null, hasToken: async () => true })
  check(pf3.ok === false && /no Google Ads connection/.test(pf3.reason), `(c) no connection → refused with a reason`)
}

// (d)
{
  const r = strip(read(ROUTE))
  check(/searchParams\.get\('platform'\)/.test(r), `(d) ${ROUTE} must read ?platform=`)
  check(/preflightGoogle\(/.test(r) && /startClientRun\(/.test(r), `(d) ${ROUTE}: the google branch must preflight then startClientRun`)
  const kickI = r.indexOf('kickoffBackfill('), gap = r.indexOf('kickoffGapBackfill('), start = r.indexOf('startClientRun(')
  check(kickI !== -1 && gap !== -1, `(d) ${ROUTE} must keep kickoffBackfill( and kickoffGapBackfill( (ruling (n): the legacy family keeps filling)`)
  check(start > kickI && start > gap, `(d) ${ROUTE}: the run starts AFTER the two kicks`)
  check(!/kickoffWalk|publishWalkStart|universe-start-publish/.test(r), `(d) ${ROUTE} must not call kickoffWalk or publishWalkStart — the run's own steps are the fires`)
  check(/googleWalkStatus\(/.test(r), `(d) ${ROUTE}: the restart rule needs the readout — googleWalkStatus must be read before the start`)
}

if (findings.length) {
  console.error(`[one-click-start-once] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[one-click-start-once] PASS — the press starts once (a live row comes back unchanged, floor-done + complete is the meter, ended runs restart by a conditional update, a key hit returns the other press\'s row); the preflight keys the token on the connection\'s email; the route preflights then starts after the two legacy kicks, with no kickoffWalk.')
