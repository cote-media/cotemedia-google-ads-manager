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

// ── LORAMER_COVERAGE_UNKNOWN_REASON_V1 — UNKNOWN MUST SAY WHICH UNKNOWN ─────────────────────────────────────
// (a) an UNKNOWN with no reason is a silent UNKNOWN, which is the defect: the reader cannot act on it.
// (b) 'read_failed' and 'no_activity_in_window' must not collapse — MEASURED 2026-07-30, Foam OH meta timed out
//     at 8,215ms against the 8s ceiling and Thought Streams meta was genuinely dormant, and the two produced the
//     IDENTICAL detail string. One is a broken instrument, the other is a fact about the account.
// (c) a connection that has NEVER captured must not be reported as an idle window — that asserts capture
//     happened and found nothing, which is false.
// (d) no UNKNOWN path may return COMPLETE. Load-bearing and restated here at the reason level.
{
  const days = (from, n) => { const o = []; const d = new Date(from + 'T00:00:00Z'); for (let i = 0; i < n; i++) { o.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) } return o }
  // ⛔ FIVE REASONS SINCE LORAMER_UNATTESTED_ABSENCE_V1 (2026-08-15). 'unattested_absence' exists because
  // the old 'idle window' fixture below — zero base rows on connected+everCaptured alone — was BEING READ AS
  // AN INACTIVITY FACT, and E7's "a real zero, not a capture hole" (Foam OH meta Q1 2026, token-dead) was
  // Lora repeating it. This leg's own previous expectation encoded that defect and was seen RED against the
  // fix before being moved — the superseded-assertion shape the guard-sweep taxonomy names.
  const REASONS = ['not_connected', 'never_captured', 'no_activity_in_window', 'unattested_absence', 'read_failed']

  // (a) EVERY UNKNOWN carries a reason, whichever path produced it.
  const unknowns = [
    ['null sets', resolveBreakdownCoverage('ga', null, null)],
    ['no denominator, facts absent', resolveBreakdownCoverage('ga', [], ['2026-01-01'])],
    ['half-failed read', resolveBreakdownCoverage('ga', days('2026-01-01', 5), null)],
    ['explicit read error', resolveBreakdownCoverage('ga', null, null, {}, { readError: 'canceling statement due to statement timeout' })],
    ['not connected', resolveBreakdownCoverage('ga', [], [], {}, { connected: false, everCaptured: false })],
    ['never captured', resolveBreakdownCoverage('ga', [], [], {}, { connected: true, everCaptured: false })],
    ['unattested empty window', resolveBreakdownCoverage('ga', [], [], {}, { connected: true, everCaptured: true })],
    ['attested idle window', resolveBreakdownCoverage('google', [], [], {}, { connected: true, everCaptured: true, attestationCoversWindow: true })],
  ]
  for (const [label, v] of unknowns) {
    check(v.verdict === 'UNKNOWN', `(a) '${label}' returned ${v.verdict}, expected UNKNOWN.`)
    check(!!v.unknownReason, `(a) '${label}' returned UNKNOWN with NO unknownReason — a silent UNKNOWN is exactly the defect: the reader cannot tell a broken instrument from a dormant account.`)
    check(REASONS.includes(v.unknownReason), `(a) '${label}' returned unknownReason '${v.unknownReason}', outside the declared four.`)
    check(v.verdict !== 'COMPLETE', `(d) '${label}' returned COMPLETE from an UNKNOWN path.`)
  }

  // (b) read_failed, unattested_absence and no_activity_in_window are DISTINCT values AND distinct text.
  // ⛔ RE-PINNED FOR LORAMER_UNATTESTED_ABSENCE_V1: zero base rows WITHOUT attestation must never classify as
  // account inactivity — 'no_activity_in_window' is reachable ONLY with attestationCoversWindow === true.
  const timedOut = resolveBreakdownCoverage('ga', null, null, {}, { readError: 'canceling statement due to statement timeout' })
  const unattested = resolveBreakdownCoverage('ga', [], [], {}, { connected: true, everCaptured: true })
  const attested = resolveBreakdownCoverage('google', [], [], {}, { connected: true, everCaptured: true, attestationCoversWindow: true })
  check(timedOut.unknownReason === 'read_failed', `(b) a read failure reported '${timedOut.unknownReason}', expected 'read_failed'.`)
  check(unattested.unknownReason === 'unattested_absence', `(b) zero base rows WITHOUT attestation reported '${unattested.unknownReason}', expected 'unattested_absence' — connected+everCaptured alone must never license an inactivity claim (E7-meta, LORAMER_UNATTESTED_ABSENCE_V1).`)
  check(attested.unknownReason === 'no_activity_in_window', `(b) a VENDOR-ATTESTED empty window reported '${attested.unknownReason}', expected 'no_activity_in_window' — attestation is the ONE door to inactivity, and it must still open.`)
  // The attestation flag in its false/null forms must land on the same safe side.
  for (const [label, flag] of [['false', false], ['null', null], ['absent', undefined]]) {
    const v = resolveBreakdownCoverage('ga', [], [], {}, { connected: true, everCaptured: true, ...(flag === undefined ? {} : { attestationCoversWindow: flag }) })
    check(v.unknownReason === 'unattested_absence', `(b) attestationCoversWindow=${label} classified as '${v.unknownReason}' — every non-true form must read as unattested (safe), never as inactivity.`)
  }
  check(!/fact about the account/i.test(unattested.detail) && !/genuinely inactive|is real/i.test(unattested.detail), `(b) the unattested_absence detail still carries inactivity language: ${JSON.stringify(unattested.detail).slice(0, 120)}`)
  check(/ATTESTS|attest/i.test(attested.detail), `(b) the attested no_activity detail does not name the attestation — the reader cannot tell WHY this one is licensed.`)
  check(timedOut.unknownReason !== unattested.unknownReason, `(b) a timed-out read and an unattested-empty window COLLAPSED to the same reason — the Foam OH / Thought Streams pair this exists to separate.`)
  check(timedOut.detail !== unattested.detail, `(b) a timed-out read and an unattested-empty window produced the IDENTICAL detail string, which is the pre-fix behaviour verbatim.`)
  check(/statement timeout/.test(timedOut.detail), `(b) the RPC error text was DISCARDED — the old code checked \`error\` and threw the message away, so the one fact that identifies the failure never reached the reader.`)

  // (c) never-captured must not masquerade as an idle window.
  const never = resolveBreakdownCoverage('ga', [], [], {}, { connected: true, everCaptured: false })
  check(never.unknownReason === 'never_captured', `(c) a connection that has NEVER captured reported '${never.unknownReason}' — reporting it as an idle window asserts that capture ran and found nothing, which is false.`)
  const notConn = resolveBreakdownCoverage('ga', [], [], {}, { connected: false })
  check(notConn.unknownReason === 'not_connected', `(c) an unconnected platform reported '${notConn.unknownReason}', expected 'not_connected' — there is no window for it to have activity in.`)
  // and an UNSUPPLIED denominator must NOT be attributed to the account.
  const unattributed = resolveBreakdownCoverage('ga', [], [])
  check(unattributed.unknownReason === 'read_failed', `(c) with the connection denominator NOT supplied the result was attributed as '${unattributed.unknownReason}' — asserting a fact about the account that was never measured is the defect being closed.`)

  // COMPLETE / PARTIAL must carry NO reason — the field is present iff UNKNOWN.
  const complete = resolveBreakdownCoverage('ga', days('2026-01-01', 3), days('2026-01-01', 3))
  check(complete.verdict === 'COMPLETE' && complete.unknownReason === undefined,
    `(a) a COMPLETE verdict carried unknownReason '${complete.unknownReason}' — the field must be present if and only if the verdict is UNKNOWN.`)
}

