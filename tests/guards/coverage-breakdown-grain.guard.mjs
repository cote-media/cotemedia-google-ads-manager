#!/usr/bin/env node
// LORAMER_COVERAGE_BREAKDOWN_GRAIN_V1 — guard the coverage claim that could not see a 30-month hole.
//
// THE DEFECT, MEASURED. coverage.ts `minMaxFor` reads the account BASE triple only, and `resolveCoverageState`
// then compares the window against TWO ENDPOINTS. Foam OH GA on 2026-07-30: base min 2022-02-02, base max
// 2026-07-29, so a question about 2023-07-01..2025-12-31 returned state 'covered' — while that window held ZERO
// dimensional rows across all 12 families. 915 days. Fleet-wide, 1,223 days were recovered that day and not one
// of them would have moved `coversWindow`, because every one was a breakdown row.
//
// WHAT THIS PROVES, driving the REAL transpiled resolvers — not a grep, not a re-implementation:
//   (i)   THE FOAM OH FIXTURE. 915 base-active days, zero breakdown days → PARTIAL with all 915 named.
//         Pre-fix there was no function that could return anything but 'covered' here; that is the red below.
//   (ii)  A window with base activity and zero breakdown rows can NEVER report COMPLETE. The headline rule.
//   (iii) INTERIOR HOLES. The Influential Drones shape — endpoints look continuous, two days missing inside.
//         min/max arithmetic cannot see this; the LEFT JOIN does. Both days must be named.
//   (iv)  UNKNOWN NEVER DEGRADES TO COMPLETE. An unreadable instrument (null sets) and a no-denominator window
//         both answer UNKNOWN, mirroring google-quota-store's 'blocked'|'not_blocked'|'unknown' rather than
//         inventing a fourth vocabulary.
//   (v)   BASE GRAIN IS UNTOUCHED. resolveCoverageState must still behave exactly as before — this flight adds a
//         second grain, it does not modify the first. A regression here would silently change Lora's caveats.
//   (vi)  SOURCE PIN: the completeness claim may not be emitted from base-grain rows alone. getBreakdownCoverage
//         must fall back to UNKNOWN — never COMPLETE — when its read fails.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const fail = (m) => { console.error(`[coverage-breakdown-grain] FAIL — ${m}`); process.exit(1) }
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }

const SRC = 'src/lib/next/coverage.ts'
if (!existsSync(resolve(ROOT, SRC))) fail(`${SRC} is missing.`)

