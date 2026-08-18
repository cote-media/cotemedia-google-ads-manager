#!/usr/bin/env node
// LORAMER_ANCHOR_RECEDES_BY_WINDOW_V1 — THE WALK GAINS A WINDOW PER PASS, NOT A RANGE.
//
// ⛔ WHAT THIS GUARD WAS, AND WHY IT CHANGED SHAPE. It shipped RED on 2026-08-17 asserting the defect:
// `deriveAnchorEnd` receded to `lastWindowStart − 1` where "the last window" came from
// `universe_surface_rotation`, which returned the last RANGE walked, because the consumer wrote range bounds
// into columns named `window_start`/`window_end`. Ranges are walked in ASCENDING date order, so the newest row
// was the range nearest the TOP of the window and the step was ONE DAY. MEASURED by the drive over five
// consecutive passes, zero variance: ~1,427 passes / ~2,854 vendor requests per surface, ~4 years each,
// 346 surfaces. THE WALK COULD NOT REACH INCEPTION AT ALL.
//
// ⛔ IT NOW ASSERTS THE **NEW CONTRACT**, IN TWO LEGS THAT MUST BOTH HOLD — LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1:
//   (A) A **KNOWN**, FULLY-ANSWERED WINDOW RECEDES BY THE WINDOW. `universe_attempt_log.parent_window_start/end`
//       (migrations/082) records the ask; the rotation prefers it; the anchor moves a full ~30 days.
//   (B) AN **UNKNOWN** WINDOW DOES NOT RECEDE AT ALL. A pre-082 row carries no parent, and the window it
//       belonged to is recoverable from NO STORED FACT — sizing is adaptive and time-varying, so it cannot be
//       recomputed, forwards or backwards. Receding on bounds we cannot vouch for is the false-all-clear class
//       this rebuild exists to end, so UNKNOWN holds.
// ⛔ LEG (B) IS NOT A NICETY. Without it the transitional period is the CATASTROPHIC configuration the
// 2026-08-18 adversary pass named: a rotation returning parent-preferred bounds while legacy rows still return
// range bounds would recede a full window on the evidence of one answered day. Either leg alone is worse than
// the defect it replaces.
//
// ⛔ IT DRIVES THE REAL COMPILED FUNCTION, not a copy. A re-implementation of the arithmetic here would prove
// this file's arithmetic, which is the class of mistake the whole 2026-08-17 session was about.
//
// ⚠ WHAT THIS GUARD STILL CANNOT SEE, STATED SO ITS GREEN IS NOT OVER-READ: it is a UNIT DRIVE. Both live
// skip mechanisms found on 2026-08-18 sit at this function's CALLERS — the ungated hold branch and the
// mis-sized upper half dropped at publish — and are invisible to it by construction. That is what
// `no-owed-day-left-behind.guard.mjs` (the warehouse property) and `mis-size-must-re-owe.guard.mjs` are for.
// A green here means the STEP SIZE is right. It does not mean no ground was left behind.
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

  // ── (A) A KNOWN, FULLY-ANSWERED 30-DAY WINDOW MUST RECEDE BY 30 DAYS ─────────────────────────────────
  // The bounds are the drive's own recorded pass 1: published window 2026-02-03..2026-03-04, every owed day
  // answered. Before 082 the rotation handed this call `2026-03-04..2026-03-04` — the last range written —
  // and the step was ONE day. It now hands the PARENT.
  const a = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2026-02-03', lastWindowEnd: '2026-03-04',
    lastWindowFullyAnswered: true,
    lastWindowKnown: true,
  })
  const step = days('2026-03-04', a.anchorEnd)
  if (!a.receded) {
    findings.push(`(A) a KNOWN, fully-answered window 2026-02-03..2026-03-04 did NOT recede at all (basis: "${a.basis}"). A window that owes nothing must be walked past, or the surface is wedged on covered ground.`)
  } else if (step < MIN_STEP_DAYS) {
    findings.push(
      `(A) a KNOWN, FULLY-ANSWERED 30-day window (2026-02-03..2026-03-04) receded the anchor by ${step} day(s), to ${a.anchorEnd}. ` +
      `The function's own basis reads "${a.basis}". At ${step} day(s) per pass a single surface needs ~${Math.ceil(DAYS_TO_FLOOR / step)} passes and ~${Math.ceil(DAYS_TO_FLOOR / step) * 2} vendor requests to reach inception, ` +
      `and the catalogue holds 346 surfaces. ⛔ THE WALK CANNOT REACH INCEPTION AS BUILT.`)
  }

  // ── (B) AN UNKNOWN WINDOW MUST NOT RECEDE ─────────────────────────────────────────────────────────────
  // Identical bounds, identical fully-answered flag — ONLY `lastWindowKnown` differs. A pre-082 row's bounds
  // are a RANGE wearing a window's name, and no amount of "fully answered" makes them vouchable.
  const b = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2026-02-03', lastWindowEnd: '2026-03-04',
    lastWindowFullyAnswered: true,
    lastWindowKnown: false,
  })
  if (b.receded) {
    findings.push(
      `(B) an UNKNOWN window (parent_known=false) RECEDED the anchor to ${b.anchorEnd} (basis: "${b.basis}"). ` +
      `⛔ A pre-082 row's bounds are the last RANGE walked, not the window asked, and the window is recoverable from no stored fact. ` +
      `Receding on them skips every owed day of the true window that sits above ${b.anchorEnd} — permanently and silently.`)
  }

  // ── (B2) THE DEFAULT MUST BE SAFE ─────────────────────────────────────────────────────────────────────
  // A caller that forgets `lastWindowKnown` must get the SAFE answer, not the fast one. This is the leg that
  // catches a third caller being added later and quietly inheriting a recession it never asked for.
  const c = R.deriveAnchorEnd({
    newestGround: '2026-08-17',
    lastWindowStart: '2026-02-03', lastWindowEnd: '2026-03-04',
    lastWindowFullyAnswered: true,
  })
  if (c.receded) {
    findings.push(`(B2) omitting lastWindowKnown RECEDED the anchor to ${c.anchorEnd}. The default must be UNKNOWN-and-hold: a new caller must not inherit a recession by forgetting a field.`)
  }

  console.log(`[anchor-recedes-by-window] measured: KNOWN fully-answered 30-day window → ${step} day(s) gained (receded=${a.receded}) · UNKNOWN same bounds → receded=${b.receded} · default → receded=${c.receded}.`)
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
  console.log(`[anchor-recedes-by-window] PASS — a KNOWN fully-answered window recedes by at least ${MIN_STEP_DAYS} days; an UNKNOWN one does not recede at all, and the default is UNKNOWN.`)
}
