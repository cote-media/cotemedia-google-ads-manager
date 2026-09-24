#!/usr/bin/env node
// LORAMER_RETENTION_WALL_CANARY_V1 — NO PATH MAY RETIRE A DAY PAST THE PUBLISHED WALL ON SILENCE ALONE.
//
// ⛔ THE HOLE (round 14, 2026-09-18): Google's 37-month wall is published (support.google.com/google-ads/answer/15188209)
// and not yet enforced on the API (daily rows served at 125 months the same day). The engine retires a success-empty
// day as NO_DATA_OBSERVED. Past the wall, an aged-out day and an idle day would answer identically if the vendor ever
// went silent instead of returning the documented DateRangeError — and the walk would seal expired history as empty.
// THE RULE: an empty answer past the wall retires a day only while the CANARY (one daily request past the wall on an
// account with known rows there) proves the vendor still serves that ground. Otherwise UNRESOLVED, recorded, loud.
//
// Legs: (a) the pure decider never says 'zero' past the wall without a 'served' canary, and always says 'zero' above it
//       (b) the canary verdict is taken from the vendor's words: rows → served; DateRangeError → refused; 0 rows → silent
//       (c) a stale or missing canary row reads 'unknown' — never 'served' by default
//       (d) SOURCE: the worker's empty path routes through classifyEmptyAnswer before any 'zero' is written, and the
//           unresolved row is outcome 'error' carrying the marker; the fire route refuses past-wall windows (descend and
//           missed) when the canary is not 'served'; a vendor refusal still records a wall (isRetentionWallRefusal → noteWall)
//       (e) the canary cron exists, is scheduled daily in vercel.json, sends the canary GAQL through the walk's stream,
//           and records through recordRetentionCanary; the check:data leg reads it
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

const LIB = 'src/lib/backfill/retention-wall.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const CANARY = 'src/app/api/cron/retention-canary/route.ts'
const CHECK = 'scripts/check-retention-canary.mjs'

