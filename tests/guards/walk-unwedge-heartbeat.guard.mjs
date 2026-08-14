#!/usr/bin/env node
// LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — NOTHING-OWED MUST ADVANCE, SKIPS ARE NOT ATTESTATION,
// EVERY FIRE BEATS, AND THE WEDGE SIGNAL TELLS COMPLETION FROM DEATH.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────
// ★WALK-WEDGES-AT-COVERED-GROUND, measured 2026-08-13/14: a derived window owing 0 was refused and NOTHING
// appended; the anchor recedes only past a window the rotation has seen ASKED (064 reads
// phase='attempt_started' ONLY), so refusal pinned the rotation and the same covered window was re-derived
// hourly, forever. All 346 surfaces wedged inside a day; 21+ hours silent; zero durable trace. Every leg
// below guards one link of the chain that let that happen — and every failure in that chain was SILENT.
//
// ── THE FOUR LEGS ───────────────────────────────────────────────────────────────────────────────────────
//   (a) NOTHING-OWED ADVANCES. Drives the REAL deriveAnchorEnd/deriveWindow: with the skip's window as the
//       rotation's last-asked, the anchor must land BELOW it. Plus source: the route's nothing-owed branch
//       appends the started+finished PAIR — started because 064's rotation reads ONLY attempt_started (the
//       two live finished-only skips on ad_group proved a finished row advances nothing).
//   (b) COVERED-SKIP ≠ VENDOR ATTESTATION. attestedEmptyDays must keep filtering outcome='zero' only, and
//       the skip append must carry requests 0 + NO rowsWritten (null keeps it out of sizing history, whose
//       read filters `.not('rows_written','is',null)`).
//   (c) EVERY FIRE BEATS. The heartbeat insert must be reachable from ALL FOUR return paths (completed,
//       quota-hold, rotation-error, meter-held), soft-fail (never throws into the fire), and migration 068
//       must exist. A heartbeat with a silent gap re-creates the invisibility it exists to end.
//   (d) THE WEDGE SIGNAL DISCRIMINATES. Drives the REAL decideWalkLiveness: the synthetic 24h-no-progress
//       case must go RED and the all-at-inception-floor case must stay GREEN — a signal that cries wolf at
//       completion is dead the week it matters.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────
// (a)/(d) drive real functions; the rest is STATIC SOURCE READ. Nothing here proves the pair lands in the
// live table, that 064's RPC returns the skip window, or that check:data runs the check (the roster pin in
// checkdata-verdict-line.guard.mjs owns that). The cross-FIRE anchor movement on live data is Gate-B.
//
// USAGE: node tests/guards/walk-unwedge-heartbeat.guard.mjs
//        [--inject-no-advance] [--inject-attest-skip] [--inject-drop-heartbeat] [--inject-signal-blind]
import { readFileSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { decideWalkLiveness } from '../../scripts/check-walk-liveness.mjs'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

// Compile the TS decider (the house transpile harness — universe-horizon-recedes.guard.mjs's shape). The
// SUBJECT is the real universe-resumer.ts, never a stub — the stubbed-subject false-green is shape (b) of
// ★GUARD-SUITE-SWEEP-FOR-FALSE-GREENS and is exactly what this avoids.
let deriveAnchorEnd = null, deriveWindow = null
{
  const out = mkdtempSync(path.join(tmpdir(), 'loramer-unwedge-'))
  const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [path.resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'), '--target', 'es2020', '--module', 'commonjs', '--outDir', out, '--skipLibCheck'], { encoding: 'utf8' })
  if (r.error || (r.status !== 0 && !/error TS/.test(String(r.stdout || '')))) {
    console.error(`✗ could not compile universe-resumer.ts — BROKEN INSTRUMENT, not a pass: ${r.error ? r.error.message : String(r.stdout || r.stderr).slice(0, 200)}`)
    process.exit(2)
  }
  try {
    const R = createRequire(import.meta.url)(path.join(out, 'universe-resumer.js'))
    deriveAnchorEnd = R.deriveAnchorEnd; deriveWindow = R.deriveWindow
  } catch (e) { console.error(`✗ could not load the compiled decider — BROKEN INSTRUMENT, not a pass: ${e.message}`); process.exit(2) }
  if (typeof deriveAnchorEnd !== 'function' || typeof deriveWindow !== 'function') {
    console.error('✗ deriveAnchorEnd/deriveWindow are not drivable functions — BROKEN INSTRUMENT, not a pass.'); process.exit(2)
  }
}

const NO_ADVANCE = process.argv.includes('--inject-no-advance')
const ATTEST_SKIP = process.argv.includes('--inject-attest-skip')
const DROP_HEARTBEAT = process.argv.includes('--inject-drop-heartbeat')
const SIGNAL_BLIND = process.argv.includes('--inject-signal-blind')

const F_ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const F_COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const F_MIGRATION = 'migrations/068_universe_fire_log.sql'

const route = read(F_ROUTE), coverage = read(F_COVERAGE), migration = read(F_MIGRATION)
for (const [n, s] of [[F_ROUTE, route], [F_COVERAGE, coverage], [F_MIGRATION, migration]]) {
  if (!s) { console.error(`✗ ${n} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
}

const findings = []

// ── (a) NOTHING-OWED ADVANCES ───────────────────────────────────────────────────────────────────────────
// Behavioral: simulate the wedge surface. Last-asked = the skip's window (07-13..08-11). The anchor MUST
// recede below it; the derived window MUST sit strictly below the skipped window.
{
  const skipWindow = { start: '2026-07-13', end: '2026-08-11' }
  const anchor = deriveAnchorEnd({
    newestGround: '2026-08-13',
    lastWindowStart: NO_ADVANCE ? null : skipWindow.start,
    lastWindowEnd: NO_ADVANCE ? null : skipWindow.end,
    lastWindowFullyAnswered: true, // covered ground — exactly the condition the skip records
  })
  const win = deriveWindow({ anchorEnd: anchor.anchorEnd, sizingDays: 30, stopDate: '2022-03-04' })
  const movedBelow = !NO_ADVANCE && anchor.receded && anchor.anchorEnd === '2026-07-12' && win !== null && win.windowEnd < skipWindow.start
  if (!movedBelow) {
    findings.push(`(a) the anchor did NOT move below a fully-answered skip window (anchor=${anchor.anchorEnd}, receded=${anchor.receded}, next=${win ? `${win.windowStart}..${win.windowEnd}` : 'null'}). With the skip recorded as last-asked, recession must continue — otherwise the wedge is back.`)
  }
  // Source: the nothing-owed branch appends the PAIR (started is what 064's rotation reads).
  const branch = /verdict\.verdict === 'nothing-owed'[\s\S]{0,900}?appendAttemptStarted\(key, 0\)[\s\S]{0,400}?appendAttemptFinished\(key, opened\.attemptNo, 'skipped'/.test(route)
  if (NO_ADVANCE || !branch) {
    findings.push(`(a) ${F_ROUTE}: the nothing-owed branch no longer appends the started(0)+finished('skipped') PAIR. The rotation (migrations/064) reads phase='attempt_started' ONLY — a finished-only skip provably advances nothing (two live rows on ad_group, 2026-08-12), and without the started row every covered surface wedges again.`)
  }
}

// ── (b) COVERED-SKIP ≠ VENDOR ATTESTATION ───────────────────────────────────────────────────────────────
{
  // Anchor on the FUNCTION BODY, not a fixed distance from the name — the doc comment between them is long
  // and a distance cap is the exact locator defect (★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE) this suite keeps
  // re-finding. Scope: from the declaration to the end of file (it is the last read in the module).
  const attestBody = coverage.slice(coverage.indexOf('export async function attestedEmptyDays'))
  const zeroOnly = !ATTEST_SKIP && attestBody.includes(".eq('phase', 'attempt_finished').eq('outcome', 'zero')") && !/outcome',\s*'skipped'/.test(attestBody)
  if (!zeroOnly) findings.push(`(b) ${F_COVERAGE}: attestedEmptyDays no longer filters outcome='zero' exactly — a 'skipped' row counting as vendor attestation would let OUR bookkeeping attest ground the vendor never answered for, the false-all-clear class.`)
  const skipShape = !ATTEST_SKIP && /appendAttemptFinished\(key, opened\.attemptNo, 'skipped', \{\s*requestsSpent: 0,\s*error: `COVERED_SKIP/.test(route)
  if (!skipShape) findings.push(`(b) ${F_ROUTE}: the covered-skip no longer carries requestsSpent:0 + the COVERED_SKIP marker with rowsWritten OMITTED. rowsWritten must stay null — sizeNextWindow filters .not('rows_written','is',null), and a 0 would feed 'the vendor served nothing' into sizing from a call that never happened.`)
  if (/appendAttemptFinished\(key, opened\.attemptNo, 'skipped', \{[^}]*rowsWritten/.test(route)) {
    findings.push(`(b) ${F_ROUTE}: the covered-skip now sets rowsWritten — it enters sizing history as a vendor answer. Remove it; null is the design.`)
  }
}

// ── (c) EVERY FIRE BEATS ────────────────────────────────────────────────────────────────────────────────
{
  const calls = DROP_HEARTBEAT ? [] : [...route.matchAll(/fireHeartbeat\(\{\s*fireOutcome: '([a-z-]+)'/g)].map((m) => m[1])
  for (const p of ['completed', 'quota-hold', 'rotation-error', 'meter-held']) {
    if (!calls.includes(p)) findings.push(`(c) ${F_ROUTE}: the '${p}' return path no longer writes a heartbeat. A fire with no durable row is exactly the 21-hour invisibility this table exists to end.`)
  }
  if (!DROP_HEARTBEAT && !/HEARTBEAT WRITE FAILED \(fire unaffected\)/.test(route)) {
    findings.push(`(c) ${F_ROUTE}: the heartbeat is no longer soft-fail — a heartbeat that can kill the fire it describes turns an instrument into a new outage mode.`)
  }
  if (!/create table if not exists public\.universe_fire_log/.test(migration)) {
    findings.push(`(c) ${F_MIGRATION}: the universe_fire_log DDL is gone.`)
  }
}

// ── (d) THE WEDGE SIGNAL DISCRIMINATES ─────────────────────────────────────────────────────────────────
{
  const wedge = decideWalkLiveness({
    fires: 21, publishedTotal: 0, rowsWritten24h: 0, advancedTotal: 0,
    latestCompletedRefusals: SIGNAL_BLIND ? { 'floor-reached': 60 } : { 'nothing-owed': 60 }, scannedLatest: 60,
  })
  if (wedge.ok) findings.push(`(d) decideWalkLiveness passed the synthetic 24h-no-progress case (21 fires, 0 published, 0 rows, refusals nothing-owed×60) — the exact measured wedge would be GREEN again.`)
  const done = decideWalkLiveness({
    fires: 24, publishedTotal: 0, rowsWritten24h: 0, advancedTotal: 0,
    latestCompletedRefusals: SIGNAL_BLIND ? { 'nothing-owed': 60 } : { 'floor-reached': 60 }, scannedLatest: 60,
  })
  if (!done.ok || done.state !== 'DONE') findings.push(`(d) decideWalkLiveness FAILED the all-at-inception-floor case (state=${done.state}) — the walk's terminal SUCCESS reads as a wedge, and a signal that cries wolf at completion is dead the week it matters.`)
}

for (const [flag, note] of [
  [NO_ADVANCE, '[--inject-no-advance] simulated a never-asked rotation + treated the pair-append as absent'],
  [ATTEST_SKIP, '[--inject-attest-skip] treated the zero-only attestation filter and the skip shape as broken'],
  [DROP_HEARTBEAT, '[--inject-drop-heartbeat] treated every heartbeat call site as absent'],
  [SIGNAL_BLIND, '[--inject-signal-blind] swapped the refusal histograms so wedge reads done and done reads wedge'],
]) if (flag) console.log(`  ${note} — it must go RED.`)

console.log(`[walk-unwedge-heartbeat] (a) advance behavioral+source · (b) attestation isolation · (c) 4/4 beat paths + soft-fail + DDL · (d) signal RED-on-wedge / GREEN-on-done`)
console.log('[walk-unwedge-heartbeat] (a)/(d) drive real functions; the rest is a STATIC READ — live cross-fire anchor movement is Gate-B. See the header.')
if (findings.length) {
  console.error(`✗ walk-unwedge-heartbeat FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ walk-unwedge-heartbeat OK — nothing-owed advances, skips never attest, every fire beats, and the signal tells completion from death.')
process.exit(0)
