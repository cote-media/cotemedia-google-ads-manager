#!/usr/bin/env node
// LORAMER_RESUME_FROM_COMMITTED_DAY_V1 — A RETRY ASKS FROM THE LAST COMMITTED DAY, NEVER THE WHOLE WINDOW AGAIN.
//
// ADOPTED-FROM Airbyte source-google-ads streams.py:117-130 (_handle_expired_page_exception resets
// `stream_slice["start_date"]` to the current state and re-reads only the remainder). Our flush-per-day already
// commits days as they land; what was missing (round 5, 2026-09-18) is that the BOUND — attempts-at-span and the
// mis-size split — still reasoned over the WHOLE window, so a killed 90-day attempt with 40 days committed was
// narrowed as if 90 were still owed. This guard proves:
//   (a) PURE planRetryAsk: 40 of 90 days committed → a 50-day ask [day 41 .. day 90]; nothing committed → the whole
//       window; everything committed → null; an interior hole → the span from the first to the last owed day
//   (b) the worker sizes the bound and the mis-size split on the REMAINDER (planRetryAsk over the coverage's uncovered
//       days), and cites the source it adopts
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

const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'

const day = (n) => { const d = new Date(Date.UTC(2026, 0, 1)); d.setUTCDate(d.getUTCDate() + n - 1); return d.toISOString().slice(0, 10) }

// (a)
const out = mkdtempSync(join(tmpdir(), 'resume-committed-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, RESUMER), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.planRetryAsk !== 'function') throw new Error('planRetryAsk is not exported from universe-resumer.ts')
  const W = { windowStart: day(1), windowEnd: day(90) }
  const uncoveredFrom = (from, to) => { const a = []; for (let n = from; n <= to; n++) a.push(day(n)); return a }
  const p1 = R.planRetryAsk({ ...W, uncoveredDays: uncoveredFrom(41, 90) })
  check(p1 && p1.start === day(41) && p1.end === day(90) && p1.days === 50, `(a) 40 of 90 committed must plan a 50-day ask ${day(41)}..${day(90)} — got ${JSON.stringify(p1)}`)
  const p2 = R.planRetryAsk({ ...W, uncoveredDays: uncoveredFrom(1, 90) })
  check(p2 && p2.start === day(1) && p2.end === day(90) && p2.days === 90, `(a) nothing committed must plan the whole window — got ${JSON.stringify(p2)}`)
  const p3 = R.planRetryAsk({ ...W, uncoveredDays: [] })
  check(p3 === null, `(a) everything committed must plan nothing (null) — got ${JSON.stringify(p3)}`)
  const p4 = R.planRetryAsk({ ...W, uncoveredDays: [day(10), day(11), day(60)] })
  check(p4 && p4.start === day(10) && p4.end === day(60) && p4.days === 51, `(a) an interior hole spans first..last owed day — got ${JSON.stringify(p4)}`)
  const p5 = R.planRetryAsk({ ...W, uncoveredDays: [day(95), day(3)] })
  check(p5 && p5.start === day(3) && p5.end === day(3) && p5.days === 1, `(a) days outside the window are ignored — got ${JSON.stringify(p5)}`)
} catch (e) {
  findings.push(`(a) could not drive planRetryAsk — ${e.message}. A guard that cannot run its subject FAILS.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// (b)
{
  const w = strip(read(WORKER))
  check(/const remainder = planRetryAsk\(\{ windowStart: startDate, windowEnd: endDate, uncoveredDays: owed\.coverage\.uncovered \}\)/.test(w), `(b) ${WORKER}: the bound must plan the retry ask from the coverage's uncovered days (planRetryAsk).`)
  check(/const spanDays = remainder \? remainder\.days : dayDiff\(startDate, endDate\) \+ 1/.test(w), `(b) ${WORKER}: spanDays must be the REMAINDER's days, not the whole window's.`)
  check(/planMisSizedSplit\(\{ windowStart: askStart, windowEnd: askEnd, minDays: MIN_WINDOW_DAYS \}\)/.test(w), `(b) ${WORKER}: the mis-size split must halve the remainder (askStart..askEnd), not the whole window.`)
  check(!/planMisSizedSplit\(\{ windowStart: startDate, windowEnd: endDate/.test(w), `(b) ${WORKER}: the old whole-window split call must be gone.`)
  check(/streams\.py:117-130/.test(read(WORKER)), `(b) ${WORKER}: the adopted-from citation (Airbyte streams.py:117-130) must sit at the site.`)
}

if (findings.length) {
  console.error(`[resume-from-committed-day] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[resume-from-committed-day] PASS — a retry asks the remainder (40 of 90 committed → a 50-day ask), the bound and the mis-size split reason over that remainder, and the adopted-from citation sits at the site.')
