#!/usr/bin/env node
// LORAMER_NONPUBLISH_ADVANCES_ROTATION_V1 — EVERY NON-PUBLISHING RESOLUTION MUST ADVANCE THE ROTATION
// OR BE PROVABLY EXCLUDED FROM THE SCAN SET. CLASS-LEVEL, NOT BRANCH-SPECIFIC.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────
// ★WALK-WEDGES-AT-FLOOR-REACHED, measured 2026-08-24 on live rows: the rotation orders the 346-surface
// catalog by last DESCEND attempt_started ASC and scans the first 60 (MAX_ENTRIES_SCANNED_PER_RUN). The
// floor-reached branch resolved with `refusals.push(...); continue` and WROTE NOTHING — so a floor-reached
// surface's recency never moved, it stayed at the FRONT of the rotation forever, and once ≥60 surfaces
// reached floor they monopolised every scan slot. Reproduced with the rotation's own ordering
// (lane='descend', migrations/084:197): top-60 = 60/60 floor-reached, best owing rank = 61, 268 owing
// surfaces starved, descend lane silent ~15h while fire logs read scanned=60 / candidates=0 /
// refusals={"floor-reached":60} every fire. This is ★WALK-WEDGES-AT-COVERED-GROUND (2026-08-13, fixed by
// LORAMER_WALK_UNWEDGE_V1) reincarnated ONE BRANCH OVER — so this guard is CLASS-LEVEL: it walks every
// non-publishing resolution the scan loop can take, not just the one that bit this week.
//
// ── THE LEGS ────────────────────────────────────────────────────────────────────────────────────────────
//  (a) EVERY NON-PUBLISHING DECISION BRANCH ADVANCES THE ROTATION — each of the four decision branches
//      (floor-reached, implausible-coverage, nothing-owed/advanced-covered, the generic !publish refusal
//      covering broken/no-progress) must contain an appendAttemptStarted(...) pair, because migrations/064's
//      rotation reads phase='attempt_started' ONLY (two live finished-only skips on ad_group, 2026-08-12,
//      provably advanced nothing).
//      ⚠ SCOPE, NAMED: ERROR branches (stop-error, coverage-error, top-edge-coverage-error) are EXEMPT —
//      a DB error must not trigger more DB writes, and a persistent-error pin is a different failure with a
//      different fix. Named here so the exemption is a decision, not an oversight.
//  (b) THE FLOOR SEAL IS ONCE-ONLY — the file must fetch prior floor_stop seals (eq outcome 'floor_stop')
//      and skip a still-valid sealed surface BEFORE consuming a scan slot (the 'floor-sealed' skip must
//      appear before `scanned++` inside the scan loop). Without this, the pair alone re-fronts every sealed
//      surface once per cycle forever (~33k bookkeeping rows/day at fleet-terminal).
//  (c) BOOKKEEPING ROWS NEVER ENTER VENDOR-BEHAVIOR DECISIONS — a 0-request pair is a fact about OUR
//      scheduling, not a vendor answer. readAttemptsAtSpan must count only requests_spent > 0 starts (else
//      kick pairs inflate the BROKEN bound) and readLastAttempt must exclude outcome 'skipped'/'floor_stop'
//      (else a kick row flips `completed` false and decideRepublish REPUBLISHES a known-stalled window —
//      vendor spend on ground the refusal existed to protect).
//  (d) THE SEAL RE-ADMITS ON STOP CHANGE — drives the REAL compiled parseFloorSeal/floorSealHolds
//      (universe-resumer.ts): same stop ⇒ holds; changed stopDate ⇒ re-admit; changed basis ⇒ re-admit;
//      unparseable seal ⇒ re-admit (fail-open to scanning, never fail-open to exclusion).
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────
// (d) drives real compiled functions; (a)-(c) are STATIC SOURCE READS. Nothing here proves the pair lands
// in the live table or that the live rotation moves — that is Gate-A, on live rows, per flight.
//
// USAGE: node tests/guards/nonpublishing-branch-must-advance-rotation.guard.mjs
import { readFileSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

const F_ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const F_LOG = 'src/lib/backfill/universe-attempt-log.ts'
const F_RESUMER = 'src/lib/backfill/universe-resumer.ts'
const route = read(F_ROUTE), logSrc = read(F_LOG)
for (const [n, s] of [[F_ROUTE, route], [F_LOG, logSrc]]) {
  if (!s) { console.error(`✗ ${n} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
}

const findings = []

// ── (a) EVERY NON-PUBLISHING DECISION BRANCH ADVANCES THE ROTATION ──────────────────────────────────────
// Branch blocks sliced by anchors that exist in the current file; a missing anchor is a FAIL, not a skip —
// an unfindable branch is a branch this guard can no longer see.
const slice = (label, startAnchor, endAnchor) => {
  const i = route.indexOf(startAnchor)
  if (i < 0) { findings.push(`(a) branch '${label}': start anchor not found (${startAnchor.slice(0, 40)}…) — the guard cannot see this branch.`); return null }
  const j = route.indexOf(endAnchor, i)
  if (j < 0) { findings.push(`(a) branch '${label}': end anchor not found — the guard cannot see this branch.`); return null }
  return route.slice(i, j)
}
const branches = [
  ['floor-reached', 'if (win === null) {', 'const { windowStart, windowEnd } = win'],
  ['implausible-coverage', 'if (!plaus.plausible) {', '// ── THE REPUBLISH DECISION'],
  ['nothing-owed/advanced-covered', "verdict.verdict === 'nothing-owed'", 'if (!verdict.publish) {'],
  ['generic-refusal (broken/no-progress)', 'if (!verdict.publish) {', 'candidates.push({'],
]
for (const [label, a, b] of branches) {
  const block = slice(label, a, b)
  if (block === null) continue
  if (!/appendAttemptStarted\s*\(/.test(block)) {
    findings.push(`(a) branch '${label}' resolves without appendAttemptStarted — the rotation reads ` +
      `phase='attempt_started' ONLY (migrations/064), so this branch cannot move a surface's recency. A surface ` +
      `resolving here every fire stays at the FRONT of the rotation and, at ≥60 such surfaces, monopolises every ` +
      `scan slot: candidates=0 forever while owing surfaces at rank 61+ starve. Write the started(0)+finished ` +
      `pair (LORAMER_WALK_UNWEDGE_V1's proven shape) or exclude the surface from the scan set.`)
  }
}

// ── (b) THE FLOOR SEAL IS ONCE-ONLY + EXCLUSION BEFORE THE SLOT ─────────────────────────────────────────
if (!/\.eq\(\s*'outcome'\s*,\s*'floor_stop'\s*\)/.test(route)) {
  findings.push(`(b) no floor_stop seal fetch in the route — without exclusion, every sealed surface re-fronts ` +
    `once per rotation cycle and the pair is re-written forever (~2 rows/surface/cycle, unbounded churn).`)
} else {
  const loopStart = route.indexOf('for (const entry of rotated)')
  const scannedInc = route.indexOf('scanned++', loopStart)
  const sealedSkip = route.indexOf("'floor-sealed'", loopStart)
  if (loopStart < 0 || scannedInc < 0) {
    findings.push(`(b) scan loop anchors missing — the guard cannot prove the exclusion runs before the slot.`)
  } else if (sealedSkip < 0 || sealedSkip > scannedInc) {
    findings.push(`(b) the 'floor-sealed' skip does not run BEFORE scanned++ — a sealed surface still consumes ` +
      `a scan slot, which re-creates the monopoly the seal exists to end.`)
  }
}

// ── (c) BOOKKEEPING ROWS NEVER ENTER VENDOR-BEHAVIOR DECISIONS ──────────────────────────────────────────
const spanFn = logSrc.match(/export async function readAttemptsAtSpan[\s\S]*?\n\}/)
if (!spanFn || !/\.gt\(\s*'requests_spent'\s*,\s*0\s*\)/.test(spanFn[0])) {
  findings.push(`(c) readAttemptsAtSpan counts 0-request bookkeeping starts — every kick pair inflates ` +
    `attemptsAtMinSpan and decideRepublish flips a surface to BROKEN on evidence of our own scheduling rows.`)
}
const lastFn = route.match(/async function readLastAttempt[\s\S]*?\n\}/)
if (!lastFn || !/(not\(\s*'outcome'|neq\(\s*'outcome')/.test(lastFn[0])) {
  findings.push(`(c) readLastAttempt returns bookkeeping outcomes ('skipped'/'floor_stop') as the last attempt — ` +
    `a kick row flips \`completed\` to false and decideRepublish REPUBLISHES a known-stalled window: vendor spend ` +
    `re-bought on the exact ground the refusal existed to protect.`)
}

// ── (d) THE SEAL RE-ADMITS ON STOP CHANGE — driven against the REAL compiled deciders ───────────────────
{
  const out = mkdtempSync(path.join(tmpdir(), 'loramer-nonpub-'))
  const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [path.resolve(ROOT, F_RESUMER), '--target', 'es2020', '--module', 'commonjs', '--outDir', out, '--skipLibCheck'], { encoding: 'utf8' })
  if (r.error || (r.status !== 0 && !/error TS/.test(String(r.stdout || '')))) {
    findings.push(`(d) could not compile universe-resumer.ts — BROKEN INSTRUMENT, not a pass: ${r.error ? r.error.message : String(r.stdout || r.stderr).slice(0, 160)}`)
  } else {
    let parseFloorSeal = null, floorSealHolds = null
    try {
      const R = createRequire(import.meta.url)(path.join(out, 'universe-resumer.js'))
      parseFloorSeal = R.parseFloorSeal; floorSealHolds = R.floorSealHolds
    } catch { /* fall through to the check below */ }
    if (typeof parseFloorSeal !== 'function' || typeof floorSealHolds !== 'function') {
      findings.push(`(d) parseFloorSeal/floorSealHolds are not exported drivable functions from universe-resumer.ts — ` +
        `the re-admit rule is not testable, so the seal is a stored boolean wearing a derivation's name.`)
    } else {
      const sealText = `FLOOR_STOP — LORAMER_WALK_FLOOR_SEAL_V1: anchor 2022-03-03 below resolved stop stop=2022-03-04 basis=«account inception 2022-03-04»; sealed`
      const seal = parseFloorSeal(sealText)
      if (!seal || seal.stopDate !== '2022-03-04') findings.push(`(d) parseFloorSeal failed to recover the stop from its own marker format.`)
      const same = { stopDate: '2022-03-04', basis: 'account inception 2022-03-04' }
      if (!floorSealHolds(seal, same)) findings.push(`(d) an UNCHANGED stop must HOLD the seal — it re-admitted.`)
      if (floorSealHolds(seal, { ...same, stopDate: '2021-01-01' })) findings.push(`(d) a CHANGED stopDate must re-admit — it held (a lowered floor would stay sealed and the new ground never walked).`)
      if (floorSealHolds(seal, { ...same, basis: 'vendor refusal wall 2022-03-04' })) findings.push(`(d) a CHANGED basis must re-admit — same date from a different fact is a different claim.`)
      if (floorSealHolds(parseFloorSeal('garbage with no marker'), same)) findings.push(`(d) an UNPARSEABLE seal must re-admit (fail-open to scanning, never to exclusion).`)
      if (floorSealHolds(seal, { stopDate: null, basis: 'UNKNOWN — no wall observed, no inception discovered' })) {
        findings.push(`(d) a stop that resolves to UNKNOWN (null) must re-admit — an unknown floor cannot hold a seal.`)
      }
    }
  }
}

if (findings.length) {
  console.error(`NONPUBLISHING-BRANCH-MUST-ADVANCE-ROTATION FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('nonpublishing-branch-must-advance-rotation: all legs green — every decision branch advances the rotation or is excluded once-sealed, bookkeeping rows are invisible to decideRepublish, and the seal re-admits on any stop change.')
