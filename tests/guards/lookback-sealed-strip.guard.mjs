#!/usr/bin/env node
// LORAMER_SEALED_STRIP_PASS_V1 → LORAMER_LOOKBACK_LANE_V1 — A FLOOR-SEALED SURFACE STILL GETS ITS BOUNDARY STRIP DERIVED.
//
// ⛔ THE DEATH THIS PINS, measured live 2026-08-26 (as top-edge-sealed-strip.guard.mjs, converted here with the lane
// under DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (j)): the seal-skip in cron/universe-resume `continue`d BEFORE
// the strip derivation, so when the Foam OH descent finished (349/349 surfaces floor-sealed by 2026-08-26 06:00Z)
// the scan went empty and the second lane published ZERO for 24+ hours — fires 287/288, candidates 0, refusals
// {"floor-sealed": 349}. The lookback lane is the top-edge lane converted: same sealed branch, same placement law,
// the strip now anchored to the restatement BOUNDARY (deriveBoundaryStrip) instead of yesterday (deriveTopStrip,
// deleted). A finished surface is exactly the surface whose past-boundary days this lane exists to seal.
//
// TWO LEGS:
//  (A) PLACEMENT IN THE SEALED BRANCH — comments stripped, the code between the `verdict: 'floor-sealed'`
//      refusal and its `continue` must derive the boundary strip: deriveBoundaryStrip + rangesStillOwed + the
//      SEALED_STRIP_DERIVATIONS_PER_RUN bound all present INSIDE that span.
//  (B) THE PURE PIECES, compiled and driven: deriveBoundaryStrip yields a window for a sealed-shaped rotation
//      once its ground is past the boundary and 'waiting' while it is not; and the derivation bound is at least
//      the lookback publication bound (LOOKBACK_REQUESTS_PER_RUN), or the pass cannot fill the slots it feeds.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── (A) PLACEMENT ─────────────────────────────────────────────────────────────────────────────────────────
try {
  const src = stripComments(readFileSync(resolve(ROOT, 'src/app/api/cron/universe-resume/route.ts'), 'utf8'))
  const at = src.indexOf("verdict: 'floor-sealed'")
  if (at < 0) {
    findings.push('(A) the floor-sealed refusal is gone from cron/universe-resume — the seal branch moved; re-anchor this guard on wherever sealed surfaces now leave the scan.')
  } else {
    const cont = src.indexOf('continue', at)
    const span = cont > at ? src.slice(at, cont) : ''
    for (const needle of ['deriveBoundaryStrip', 'rangesStillOwed', 'SEALED_STRIP_DERIVATIONS_PER_RUN']) {
      if (!span.includes(needle)) {
        findings.push(`(A) the sealed branch reaches its \`continue\` without ${needle} — a floor-sealed surface's boundary strip is not derived, and at fleet-terminal (every surface sealed, the walk's own finish line) the lookback lane publishes nothing forever.`)
      }
    }
  }
} catch (e) {
  findings.push(`(A) source read failed: ${e.message}`)
}

// ── (B) THE PURE PIECES, DRIVEN ───────────────────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-lookback-sealed-strip-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.SEALED_STRIP_DERIVATIONS_PER_RUN !== 'number') {
    findings.push('(B) SEALED_STRIP_DERIVATIONS_PER_RUN is not exported from universe-resumer.ts — the bound the pass runs under does not exist as code.')
  } else if (typeof R.LOOKBACK_REQUESTS_PER_RUN !== 'number') {
    findings.push('(B) LOOKBACK_REQUESTS_PER_RUN is not exported from universe-resumer.ts — the lookback slot has no publication bound.')
  } else if (R.SEALED_STRIP_DERIVATIONS_PER_RUN < R.LOOKBACK_REQUESTS_PER_RUN) {
    findings.push(`(B) SEALED_STRIP_DERIVATIONS_PER_RUN (${R.SEALED_STRIP_DERIVATIONS_PER_RUN}) is below LOOKBACK_REQUESTS_PER_RUN (${R.LOOKBACK_REQUESTS_PER_RUN}) — the pass derives fewer candidates than the slots it must fill.`)
  }
  if (typeof R.deriveBoundaryStrip !== 'function') {
    findings.push('(B) deriveBoundaryStrip is not exported — the subject moved (or the lane was not converted).')
  } else {
    // a sealed Foam OH surface, ground past a 20-day boundary → a window ending at T−20
    const sealed = R.deriveBoundaryStrip({ descendTopEnd: '2026-08-12', lastLookbackEnd: null, newestServable: '2026-09-07', boundaryDays: 20, widthDays: 7 })
    if (!sealed || sealed.kind !== 'window' || sealed.windowEnd !== '2026-08-19') {
      findings.push(`(B) a sealed-shaped rotation (descent top 2026-08-12, T 2026-09-08, B 20, W 7) derived ${JSON.stringify(sealed)} — the strip above a FINISHED descent must exist once past the boundary and end at T−B.`)
    }
    // the same surface inside the boundary → WAITING, never a window
    const waiting = R.deriveBoundaryStrip({ descendTopEnd: '2026-08-12', lastLookbackEnd: null, newestServable: '2026-09-07', boundaryDays: 90, widthDays: 7 })
    if (!waiting || waiting.kind !== 'waiting') {
      findings.push(`(B) ground inside the boundary derived ${JSON.stringify(waiting)} — it must WAIT (kind 'waiting'), never be asked.`)
    }
  }
} catch (e) {
  findings.push(`(B) pure drive failed: ${e.message}`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (findings.length) {
  console.error(`✗ LOOKBACK-SEALED-STRIP FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[lookback-sealed-strip] PASS — the sealed branch derives the boundary strip before its continue (bounded by SEALED_STRIP_DERIVATIONS_PER_RUN ≥ LOOKBACK_REQUESTS_PER_RUN), and deriveBoundaryStrip yields a window past the boundary and waits inside it.')
