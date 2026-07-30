#!/usr/bin/env node
// LORAMER_RANGELAP_COMPLETION_HONESTY_V1 — guard the two booleans in the WIDEST instance of the class.
//
// rangeLap (drain-registry.ts) serves 22 of the 34 drain steps and wrote ALL 43 google completion-claim
// violations. It carried BOTH defects fixed in ga-dimensional-backfill.ts tonight: completion from window
// position (94a627d) and the zero-work seal (30172c2). This drives the REAL exported decisions, transpiled with
// the installed tsc, plus a SOURCE assertion — because the pre-fix zero-work branch never CALLED a decision
// function, so a re-inlined version would pass every behavioural case by simply not being reached.
//
// ⚠ WHAT THIS DELIBERATELY DOES **NOT** ASSERT, stated so a green run is never over-read: it does not assert that
// reaching the floor with zero rows BLOCKS completion. It cannot, because that rule infinite-loops against the
// restart (see decideRangeLapCompletion's header: empty floor window -> no seal -> anomalous cursor -> restart ->
// repeat, forever, against a 15k/day GAQL cap). What it asserts instead is that the zero-row case is DETECTED and
// reported as rowsCovered=false, which is what LORAMER_COMPLETION_CLAIM_GATE_V1 fails on in check:data.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[rangelap-completion-honesty] FAIL — ${m}`); process.exit(1) }

const SRC = 'src/lib/backfill/drain-registry.ts'
if (!existsSync(resolve(ROOT, SRC))) fail(`${SRC} is missing.`)

const out = mkdtempSync(join(tmpdir(), 'loramer-rangelap-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

// drain-registry imports the whole backfill writer tree at module scope. The two decisions touch NONE of it, but
// the requires would pull in supabase/tokens, so every alias is stubbed. Stubbing is confined to state that cannot
// exist without a DB or a vendor token — the DECISIONS are the real compiled functions.
const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = new Proxy({ supabaseAdmin: {} }, { get: (t, k) => k in t ? t[k] : (() => {}) })\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) {
    if (!request.includes('drain-registry')) return stub
  }
  return origResolve.call(this, request, ...rest)
}

