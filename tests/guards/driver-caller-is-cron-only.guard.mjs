#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 (2/2) — THE DRIVER HAS EXACTLY ONE CALLER, AND IT IS THE CRON ROUTE BEHIND THE BEARER.
//
// runForwardDriver writes metrics_daily + forward_observation_log for every eligible google connection. A second
// importer (a UI route, a script, a backfill button) would be a second writer of the 319 catalogue surfaces with no
// lease coordination — ruling (n)'s "no row written twice" would fail across callers instead of across spellings.
// The cron route refuses without `Bearer $CRON_SECRET` (Vercel's cron contract, universe-resume's template) so a
// public hit cannot start a fire.
//
// LEGS
//  (a) src/app/api/cron/forward-driver/route.ts exists, exports maxDuration = 800 (= DRIVER_MAX_DURATION_S, the lease's
//      ceiling), and its GET checks CRON_SECRET BEFORE runForwardDriver( is reached (index order in the stripped source)
//  (b) no file under src/ other than that route imports @/lib/backfill/forward-driver (the pure slices module may be
//      imported by anyone — it writes nothing)
//  (c) vercel.json holds EXACTLY the three decided entries for /api/cron/forward-driver: "*/10 11-16 * * *" (the window,
//      after google sync 8-58/10 8-10 and catchup 9-59/10 8-11 end), "30 17 * * *" and "30 21 * * *" (ruling q's make-ups,
//      shifted to sit after the window) — and NO other file's entries changed shape (count 17 → 20)
//  (d) registered in scripts/run-guards.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const ROUTE = 'src/app/api/cron/forward-driver/route.ts'

const route = strip(read(ROUTE))
if (!route) findings.push(`(a) ${ROUTE} does not exist — the driver has no caller (commit 2 not built)`)
else {
  const maxDur = route.match(/export const maxDuration\s*=\s*(\d+)/)
  if (!maxDur) findings.push(`(a) ${ROUTE} declares no numeric export const maxDuration`)
  else if (maxDur[1] !== '800') findings.push(`(a) ${ROUTE} maxDuration = ${maxDur[1]}; the driver's lease is derived from 800 (DRIVER_MAX_DURATION_S) — the two must agree`)
  const authIdx = route.indexOf('CRON_SECRET')
  const callIdx = route.indexOf('runForwardDriver(')
  if (authIdx === -1) findings.push(`(a) ${ROUTE} never reads CRON_SECRET — a public hit could start a fire`)
  if (callIdx === -1) findings.push(`(a) ${ROUTE} never calls runForwardDriver( — it is not the driver's caller`)
  if (authIdx !== -1 && callIdx !== -1 && authIdx > callIdx) findings.push(`(a) ${ROUTE} calls runForwardDriver( before checking CRON_SECRET`)
  if (!/status:\s*401/.test(route)) findings.push(`(a) ${ROUTE} has no 401 path — the bearer check must refuse, not fall through`)
}

// (b) importers
const files = []
const walk = (d) => { for (const e of readdirSync(resolve(ROOT, d))) { const p = join(d, e); const st = statSync(resolve(ROOT, p)); if (st.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e)) files.push(p) } }
walk('src')
const importers = files.filter((f) => /from\s+['"]@\/lib\/backfill\/forward-driver['"]/.test(strip(read(f))))
const foreign = importers.filter((f) => f !== ROUTE)
if (foreign.length) findings.push(`(b) ${foreign.join(', ')} import(s) @/lib/backfill/forward-driver — the driver has exactly one caller (the cron route); a second importer is a second writer with no lease`)

// (c) vercel.json
try {
  const v = JSON.parse(read('vercel.json'))
  const crons = v.crons || []
  const mine = crons.filter((c) => String(c.path || '').split('?')[0] === '/api/cron/forward-driver')
  const want = ['*/10 11-16 * * *', '30 17 * * *', '30 21 * * *']
  const got = mine.map((c) => c.schedule)
  if (mine.length !== 3 || want.some((s) => !got.includes(s))) findings.push(`(c) vercel.json holds ${mine.length} /api/cron/forward-driver entr(ies) with schedules ${JSON.stringify(got)}; decided: exactly ${JSON.stringify(want)}`)
  if (mine.some((c) => String(c.path).includes('?'))) findings.push('(c) a forward-driver cron entry carries a query string — the caller takes no client filter on the schedule (DRIVER_EXCLUDED_CLIENTS is the only filter)')
  if (crons.length !== 20) findings.push(`(c) vercel.json holds ${crons.length} cron entries; 17 before this commit + 3 driver entries = 20 — something else moved`)
} catch (e) { findings.push(`(c) vercel.json unreadable: ${e.message}`) }

const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/driver-caller-is-cron-only.guard.mjs')) findings.push('(d) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ driver-caller-is-cron-only FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log('[driver-caller-is-cron-only] PASS — the driver has one caller (src/app/api/cron/forward-driver/route.ts, bearer-checked before the call, maxDuration 800), no other importer under src/, and vercel.json carries exactly the three decided entries (*/10 11-16 · 30 17 · 30 21 UTC).')
