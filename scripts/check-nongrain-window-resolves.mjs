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
// ── RE-SPEC 2026-09-14 — LORAMER_CHECKDATA_RESPEC_BATCH_A_V1 (DECISIONS LORAMER_NONGRAIN_ATTESTS_V1) ────────────
// The remedy landed: the worker classifies "the vendor answered and nothing was a grain" as outcome 'nongrain', and
// attestedEmptyDays reads `.in('outcome', ['zero','nongrain'])` (universe-coverage.ts). Two assertions here still
// described the world BEFORE that:
//   A2 read ONLY outcome='zero' — the exact narrowing the remedy removed — and stayed red on a window that IS
//      attested (Foam OH campaign/travel_destination_city 2026-03-19..20, attempt 6, outcome nongrain, 2026-08-18).
//      A2 now mirrors the reader it checks: attested by outcome zero OR nongrain.
//   A3 read `attempt_no <= 1` — a count that includes the passes that were burned BEFORE the remedy existed and can
//      never fall. The property is "a RESOLVED window is not re-asked": A3 is red only when a completed pass on the
//      same bounds is recorded AFTER the newest nongrain|zero terminal. No terminal → nothing to anchor; A1/A2 carry
//      that state, and A3 says so rather than reading green silently.
//   A1 unchanged — the window must end up covered or attested.
// The fixture (`--self`, also run inline before the DB read) drives the pure A2/A3 cores: the Foam OH ledger shape
// reads GREEN; the same shape plus one 'ok' pass recorded after the terminal reads RED.
//
// USAGE: node scripts/check-nongrain-window-resolves.mjs [--self]
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