const out = mkdtempSync(join(tmpdir(), 'loramer-covgrain-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

const stub = join(out, '__stub.js')
writeFileSync(stub, `module.exports = {
  supabaseAdmin: { rpc: async () => ({ data: null, error: new Error('rpc absent') }) },
  reconcile: () => [null],
  isConnectedForCoverage: () => true,
}\n`)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) { return req.startsWith('@/lib/') ? stub : origResolve.call(this, req, ...rest) }
const mod = require(join(out, 'src/lib/next/coverage.js'))
Module._resolveFilename = origResolve

for (const n of ['resolveBreakdownCoverage', 'getBreakdownCoverage', 'resolveCoverageState']) {
  if (typeof mod[n] !== 'function') fail(`${SRC} does not export ${n} — breakdown-grain completeness does not exist, so a coverage claim is still base-grain only.`)
}
const { resolveBreakdownCoverage, getBreakdownCoverage, resolveCoverageState } = mod

const days = (from, n) => {
  const o = []; const d = new Date(from + 'T00:00:00Z')
  for (let i = 0; i < n; i++) { o.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return o
}

// ── (i) + (ii) THE FOAM OH FIXTURE, pre-recovery: 915 base-active days, zero breakdown rows ─────────────────
{
  const base = days('2023-07-01', 915)
  const v = resolveBreakdownCoverage('ga', base, [])
  check(v.verdict !== 'COMPLETE',
    `(ii) a window with 915 base-active days and ZERO breakdown rows reported ${v.verdict}. This is the Foam OH shape that read 'covered' for 30 months.`)
  check(v.verdict === 'PARTIAL', `(i) expected PARTIAL for the Foam OH fixture, got ${v.verdict}.`)
  check(v.holeDays.length === 915, `(i) expected all 915 base-active days named as holes, got ${v.holeDays.length}.`)
  check(v.holeDays[0] === '2023-07-01' && v.holeDays[914] === '2025-12-31',
    `(i) hole range wrong: ${v.holeDays[0]}..${v.holeDays[v.holeDays.length - 1]} — expected 2023-07-01..2025-12-31.`)
}

// ── (iii) INTERIOR HOLES — the Drones shape. Endpoints continuous, two days missing inside. ─────────────────
{
  const base = days('2026-07-10', 12) // 2026-07-10 .. 2026-07-21
  const dims = base.filter((d) => d !== '2026-07-14' && d !== '2026-07-16')
  const v = resolveBreakdownCoverage('ga', base, dims)
  check(v.verdict === 'PARTIAL', `(iii) two interior holes reported ${v.verdict}, expected PARTIAL. min/max would call this continuous.`)
  check(JSON.stringify(v.holeDays) === JSON.stringify(['2026-07-14', '2026-07-16']),
    `(iii) interior holes not named correctly: ${JSON.stringify(v.holeDays)}.`)
}

// ── COMPLETE must still be reachable, or the verdict is useless ─────────────────────────────────────────────
{
  const base = days('2026-01-01', 30)
  const v = resolveBreakdownCoverage('ga', base, base.slice())
  check(v.verdict === 'COMPLETE', `POSITIVE CONTROL: a fully covered window reported ${v.verdict} — the verdict can never say COMPLETE, so it says nothing.`)
  check(v.holeDays.length === 0, `POSITIVE CONTROL: a fully covered window named ${v.holeDays.length} holes.`)
}

// ── (iv) UNKNOWN NEVER DEGRADES TO COMPLETE ─────────────────────────────────────────────────────────────────
{
  const unread = resolveBreakdownCoverage('ga', null, null)
  check(unread.verdict === 'UNKNOWN', `(iv) an unreadable measurement reported ${unread.verdict}, expected UNKNOWN.`)
  check(unread.verdict !== 'COMPLETE', `(iv) an unreadable measurement reported COMPLETE — an unreadable instrument must never be a clean bill of health.`)
  const nodenom = resolveBreakdownCoverage('ga', [], ['2026-01-01'])
  check(nodenom.verdict === 'UNKNOWN', `(iv) a window with no base activity reported ${nodenom.verdict}, expected UNKNOWN (no denominator).`)
  const half = resolveBreakdownCoverage('ga', days('2026-01-01', 5), null)
  check(half.verdict === 'UNKNOWN', `(iv) a half-failed read reported ${half.verdict}, expected UNKNOWN.`)
}

// ── (vi) the RPC-absent path must answer UNKNOWN, not COMPLETE (stub rpc returns an error) ───────────────────
{
  const v = await getBreakdownCoverage('c', 'ga', { startDate: '2023-07-01', endDate: '2025-12-31' })
  check(v.verdict === 'UNKNOWN', `(vi) with the RPC absent, getBreakdownCoverage returned ${v.verdict} — the fallback MUST be UNKNOWN so an unwired instrument cannot certify a window.`)
}

// ── (v) BASE GRAIN UNTOUCHED — resolveCoverageState must behave exactly as before ───────────────────────────
{
  const covered = resolveCoverageState({ cursorComplete: true, status: 'OK' }, '2022-02-02', '2026-07-29', { startDate: '2023-07-01', endDate: '2025-12-31' })
  check(covered.state === 'covered' && covered.coversWindow === true,
    `(v) base-grain behaviour CHANGED: expected state 'covered' for a window inside [min,max], got '${covered.state}'. This flight must add a grain, not modify one.`)
  const trailing = resolveCoverageState({ cursorComplete: true, status: 'OK' }, '2022-02-02', '2026-07-29', { startDate: '2026-08-01', endDate: '2026-08-10' })
  check(trailing.state === 'trailing_gap', `(v) base-grain trailing_gap regressed: got '${trailing.state}'.`)
  const predates = resolveCoverageState({ cursorComplete: true, status: 'OK' }, '2022-02-02', '2026-07-29', { startDate: '2021-01-01', endDate: '2021-02-01' })
  check(predates.state === 'predates_capture', `(v) base-grain predates_capture regressed: got '${predates.state}'.`)
}

// ── SOURCE PINS ─────────────────────────────────────────────────────────────────────────────────────────────
const src = readFileSync(resolve(ROOT, SRC), 'utf8')
check(/entity_level', 'account'\)\.eq\('breakdown_type', ''\)/.test(src),
  `SOURCE PIN: minMaxFor's account triple was altered. It is load-bearing for the migration-035 partial index and base grain must stay as-is.`)
check(/BreakdownCoverageVerdict\s*=\s*'COMPLETE'\s*\|\s*'PARTIAL'\s*\|\s*'UNKNOWN'/.test(src),
  `SOURCE PIN: the three-state verdict is not COMPLETE|PARTIAL|UNKNOWN — do not invent a fourth vocabulary.`)

rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`[coverage-breakdown-grain] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[coverage-breakdown-grain] PASS — base+zero-breakdown is PARTIAL with every day named, interior holes are found by set-difference, UNKNOWN never degrades to COMPLETE, and base-grain behaviour is byte-for-byte unchanged.')
