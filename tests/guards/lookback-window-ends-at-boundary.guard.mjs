#!/usr/bin/env node
// LORAMER_LOOKBACK_LANE_V1 — A LOOKBACK WINDOW NEVER ENDS INSIDE THE RESTATEMENT BOUNDARY.
//
// THE PROPERTY: for every input, deriveBoundaryStrip either returns a window whose windowEnd ≤ T−B (T = the day
// after newestServable, B = boundaryDays) or returns no window at all. A window ending inside the boundary
// would be asked while the vendor can still restate it, and its `zero` would then ATTEST a day that was not
// final — the false-all-clear class (universe-coverage.ts header) arriving through the lane built to end it.
// ⛔ DRIVEN ON THE REAL COMPILED FUNCTION (the anchor-recedes idiom), never re-derived here. Red-first: before
// the function exists the drive reports "not exported", which is exactly the state this commit starts from.
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const findings = []
const out = mkdtempSync(join(tmpdir(), 'loramer-lookback-boundary-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, RESUMER), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.deriveBoundaryStrip !== 'function') {
    findings.push(`deriveBoundaryStrip is not exported from ${RESUMER} — the boundary strip does not exist as a drivable function, so nothing can prove a lookback window stops at T−B.`)
  } else {
    const d = R.deriveBoundaryStrip
    const T = '2026-09-08', yesterday = '2026-09-07'
    const boundaryEnd = (B) => { const x = new Date(T + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - B); return x.toISOString().slice(0, 10) }
    // (1) Foam OH today: descent top 2026-08-12, nothing asked yet, B=90 → the first window [08-13..08-19] ends
    //     AFTER T−90 = 2026-06-10 → NO window; the derivation says WHEN it becomes askable.
    const a = d({ descendTopEnd: '2026-08-12', lastLookbackEnd: null, newestServable: yesterday, boundaryDays: 90, widthDays: 7 })
    if (!a || a.kind === 'window') findings.push(`(1) a window was produced for ground still inside the boundary: ${JSON.stringify(a)} — [2026-08-13..2026-08-19] ends after T−90 = ${boundaryEnd(90)}.`)
    else if (a.kind !== 'waiting' || a.askableOn !== '2026-11-17') findings.push(`(1) expected kind 'waiting' with askableOn 2026-11-17 (08-19 + 90 d), got ${JSON.stringify(a)}.`)
    // (2) the same surface with B=20 → boundaryEnd 2026-08-19 → the full 7-day window [08-13..08-19] is askable and ends exactly at T−B.
    const b = d({ descendTopEnd: '2026-08-12', lastLookbackEnd: null, newestServable: yesterday, boundaryDays: 20, widthDays: 7 })
    if (!b || b.kind !== 'window' || b.windowStart !== '2026-08-13' || b.windowEnd !== '2026-08-19' || b.windowEnd > boundaryEnd(20)) {
      findings.push(`(2) expected the full window [2026-08-13..2026-08-19] ending at T−20 = ${boundaryEnd(20)}, got ${JSON.stringify(b)}.`)
    }
    // (3) a partial window is NOT asked early: B=18 → boundaryEnd 2026-08-21; the next full window after 08-19 would be [08-20..08-26] → waiting until 08-26 + 18 = 2026-09-13.
    const c = d({ descendTopEnd: '2026-08-12', lastLookbackEnd: '2026-08-19', newestServable: yesterday, boundaryDays: 18, widthDays: 7 })
    if (!c || c.kind !== 'waiting' || c.nextStart !== '2026-08-20' || c.askableOn !== '2026-09-13') findings.push(`(3) expected 'waiting' from 2026-08-20 until 2026-09-13, got ${JSON.stringify(c)} — a partial window must never be asked inside the boundary.`)
    // (4) W=1 (Standard): every past-boundary day is its own window and the newest allowed is exactly T−B.
    const e = d({ descendTopEnd: '2026-08-12', lastLookbackEnd: '2026-08-19', newestServable: yesterday, boundaryDays: 18, widthDays: 1 })
    if (!e || e.kind !== 'window' || e.windowStart !== '2026-08-20' || e.windowEnd !== '2026-08-20') findings.push(`(4) expected the one-day window [2026-08-20..2026-08-20] under W=1, got ${JSON.stringify(e)}.`)
    // (5) a never-asked surface has no strip — that is the descent's whole history, not a lookback.
    const f = d({ descendTopEnd: null, lastLookbackEnd: null, newestServable: yesterday, boundaryDays: 20, widthDays: 7 })
    if (!f || f.kind !== 'none') findings.push(`(5) a surface the descent never asked produced ${JSON.stringify(f)} — it must be 'none' (the descending lane owns its history).`)
    // (6) THE SWEEP — every produced window across a grid of inputs ends ≤ T−B. Direction-independent proof.
    let produced = 0, violations = 0
    for (const B of [1, 7, 18, 30, 60, 90, 96]) for (const W of [1, 7]) for (const last of [null, '2026-08-12', '2026-08-19', '2026-08-31']) {
      const w = d({ descendTopEnd: '2026-08-12', lastLookbackEnd: last, newestServable: yesterday, boundaryDays: B, widthDays: W })
      if (w && w.kind === 'window') { produced++; if (w.windowEnd > boundaryEnd(B)) violations++ }
    }
    if (violations) findings.push(`(6) ${violations} of ${produced} produced window(s) end AFTER T−B across the input sweep — the boundary is not a boundary.`)
    if (produced === 0) findings.push('(6) the sweep produced NO windows at all — the derivation never yields, which reads exactly like "always safe".')
  }
} catch (e) {
  findings.push(`pure drive failed: ${e.message}`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
if (findings.length) {
  console.error(`✗ LOOKBACK-WINDOW-ENDS-AT-BOUNDARY FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('  ⇒ SPEC: QUEUE ★LOOKBACK-LANE-OWNS-PROMOTION (2) — deriveBoundaryStrip publishes only windows ending ≤ T−B and REFUSES any window ending inside the boundary; DECISIONS (i) the boundary is per account and measured.')
  process.exit(1)
}
console.log('[lookback-window-ends-at-boundary] PASS — deriveBoundaryStrip driven: inside-boundary ground WAITS (with the date it becomes askable), a full window ends exactly at T−B, partial windows are never asked early, W=1 yields single days, a never-asked surface yields none, and no window in the sweep ends after T−B.')
