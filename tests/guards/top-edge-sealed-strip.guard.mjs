#!/usr/bin/env node
// LORAMER_SEALED_STRIP_PASS_V1 — A FLOOR-SEALED SURFACE STILL GETS ITS TOP STRIP DERIVED.
//
// ⛔ THE DEATH THIS PINS, measured live 2026-08-26: the seal-skip in cron/universe-resume `continue`d BEFORE
// the strip derivation, so when the Foam OH descent finished (349/349 surfaces floor-sealed by 2026-08-26
// 06:00Z) the scan went empty and the top-edge lane published ZERO for 24+ hours — fires 287/288 (cadence
// fine), candidates 0, refusals {"floor-sealed": 349}, backlog growing 349 days/day, time-to-target NEVER.
// The branch's own residual comment predicted exactly this and claimed the bounded pass was "(queued)";
// no queue item existed. A residual named in a comment is not a queue item — this guard is the enforcer
// the comment pretended to have.
//
// TWO LEGS:
//  (A) PLACEMENT IN THE SEALED BRANCH — comments stripped, the code between the `verdict: 'floor-sealed'`
//      refusal and its `continue` must derive the strip: deriveTopStrip + rangesStillOwed + the
//      SEALED_STRIP_DERIVATIONS_PER_RUN bound all present INSIDE that span. This is the strip block's own
//      placement law ("computed BEFORE every `continue` the descent can take") applied to the one branch
//      that violated it — the branch every finished surface takes forever after.
//  (B) THE PURE PIECES, compiled and driven (the anchor-recedes idiom — real code, not a re-derivation):
//      deriveTopStrip yields a strip for a sealed-shaped rotation and none when the descent top already
//      reaches newest-servable; and the derivation bound is at least the publication bound, or the pass
//      cannot fill the slots it exists to feed.
import { readFileSync, mkdtempSync } from 'node:fs'
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
    findings.push(`(A) the floor-sealed refusal is gone from cron/universe-resume — the seal branch moved; re-anchor this guard on wherever sealed surfaces now leave the scan.`)
  } else {
    const cont = src.indexOf('continue', at)
    const span = cont > at ? src.slice(at, cont) : ''
    for (const needle of ['deriveTopStrip', 'rangesStillOwed', 'SEALED_STRIP_DERIVATIONS_PER_RUN']) {
      if (!span.includes(needle)) {
        findings.push(`(A) the sealed branch reaches its \`continue\` without ${needle} — a floor-sealed surface's top strip is not derived, and at fleet-terminal (every surface sealed, the walk's own DONE state) the top-edge lane starves to zero exactly as measured on 2026-08-26.`)
      }
    }
  }
} catch (e) {
  findings.push(`(A) source read failed: ${e.message}`)
}

// ── (B) THE PURE PIECES, DRIVEN ───────────────────────────────────────────────────────────────────────────
try {
  const out = mkdtempSync(join(tmpdir(), 'loramer-sealed-strip-'))
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
  if (typeof R.SEALED_STRIP_DERIVATIONS_PER_RUN !== 'number') {
    findings.push('(B) SEALED_STRIP_DERIVATIONS_PER_RUN is not exported from universe-resumer.ts — the bound the pass runs under does not exist as code.')
  } else if (R.SEALED_STRIP_DERIVATIONS_PER_RUN < R.TOP_EDGE_REQUESTS_PER_RUN) {
    findings.push(`(B) SEALED_STRIP_DERIVATIONS_PER_RUN (${R.SEALED_STRIP_DERIVATIONS_PER_RUN}) is below TOP_EDGE_REQUESTS_PER_RUN (${R.TOP_EDGE_REQUESTS_PER_RUN}) — the pass derives fewer candidates than the lane publishes, so the slots it exists to feed go unfilled.`)
  }
  if (typeof R.deriveTopStrip !== 'function') {
    findings.push('(B) deriveTopStrip is not exported — the subject moved.')
  } else {
    const sealed = R.deriveTopStrip({ descendTopEnd: '2026-08-12', newestServable: '2026-08-25', maxSpanDays: 30 })
    if (!sealed || sealed.windowEnd !== '2026-08-25') {
      findings.push(`(B) a sealed-shaped rotation (descent top 2026-08-12, newest servable 2026-08-25) derived ${JSON.stringify(sealed)} — the strip above a FINISHED descent must exist and end at newest-servable.`)
    }
    const flush = R.deriveTopStrip({ descendTopEnd: '2026-08-25', newestServable: '2026-08-25', maxSpanDays: 30 })
    if (flush !== null) {
      findings.push(`(B) a descent already at newest-servable derived ${JSON.stringify(flush)} — no strip exists there, and inventing one re-asks held ground every fire.`)
    }
  }
} catch (e) {
  findings.push(`(B) pure drive failed: ${e.message}`)
}

if (findings.length) {
  console.error(`✗ TOP-EDGE-SEALED-STRIP FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[top-edge-sealed-strip] PASS — the sealed branch derives the strip before its continue (bounded by SEALED_STRIP_DERIVATIONS_PER_RUN ≥ the publication bound), and deriveTopStrip yields a strip for a finished descent and none at the flush edge. LIMIT: whether the LIVE lane publishes again is the check:data top-edge-is-held leg and the fire ledger — no build guard can see a cron fire.')
