#!/usr/bin/env node
// LORAMER_DESCEND_WINDOW_360_V1 — THE DESCEND AND MISSED WINDOWS ARE 360 DAYS (≤ MAX_REQUESTS_PER_RUN), AND NO PLANNED WINDOW STRADDLES THE WALL.
// (Was LORAMER_DESCEND_WINDOW_90_V1, 2026-09-18. Widened 2026-09-22 on the measured 90-day p99: 32.3 s, n=10,801.)
//
// Rounds 2–5 (2026-09-18): no Google date-range cap exists; the 14-day (Airbyte) and 1-day (Singer) prior-art slices
// are `search`-pagination artefacts; 90 halves Foam OH's requests while the 25 heavy surfaces stay row-budget-capped
// by sizeFromPolicy. A window that would straddle the 37-month retention line is SPLIT at the line in Airbyte's clip
// form (utils.py:284-291 `start = max(start, today − days_of_data_storage)`), so past-wall days are asked in their own
// window and an empty answer there can be told apart from an empty above the line.
//   (a) google-ads.adapter.ts sizing.maxDays === 360; universe-resumer.ts MISSED_WINDOW_DAYS === 360; and maxDays ≤ MAX_REQUESTS_PER_RUN
//       (the horizon guard's exact-bound invariant, restated here so the two numbers can never be widened apart)
//   (b) PURE deriveWindow: a window straddling wallLine starts AT the line; fully above and fully past are untouched;
//       the stop still clamps; a window that would fall entirely below the stop is null
//   (c) PURE splitAtWall: a span crossing the line splits into [start..line−1] and [line..end]; others pass through
//   (d) the resumer and the drive pass wallLine into deriveWindow; the missed lane splits holes at the wall before chunking
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

const ADAPTER = 'src/lib/backfill/capture-adapters/google-ads.adapter.ts'
const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const DRIVE = 'src/app/api/backfill/universe-drive/route.ts'

// (a)
{
  const a = strip(read(ADAPTER))
  const m = a.match(/const sizing: SizingPolicy = \{[^}]*maxDays: (\d+)[^}]*\}/)
  check(m && m[1] === '360', `(a) ${ADAPTER}: sizing.maxDays must be 360 (GOOGLE_DESCEND_MAX_DAYS ⇐ LORAMER_DESCEND_WINDOW_360_V1) — found ${m ? m[1] : 'no sizing literal'}.`)
  const r = strip(read(RESUMER))
  const mm = r.match(/export const MISSED_WINDOW_DAYS = (\d+)/)
  check(mm && mm[1] === '360', `(a) ${RESUMER}: MISSED_WINDOW_DAYS must be 360 — found ${mm ? mm[1] : 'none'}.`)
  const bite = Number((r.match(/export const MAX_REQUESTS_PER_RUN\s*=\s*(\d+)/) || [])[1])
  check(Number.isFinite(bite) && m && Number(m[1]) <= bite, `(a) sizing.maxDays (${m ? m[1] : '?'}) must not exceed MAX_REQUESTS_PER_RUN (${bite}) — the exact-bound invariant (universe-horizon-recedes (d)); widen the bite before the window.`)
  check(Number.isFinite(bite) && mm && Number(mm[1]) <= bite, `(a) MISSED_WINDOW_DAYS (${mm ? mm[1] : '?'}) must not exceed MAX_REQUESTS_PER_RUN (${bite}).`)
}

