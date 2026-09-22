#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_JOB_V1 — A LIVE DELETION REFUSES A SECOND RUN, AND COUNTS COME ONLY FROM THE DATABASE.
//
// ⛔ THE CLASS, from the first Tri-Copy press (round 6, 2026-09-21): a phone dropped an 82-second request and re-sent
// it; two runs overlapped; each merged `detail` in memory and wrote it back whole; the log under-recorded 307,153
// deleted rows. Two properties end the class and this guard pins both:
//   (a) THE ROW IS THE LOCK — the press route calls google_delete_open, then either returns the live row or hands the
//       job to the runner; the runner's FIRST database call is google_delete_claim, and no delete function is called
//       unless the claim returned true. A second press, a re-send or a second tab can only read progress.
//   (b) COUNTS ARE WRITTEN BY THE DATABASE — every delete function is called WITH p_code (the merge happens in the
//       deleting transaction, migration 100); neither the route nor the runner adds counts, assigns detail.counts,
//       or updates `detail` wholesale; the only in-app writes are the cache null (an UPDATE on client_context) and
//       google_tokens on the revoke branch.
//   (c) THE JOB SURVIVES THE PAGE — the press returns at once (202) after waitUntil(runDeletionJob); the pump route
//       exists with maxDuration 800 and cron auth; vercel.json schedules it every minute; CLAIM_RESERVE_S is derived
//       from the pump's maxDuration (a raise without the other fails here, the fire-lease invariant applied).
// SEEN RED FIRST (2026-09-21) against the round-5 route: addCounts merges, no claim, no p_code, no pump.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const ROUTE = 'src/app/api/clients/google/delete-data/route.ts'
const JOB = 'src/lib/google-delete/job.ts'
const PUMP = 'src/app/api/cron/google-delete-pump/route.ts'
const findings = []
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const route = read(ROUTE), job = read(JOB), pump = read(PUMP), vercel = read('vercel.json')
if (route === null) findings.push(`UNREADABLE ${ROUTE}`)
if (job === null) findings.push(`(c) ${JOB} does not exist — the deletion has no runner separate from the request`)
if (pump === null) findings.push(`(c) ${PUMP} does not exist — a run that ends mid-job has nothing to resume it`)
const strip = (s) => (s ?? '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
const r = strip(route), j = strip(job), p = strip(pump)
// (a) the lock
if (route !== null && !/google_delete_open/.test(r)) findings.push(`(a) ${ROUTE} does not call google_delete_open — the row is the lock and the press must open it first`)
if (job !== null) {
  // the property is scoped to the runner's body: helpers above it may name delete functions, only the runner calls them
  const bodyStart = j.indexOf('export async function runDeletionJob')
  const body = bodyStart >= 0 ? j.slice(bodyStart) : ''
  if (bodyStart < 0) findings.push(`(a) ${JOB} exports no runDeletionJob`)
  const firstRpc = [...body.matchAll(/rpc[<(][^'\n]*'([a-z_]+)'/g)].map((m) => m[1])[0]
  if (firstRpc !== 'google_delete_claim') findings.push(`(a) ${JOB}: the runner's first database call must be google_delete_claim (found ${firstRpc ?? 'none'})`)
  const claimIdx = body.indexOf("'google_delete_claim'"), firstDelete = body.search(/'google_delete_client_(connection|ledgers|metrics|capture|walk_state)'|deleteRange\(/)
  if (claimIdx < 0 || (firstDelete >= 0 && firstDelete < claimIdx)) findings.push(`(a) ${JOB}: a delete is reached before the claim`)
  if (!/if \(!claimed\)/.test(body)) findings.push(`(a) ${JOB}: a failed claim must return before any step (no \`if (!claimed)\` guard)`)
}
if (route !== null && /'google_delete_client_(connection|ledgers|metrics|capture|walk_state)'/.test(r)) findings.push(`(a) ${ROUTE} calls a delete function directly — only the runner may, after its claim`)
// (b) counts only from the database
for (const [name, src] of [[ROUTE, r], [JOB, j]]) {
  if (src == null) continue
  if (/addCounts\(/.test(src)) findings.push(`(b) ${name} merges counts in memory (addCounts)`)
  if (/detail\.counts\s*\[|detail\.counts\s*=|counts\[[^\]]+\]\s*=\s*\(/.test(src)) findings.push(`(b) ${name} assigns a count in memory`)
  if (/\.update\(\{\s*detail\b/.test(src)) findings.push(`(b) ${name} writes detail wholesale (.update({ detail`)
  for (const m of src.matchAll(/'google_delete_client_(connection|ledgers|metrics|capture|walk_state)'\s*,\s*\{([^}]*)\}/g)) {
    if (!/p_code/.test(m[2])) findings.push(`(b) ${name}: google_delete_client_${m[1]} is called without p_code — its count would not reach the row`)
  }
}
// (c) the job survives the page
if (route !== null && !/waitUntil\(/.test(r)) findings.push(`(c) ${ROUTE} does not hand the job to waitUntil — the press must return at once`)
if (route !== null && !/runDeletionJob/.test(r)) findings.push(`(c) ${ROUTE} does not call runDeletionJob`)
if (pump !== null) {
  if (!/export const maxDuration = 800/.test(p)) findings.push(`(c) ${PUMP} must declare maxDuration = 800`)
  if (!/CRON_SECRET/.test(p)) findings.push(`(c) ${PUMP} must authenticate with CRON_SECRET like every cron route`)
  if (!/runDeletionJob/.test(p)) findings.push(`(c) ${PUMP} does not call runDeletionJob`)
}
if (vercel !== null) {
  const crons = JSON.parse(vercel).crons ?? []
  const c = crons.find((x) => x.path === '/api/cron/google-delete-pump')
  if (!c) findings.push('(c) vercel.json has no cron for /api/cron/google-delete-pump')
  else if (c.schedule !== '* * * * *') findings.push(`(c) the pump cron must run every minute (found "${c.schedule}")`)
}
if (job !== null) {
  const pumpMax = j.match(/PUMP_MAX_DURATION_S\s*=\s*(\d+)/)?.[1], reserve = j.match(/CLAIM_RESERVE_S\s*=\s*PUMP_MAX_DURATION_S\s*\+\s*(\d+)/)?.[1]
  if (pumpMax !== '800' || reserve !== '20') findings.push(`(c) CLAIM_RESERVE_S must derive from PUMP_MAX_DURATION_S = 800 (+20), the pump's STEP_RESERVE derivation`)
}
if (findings.length) { console.error(`\n❌ LORAMER_GOOGLE_DELETE_JOB_V1 FAILED — ${findings.length} finding(s)\n`); findings.forEach((f) => console.error('  • ' + f)); process.exit(1) }
console.log('google-delete-job.guard: PASS — the press opens the row and hands off; the runner claims before any delete; every delete carries p_code and no count is merged in memory; the pump exists (maxDuration 800, cron auth, every minute) and the claim reserve derives from it.')
