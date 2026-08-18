#!/usr/bin/env node
// LORAMER_ANCHOR_RECEDES_BY_WINDOW_V1 — RED UNTIL THE WALK GAINS A WINDOW PER PASS INSTEAD OF A RANGE.
//
// ⛔ THIS SHIPS RED, ON PURPOSE, AND IT IS THE HEAD OF THE QUEUE (★ANCHOR-RECEDES-BY-RANGE-NOT-WINDOW).
// `deriveAnchorEnd` recedes to `lastWindowStart − 1`, learning "the last window" from
// `universe_surface_rotation` (migrations/064) — which returns the last RANGE walked, because the consumer
// writes range bounds into columns named `window_start`/`window_end`. The step is therefore
// `previous window end − start of the LAST-WRITTEN range`, and since ranges are walked in ASCENDING date
// order the last one written is the newest, so the step is usually ONE DAY.
//
// ⛔ THE NUMBERS BELOW ARE NOT A FIXTURE. They are the drive's own recorded passes from 2026-08-17:
//   pass 1  — published window 2026-02-03..2026-03-04 (30 days). The consumer walked TWO ranges in ascending
//             order and the LAST attempt_started written was the TOP one, 2026-03-04..2026-03-04. Every owed
//             day in the window was answered. Ground gained: ONE day.
//   pass 20 — a single range 2025-12-26..2026-01-10 (16 days). Same code. Ground gained: SIXTEEN days.
// One code path, two answers, and the difference is the WIDTH OF THE LAST RANGE — which is the defect.
//
// ⛔ IT DRIVES THE REAL COMPILED FUNCTION, not a copy. A re-implementation of the arithmetic here would prove
// this file's arithmetic, which is the class of mistake this whole session was about.
//
// GOES GREEN WHEN: a fully-answered window recedes the anchor by the WINDOW (~30 days). ⛔ AND NOT BEFORE —
// see docs/LORAMER_WALK_REBUILD_ARCHITECTURE.md § PROGRESS-TRUTH for why receding by the window WITHOUT also
// evaluating `lastWindowFullyAnswered` over that window would skip 18 owed days permanently and silently.
// BOTH HALVES OR IT IS WRONG. A green here with the other half missing is worse than this red.
//
// USAGE: node tests/guards/anchor-recedes-by-window.guard.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const MIN_STEP_DAYS = 30            // sizing maxDays; a fully-answered window must yield its own width
const DAYS_TO_FLOOR = 1427          // 2026-01-30 → 2022-03-04, measured 2026-08-17
const out = mkdtempSync(join(tmpdir(), 'loramer-anchor-'))
const days = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000)
const findings = []

try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.deriveAnchorEnd !== 'function') throw new Error('deriveAnchorEnd is not exported — the subject moved.')

  // ── THE ASSERTION — pass 1's recorded shape.
  const a = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2026-03-04', lastWindowEnd: '2026-03-04',   // what the rotation RETURNS: a RANGE
    lastWindowFullyAnswered: true,
  })
  const step = days('2026-03-04', a.anchorEnd)                     // window end 2026-03-04 → new anchor
  if (step < MIN_STEP_DAYS) {
    findings.push(
      `a FULLY-ANSWERED 30-day window (2026-02-03..2026-03-04) receded the anchor by ${step} day(s), to ${a.anchorEnd}. ` +
      `The function's own basis reads "${a.basis}" — perfectly correct about the RANGE and silent about the other 29 days. ` +
      `At ${step} day(s) per pass a single surface needs ~${Math.ceil(DAYS_TO_FLOOR / step)} passes and ~${Math.ceil(DAYS_TO_FLOOR / step) * 2} vendor requests to reach inception, ` +
      `and the catalogue holds 346 surfaces. ⛔ THE WALK CANNOT REACH INCEPTION AS BUILT.`)
  }

  // ── THE SAME CODE, A WIDER RANGE — proof the step is the RANGE and nothing else.
  const b = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2025-12-26', lastWindowEnd: '2026-01-10',
    lastWindowFullyAnswered: true,
  })
  const wide = days('2026-01-10', b.anchorEnd)
  if (wide === step) {
    findings.push(`the 16-day range produced the SAME step (${wide}) as the 1-day range — the recorded shapes no longer differ, so this leg has stopped measuring what it was written for. Re-derive it against fresh drive passes.`)
  }
  console.log(`[anchor-recedes-by-window] measured: 1-day range → ${step} day(s) gained · 16-day range → ${wide} day(s) gained (same code, same fully-answered flag).`)
} catch (e) {
  rmSync(out, { recursive: true, force: true })
  console.error(`[anchor-recedes-by-window] CANNOT RUN — ${e.message}. A guard that cannot drive its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}
rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`[anchor-recedes-by-window] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ SPEC: docs/LORAMER_WALK_REBUILD_ARCHITECTURE.md § PROGRESS-TRUTH. ⛔ Record the WINDOW **and** evaluate fullyAnswered over that window — either half alone is worse than today.`)
  process.exitCode = 1
} else {
  console.log(`[anchor-recedes-by-window] PASS — a fully-answered window recedes the anchor by at least ${MIN_STEP_DAYS} days.`)
}
