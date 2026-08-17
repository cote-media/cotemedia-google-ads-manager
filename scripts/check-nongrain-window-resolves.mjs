#!/usr/bin/env node
// LORAMER_NONGRAIN_WINDOW_RESOLVES_V1 — A WINDOW THE VENDOR ANSWERED MUST RESOLVE. RED-FIRST.
//
// ⛔ THE DEADLOCK THIS EXISTS TO CATCH, MEASURED LIVE 2026-08-17 ON 14 SURFACES:
// Google answers the query with rows, but every row carries an EMPTY segment value, so
// `buildUniverseRowsAtGrain` drops them all at `if (segPath && value === '') continue`. Consequently:
//   · metrics_daily receives NOTHING          -> the days are NOT COVERED
//   · `res.apiRows` was incremented BEFORE the drop (universe-stream-capture: `out.apiRows++` sits at the
//     top of the stream loop), so the outcome is `apiRows === 0 ? 'zero' : 'ok'` -> **'ok', never 'zero'**
//   · `attestedEmptyDays` reads ONLY `outcome='zero'` -> the days are NEVER ATTESTED
// Not covered AND not attested = OWED FOREVER. The window pins the anchor, the resumer re-publishes the
// identical range every rotation, and each pass burns a vendor request to re-learn the same nothing.
// MEASURED: 32 stuck windows across 14 surfaces, 65 completed passes, 33 of them repeats, attempt numbers
// reaching 4 — 65 vendor requests spent since 2026-08-13 to store zero rows and resolve zero days.
//
// ⛔ THE DROP ITSELF IS CORRECT AND THIS CHECK DOES NOT ARGUE WITH IT. Google's own convention is that a
// null segment means the segment is NOT APPLICABLE (travel_destination_city on a non-travel account), and
// its own shopping guidance is to EXCLUDE unset product attributes. An empty-segment row is not a grain.
// **THE DEFECT IS THE CLASSIFICATION, NOT THE FILTER**: "the vendor answered and nothing was a grain at this
// surface" is an ATTESTABLE EMPTY, and we record it as a partial success that owes work forever.
//
// ⛔ WHAT THIS CHECK ASSERTS IS THE PROPERTY, NOT THE REMEDY: a window that a COMPLETED pass has answered
// must end up either COVERED or ATTESTED. It stays valid whichever way the fix goes, and it goes green only
// when the days actually resolve.
//
// USAGE: node scripts/check-nongrain-window-resolves.mjs
// EXIT:  0 resolved · 1 still owed after a completed pass · 2 CANNOT RUN
// READ-ONLY. No writes, no vendor requests.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// ── THE SUBJECT — the deepest-re-asked instance of the class ────────────────────────────────────────────
const CLIENT_ID = '957d484e-d0c4-4dd0-b382-d8499d556252'   // Foam OH
const VENDOR = 'google'
const RESOURCE = 'campaign'
const SEGMENT = 'segments.travel_destination_city'
const BREAKDOWN = 'travel_destination_city'                 // breakdownTypeForSurface(RESOURCE, SEGMENT)
const WIN_START = '2026-03-19'
const WIN_END = '2026-03-20'

const results = []
const ok = (id, what) => results.push({ id, pass: true, what })
const red = (id, what, why) => results.push({ id, pass: false, what, why })

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class { constructor() { throw new Error('Realtime unused; shim exists only so createClient() constructs on Node < 22.') } }
}
try {
  const p = join(ROOT, '.env.local')
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (!m) continue
    let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
} catch {}
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) {
  console.error('[nongrain-resolves] CANNOT RUN — Supabase env missing.')
  console.log('[nongrain-resolves] VERDICT — CANNOT-RUN · 0 green · 0 red · env missing'); process.exit(2)
}

const out = mkdtempSync(join(tmpdir(), 'loramer-nongrain-'))
const origResolve = Module._resolveFilename
let restored = false
const cleanup = () => { if (!restored) { Module._resolveFilename = origResolve; restored = true } rmSync(out, { recursive: true, force: true }) }

let cov, sb
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-coverage.ts'), resolve(ROOT, 'src/lib/backfill/universe-surfaces.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const { createClient } = createRequire(import.meta.url)('@supabase/supabase-js')
  sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  const shim = join(out, '__supabase.js')
  writeFileSync(shim, 'module.exports = { supabaseAdmin: global.__LORAMER_SB__, supabase: global.__LORAMER_SB__ }')
  global.__LORAMER_SB__ = sb
  const surfacesJs = join(out, 'src/lib/backfill/universe-surfaces.js')
  Module._resolveFilename = function (request, ...rest) {
    if (/universe-surfaces$/.test(request)) return surfacesJs
    if (/@\/lib\/supabase$/.test(request)) return shim
    return origResolve.call(this, request, ...rest)
  }
  cov = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-coverage.js'))
} catch (e) {
  cleanup(); console.error(`[nongrain-resolves] CANNOT RUN — harness failed: ${e.message}`)
  console.log('[nongrain-resolves] VERDICT — CANNOT-RUN · 0 green · 0 red · harness'); process.exit(2)
}

