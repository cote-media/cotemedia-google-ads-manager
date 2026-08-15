#!/usr/bin/env node
// LORAMER_COVERAGE_DENSITY_V1 — "CAPTURE REACHES BACK THIS FAR" IS NOT "EVERY DAY IN THE WINDOW IS PRESENT".
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────
// LORAMER_BINDING_COVERAGE_V1 shipped a payload that gates structurally on the coverage verdict — and closed
// ZERO of the 17 baseline honesty failures, because the verdict it was handed came from a FLOOR test.
// Measured: Shelley Kyle woocommerce 2024 holds 248 of 366 days — 118 ABSENT — and `complete` came back TRUE
// through the real tool runner. This leg is what makes the binding bite.
//
// ⛔ AND THE REASON IT IS DANGEROUS TO GET WRONG, measured before it was built: judged against TODAY rather
// than the capturable frontier, 30 of 30 fleet client×platform pairs go PARTIAL on EVERY recent window —
// capture is T+1, so today is always missing. Every present-tense question on every client would refuse. The
// frontier leg is not a refinement; without it the feature is unshippable.
//
// ── THE FOUR LEGS ───────────────────────────────────────────────────────────────────────────────────────
//   (i)   FRONTIER — a window whose only absent day is today must be COMPLETE. Drives the REAL resolver.
//   (ii)  RUN THRESHOLD — a >=DENSITY_HOLE_RUN_DAYS run is a hole (PARTIAL); runs under it read as
//         no-activity and stay COMPLETE. The 1-6 vs >=7 split is the fleet's measured bimodal distribution.
//   (iii) ZERO-DAYS-BELOW-FLOOR — capture reaches back before the window and the window holds nothing:
//         PARTIAL. Distinct from a floor fact, which stays UNKNOWN and is the floor test's to report.
//   (iv)  ONE CONSTANT, WITH ITS REASONING — the threshold exists exactly once, carries the calibration and
//         BOTH failure directions at its definition, and is wired into the binding path. A number re-derived
//         somewhere else is how two coverage dialects start.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────
// (i)-(iii) drive the real compiled resolver; (iv) is a static read. Nothing here proves the threshold is
// RIGHT — it is CALIBRATED on one fleet, not derived, and both failure directions are live (a genuine 7+-day
// pause over-refuses; a 6-day outage under-refuses). The true fix is the walk's vendor attestation
// (★ATTESTED-EMPTY-UNREACHABLE-FROM-LORA). This guards the shape, never the number's correctness.
//
// USAGE: node tests/guards/coverage-density.guard.mjs
//        [--inject-no-frontier] [--inject-no-threshold] [--inject-zero-ok] [--inject-two-constants]
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }
const F_COV = 'src/lib/next/coverage.ts'
const F_TOOLS = 'src/lib/claude-tools.ts'
const cov = read(F_COV), tools = read(F_TOOLS)
for (const [n, s] of [[F_COV, cov], [F_TOOLS, tools]]) if (!s) { console.error(`✗ ${n} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }

const NO_FRONTIER = process.argv.includes('--inject-no-frontier')
const NO_THRESHOLD = process.argv.includes('--inject-no-threshold')
const ZERO_OK = process.argv.includes('--inject-zero-ok')
const TWO_CONST = process.argv.includes('--inject-two-constants')

// Compile the REAL resolver. coverage.ts imports supabase, so strip the module graph: the pure function is
// extracted by compiling with --noResolve and requiring only what it needs (no runtime import is executed
// because resolveDensity touches nothing outside itself).
let resolveDensity = null, THRESH = null
{
  const out = mkdtempSync(path.join(tmpdir(), 'loramer-density-'))
  const tmpSrc = path.join(out, 'density.ts')
  // Slice the pure region so the harness compiles the REAL code without its DB imports — the slice is taken
  // by MARKER, not by line number, so it cannot silently drift to a different function.
  const start = cov.indexOf('export const DENSITY_HOLE_RUN_DAYS')
  const end = cov.indexOf('// Data access for the above.')
  const types = `type BreakdownCoverageVerdict='COMPLETE'|'PARTIAL'|'UNKNOWN'\ntype BreakdownUnknownReason='not_connected'|'never_captured'|'no_activity_in_window'|'read_failed'\n`
  if (start < 0 || end < 0 || end <= start) { console.error('✗ could not slice the density region from coverage.ts — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }
  writeFileSync(tmpSrc, types + cov.slice(start, end))
  const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [tmpSrc, '--target', 'es2020', '--module', 'commonjs', '--outDir', out, '--skipLibCheck'], { encoding: 'utf8' })
  try {
    const M = createRequire(import.meta.url)(path.join(out, 'density.js'))
    resolveDensity = M.resolveDensity; THRESH = M.DENSITY_HOLE_RUN_DAYS
  } catch (e) { console.error(`✗ could not load the compiled resolver — BROKEN INSTRUMENT, not a pass: ${e.message}. tsc: ${String(r.stdout||'').slice(0,200)}`); process.exit(2) }
  if (typeof resolveDensity !== 'function') { console.error('✗ resolveDensity is not drivable — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }
}

const findings = []
const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10))

// ── (i) FRONTIER ────────────────────────────────────────────────────────────────────────────────────────
// ⛔ THE FIRST VERSION OF THIS LEG PROVED NOTHING AND I CAUGHT IT BY INJECTION: it used a 30-day window whose
// only absent day was today, which the RUN THRESHOLD already absorbs (a 1-day gap is under 7), so removing
// the frontier left the verdict COMPLETE and the leg stayed green. A leg that cannot fail is decoration.
// THE CASE WHERE THE FRONTIER ACTUALLY DECIDES is a window that ENDS TODAY and is SHORT — "how did we do
// today?" — where today is the whole window. Judged to the frontier there is nothing capture could hold yet
// (UNKNOWN, honest); judged to today it is an empty funded window and refuses as a hole.
{
  const v = resolveDensity({ platform: 'google', windowStart: '2026-08-14', windowEnd: '2026-08-14',
    frontier: NO_FRONTIER ? '2026-08-14' : '2026-08-13', presentDays: [], floor: '2022-01-01' })
  if (v.verdict === 'PARTIAL') findings.push(`(i) a window covering only TODAY came back PARTIAL. Capture is T+1, so today is never held — judged against today rather than the capturable frontier, "how did we do today" becomes a capture-hole refusal on every client, every day.`)
  if (!NO_FRONTIER && v.unknownReason !== 'no_activity_in_window') findings.push(`(i) a today-only window did not classify as 'no_activity_in_window' (got ${v.verdict}/${v.unknownReason}) — the reason must say nothing is held YET, not that measurement failed.`)
}

// ── (ii) RUN THRESHOLD ──────────────────────────────────────────────────────────────────────────────────
{
  const base = { platform: 'meta', windowStart: '2025-01-01', windowEnd: '2025-03-31', frontier: '2026-08-13', floor: '2024-01-01' }
  // 6-day gap → no-activity, stays COMPLETE (Shelley's 48 single-day no-order gaps are this case).
  const shortGap = [...days('2025-01-01', 40), ...days('2025-02-16', 44)]
  const vs = resolveDensity({ ...base, presentDays: shortGap, runThresholdDays: NO_THRESHOLD ? 1 : undefined })
  if (vs.verdict !== 'COMPLETE') findings.push(`(ii) a ${vs.longestMissingRun}-day gap (under the ${THRESH}-day threshold) came back ${vs.verdict}. Short gaps are NO-ACTIVITY days — the writers omit them by design — and refusing them slanders a store that simply had no orders. FALSE-PARTIAL.`)
  // A run at/over the threshold → hole, PARTIAL.
  const longGap = [...days('2025-01-01', 20), ...days('2025-02-05', 55)]
  const vl = resolveDensity({ ...base, presentDays: longGap })
  if (vl.verdict !== 'PARTIAL') findings.push(`(ii) a ${vl.longestMissingRun}-day missing run came back ${vl.verdict}, not PARTIAL. Runs of ${THRESH}+ days are the measured capture-hole cluster (all four are Meta token-cliff outages: 57 / 36 / 31 / 13 days).`)
  if (vl.verdict === 'PARTIAL' && vl.holeRuns.length === 0) findings.push(`(ii) a PARTIAL density verdict names no holeRuns — the reader gets a refusal with no gap to name, which is a caveat nobody can act on.`)
}

// ── (iii) ZERO-DAYS-BELOW-FLOOR ─────────────────────────────────────────────────────────────────────────
{
  const v = resolveDensity({ platform: 'google', windowStart: '2025-01-01', windowEnd: '2025-12-31',
    frontier: '2026-08-13', presentDays: ZERO_OK ? days('2025-01-01', 365) : [], floor: '2019-12-18' })
  if (v.verdict !== 'PARTIAL') findings.push(`(iii) a window holding ZERO days while capture reaches back to 2019 came back ${v.verdict}. Measured live: BusyBee google and Influential Drones google each hold 0 of 365 days of 2025 with floors in 2019/2018 — the floor test calls that "covered", and it is the starkest hole there is.`)
  // A floor INSIDE the window is a floor fact, not a density hole — it must not be double-reported.
  const vf = resolveDensity({ platform: 'google', windowStart: '2025-01-01', windowEnd: '2025-12-31', frontier: '2026-08-13', presentDays: [], floor: '2026-02-01' })
  if (vf.verdict !== 'UNKNOWN') findings.push(`(iii) an empty window whose capture floor POSTDATES it came back ${vf.verdict}, not UNKNOWN. That is a floor fact the floor test already reports; density claiming it too double-caveats the same absence.`)
}

// ── (iv) ONE CONSTANT, WITH ITS REASONING, WIRED ────────────────────────────────────────────────────────
{
  const defs = (cov.match(/DENSITY_HOLE_RUN_DAYS\s*=/g) || []).length + (TWO_CONST ? 1 : 0)
  if (defs !== 1) findings.push(`(iv) DENSITY_HOLE_RUN_DAYS is defined ${defs} time(s). The threshold is CALIBRATED, not derived — a second definition is how two coverage dialects begin, and neither would carry the calibration.`)
  const region = cov.slice(Math.max(0, cov.indexOf('export const DENSITY_HOLE_RUN_DAYS') - 2600), cov.indexOf('export const DENSITY_HOLE_RUN_DAYS'))
  for (const [re, what] of [[/BIMODAL/i, 'the measured bimodal distribution'], [/OVER-REFUSE/i, 'the over-refusal failure direction'], [/UNDER-REFUSE/i, 'the under-refusal failure direction'], [/attestedEmptyDays/, 'the pointer to the only true fix']]) {
    if (!re.test(region)) findings.push(`(iv) the constant's definition no longer carries ${what}. A calibrated number without its calibration reads as a derived one, and the next reader tunes it instead of replacing it.`)
  }
  if (!/getDensityForWindow\(ctx\.clientId, p, w, frontier\)/.test(tools)) findings.push(`(iv) ${F_TOOLS}: the density leg is not wired into the binding path — the resolver would exist and change nothing, which is the state BINDING_COVERAGE shipped in.`)
  if (!/d\.verdict === 'PARTIAL'\)\) comp\.completePerWindow\[i\] = false/.test(tools)) findings.push(`(iv) ${F_TOOLS}: a PARTIAL density verdict no longer downgrades the window, so the binding never sees it.`)
}

for (const [flag, note] of [
  [NO_FRONTIER, '[--inject-no-frontier] judged the window against today instead of the frontier'],
  [NO_THRESHOLD, '[--inject-no-threshold] set the run threshold to 1 day'],
  [ZERO_OK, '[--inject-zero-ok] filled the empty-year window'],
  [TWO_CONST, '[--inject-two-constants] simulated a second threshold definition'],
]) if (flag) console.log(`  ${note} — it must go RED.`)

console.log(`[coverage-density] threshold=${THRESH}d · (i) frontier · (ii) run split · (iii) zero-days-below-floor · (iv) one constant with its calibration, wired`)
console.log('[coverage-density] (i)-(iii) drive the REAL compiled resolver; (iv) static. Proves the SHAPE — NOT that 7 is the right number (calibrated on one fleet, both failure directions live).')
if (findings.length) { console.error(`✗ coverage-density FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  - ${f}`); process.exit(1) }
console.log('✓ coverage-density OK — the frontier protects recent windows, runs split at the calibrated threshold, an empty funded window is a hole, and the constant carries its own reasoning.')
process.exit(0)
