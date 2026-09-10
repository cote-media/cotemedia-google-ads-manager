#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 — EVERY SURFACE A UNIT ASKS ENDS WITH AN OBSERVATION ROW, WHATEVER CAME BACK.
//
// Ruling (F), DECISIONS 2026-09-04: never a "didn't ask" day. The driver's unit loop is a PURE orchestration
// (forward-driver-slices.ts: runCatalogueUnit) that takes `ask` and `observe` as functions, so this guard can drive
// it with no network and no DB: an ask that returns rows → 'ok', returns nothing → 'zero', returns rows that
// became no row → 'nongrain', THROWS → 'error' — and in every case exactly one observe() per surface.
//
// LEGS
//  (a) forward-driver-slices.ts compiles standalone and exports runCatalogueUnit
//  (b) 4 surfaces × 4 outcomes: observe called 4 times, outcomes exactly ok · zero · nongrain · error, the error text kept
//  (c) a throwing observe() never aborts the unit: the remaining surfaces are still asked and the failure is returned
//  (d) forward-driver.ts calls runCatalogueUnit and wires observe to the observation module's observeForward
//  (e) registered in scripts/run-guards.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const SLICES = 'src/lib/backfill/forward-driver-slices.ts'
const DRIVER = 'src/lib/backfill/forward-driver.ts'

if (!read(SLICES)) findings.push(`(a) ${SLICES} does not exist — the driver's pure unit loop has not been built`)
else {
  const out = mkdtempSync(join(tmpdir(), 'loramer-unit-observed-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
      resolve(ROOT, SLICES), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
      '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
    ], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const M = createRequire(import.meta.url)(join(out, 'src/lib/backfill/forward-driver-slices.js'))
    if (typeof M.runCatalogueUnit !== 'function') findings.push(`(a) ${SLICES} does not export runCatalogueUnit`)
    else {
      const surfaces = [
        { resource: 'a', segment: '' }, { resource: 'b', segment: 'segments.x' }, { resource: 'c', segment: '' }, { resource: 'd', segment: 'segments.y' },
      ]
      const ask = async (s) => {
        if (s.resource === 'a') return { apiRows: 10, rowsWritten: 10, rowsByDay: { '2026-09-09': 10 }, requests: 1 }
        if (s.resource === 'b') return { apiRows: 0, rowsWritten: 0, rowsByDay: {}, requests: 1 }
        if (s.resource === 'c') return { apiRows: 5, rowsWritten: 0, rowsByDay: {}, requests: 1 }
        throw new Error('vendor said no')
      }
      const seen = []
      const res = await M.runCatalogueUnit({ surfaces, ask, observe: async (o) => { seen.push(o) }, window: { start: '2026-08-10', end: '2026-09-09' }, deadlineAt: Infinity })
      if (seen.length !== 4) findings.push(`(b) 4 surfaces asked, observe() called ${seen.length} time(s) — a surface without an observation is a "didn't ask" day`)
      const oc = Object.fromEntries(seen.map((o) => [o.resource, o.outcome]))
      const want = { a: 'ok', b: 'zero', c: 'nongrain', d: 'error' }
      for (const [k, v] of Object.entries(want)) if (oc[k] !== v) findings.push(`(b) surface ${k}: outcome ${oc[k]} — expected ${v}`)
      const errObs = seen.find((o) => o.resource === 'd')
      if (errObs && !/vendor said no/.test(String(errObs.error))) findings.push('(b) the thrown error text was not carried onto the observation')
      if (!res || res.surfacesAsked !== 4) findings.push(`(b) runCatalogueUnit reported surfacesAsked=${res?.surfacesAsked} — expected 4`)
      // (c) a failing observe never aborts the unit
      const seen2 = []
      const res2 = await M.runCatalogueUnit({ surfaces, ask, observe: async (o) => { if (o.resource === 'a') throw new Error('ledger down'); seen2.push(o) }, window: { start: '2026-08-10', end: '2026-09-09' }, deadlineAt: Infinity })
      if (seen2.length !== 3) findings.push(`(c) after observe() threw on the first surface the unit recorded ${seen2.length} more — expected 3 (the unit continues)`)
      if (!res2 || res2.observationFailures !== 1) findings.push(`(c) observationFailures=${res2?.observationFailures} — a failed append must be counted, never swallowed`)
    }
  } catch (e) { findings.push(`(a) ${SLICES} could not be compiled or driven: ${e.message}`) }
  finally { rmSync(out, { recursive: true, force: true }) }
}

const driver = strip(read(DRIVER))
if (!driver) findings.push(`(d) ${DRIVER} does not exist`)
else {
  if (!/runCatalogueUnit\s*\(/.test(driver)) findings.push(`(d) ${DRIVER} does not call runCatalogueUnit — the unit loop this guard proves is not the one the driver runs`)
  if (!/observeForward\s*\(/.test(driver)) findings.push(`(d) ${DRIVER} never calls observeForward — the observation module is not the driver's recorder`)
}
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/every-unit-observed.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ every-unit-observed FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log('[every-unit-observed] PASS — runCatalogueUnit records exactly one observation per surface across ok · zero · nongrain · error, survives a failing append, and the driver runs its units through it.')