// ── SOURCE PINS ─────────────────────────────────────────────────────────────────────────────────────────────
const src = readFileSync(resolve(ROOT, SRC), 'utf8')
check(/entity_level', 'account'\)\.eq\('breakdown_type', ''\)/.test(src),
  `SOURCE PIN: minMaxFor's account triple was altered. It is load-bearing for the migration-035 partial index and base grain must stay as-is.`)
check(/BreakdownCoverageVerdict\s*=\s*'COMPLETE'\s*\|\s*'PARTIAL'\s*\|\s*'UNKNOWN'/.test(src),
  `SOURCE PIN: the three-state verdict is not COMPLETE|PARTIAL|UNKNOWN — do not invent a fourth vocabulary.`)
// SOURCE PIN: the RPC-applied comment must not drift back to claiming it is unapplied. It said "NOT APPLIED YET"
// for a day after 046/047 went live — a doc misstating the system it documents, in the file the reader trusts.
check(!/THE RPC IS NOT APPLIED YET/.test(src),
  `SOURCE PIN: coverage.ts still claims the breakdown-coverage RPC is NOT APPLIED. Migrations 046 and 047 were applied to production 2026-07-30.`)
// SOURCE PIN: the pure resolver may not read a table. The connection denominator is passed IN.
{
  const i = src.indexOf('export function resolveBreakdownCoverage')
  const j = src.indexOf('export async function getBreakdownCoverage')
  const body = i >= 0 && j > i ? src.slice(i, j) : ''
  check(body.length > 0 && !/supabaseAdmin/.test(body),
    `SOURCE PIN: resolveBreakdownCoverage reads the database. It must stay PURE — the connection denominator is measured by the caller and passed in, or it cannot be driven without a DB and the booleans go untested.`)
}

rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`[coverage-breakdown-grain] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[coverage-breakdown-grain] PASS — base+zero-breakdown is PARTIAL with every day named, interior holes are found by set-difference, UNKNOWN never degrades to COMPLETE, and base-grain behaviour is byte-for-byte unchanged.')