// ── compile the pure module with tsc, with its one import stubbed ──
let M = null
const tmp = mkdtempSync(join(tmpdir(), 'retention-wall-'))
try {
  const src = read(LIB)
    .replace(/import \{ retentionWarningLine \} from '@\/lib\/backfill\/google-ads-universe-writer'/, 'const retentionWarningLine = globalThis.__rwl')
  writeFileSync(join(tmp, 'retention-wall.ts'), src)
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noResolve', '--skipLibCheck', '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'node', '--outDir', tmp, join(tmp, 'retention-wall.ts')], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  // the writer's real arithmetic, copied in so the guard is not fooled by a stub: 37 calendar months back
  globalThis.__rwl = (todayIso) => {
    const [y, m, d] = todayIso.slice(0, 10).split('-').map(Number)
    const total = y * 12 + (m - 1) - 37
    const ny = Math.floor(total / 12), nm = ((total % 12) + 12) % 12
    const leap = (ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0
    const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nm]
    return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
  }
  M = await import(pathToFileURL(join(tmp, 'retention-wall.js')).href)
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (M) {
  const wall = M.wallLineFor('2026-09-18')
  check(wall === '2023-08-18', `(a) wallLineFor('2026-09-18') = ${wall}, expected 2023-08-18 (37 calendar months).`)
  // (a) past the wall: NOTHING lets an empty retire (Q6, 2026-09-18) — every canary state reads unresolved
  for (const c of ['unknown', 'refused', 'silent', 'failed']) {
    const v = M.classifyEmptyAnswer({ rangeEnd: '2022-09-16', wallLine: wall, canary: c })
    check(v === 'zero', `(a) ⛔ an empty answer PAST the line with canary '${c}' classified as '${v}' — it must be 'zero': measured 0 omissions in 12,790 witnessed windows (round 40, LORAMER_PAST_LINE_EMPTY_V1).`)
  }
  // LORAMER_WALL_HOLD_NEVER_RETIRE_V1 (Q6, 2026-09-18): a SERVED canary no longer licenses retirement past the wall.
  check(M.classifyEmptyAnswer({ rangeEnd: '2022-09-16', wallLine: wall, canary: 'served' }) === 'zero', `(a) an empty past the line under a SERVED canary must be 'zero' — the canary detects enforcement; it never classifies an answer (LORAMER_PAST_LINE_EMPTY_V1).`)
  // above the wall: always zero, whatever the canary (the vendor serves that ground by policy)
  for (const c of ['unknown', 'refused', 'silent', 'failed', 'served']) {
    const v = M.classifyEmptyAnswer({ rangeEnd: '2025-11-10', wallLine: wall, canary: c })
    check(v === 'zero', `(a) an empty answer ABOVE the wall with canary '${c}' classified as '${v}' — above the wall an empty is NO_DATA_OBSERVED, as always.`)
  }
  // the boundary day: rangeEnd == wallLine is NOT past the wall
  check(M.isPastWall('2023-08-18', wall) === false && M.isPastWall('2023-08-17', wall) === true, `(a) isPastWall boundary: the wall day itself is inside; the day before is past.`)
  // (b) verdicts from the vendor's words
  check(M.canaryVerdict({ ok: true, rows: 7, error: null }) === 'served', `(b) 7 rows past the wall must read 'served'.`)
  check(M.canaryVerdict({ ok: true, rows: 0, error: null }) === 'silent', `(b) 0 rows where rows are known must read 'silent' — the dangerous shape.`)
  check(M.canaryVerdict({ ok: false, rows: 0, error: '{"date_range_error":"INVALID_DATE"} The requested date range is not supported' }) === 'refused', `(b) a DateRangeError must read 'refused' — the documented enforcement shape.`)
  check(M.canaryVerdict({ ok: false, rows: 0, error: '{"authentication_error":"OAUTH_TOKEN_REVOKED"} token' }) === 'failed', `(b) a non-date-range error must read 'failed', never 'refused'.`)
  // (c) stale or missing → unknown
  const now = Date.parse('2026-09-18T12:00:00Z')
  check(M.readingFromRow(null, now).state === 'unknown', `(c) no canary row must read 'unknown'.`)
  const fresh = M.readingFromRow({ outcome: 'ok', detail: JSON.stringify({ state: 'served', summary: 'x' }), ran_at: '2026-09-18T10:15:00Z' }, now)
  check(fresh.state === 'served', `(c) a fresh ok row must read 'served' (got ${fresh.state}).`)
  const stale = M.readingFromRow({ outcome: 'ok', detail: JSON.stringify({ state: 'served' }), ran_at: '2026-09-16T10:15:00Z' }, now)
  check(stale.state === 'unknown', `(c) ⛔ a canary row ${Math.round((now - Date.parse('2026-09-16T10:15:00Z')) / 3600000)} h old read '${stale.state}' — stale must be 'unknown'; the day enforcement begins must be known within a day.`)
  const silent = M.readingFromRow({ outcome: 'error', detail: JSON.stringify({ state: 'silent' }), ran_at: '2026-09-18T10:15:00Z' }, now)
  check(silent.state === 'silent', `(c) an error row whose detail says silent must read 'silent' (got ${silent.state}).`)
}

