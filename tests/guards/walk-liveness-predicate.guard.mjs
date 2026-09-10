#!/usr/bin/env node
// LORAMER_WALK_LIVENESS_RECUT_V1 — THE LIVENESS PREDICATE IS DRIVEN ON THE SUBJECT'S OWN ROWS, AND IDLE ≠ WEDGED.
//
// ⛔ THE DEFECT, MEASURED 2026-09-09 23:5xZ: `check-walk-liveness` read "state=WEDGED" on a walk that was legitimately
// idle — 349/349 surfaces floor-sealed, the lookback slot observe-only, candidates 0 — because its DONE branch keyed
// on refusals['floor-reached'] with scanned > 0, while the sealed terminal state records scanned 0 and refusals
// {"floor-sealed":349,"lookback-boundary-unknown":1} (the seal path skips scanning). Earlier the same day it read
// ALIVE on 14 top-edge units that were PUBLISHED, not consumed — the 08-17 defect (ESSENCE C6: "liveness tests
// CONSUMPTION, not publishing") one lane over. Prior art: Kubernetes probes — "liveness probes could catch a
// deadlock, where an application is running, but unable to make progress"; a process with no work is not deadlocked.
//
// ── THE ASSERTION — decideWalkLiveness on REAL universe_fire_log rows, pasted verbatim with their timestamps ──
//   (1) the 2026-09-09T20:55:58.284605Z sealed row (scanned 0 · catalog_size 349 · candidates 0 · published 0 ·
//       refusals floor-sealed 349 + lookback-boundary-unknown 1) → SEALED-IDLE, green, 349/349 in the reason.
//   (2) the 2026-09-09T02:56:00.330603Z row (published 2, top-edge era) with attempts 0 → EXECUTION-DARK, red.
//       ⚠ THE ATTEMPT COUNT IS A STUB (named): the row is real; "0 attempts opened" is the constructed half.
//   (3) the 2026-08-14 wedge SHAPE → WEDGED, red. ⚠ STUB, named: universe_fire_log's earliest row is
//       2026-08-14T22:32:10Z — the table was created in response to that wedge, so no real row of it exists.
//       The shape is the incident's measured one (fires hourly, scanned 60, refusals nothing-owed ×60, nothing
//       published, no rows, no advance).
//   (4) the legacy all-floor-reached fixture (walk-unwedge-heartbeat.guard.mjs (d)) still reads DONE, green.
//   (5) a sealed row with an UNEXPLAINED refusal key beside the seals → WEDGED — idle must be fully explained.
//   (6) published > 0 with attempts UNMEASURED → red — an instrument that cannot read consumption may not claim life.
//   (7) the machine-final line shape `[walk-liveness] 24h: … · state=<STATE>` is what the runner parses.
// A predicate that misclassifies a real row of its own subject is red. RED ON HEAD (5083b90): fixture (1) → WEDGED.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SCRIPT = resolve(ROOT, 'scripts/check-walk-liveness.mjs')
const findings = []
let mod = null
try { mod = await import(SCRIPT) } catch (e) { findings.push(`scripts/check-walk-liveness.mjs cannot be imported (${e.message})`) }

