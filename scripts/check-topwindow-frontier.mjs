#!/usr/bin/env node
// LORAMER_TOPWINDOW_FRONTIER_PROOF_V1 — ONE SURFACE, ONE DATA POINT, RED FIRST.
//
// ⛔ WHAT THIS PROVES, AND IT IS DELIBERATELY NARROW: that ONE Foam OH surface —
// `campaign_search_term_view / segments.device`, top window 2026-03-09..2026-04-07 — is STUCK, and that the
// thing making it stuck is `coveredDaysStrict` stripping the newest day-with-rows while its `dayCommitted`
// escape hatch is never fed. Not the engine. Not the fleet. One surface.
//
// ⛔ IT DRIVES THE REAL PREDICATE AGAINST THE REAL DATABASE. `windowCoverage` / `rangesStillOwed` /
// `decideRepublish` are the SHIPPED functions, compiled from src/ by tsc into a temp dir and required here.
// The rows come from live `metrics_daily` and live `universe_attempt_log`.
// ⛔ IT NEVER HAND-FEEDS `dayCommitted`. That is the whole point (LORAMER_REAL_INPUT_GATE_A_V1: a Gate-A that
// hand-supplies the input which makes the flag fire is a REHEARSAL, not a proof). The test calls
// windowCoverage — the real entry — and lets the module decide for itself whether to consult the commit
// records. On today's code it does not, and A1 goes RED. After the fix it does, from the SAME real rows.
//
// ⛔ NO VENDOR REQUEST. NO WRITE. Two indexed reads per day of the window plus one attempt-log read.
//
// USAGE:  node scripts/check-topwindow-frontier.mjs
// EXIT:   0 all green · 1 one or more assertions RED · 2 CANNOT RUN (precondition absent / harness broken)

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// ── THE SINGLE DATA POINT, NAMED ONCE ───────────────────────────────────────────────────────────────────
const CLIENT_ID = '957d484e-d0c4-4dd0-b382-d8499d556252'   // Foam OH
const VENDOR = 'google'
const RESOURCE = 'campaign_search_term_view'
const SEGMENT = 'segments.device'
const BREAKDOWN = 'device'                                  // breakdownTypeForSurface(RESOURCE, SEGMENT)
const WIN_START = '2026-03-09'
const WIN_END = '2026-04-07'
const STUCK_DAY = '2026-04-05'                              // newest day-with-rows in the window; the stripped one
const STUCK_RANGE = { start: '2026-04-05', end: '2026-04-07' }

const results = []
const ok = (id, what) => results.push({ id, pass: true, what })
const red = (id, what, why) => results.push({ id, pass: false, what, why })

// ── ENV ─────────────────────────────────────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const p = join(ROOT, '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
}
loadEnvLocal()

// ⛔ REALTIME-ONLY SHIM, AND IT MUST NOT BE READ AS STUBBING THE DATABASE. supabase-js validates a native
// WebSocket AT CONSTRUCTION for its Realtime client; Node 20 has none, so `createClient` throws before a
// single query runs — a CANNOT-RUN wearing the costume of a harness bug (measured 2026-08-17: local Node
// 20.20.2, Vercel runs 24.x, so the local machine is the outlier and check:data spawns with process.execPath).
// This satisfies that constructor and NOTHING ELSE: the class throws if anyone ever opens it, and this check
// never subscribes. **THE QUERY PATH IS THE REAL supabase-js PostgREST CLIENT AGAINST THE LIVE DATABASE.**
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() { throw new Error('[topwindow-frontier] Realtime is never used by this check; the shim exists only so createClient() can construct on Node < 22.') }
  }
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) {
  console.error('[topwindow-frontier] CANNOT RUN — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absent (.env.local).')
  console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · env missing')
  process.exit(2)
}

// ── COMPILE THE REAL MODULES (the universe-stream-consumer.guard harness, same shape) ────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-topwindow-'))
const origResolve = Module._resolveFilename
let restored = false
const cleanup = () => { if (!restored) { Module._resolveFilename = origResolve; restored = true } rmSync(out, { recursive: true, force: true }) }

const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const RESUMER = 'src/lib/backfill/universe-resumer.ts'

let cov, resumer, sb
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [
    resolve(ROOT, COVERAGE), resolve(ROOT, SURFACES), resolve(ROOT, RESUMER),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)

  // ⛔ THE SUPABASE SHIM IS A REAL CLIENT, NOT A STUB. Stubbing it here would make this test measure its own
  // fixture — the exact failure universe-stream-consumer.guard documents at its resolver hook. The module
  // under test must issue its OWN queries against the live warehouse.
  const { createClient } = createRequire(import.meta.url)('@supabase/supabase-js')
  sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  const shim = join(out, '__supabase.js')
  writeFileSync(shim, 'module.exports = { supabaseAdmin: global.__LORAMER_SB__, supabase: global.__LORAMER_SB__ }')
  global.__LORAMER_SB__ = sb

  const surfacesJs = join(out, 'src/lib/backfill/universe-surfaces.js')
  Module._resolveFilename = function (request, ...rest) {
    if (/universe-surfaces$/.test(request)) return surfacesJs          // REAL alias map + segment mapping
    if (/@\/lib\/supabase$/.test(request)) return shim                 // REAL client
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  cov = req(join(out, 'src/lib/backfill/universe-coverage.js'))
  resumer = req(join(out, 'src/lib/backfill/universe-resumer.js'))
} catch (e) {
  cleanup()
  console.error(`[topwindow-frontier] CANNOT RUN — harness failed: ${e.message}`)
  console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · harness')
  process.exit(2)
}

