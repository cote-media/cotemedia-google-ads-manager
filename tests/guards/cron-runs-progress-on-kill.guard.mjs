#!/usr/bin/env node
// LORAMER_FORWARD_LANE_HYGIENE_V1 — A KILLED FORWARD FIRE LEAVES A RECORD, AND NO INSTRUMENT MAY JUDGE THE
// DAY BY THE NEWEST OR THE COMPLETED FIRE ALONE.
//
// ⛔ THE DEFECT, MEASURED 2026-09-05: 26 of 541 google forward fires in 30 days carry finished_at NULL —
// killed at maxDuration 800 s (FORWARD_BUDGET_MS is tested only BETWEEN clients, so a client admitted at ≤680 s
// that needs 650 s runs past the ceiling). Every one of them wrote rows and stamped cursors, and every one of
// them reads as attempted 0 / rows 0 / errors 0 in cron_runs, because the ONLY tally write was a single
// finalizeSection after the whole loop and the file had no `finally`. Three of today's fires wrote 11 of the 18
// account rows and left no record of having done so. Two instruments then judged the day by the wrong fire:
// check-google-forward-account-day.mjs took "the newest COMPLETED fire" (a 10:58Z no-op that ran 110 minutes
// after the last row was written) and reported 18/18 rows as not-written-by-the-fire; /api/cron/status took
// "the LATEST fire" and reported healthy over three kills.
//
// WHAT THIS PINS (structure, because the platform kill itself cannot be observed by a build):
//  (a) src/lib/cron-runs.ts exports progressCronRun and its UPDATE never sets finished_at — a progress row is
//      NOT a completion claim
//  (b) every platform section in cron/sync/route.ts calls progressSection('<platform>', __snap) inside its
//      client loop, and progressSection calls progressCronRun — so a kill mid-loop leaves the work done so far
//  (c) every finalizeSection call sits inside a `finally` — a THROW stamps finished_at; a kill still cannot, and
//      the progress row from (b) is what survives it
//  (d) scripts/check-google-forward-account-day.mjs no longer selects the fire by `finished_at=not.is.null`
//      with `limit=1` — it judges EVERY forward fire for the day, finished or not
//  (e) src/app/api/cron/status/route.ts no longer reads one row with `.limit(1).maybeSingle()`; it carries a
//      'killed' verdict, and its per-mode maxDuration map equals the routes' own exported maxDuration
//  (f) this guard is registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const PLATFORMS = ['shopify', 'meta', 'google', 'woocommerce', 'ga']
const SYNC = 'src/app/api/cron/sync/route.ts'
const CRON_RUNS = 'src/lib/cron-runs.ts'
const CHECK = 'scripts/check-google-forward-account-day.mjs'
const STATUS = 'src/app/api/cron/status/route.ts'