const req = createRequire(import.meta.url)
let mod
try { mod = req(join(out, 'src/lib/backfill/drain-registry.js')) }
catch (e) { rmSync(out, { recursive: true, force: true }); fail(`compiled module did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
rmSync(out, { recursive: true, force: true })

for (const fn of ['decideRangeLapCompletion', 'resolveRangeLapWindowEnd']) {
  if (typeof mod[fn] !== 'function') {
    findings.push(`${SRC} does not export ${fn} — the decision is inlined again, which is why these two booleans went untested while they wrote 43 false claims.`)
  }
}

const FLOOR = '2023-07-30'
const YDAY = '2026-07-29'

if (typeof mod.decideRangeLapCompletion === 'function') {
  const d = mod.decideRangeLapCompletion
  const CASES = [
    { name: 'reached floor WITH rows -> complete, rowsCovered',
      args: { subStart: FLOOR, floor: FLOOR, status: 200, written: 4210, emptyDeclared: false },
      want: { complete: true, rowsCovered: true },
      why: 'The ordinary success. Completion must stay REACHABLE or every rangeLap family walks forever.' },
    { name: 'reached floor with ZERO rows -> complete stays position-based BUT rowsCovered is FALSE',
      args: { subStart: FLOOR, floor: FLOOR, status: 200, written: 0, emptyDeclared: false },
      want: { complete: true, rowsCovered: false },
      why: 'THE 43-VIOLATION CASE. rowsCovered=false is the signal the completion-claim gate fails on. complete is deliberately NOT blocked here — that rule infinite-loops against the restart; see the decision function header.' },
    { name: 'reached floor, zero rows, writer DECLARED empty as honest -> rowsCovered TRUE',
      args: { subStart: FLOOR, floor: FLOOR, status: 200, written: 0, emptyDeclared: true },
      want: { complete: true, rowsCovered: true },
      why: 'The meta-simple writers return emptyMeans exactly when zero is the honest answer (no catalog, no video ads). Flagging those would be crying wolf on 22 families.' },
    { name: 'writer reported NO row count -> rowsCovered TRUE (unknown is not zero)',
      args: { subStart: FLOOR, floor: FLOOR, status: 200, written: null, emptyDeclared: false },
      want: { complete: true, rowsCovered: true },
      why: 'A writer that reports no count must never be read as "wrote nothing" — that would manufacture violations from a missing field.' },
    { name: 'normal mid-walk -> not complete',
      args: { subStart: '2025-01-01', floor: FLOOR, status: 200, written: 900, emptyDeclared: false },
      want: { complete: false, rowsCovered: true },
      why: 'Short of the floor: more walking to do. The ordinary path must be untouched.' },
    { name: 'non-200 at the floor -> not complete',
      args: { subStart: FLOOR, floor: FLOOR, status: 500, written: 0, emptyDeclared: false },
      want: { complete: false, rowsCovered: false },
      why: 'A failed writer must never seal. (rangeLap also returns early on non-200; asserted here so a refactor cannot drop it.)' },
  ]
  for (const c of CASES) {
    let got
    try { got = d(c.args) } catch (e) { findings.push(`${c.name}: threw — ${e.message}`); continue }
    if (got?.complete !== c.want.complete || got?.rowsCovered !== c.want.rowsCovered) {
      findings.push(`${c.name}: expected complete=${c.want.complete}/rowsCovered=${c.want.rowsCovered}, got complete=${got?.complete}/rowsCovered=${got?.rowsCovered}. ${c.why}`)
    }
  }
}

if (typeof mod.resolveRangeLapWindowEnd === 'function') {
  const w = mod.resolveRangeLapWindowEnd
  const WCASES = [
    { name: 'never walked (null cursor) -> yesterday', got: () => w(null, YDAY, FLOOR), want: YDAY,
      why: 'Pre-existing behaviour, pinned so the fix cannot change it.' },
    { name: 'ZERO-WORK: cursor AT the floor -> RESTART at yesterday, never seal', got: () => w(FLOOR, YDAY, FLOOR), want: YDAY,
      why: 'Pre-fix this branch called writeRangeCursor(floor, TRUE) with no writer call at all — completion asserted for zero work, and reachable only when complete=false, so the state is anomalous by construction.' },
    { name: 'cursor BELOW the floor -> RESTART', got: () => w('2020-01-01', YDAY, FLOOR), want: YDAY,
      why: 'Same branch, deeper value.' },
    { name: 'normal resume -> the day before the cursor', got: () => w('2025-06-01', YDAY, FLOOR), want: '2025-05-31',
      why: 'The ordinary resume must be byte-identical or every healthy walk restarts from scratch.' },
  ]
  for (const c of WCASES) {
    let got
    try { got = c.got() } catch (e) { findings.push(`${c.name}: threw — ${e.message}`); continue }
    if (got !== c.want) findings.push(`${c.name}: expected ${c.want}, got ${got}. ${c.why}`)
  }
}

// SOURCE ASSERTION — the literal zero-work seal must not exist. Comment lines are stripped first: QUOTATION IS NOT
// ASSERTION, which has now bitten twice tonight (the canonical-identity guard and the ga-dim source check), and the
// module's own header quotes the defective line to teach the rule.
const src = readFileSync(resolve(ROOT, SRC), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
if (/writeRangeCursor\([^)]*floor\s*,\s*true\s*\)/.test(src)) {
  findings.push(`${SRC} still contains writeRangeCursor(..., floor, true) — the zero-work seal. That call marks a cursor complete having called no writer and persisted no rows.`)
}

console.log(`[rangelap-completion-honesty] drove the real rangeLap decisions (completion + window) plus the source check`)
if (findings.length) {
  console.error(`[rangelap-completion-honesty] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('  COMPLETION IS A CLAIM ABOUT WHAT WAS WRITTEN, NEVER ABOUT HOW FAR THE WALK GOT.')
  process.exit(1)
}
console.log('[rangelap-completion-honesty] OK')