// (b)(c)
const out = mkdtempSync(join(tmpdir(), 'descend-window-360-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, RESUMER), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.deriveWindow !== 'function' || typeof R.splitAtWall !== 'function') throw new Error('deriveWindow / splitAtWall not exported')
  const WALL = '2023-08-18'
  // straddling: 90 days ending 2023-09-10 would start 2023-06-13 → starts at the wall
  const s1 = R.deriveWindow({ anchorEnd: '2023-09-10', sizingDays: 90, stopDate: '2022-03-04', wallLine: WALL })
  check(s1 && s1.windowStart === WALL && s1.windowEnd === '2023-09-10', `(b) a straddling window must start AT the wall — got ${JSON.stringify(s1)}`)
  // fully above: untouched
  const s2 = R.deriveWindow({ anchorEnd: '2025-09-10', sizingDays: 90, stopDate: '2022-03-04', wallLine: WALL })
  check(s2 && s2.windowStart === '2025-06-13' && s2.windowEnd === '2025-09-10', `(b) a window above the wall must be untouched — got ${JSON.stringify(s2)}`)
  // fully past: untouched (asked in its own window; its answer is judged by retention-wall.ts)
  const s3 = R.deriveWindow({ anchorEnd: '2023-08-17', sizingDays: 90, stopDate: '2022-03-04', wallLine: WALL })
  check(s3 && s3.windowStart === '2023-05-20' && s3.windowEnd === '2023-08-17', `(b) a window entirely past the wall must be untouched — got ${JSON.stringify(s3)}`)
  // the stop still clamps, and clamps above the wall when the stop is newer
  const s4 = R.deriveWindow({ anchorEnd: '2023-09-10', sizingDays: 90, stopDate: '2023-09-01', wallLine: WALL })
  check(s4 && s4.windowStart === '2023-09-01', `(b) the resolved stop still clamps (stop newer than the wall) — got ${JSON.stringify(s4)}`)
  const s5 = R.deriveWindow({ anchorEnd: '2023-09-10', sizingDays: 90, stopDate: '2023-09-11', wallLine: WALL })
  check(s5 === null, `(b) an anchor below the stop is still null (surface complete) — got ${JSON.stringify(s5)}`)
  // no wall given: byte-identical to the old behaviour
  const s6 = R.deriveWindow({ anchorEnd: '2023-09-10', sizingDays: 90, stopDate: '2022-03-04' })
  check(s6 && s6.windowStart === '2023-06-13', `(b) without a wallLine the window is the plain 90-day window — got ${JSON.stringify(s6)}`)
  // (c)
  const c1 = R.splitAtWall('2023-07-01', '2023-09-30', WALL)
  check(c1.length === 2 && c1[0].start === '2023-07-01' && c1[0].end === '2023-08-17' && c1[1].start === WALL && c1[1].end === '2023-09-30', `(c) a span crossing the wall must split at it — got ${JSON.stringify(c1)}`)
  const c2 = R.splitAtWall('2023-09-01', '2023-09-30', WALL)
  check(c2.length === 1 && c2[0].start === '2023-09-01', `(c) a span above the wall passes through — got ${JSON.stringify(c2)}`)
  const c3 = R.splitAtWall('2022-01-01', '2022-03-01', WALL)
  check(c3.length === 1 && c3[0].end === '2022-03-01', `(c) a span past the wall passes through — got ${JSON.stringify(c3)}`)
  const c4 = R.splitAtWall(WALL, '2023-09-30', WALL)
  check(c4.length === 1, `(c) a span starting exactly at the wall is not split — got ${JSON.stringify(c4)}`)
} catch (e) {
  findings.push(`(b)(c) could not drive the pure deciders — ${e.message}. A guard that cannot run its subject FAILS.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// (d)
{
  const route = strip(read(ROUTE))
  check(/deriveWindow\(\{ anchorEnd: anchor\.anchorEnd, sizingDays: sizing\.days, stopDate: stop\.stopDate, wallLine \}\)/.test(route), `(d) ${ROUTE}: deriveWindow must receive wallLine so a descend window never straddles the retention line.`)
  check(/splitAtWall\(h\.start, h\.end, wallLine\)/.test(route), `(d) ${ROUTE}: the missed lane must split each hole at the wall before chunking it into MISSED_WINDOW_DAYS windows.`)
  const drive = strip(read(DRIVE))
  check(/deriveWindow\(\{ anchorEnd: anchor\.anchorEnd, sizingDays: sizing\.days, stopDate: stop\.stopDate, wallLine \}\)/.test(drive), `(d) ${DRIVE}: the drive's deriveWindow must receive wallLine too — same planner, same clip.`)
}

if (findings.length) {
  console.error(`[descend-window-360] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[descend-window-360] PASS — maxDays 360 and MISSED_WINDOW_DAYS 360 are pinned under MAX_REQUESTS_PER_RUN; deriveWindow clips a straddling window to start at the wall (Airbyte form) and leaves above/past windows untouched; the missed lane splits holes at the wall; both planners pass wallLine.')