if (mod) {
  const d = mod.decideWalkLiveness
  // (1) REAL ROW — universe_fire_log, fired_at 2026-09-09T20:55:58.284605+00:00 (read 2026-09-10)
  const sealedRow = { fired_at: '2026-09-09T20:55:58.284605+00:00', dry_run: false, fire_outcome: 'completed', scanned: 0, scan_completed: false, catalog_size: 349, candidates: 0, published: 0, requests_selected: 0, advanced: 0, refusals: { 'floor-sealed': 349, 'lookback-boundary-unknown': 1 }, elapsed_ms: 14354, held: null }
  const v1 = d({ fires: 288, publishedTotal: 0, rowsWritten24h: 0, advancedTotal: 0, attemptsStarted24h: 0, latestCompleted: sealedRow, latestCompletedRefusals: sealedRow.refusals, scannedLatest: sealedRow.scanned })
  if (!v1.ok || v1.state !== 'SEALED-IDLE') findings.push(`(1) the REAL sealed row 2026-09-09T20:55:58Z reads ${v1.state} (${String(v1.reason).slice(0, 140)}) — expected SEALED-IDLE, green`)
  else if (!/349\/349/.test(v1.reason)) findings.push(`(1) SEALED-IDLE reason does not carry the seal arithmetic 349/349: ${String(v1.reason).slice(0, 140)}`)

  // (2) REAL ROW — fired_at 2026-09-09T02:56:00.330603+00:00 (published 2) + STUB: 0 attempts opened in the window
  const publishedRow = { fired_at: '2026-09-09T02:56:00.330603+00:00', dry_run: false, fire_outcome: 'completed', scanned: 0, scan_completed: false, catalog_size: 349, candidates: 0, published: 2, requests_selected: 0, advanced: 0, refusals: { 'floor-sealed': 349 }, elapsed_ms: 16565, held: null }
  const v2 = d({ fires: 60, publishedTotal: 118, rowsWritten24h: 0, advancedTotal: 0, attemptsStarted24h: 0, latestCompleted: publishedRow, latestCompletedRefusals: publishedRow.refusals, scannedLatest: 0 })
  if (v2.ok || v2.state !== 'EXECUTION-DARK') findings.push(`(2) 118 published / 0 attempts (STUB attempts) reads ${v2.state} — expected EXECUTION-DARK, red (publishing is not consumption)`)
  // (2b) the same real row, consumed: attempts ≥ published − the latest fire's own published (in-flight tolerance)
  const v2b = d({ fires: 60, publishedTotal: 118, rowsWritten24h: 0, advancedTotal: 0, attemptsStarted24h: 116, latestCompleted: publishedRow, latestCompletedRefusals: publishedRow.refusals, scannedLatest: 0 })
  if (!v2b.ok || v2b.state !== 'ALIVE') findings.push(`(2b) 118 published / 116 attempts with the latest fire's 2 in flight reads ${v2b.state} — expected ALIVE`)
  else if (!/116\/118/.test(v2b.reason)) findings.push(`(2b) ALIVE reason does not print the consumption ratio with its denominator (116/118): ${String(v2b.reason).slice(0, 140)}`)

  // (3) STUB — the 2026-08-14 wedge SHAPE (no real row exists; the table postdates the incident)
  const v3 = d({ fires: 21, publishedTotal: 0, rowsWritten24h: 0, advancedTotal: 0, attemptsStarted24h: 0, latestCompletedRefusals: { 'nothing-owed': 60 }, scannedLatest: 60, latestCompleted: { scanned: 60, catalog_size: 346, candidates: 0, published: 0, refusals: { 'nothing-owed': 60 } } })
  if (v3.ok || v3.state !== 'WEDGED') findings.push(`(3) the 08-14 wedge shape reads ${v3.state} — expected WEDGED, red`)

  // (4) legacy all-floor-reached (walk-unwedge-heartbeat.guard.mjs (d)) → DONE
  const v4 = d({ fires: 24, publishedTotal: 0, rowsWritten24h: 0, advancedTotal: 0, latestCompletedRefusals: { 'floor-reached': 60 }, scannedLatest: 60 })
  if (!v4.ok || v4.state !== 'DONE') findings.push(`(4) the all-floor-reached fixture reads ${v4.state} — expected DONE (the legacy terminal state must survive the recut)`)

  // (5) sealed row with an unexplained refusal beside the seals → WEDGED
  const v5 = d({ fires: 288, publishedTotal: 0, rowsWritten24h: 0, advancedTotal: 0, attemptsStarted24h: 0, latestCompleted: { ...sealedRow, refusals: { 'floor-sealed': 348, 'nothing-owed': 1, 'lookback-boundary-unknown': 1 } }, latestCompletedRefusals: { 'floor-sealed': 348, 'nothing-owed': 1, 'lookback-boundary-unknown': 1 }, scannedLatest: 0 })
  if (v5.ok) findings.push(`(5) 348 sealed + 1 'nothing-owed' reads ${v5.state} — an idle that is not fully explained by seals must read WEDGED`)

  // (8) THE 2026-09-10 DOUBLE-COUNT SIGNATURE (★FIRE-LOG-PUBLISHED-DOUBLE-COUNTS-LOOKBACK): the f75d8aa heartbeat wrote
  //     published = 2 × the executed lookback units (fire 6688: 4 vs publishedOf 2), so the 24 h witness read 68 published
  //     against 34 attempts (16:0xZ check:data). The predicate is RIGHT to call that EXECUTION-DARK — it is the witness that
  //     lied — and this fixture pins the signature so the false red is recognisable: attempts == published/2 exactly.
  const v8 = d({ fires: 200, publishedTotal: 68, rowsWritten24h: 68735, advancedTotal: 0, attemptsStarted24h: 34, latestCompleted: { ...publishedRow, published: 4 }, latestCompletedRefusals: publishedRow.refusals, scannedLatest: 0 })
  if (v8.ok || v8.state !== 'EXECUTION-DARK') findings.push(`(8) the double-count signature (68 published / 34 attempts, latest 4) reads ${v8.state} — expected EXECUTION-DARK (the predicate must not be loosened to hide a lying witness)`)
  // (8b) the same 24 h with the heartbeat fixed (each lookback unit counted once): published == attempts → ALIVE 34/34
  const v8b = d({ fires: 200, publishedTotal: 34, rowsWritten24h: 68735, advancedTotal: 0, attemptsStarted24h: 34, latestCompleted: { ...publishedRow, published: 2 }, latestCompletedRefusals: publishedRow.refusals, scannedLatest: 0 })
  if (!v8b.ok || v8b.state !== 'ALIVE') findings.push(`(8b) 34 published / 34 attempts (latest 2 in flight) reads ${v8b.state} — expected ALIVE`)
  else if (!/34\/34/.test(v8b.reason)) findings.push(`(8b) ALIVE reason does not print 34/34: ${String(v8b.reason).slice(0, 140)}`)
  // (6) published > 0 with attempts unmeasured → red
  const v6 = d({ fires: 60, publishedTotal: 118, rowsWritten24h: 0, advancedTotal: 0, latestCompleted: publishedRow, latestCompletedRefusals: publishedRow.refusals, scannedLatest: 0 })
  if (v6.ok) findings.push(`(6) published > 0 with attemptsStarted24h UNMEASURED reads ${v6.state} — an instrument that cannot read consumption may not claim life`)

  // (7) the machine-final line shape
  const src = readFileSync(SCRIPT, 'utf8')
  if (!/\[walk-liveness\] 24h: fires=\$\{[^}]+\} published=\$\{[^}]+\} .*state=\$\{verdict\.state\}/.test(src)) findings.push('(7) the machine-final line `[walk-liveness] 24h: … · state=${verdict.state}` is missing or reshaped — the runner and the report parse it')
}

if (findings.length) {
  console.error(`[walk-liveness-predicate] FAIL — ${findings.length} finding(s):\n  - ${findings.join('\n  - ')}`)
  process.exit(1)
}
console.log('[walk-liveness-predicate] PASS — 2 real universe_fire_log rows (2026-09-09T20:55:58Z sealed → SEALED-IDLE 349/349; 2026-09-09T02:56:00Z published → EXECUTION-DARK with STUB attempts 0, ALIVE at 116/118), the 08-14 wedge shape (STUB) → WEDGED, legacy floor-reached → DONE, unexplained refusal → WEDGED, unmeasured consumption → red, verdict line pinned.')