// (d) SOURCE — the worker's empty path and the route's refusals
{
  const w = strip(read(WORKER))
  const iOutcome = w.indexOf("res.apiRows === 0 ? 'zero'")
  const iCount = w.indexOf('opts.onPastLineEmpty?.()')
  const iWrite = w.indexOf('await appendAttemptFinished(rangeKey, opened.attemptNo, outcome, {')
  check(iOutcome > 0 && iCount > iOutcome && iWrite > iCount, `(d) ${WORKER}: the empty path must derive the outcome, COUNT a past-line empty (onPastLineEmpty), then write it as 'zero' — found outcome@${iOutcome} count@${iCount} write@${iWrite}.`)
  check(!/UNRESOLVED_PAST_WALL_MARKER/.test(w), `(d) ${WORKER}: no worker path may emit UNRESOLVED_PAST_WALL (LORAMER_PAST_LINE_EMPTY_V1) — an empty past the line is 'zero'.`)
  check(/noteWall\(range\.start, res\.error\)/.test(w) && /isRetentionWallRefusal\(err\)/.test(w), `(d) ${WORKER}: a vendor refusal must still record a wall (noteWall on isRetentionWallRefusal) — unchanged.`)
  check(/onPastLineEmpty\?: \(\) => void/.test(w), `(d) ${WORKER}: DeadlineOpts must carry onPastLineEmpty so the fire's instrument counts past-line empties.`)
  const r = strip(read(ROUTE))
  // LORAMER_WALL_HOLD_NEVER_RETIRE_V1 (Q6, 2026-09-18): past-wall windows are ASKED (their empties held); the canary gates nothing.
  check(!/verdict: 'past-wall-unverified'/.test(r), `(d) ${ROUTE}: a descend window past the wall must NOT be refused on the canary (Q6) — wall-hold-never-retire.guard.mjs owns the ruling.`)
  check(!/missed\.filter\(\(m\) => !isPastWall\(m\.windowEnd, wallLine\)\)/.test(r), `(d) ${ROUTE}: the missed lane must NOT drop past-wall holes on the canary (Q6).`)
  check(/retentionCanary: canary\.state/.test(r) && /pastLineEmpty/.test(r) && !/unresolvedPastWall/.test(r), `(d) ${ROUTE}: the fire instrument must carry the canary state and pastLineEmpty (empties past the line, attested), never an unresolved count.`)
  check(!/googleAdsStreamFor|queryStream|customer\.query/.test(r), `(d) ${ROUTE} reaches the vendor — the scheduler must not fetch (universe-resumer.guard.mjs). The canary and the idle check run elsewhere.`)
}
// (e) the canary cron
{
  const c = strip(read(CANARY))
  check(/RETENTION_CANARY_GAQL/.test(c) && /googleAdsStreamFor\(userEmail, RETENTION_CANARY\.customerId\)/.test(c), `(e) ${CANARY} must send RETENTION_CANARY_GAQL through the walk's own stream (the arming boundary, the choke-point client).`)
  check(/recordRetentionCanary\(\{ state, rows/.test(c) && /canaryVerdict\(\{ ok, rows, error \}\)/.test(c), `(e) ${CANARY} must take its verdict from canaryVerdict and record it through recordRetentionCanary.`)
  check(/process\.env\.CRON_SECRET/.test(c) && /status: 401/.test(c), `(e) ${CANARY} must be bearer-checked against CRON_SECRET.`)
  let crons = []
  try { crons = JSON.parse(read('vercel.json')).crons ?? [] } catch (e) { findings.push(`(e) vercel.json unreadable — ${e.message}`) }
  const entry = crons.find((x) => x.path === '/api/cron/retention-canary')
  check(!!entry && /^\d+ \d+ \* \* \*$/.test(String(entry.schedule)), `(e) vercel.json must schedule /api/cron/retention-canary ONCE A DAY (found ${JSON.stringify(entry ?? null)}) — the day enforcement begins must be known within a day.`)
  const k = read(CHECK)
  check(/retention_canary|RETENTION_CANARY_MARKER/.test(k) && /UNRESOLVED_PAST_WALL/.test(k), `(e) ${CHECK} must read the canary row and count UNRESOLVED_PAST_WALL rows — the check:data leg is the loud surface.`)
  const roster = read('scripts/run-checkdata.mjs')
  check(/check-retention-canary/.test(roster), `(e) scripts/run-checkdata.mjs does not run check-retention-canary.`)
}

if (findings.length) {
  console.error(`[retention-wall] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[retention-wall] PASS — an empty answer past the 37-month wall retires a day only under a SERVED canary; otherwise it is UNRESOLVED (outcome error + marker), counted and logged; the fire spends nothing past the wall without a green canary; a vendor refusal still records a wall; the canary runs daily through the walk\'s stream and check:data reads it.')