// (a) progressCronRun exists and never completes a run
const cronRuns = strip(read(CRON_RUNS))
const pStart = cronRuns.indexOf('export async function progressCronRun')
if (pStart === -1) findings.push(`(a) ${CRON_RUNS} exports no progressCronRun — a killed fire has no way to leave its tallies behind`)
else {
  const rest = cronRuns.slice(pStart + 1)
  const next = rest.search(/\nexport (async )?function /)
  const body = rest.slice(0, next === -1 ? rest.length : next)
  if (/finished_at/.test(body)) findings.push(`(a) progressCronRun in ${CRON_RUNS} touches finished_at — a progress row must never read as a completed fire`)
  if (!/\.from\('cron_runs'\)/.test(body) || !/\.update\(/.test(body)) findings.push(`(a) progressCronRun in ${CRON_RUNS} does not UPDATE cron_runs`)
}

// (b) + (c) the sync route's five sections
const sync = strip(read(SYNC))
if (!sync) findings.push(`cannot read ${SYNC}`)
else {
  if (!/async function progressSection\(/.test(sync)) findings.push(`(b) ${SYNC} defines no progressSection helper`)
  else {
    const i = sync.indexOf('async function progressSection(')
    const helper = sync.slice(i, i + 1200)
    if (!/progressCronRun\(cronRunIds\[p\]/.test(helper)) findings.push(`(b) progressSection in ${SYNC} does not call progressCronRun(cronRunIds[p], …)`)
  }
  for (const p of PLATFORMS) {
    const calls = (sync.match(new RegExp(`await progressSection\\('${p}', __snap\\)`, 'g')) || []).length
    if (calls === 0) findings.push(`(b) the ${p} section in ${SYNC} never calls progressSection('${p}', __snap) after a client — a fire killed mid-loop leaves attempted 0 / rows 0 for ${p}`)
    const fin = new RegExp(`\\}\\s*finally\\s*\\{\\s*await finalizeSection\\('${p}', __snap\\)`)
    if (!fin.test(sync)) findings.push(`(c) finalizeSection('${p}', __snap) in ${SYNC} is not inside a finally — a throw anywhere in the ${p} section leaves finished_at NULL`)
  }
}

// (d) the account-day check judges every fire for the day
const check = read(CHECK)
if (!check) findings.push(`cannot read ${CHECK}`)
else {
  if (/finished_at=not\.is\.null/.test(check)) findings.push(`(d) ${CHECK} still filters cron_runs by finished_at=not.is.null — a killed fire that wrote the day is invisible to it, and the "newest completed" fire is a no-op that ran after the work`)
  // The JUDGING read is the one that selects started_at (the fire's clock); the day-discovery read selects only
  // target_date and may take one row.
  const firesLine = (check.split('\n').find((l) => /cron_runs\?/.test(l) && /select=[^&]*started_at/.test(l))) || ''
  if (!firesLine) findings.push(`(d) ${CHECK} has no cron_runs read that selects started_at — leg 4 has no fire clock to judge observedAt against`)
  if (/limit=1\b/.test(firesLine)) findings.push(`(d) ${CHECK} selects ONE forward fire (limit=1) — seven fires wrote 2026-09-04; the day must be judged against every fire that targeted it`)
  if (!/target_date=eq\./.test(check)) findings.push(`(d) ${CHECK} does not select the fires by target_date — it cannot name which fires wrote the day it judges`)
}

// (e) the status route sees killed fires
const status = strip(read(STATUS))
if (!status) findings.push(`cannot read ${STATUS}`)
else {
  if (/\.limit\(1\)/.test(status) && /\.maybeSingle\(\)/.test(status)) findings.push(`(e) ${STATUS} reads one row per (mode, platform) with .limit(1).maybeSingle() — the latest fire is a no-op after the kills, so a killed fire can never be seen`)
  if (!/'killed'/.test(status)) findings.push(`(e) ${STATUS} carries no 'killed' verdict — an unfinished fire older than its route's maxDuration is not "running" and not "crashed-or-timed-out"; it is a kill that wrote work`)
  const map = status.match(/ROUTE_MAX_DURATION_S[^}]*\{([^}]*)\}/)
  if (!map) findings.push(`(e) ${STATUS} declares no ROUTE_MAX_DURATION_S map — the killed verdict has no ceiling to measure against`)
  else {
    for (const [mode, file] of [['forward', SYNC], ['catchup', 'src/app/api/cron/catchup/route.ts']]) {
      const routeMax = strip(read(file)).match(/export const maxDuration\s*=\s*(\d+)/)
      const mapped = map[1].match(new RegExp(`${mode}:\\s*(\\d+)`))
      if (!routeMax || !mapped) findings.push(`(e) cannot compare ${mode} maxDuration between ${STATUS} and ${file}`)
      else if (routeMax[1] !== mapped[1]) findings.push(`(e) ${STATUS} says ${mode} maxDuration is ${mapped[1]} s but ${file} exports ${routeMax[1]} s — the killed verdict would measure against the wrong ceiling`)
    }
  }
}

// (f) registered
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/cron-runs-progress-on-kill.guard.mjs')) findings.push('(f) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length === 0) {
  console.log('cron-runs-progress-on-kill: PASSED — progressCronRun never completes a run · all five sections stamp progress per client · every finalizeSection sits in a finally · the account-day check judges every fire that targeted the day · the status route reads the trailing window with a killed verdict against each route\'s own maxDuration. (Structure only: a maxDuration kill itself cannot be observed by a build; the progress row is what survives it.)')
  process.exit(0)
}
console.error(`cron-runs-progress-on-kill: FAILED — ${findings.length} finding(s)`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
