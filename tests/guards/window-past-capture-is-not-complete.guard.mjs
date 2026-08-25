#!/usr/bin/env node
// LORAMER_WINDOW_PAST_CAPTURE_V1 — A WINDOW THAT RUNS PAST WHAT WE CAPTURED MAY NEVER READ 'covered'.
//
// ⛔ THE DEFECT, found 2026-08-24 by reading date-range.ts against coverage.ts. TWO presets are TO-DATE:
// THIS_MONTH (date-range.ts:81-84) and THIS_WEEK (:92-97) both end at TODAY. The warehouse's newest
// Google day is YESTERDAY — forward capture writes yesterday, and there were ZERO google rows for today
// when this was measured. resolveCoverageState tests only `win.startDate > maxDate` (whole window past
// capture ⇒ trailing_gap) and `win.endDate < minDate` (whole window before ⇒ predates_capture). There is
// NO branch for a window whose TAIL runs past maxDate, so it falls through to `covered` — and Lora is
// told COMPLETE for a figure that is silently missing today.
//
// ⛔ WHY NOT JUST CLAMP THE QUERY TO capturedThrough: clamping answers a DIFFERENT QUESTION than the one
// asked and reports the shorter window as whole. The missing day disappears instead of being named. The
// state has to be nameable so she must say it.
//
// ⚠ NOT the same thing as `stale_tail`, which already exists and must keep its own cases: stale_tail asks
// "is CAPTURE BEHIND the frontier?" and deliberately clamps its comparison end to the frontier
// (query-completeness.ts:89-90) precisely so a healthy client at the frontier does not false-alarm
// nightly. This asks a different question — "does the WINDOW REACH PAST what we hold?" — and that is why
// the new branch must sit AFTER stale_tail in the contribution chain, never instead of it.
//
// BEHAVIOURAL: this drives the REAL transpiled resolveCoverageState, it does not read the source for a
// shape. A guard that greps for an `if` proves nothing about what the function returns.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SRC = 'src/lib/next/coverage.ts'
const CONTRACT = 'src/lib/next/query-completeness.ts'
const findings = []
const die = (m) => { console.error(`[window-past-capture] CANNOT RUN — ${m}`); process.exit(1) }

if (!existsSync(resolve(ROOT, SRC))) die(`${SRC} is missing`)

// ── transpile + drive the real function, stubbing only its leaf imports ─────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-window-past-capture-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs',
  '--moduleResolution', 'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); die(`could not run tsc — ${r.error.message}`) }

