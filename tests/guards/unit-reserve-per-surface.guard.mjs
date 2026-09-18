#!/usr/bin/env node
// LORAMER_UNIT_RESERVE_PER_SURFACE_V1 — A UNIT RESERVES WHAT ITS OWN SURFACE HAS COST PER DAY, NOT A FLAT 10 SECONDS.
//
// Round 4 (2026-09-18) measured the flat UNIT_RESERVATION_FLOOR_MS = 10,000 (from a 6,768 ms p99 on ≤30-day units)
// against 90-day units and the ledger: the rows-based formula failed 629 of 666 attempts because vendor latency, not
// rows, sets the floor (≤1,000-row requests run p99.9 16.9 s); a PER-SURFACE predictor from the ledger's own
// durations — 18 s + max(seconds-per-day over the last 12 attempts) × days × 1.48 — covered 23,093 of 23,096 warm
// attempts. This guard proves:
//   (a) PURE unitReserveMs: 90 days at 1.0 s/day → ≥ 151,180 ms; a 1-day unit with no history → exactly 18,000
//   (b) the contract's floor is 18,000 and FIRE_WORK_BUDGET_MS still derives from it
//   (c) sizing reads duration_ms and returns maxSecPerDay + reserveMs beside the window size
//   (d) the fire admits each unit against ITS reserve and hands maxSecPerDay to the worker, whose range admission
//       reserves per range through unitReserveMs (never the bare flat floor)
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

const ADAPTER = 'src/lib/backfill/capture-adapter.ts'
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const SIZING = 'src/lib/backfill/universe-sizing.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'

// (a) pure
const out = mkdtempSync(join(tmpdir(), 'unit-reserve-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, ADAPTER), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const A = createRequire(import.meta.url)(join(out, 'src/lib/backfill/capture-adapter.js'))
  if (typeof A.unitReserveMs !== 'function') throw new Error('unitReserveMs is not exported from capture-adapter.ts')
  const heavy = A.unitReserveMs({ maxSecPerDay: 1.0, days: 90 })
  check(heavy >= 151180, `(a) a 90-day unit on a surface that has cost 1.0 s/day must reserve ≥ 151,180 ms (18,000 + 1.0 × 90 × 1,480) — got ${heavy}`)
  const light = A.unitReserveMs({ maxSecPerDay: null, days: 1 })
  check(light === 18000, `(a) a 1-day unit with no history must reserve exactly the 18,000 ms floor — got ${light}`)
  const tiny = A.unitReserveMs({ maxSecPerDay: 0.01, days: 1 })
  check(tiny === 18015, `(a) the floor is ADDED to, never replaced: 0.01 s/day × 1 day × 1.48 → 18,015 ms — got ${tiny}`)
  const zero = A.unitReserveMs({ maxSecPerDay: 0, days: 90 })
  check(zero === 18000, `(a) a surface that has measured 0 s/day reserves exactly the floor at any width — got ${zero}`)
  check(A.UNIT_RESERVE_FLOOR_MS === 18000 && Math.abs(A.UNIT_RESERVE_FACTOR - 1.48) < 1e-9, `(a) UNIT_RESERVE_FLOOR_MS must be 18,000 and UNIT_RESERVE_FACTOR 1.48 — got ${A.UNIT_RESERVE_FLOOR_MS} / ${A.UNIT_RESERVE_FACTOR}`)
} catch (e) {
  findings.push(`(a) could not drive unitReserveMs — ${e.message}. A guard that cannot run its subject FAILS.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// (b) contract
{
  const c = strip(read(CONTRACT))
  check(/export const UNIT_RESERVATION_FLOOR_MS = UNIT_RESERVE_FLOOR_MS/.test(c) || /export const UNIT_RESERVATION_FLOOR_MS = 18_000/.test(c), `(b) ${CONTRACT}: UNIT_RESERVATION_FLOOR_MS must be the 18,000 ms floor (or alias UNIT_RESERVE_FLOOR_MS).`)
  check(/export const FIRE_WORK_BUDGET_MS = \(CONSUMER_MAX_DURATION_S \* 1000\) - UNIT_RESERVATION_FLOOR_MS/.test(c), `(b) ${CONTRACT}: FIRE_WORK_BUDGET_MS must still derive from the floor.`)
}
// (c) sizing
{
  const s = strip(read(SIZING))
  check(/select\('window_start, window_end, rows_written, duration_ms'\)/.test(s), `(c) ${SIZING}: the sizing read must select duration_ms beside rows_written (one read, no second round trip).`)
  check(/maxSecPerDay/.test(s) && /unitReserveMs\(/.test(s) && /reserveMs/.test(s), `(c) ${SIZING}: sizeNextWindow must derive maxSecPerDay from duration_ms and return reserveMs via unitReserveMs.`)
}
// (d) route + worker
{
  const route = strip(read(ROUTE))
  check(/shouldStartAnotherLap\(Date\.now\(\) - startedAt, maxUnitMs, FIRE_WORK_BUDGET_MS, c\.reserveMs\)/.test(route), `(d) ${ROUTE}: unit admission must reserve the unit's OWN reserveMs (shouldStartAnotherLap(…, FIRE_WORK_BUDGET_MS, c.reserveMs)).`)
  check(/maxSecPerDay: c\.maxSecPerDay/.test(route), `(d) ${ROUTE}: the fire must hand the unit's maxSecPerDay to the worker.`)
  const w = strip(read(WORKER))
  check(/unitReserveMs\(\{ maxSecPerDay: opts\.maxSecPerDay \?\? null, days: dayDiff\(range\.start, range\.end\) \+ 1 \}\)/.test(w), `(d) ${WORKER}: range admission must reserve per range through unitReserveMs(maxSecPerDay, rangeDays).`)
  check(!/Math\.max\(maxRangeMs, UNIT_RESERVATION_FLOOR_MS\)/.test(w), `(d) ${WORKER}: the bare flat floor must no longer be the range reservation.`)
}

if (findings.length) {
  console.error(`[unit-reserve-per-surface] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[unit-reserve-per-surface] PASS — a unit reserves 18 s + its surface\'s max seconds-per-day × days × 1.48 (floor 18 s): 90 d at 1.0 s/day ≥ 151,180 ms, a light 1-day unit exactly 18,000; sizing reads duration_ms; the fire and the worker admit against that reserve.')