const KEY = { clientId: CLIENT_ID, platform: VENDOR, entityLevel: RESOURCE, breakdownType: BREAKDOWN }

try {
  // ── A0 · PRECONDITION — THE COMMIT RECORD MUST ACTUALLY EXIST ────────────────────────────────────────
  // ⛔ WITHOUT THIS THE TEST MEASURES NOTHING. If no day_committed row exists for the stripped day, then a
  // fix that consults commit records cannot move this surface and a RED below would be red for the wrong
  // reason. This is a CANNOT-RUN, never a pass and never a fail.
  const { data: commits, error: cErr } = await sb.from('universe_attempt_log')
    .select('attempt_no, rows_written, recorded_at')
    .eq('client_id', CLIENT_ID).eq('vendor', VENDOR).eq('resource', RESOURCE).eq('segment', SEGMENT)
    .eq('phase', 'day_committed').eq('day', STUCK_DAY)
  if (cErr) throw new Error(`precondition read failed: ${cErr.message}`)
  if (!commits || commits.length === 0) {
    cleanup()
    console.error(`[topwindow-frontier] CANNOT RUN — no day_committed record exists for ${RESOURCE}/${SEGMENT} on ${STUCK_DAY}.`)
    console.error('  The proof depends on a REAL commit record. Without one the fix has nothing to read and this test proves nothing.')
    console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · precondition absent')
    process.exit(2)
  }
  console.log(`[topwindow-frontier] PRECONDITION OK — ${commits.length} real day_committed record(s) for ${STUCK_DAY} ` +
    `(attempt_no ${commits.map((c) => c.attempt_no).join(', ')}; ${commits.map((c) => c.rows_written).join('/')} rows each).`)

  // ── DRIVE THE REAL PREDICATE. NO SYNTHETIC INPUT. ───────────────────────────────────────────────────
  const owed = await cov.rangesStillOwed(KEY, WIN_START, WIN_END)
  const c = owed.coverage
  console.log(`[topwindow-frontier] REAL windowCoverage ${RESOURCE}/${SEGMENT} ${WIN_START}..${WIN_END}: ` +
    `${c.covered.length} covered · ${c.attestedEmpty.length} attested-empty · ${c.uncovered.length} owed ` +
    `in ${owed.ranges.length} range(s) · ${c.probes} probes / ${c.ms}ms`)
  console.log(`[topwindow-frontier] owed ranges: ${JSON.stringify(owed.ranges)}`)

  // ── A1 · THE COMMITTED DAY MUST COUNT AS COVERED ────────────────────────────────────────────────────
  if (c.covered.includes(STUCK_DAY)) {
    ok('A1', `${STUCK_DAY} is COVERED — the commit record was consulted.`)
  } else {
    red('A1', `${STUCK_DAY} must be COVERED once it has been committed.`,
      `windowCoverage returned it as ${c.uncovered.includes(STUCK_DAY) ? 'UNCOVERED' : 'attested-empty/absent'}. ` +
      `coveredDaysStrict strips the NEWEST day-with-rows unless opts.dayCommitted names it, and universe-coverage.ts:149 ` +
      `calls it with no second argument, so opts={} on every walk read. ${commits.length} real commit record(s) for this day ` +
      `sit in universe_attempt_log and nothing reads them.`)
  }

  // ── A2 · THE OWED RANGE MUST SHRINK — no re-ask of the identical stuck range ─────────────────────────
  const identical = owed.ranges.some((r) => r.start === STUCK_RANGE.start && r.end === STUCK_RANGE.end)
  if (!identical && !c.uncovered.includes(STUCK_DAY)) {
    ok('A2', `the owed set no longer contains ${STUCK_DAY}; the identical ${STUCK_RANGE.start}..${STUCK_RANGE.end} range is not re-asked.`)
  } else {
    red('A2', `the top window must stop re-asking the identical range ${STUCK_RANGE.start}..${STUCK_RANGE.end}.`,
      `it is still owed verbatim (${JSON.stringify(owed.ranges)}). Every fire re-asks it, spends one vendor request, ` +
      `re-writes the same rows and advances nothing.`)
  }

  // ── A3 · THE RESIDUE MUST BE GENUINELY-EMPTY GROUND — the deadlock broken ────────────────────────────
  // ⛔ THIS IS NOT "THE FRONTIER MOVED". It cannot be, offline: after the fix this window still owes
  // 2026-04-06..07, and the anchor only recedes once the window owes NOTHING — which needs one more REAL
  // pass returning 'zero' so attestedEmptyDays can clear them. That pass costs a vendor request and belongs
  // to Gate-B. What IS checkable here is that the residue is ground a zero-returning pass CAN clear: every
  // remaining owed day holds no rows. Today it does not, because the stripped day has 6,532 of them.
  const withRows = []
  for (const day of c.uncovered) {
    const { data, error } = await sb.from('metrics_daily').select('date')
      .eq('client_id', CLIENT_ID).eq('platform', VENDOR)
      .eq('entity_level', RESOURCE).eq('breakdown_type', BREAKDOWN).eq('date', day).limit(1)
    if (error) throw new Error(`residue probe failed on ${day}: ${error.message}`)
    if ((data?.length ?? 0) > 0) withRows.push(day)
  }
  if (withRows.length === 0) {
    ok('A3', 'every remaining owed day holds ZERO rows — a real pass returns zero, attests, and the anchor recedes.')
  } else {
    red('A3', 'the owed residue must be days a zero-returning pass can attest.',
      `${withRows.length} owed day(s) STILL HOLD ROWS: ${withRows.join(', ')}. A pass over this range returns rows, ` +
      `so its outcome is 'ok' and never 'zero' — attestedEmptyDays can never clear the days beside it. That is the ` +
      `deadlock: the day with rows cannot cover, and the empty days cannot attest.`)
  }

  // ── A4 · THE NO-PROGRESS BOUND MUST FIRE ON COMMIT-BUT-NO-SHRINK ────────────────────────────────────
  // ⛔ THE REAL STUCK SHAPE, TAKEN FROM THE LIVE LOG: attempt #3 over 2026-04-05..04-07 reported 'ok' and
  // committed exactly ONE day, and the owed set was 3 before and 3 after. `owedDaysAtLastAttempt` is passed
  // because the bound cannot see a stall without it — and it is OPTIONAL by design, so a caller that omits
  // it behaves exactly as before (universe-resumer.guard leg (f) pins the fragmented-window case that a
  // wider condition would have broken).
  // ⚠ THIS ASSERTS THE FUNCTION, NOT THE PRODUCTION WIRING. The caller does not yet derive this field — see
  // ★NO-PROGRESS-BOUND-KEYED-ON-THE-WRONG-SHAPE. Stated so a green here is never read as "it fires live".
  const verdict = resumer.decideRepublish({
    owedDays: 3, owedDaysAtLastAttempt: 3,
    attemptsAtMinSpan: 1, maxAttemptsAtMinSpan: 3, spanDays: 3, minSpanDays: 1,
    last: { outcome: 'ok', attemptNo: 3, daysCommitted: 1 },
  })
  if (verdict.publish === false && verdict.verdict === 'no-progress') {
    ok('A4', 'decideRepublish refuses a lap that committed a day and shrank nothing.')
  } else {
    red('A4', 'the no-progress bound must fire when a lap commits a day but the owed set does not shrink.',
      `decideRepublish returned ${JSON.stringify(verdict)}. universe-resumer.ts:214 tests ` +
      `\`last.daysCommitted === 0\`; a stuck surface commits exactly ONE day per pass, so 1 !== 0 and the bound ` +
      `never fires. It measures "did we commit a day", not "did the owed set shrink" — and those disagree here.`)
  }
} catch (e) {
  cleanup()
  console.error(`[topwindow-frontier] CANNOT RUN — ${e.message}`)
  console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · exception')
  process.exit(2)
}
cleanup()

// ── REPORT. THE VERDICT IS THE LAST LINE AND THE EXIT IS ITS OWN FIELD (LORAMER_CHECKDATA_VERDICT_LINE_V1).
console.log('')
for (const r of results) {
  if (r.pass) console.log(`  ✓ ${r.id}  ${r.what}`)
  else { console.log(`  ✗ ${r.id}  ${r.what}`); console.log(`        WHY: ${r.why}`) }
}
const reds = results.filter((r) => !r.pass)
console.log('')
console.log(`[topwindow-frontier] VERDICT — EXIT ${reds.length ? 1 : 0} · ${results.length} assertions: ` +
  `${results.length - reds.length} green · ${reds.length} red` +
  (reds.length ? ` (${reds.map((r) => r.id).join(', ')})` : ''))
// ⛔ exitCode, NEVER process.exit — the same reason run-checkdata.mjs banks: process.exit forces exit even
// with pending async stdout writes, and stdout to a PIPE is async, so the verdict line above could be
// truncated by the very consumer it exists for. check:data spawns this with piped stdio.
process.exitCode = reds.length ? 1 : 0