const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = new Proxy({}, { get: () => (() => {}) })')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) return stub
  return origResolve.call(this, request, ...rest)
}
let mod
try { mod = createRequire(import.meta.url)(join(out, 'src/lib/next/coverage.js')) }
catch (e) { Module._resolveFilename = origResolve; rmSync(out, { recursive: true, force: true }); die(`compiled coverage did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })

const fn = mod.resolveCoverageState
if (typeof fn !== 'function') die(`${SRC} does not export resolveCoverageState()`)

// step shape: cursorComplete gates floorConfirmed; status only matters for the empty-capture branches.
const STEP = { cursorComplete: true, status: 'OK' }
const call = (min, max, start, end) => fn(STEP, min, max, { startDate: start, endDate: end })

// ── (a) THE DEFECT ITSELF — a to-date window whose tail runs past captured-through ──────────────────
const cases = [
  { name: 'THIS_MONTH shape: window ends today, capture settled through yesterday',
    min: '2026-01-01', max: '2026-08-23', start: '2026-08-01', end: '2026-08-24' },
  { name: 'THIS_WEEK shape: Monday..today against yesterday capture',
    min: '2026-01-01', max: '2026-08-23', start: '2026-08-18', end: '2026-08-24' },
  { name: 'custom range ending today',
    min: '2024-05-05', max: '2026-08-23', start: '2026-06-01', end: '2026-08-24' },
  { name: 'window tail past a BADLY behind capture',
    min: '2024-05-05', max: '2026-08-10', start: '2026-08-01', end: '2026-08-23' },
]
for (const c of cases) {
  const got = call(c.min, c.max, c.start, c.end)
  if (got.state === 'covered' || got.coversWindow === true) {
    findings.push(`${c.name}\n      window ${c.start}..${c.end} against captured-through ${c.max}\n      got state='${got.state}' coversWindow=${got.coversWindow} — a window reaching ${c.end} cannot be covered by data ending ${c.max}`)
  } else if (got.state !== 'extends_past_capture') {
    findings.push(`${c.name}\n      expected state='extends_past_capture', got '${got.state}'`)
  } else {
    // the state must CARRY THE NUMBERS, not merely flag
    if (got.uncoveredFrom !== nextDay(c.max) || got.uncoveredTo !== c.end) {
      findings.push(`${c.name}\n      state is right but carries no usable span: uncoveredFrom=${got.uncoveredFrom} uncoveredTo=${got.uncoveredTo} (expected ${nextDay(c.max)}..${c.end}). Lora must be able to STATE how much is missing, not just that something is.`)
    }
  }
}

// ── (b) NO FALSE POSITIVES — settled windows must still read covered ────────────────────────────────
const settled = [
  { name: 'LAST_30_DAYS shape: window ends exactly at captured-through', min: '2026-01-01', max: '2026-08-23', start: '2026-07-25', end: '2026-08-23' },
  { name: 'fully historical window well inside capture', min: '2024-01-01', max: '2026-08-23', start: '2025-03-01', end: '2025-03-31' },
]
for (const c of settled) {
  const got = call(c.min, c.max, c.start, c.end)
  if (got.state !== 'covered' || got.coversWindow !== true) {
    findings.push(`FALSE POSITIVE — ${c.name}\n      window ${c.start}..${c.end} against captured-through ${c.max} got state='${got.state}' coversWindow=${got.coversWindow}, expected covered`)
  }
}

// ── (c) THE EXISTING STATES MUST NOT MOVE ───────────────────────────────────────────────────────────
const unchanged = [
  { name: 'whole window past capture stays trailing_gap', min: '2026-01-01', max: '2026-08-23', start: '2026-08-24', end: '2026-08-30', want: 'trailing_gap' },
  { name: 'whole window before capture stays predates_capture', min: '2026-01-01', max: '2026-08-23', start: '2025-01-01', end: '2025-06-30', want: 'predates_capture' },
]
for (const c of unchanged) {
  const got = call(c.min, c.max, c.start, c.end)
  if (got.state !== c.want) findings.push(`REGRESSION — ${c.name}: got '${got.state}', expected '${c.want}'`)
}

// ── (d) THE CONTRACT — the status must exist, be INCOMPLETE, and be reachable ───────────────────────
const contract = existsSync(resolve(ROOT, CONTRACT)) ? readFileSync(resolve(ROOT, CONTRACT), 'utf8') : ''
const code = contract.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
if (!/'extends_past_capture'/.test(code)) findings.push(`${CONTRACT} has no 'extends_past_capture' ContributionStatus — the classifier can name the state but the contract Lora reads cannot carry it`)
if (!/INCOMPLETE[^\n]*extends_past_capture|extends_past_capture[^\n]*\]\)/.test(code.replace(/\s+/g, ' '))) {
  const m = /const INCOMPLETE[^\n]*\n?[^\n]*/.exec(code)
  if (!m || !m[0].includes('extends_past_capture')) findings.push(`${CONTRACT}: 'extends_past_capture' is not in the INCOMPLETE set — a window missing today would still be verdicted COMPLETE`)
}
if (!/c\.state === 'extends_past_capture'/.test(code)) findings.push(`${CONTRACT}: no branch maps coverage.state 'extends_past_capture' onto a contribution — the state would be computed and dropped`)

function nextDay(iso) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

if (findings.length === 0) {
  console.log('window-past-capture: PASSED — a window reaching past captured-through is named, carries its uncovered span, counts as INCOMPLETE, and settled windows still read covered.')
  process.exit(0)
}
console.error(`window-past-capture: FAILED — ${findings.length} finding(s)\n`)
for (const f of findings) console.error(`  ✗ ${f}\n`)
process.exit(1)