// ── PURE CORES (the fixture and the live read drive the SAME logic) ───────────────────────────────────────
export const TERMINAL_OUTCOMES = ['zero', 'nongrain'] // mirrors universe-coverage.ts attestedEmptyDays `.in('outcome', [...])`
/** A2: the window is attestable iff a completed pass with a terminal outcome overlaps it. */
export function attestedBy(records) { return (records || []).filter((r) => TERMINAL_OUTCOMES.includes(r.outcome)) }
/** A3: passes on the SAME bounds recorded after the newest terminal. { terminal, after } — terminal null when none. */
export function reaskedAfterTerminal(passes) {
  const terminals = (passes || []).filter((p) => TERMINAL_OUTCOMES.includes(p.outcome))
  if (!terminals.length) return { terminal: null, after: [] }
  const terminal = terminals.reduce((a, b) => (String(b.recorded_at) > String(a.recorded_at) ? b : a))
  const after = (passes || []).filter((p) => String(p.recorded_at) > String(terminal.recorded_at))
  return { terminal, after }
}
function runFixture() {
  // The Foam OH ledger shape as read live 2026-09-14: ok ×4, error, nongrain (attempt 6, 2026-08-18T00:31:56Z).
  const foam = [
    { attempt_no: 1, outcome: 'ok', recorded_at: '2026-08-16T15:33:06.362Z' },
    { attempt_no: 2, outcome: 'ok', recorded_at: '2026-08-17T03:16:46.398Z' },
    { attempt_no: 3, outcome: 'ok', recorded_at: '2026-08-17T17:02:22.687Z' },
    { attempt_no: 4, outcome: 'ok', recorded_at: '2026-08-17T19:17:07.606Z' },
    { attempt_no: 5, outcome: 'error', recorded_at: '2026-08-17T21:02:05.017Z' },
    { attempt_no: 6, outcome: 'nongrain', recorded_at: '2026-08-18T00:31:56.913Z' },
  ]
  const reask = [...foam, { attempt_no: 7, outcome: 'ok', recorded_at: '2026-08-19T00:00:00.000Z' }]
  const zeroOnly = foam.filter((p) => p.outcome !== 'nongrain')
  const cases = [
    { name: 'A2 · Foam OH shape (terminal = nongrain) → attested (green)', got: attestedBy(foam).length > 0, want: true },
    { name: 'A2 · same shape with no terminal → not attested (red)', got: attestedBy(zeroOnly).length > 0, want: false },
    { name: 'A3 · Foam OH shape — nothing recorded after the terminal → green', got: reaskedAfterTerminal(foam).after.length === 0, want: true },
    { name: 'A3 · synthetic re-ask (attempt 7 ok) recorded AFTER the terminal → red', got: reaskedAfterTerminal(reask).after.length === 0, want: false },
    { name: 'A3 · no terminal → nothing to anchor (terminal null)', got: reaskedAfterTerminal(zeroOnly).terminal === null, want: true },
  ]
  let bad = 0
  for (const c of cases) { const pass = c.got === c.want; if (!pass) bad++; console.log(`  ${pass ? '✓' : '✗'} fixture ${c.name}`) }
  return bad
}
if (process.argv.includes('--self')) {
  const bad = runFixture()
  console.log(bad ? `[nongrain-resolves] --self: ${bad} fixture(s) FAILED` : '[nongrain-resolves] --self: 5/5 fixtures hold')
  process.exit(bad ? 1 : 0)
}
{
  const bad = runFixture()
  if (bad) { console.error(`[nongrain-resolves] CANNOT RUN — ${bad} fixture(s) failed; the instrument does not measure what it claims.`)
    console.log('[nongrain-resolves] VERDICT — CANNOT-RUN · 0 green · 0 red · fixture'); process.exit(2) }
}

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
    resolve(ROOT, 'src/lib/concurrency.ts'), // LORAMER_FANOUT_BOUNDED_GUARD_V1 lifted mapBounded here; this harness resolves it too
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
    if (/\/concurrency$/.test(request)) return join(out, 'src/lib/concurrency.js')
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
  const { data: terms, error: zErr } = await sb.from('universe_attempt_log')
    .select('attempt_no, outcome, recorded_at').eq('client_id', CLIENT_ID).eq('vendor', VENDOR)
    .eq('resource', RESOURCE).eq('segment', SEGMENT).eq('phase', 'attempt_finished').in('outcome', TERMINAL_OUTCOMES)
    .lte('window_start', WIN_END).gte('window_end', WIN_START)
  if (zErr) throw new Error(`attestation read failed: ${zErr.message}`)
  const attested = attestedBy(terms)
  if (attested.length > 0) ok('A2', `${attested.length} terminal record(s) (outcome zero|nongrain: ${attested.map((r) => `#${r.attempt_no} ${r.outcome}`).join(', ')}) overlap the window — the days are attestable, by the same read attestedEmptyDays makes.`)
  else red('A2', 'a window where nothing was a grain must be ATTESTABLE as empty.',
    `zero records with outcome in [${TERMINAL_OUTCOMES.join(', ')}] overlap ${WIN_START}..${WIN_END} — the vendor answered and nothing was a grain, ` +
    `yet no pass recorded it as a terminal, so attestedEmptyDays (which reads exactly these outcomes) can never attest these days.`)
  const { terminal, after } = reaskedAfterTerminal(passes)
  if (terminal === null) ok('A3', `no terminal pass (zero|nongrain) exists on these bounds yet — nothing to anchor a re-ask against; A1/A2 carry the unresolved state (attempt_no=${top.attempt_no}).`)
  else if (after.length === 0) ok('A3', `the newest terminal is attempt #${terminal.attempt_no} (${terminal.outcome}, ${terminal.recorded_at}); no completed pass on the same bounds is recorded after it — the resolved window is not re-asked.`)
  else red('A3', 'a RESOLVED window must not be re-asked pass after pass.',
    `${after.length} completed pass(es) on the SAME bounds were recorded AFTER the newest terminal (attempt #${terminal.attempt_no} ${terminal.outcome} at ${terminal.recorded_at}): ` +
    `${after.map((p) => `#${p.attempt_no} ${p.outcome} at ${p.recorded_at}`).join(', ')} — each spent a vendor request to re-learn an attested nothing.`)
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