try {
  // ── A0 · PRECONDITION — a COMPLETED pass must have answered this window, and re-asked it. ────────────
  const { data: passes, error: pErr } = await sb.from('universe_attempt_log')
    .select('attempt_no, outcome, rows_written, requests_spent, recorded_at')
    .eq('client_id', CLIENT_ID).eq('vendor', VENDOR).eq('resource', RESOURCE).eq('segment', SEGMENT)
    .eq('window_start', WIN_START).eq('window_end', WIN_END).eq('phase', 'attempt_finished')
    .order('attempt_no', { ascending: false })
  if (pErr) throw new Error(`precondition read failed: ${pErr.message}`)
  if (!passes?.length) {
    cleanup(); console.error(`[nongrain-resolves] CANNOT RUN — no completed pass exists for ${RESOURCE}/${SEGMENT} ${WIN_START}..${WIN_END}.`)
    console.log('[nongrain-resolves] VERDICT — CANNOT-RUN · 0 green · 0 red · precondition absent'); process.exit(2)
  }
  const top = passes[0]
  console.log(`[nongrain-resolves] PRECONDITION OK — ${passes.length} completed pass(es) for ${RESOURCE}/${SEGMENT} ${WIN_START}..${WIN_END}; ` +
    `latest attempt_no=${top.attempt_no} outcome=${top.outcome} rows_written=${top.rows_written} requests_spent=${top.requests_spent}`)

  // ── DRIVE THE REAL COVERAGE PATH ─────────────────────────────────────────────────────────────────────
  const key = { clientId: CLIENT_ID, platform: VENDOR, entityLevel: RESOURCE, breakdownType: BREAKDOWN }
  const owed = await cov.rangesStillOwed(key, WIN_START, WIN_END)
  const c = owed.coverage
  console.log(`[nongrain-resolves] REAL windowCoverage ${RESOURCE}/${SEGMENT} ${WIN_START}..${WIN_END}: ` +
    `${c.covered.length} covered · ${c.attestedEmpty.length} attested-empty · ${c.uncovered.length} owed in ${owed.ranges.length} range(s)`)
  console.log(`[nongrain-resolves] owed ranges: ${JSON.stringify(owed.ranges)}`)

  // ── A1 · THE PROPERTY. Answered by a completed pass ⇒ COVERED or ATTESTED. Never still owed. ─────────
  if (c.uncovered.length === 0) {
    ok('A1', `the window RESOLVED — ${c.covered.length} covered, ${c.attestedEmpty.length} attested-empty, 0 owed.`)
  } else {
    red('A1', 'a window a completed pass has answered must end up COVERED or ATTESTED, never still owed.',
      `${c.uncovered.length} day(s) still owed (${JSON.stringify(owed.ranges)}) after ${passes.length} completed pass(es). ` +
      `The vendor ANSWERED — outcome '${top.outcome}' means apiRows > 0 — but every row was dropped at ` +
      `\`if (segPath && value === '') continue\` because the segment value was empty, so metrics_daily got nothing ` +
      `(not covered) AND the outcome was not 'zero' (never attested). Not covered AND not attested = owed forever.`)
  }

  // ── A2 · IT MUST BE ATTESTABLE. A grain the vendor cannot populate has to be recordable as empty. ────
  const { data: zeros, error: zErr } = await sb.from('universe_attempt_log')
    .select('attempt_no').eq('client_id', CLIENT_ID).eq('vendor', VENDOR)
    .eq('resource', RESOURCE).eq('segment', SEGMENT).eq('phase', 'attempt_finished').eq('outcome', 'zero')
    .lte('window_start', WIN_END).gte('window_end', WIN_START)
  if (zErr) throw new Error(`attestation read failed: ${zErr.message}`)
  if ((zeros?.length ?? 0) > 0) ok('A2', `${zeros.length} attestation record(s) exist — the days can be recorded empty.`)
  else red('A2', 'a window where nothing was a grain must be ATTESTABLE as empty.',
    `zero 'zero'-outcome records overlap ${WIN_START}..${WIN_END}. attestedEmptyDays reads ONLY outcome='zero', ` +
    `and this surface can never produce one while apiRows is counted before the grain filter — so no amount of ` +
    `re-asking will ever make these days attest.`)

  // ── A3 · THE COST. The identical range must not be re-asked indefinitely. ───────────────────────────
  if (Number(top.attempt_no) <= 1) ok('A3', `the range has been asked once (attempt_no=${top.attempt_no}).`)
  else red('A3', 'the identical range must not be re-asked pass after pass.',
    `attempt_no has reached ${top.attempt_no} on the SAME bounds; ${passes.length} completed passes have each ` +
    `spent a vendor request and stored ${passes.reduce((s, p) => s + Number(p.rows_written ?? 0), 0)} rows. ` +
    `Fleet-wide this class stands at 32 stuck windows across 14 surfaces and 65 requests burned.`)
} catch (e) {
  cleanup(); console.error(`[nongrain-resolves] CANNOT RUN — ${e.message}`)
  console.log('[nongrain-resolves] VERDICT — CANNOT-RUN · 0 green · 0 red · exception'); process.exit(2)
}
cleanup()

console.log('')
for (const r of results) {
  if (r.pass) console.log(`  ✓ ${r.id}  ${r.what}`)
  else { console.log(`  ✗ ${r.id}  ${r.what}`); console.log(`        WHY: ${r.why}`) }
}
const reds = results.filter((r) => !r.pass)
console.log('')
console.log(`[nongrain-resolves] VERDICT — EXIT ${reds.length ? 1 : 0} · ${results.length} assertions: ` +
  `${results.length - reds.length} green · ${reds.length} red${reds.length ? ` (${reds.map((r) => r.id).join(', ')})` : ''}`)
process.exitCode = reds.length ? 1 : 0
