#!/usr/bin/env node
// LORAMER_COMPLETION_SIGNAL_V1 — THE DRIVE IS GRADED LIKE THE ENGINE NOW.
//
// ⛔ THE STRUCTURAL FINDING THIS CLOSES, AND IT EXPLAINS THE WHOLE SHAPE OF 2026-08-18: `drive-one-surface.mjs`
// has its numbers quoted in FIVE governance documents — DECISIONS, the QUEUE, CONTINUE_HERE, the digest and
// the walk architecture doc, including the head-of-queue ~1,427-passes / ~2,854-requests arithmetic — and it
// appeared in NO guard suite, NO check:data roster and NO package script. The engine has 127 guards; this file
// had a self-test it wrote for itself. **Five of that day's six defects were instruments, and this is why.**
//
// ⛔ AND THE SELF-TEST WAS AIMED ONE LEVEL TOO LOW. It drove the PREDICATES against real recorded data and
// passed — while `QUIET_MS = 10_000`, sized on a measured 1-4s inter-range gap, blinded the instrument on the
// first dense day it met (pass 3, open 22:31:53.470 → finish 22:32:09.300, 8,649 rows). It tested the
// predicate; nothing tested the CONSTANT.
//
// ⇒ THE GENERALISABLE RULE, and it is what this guard enforces: **FOR EVERY SIZED CONSTANT, A FIXTURE DRAWN
// FROM REAL RECORDED DATA THAT SITS ON THE WRONG SIDE OF IT.** Not a synthetic edge case — a trace that
// actually happened, so the fixture cannot be tuned to agree with the constant.
//
// THIS GUARD RUNS THE SELF-TEST AS ITS SUBJECT rather than re-implementing anything: the fixtures live with
// the code they bound, and a fixture that stops being reachable from here is a fixture nobody runs.
// LEGS: (a) the self-test exits 0 · (b) it actually EMITS fixture lines (a self-test with no fixtures would
// exit 0 and prove nothing — the vacuous-green class) · (c) the three named constants each have one.
//
// USAGE: node tests/guards/drive-constants-have-fixtures.guard.mjs
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SCRIPT = 'scripts/drive-one-surface.mjs'
const findings = []

const r = spawnSync(process.execPath, [resolve(ROOT, SCRIPT), '--selftest'], { encoding: 'utf8', cwd: ROOT })
if (r.error) {
  console.error(`[drive-constants-have-fixtures] CANNOT RUN — ${SCRIPT} --selftest did not run (${r.error.message}). A guard that cannot drive its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`

// ── (a) IT PASSES ─────────────────────────────────────────────────────────────────────────────────────────
if (r.status !== 0) {
  findings.push(`(a) ${SCRIPT} --selftest exited ${r.status}. Its own output follows verbatim, because a fixture failing IS the finding:\n${out.split('\n').map((l) => `      ${l}`).join('\n')}`)
}

// ── (b) IT IS NOT VACUOUS ─────────────────────────────────────────────────────────────────────────────────
const fixtureLines = out.split('\n').filter((l) => /\[selftest\] fixture /.test(l))
if (fixtureLines.length === 0) {
  findings.push(`(b) ${SCRIPT} --selftest emitted NO fixture lines. A self-test that checks only its predicates exits 0 while every sized constant remains unproven — which is exactly what happened before 2026-08-18, and a vacuous green read as a real one is the class this repo has banked repeatedly.`)
}

// ── (c) EACH NAMED CONSTANT HAS ONE ───────────────────────────────────────────────────────────────────────
// ⛔ NAMED RATHER THAN COUNTED. A count passes when someone deletes the awkward fixture and adds two easy
// ones; naming the constants means the awkward one cannot be traded away.
const REQUIRED = [
  { needle: 'QUIET_MS', why: 'the quiesce window — the constant that actually blinded the instrument, and its fixture is the recorded 15,830 ms open→finish trace' },
  { needle: 'CONSUMER_MAX_DURATION_S', why: 'the ceiling — it must derive from the declared contract, not mirror WALK_BUDGET_MS' },
  { needle: 'FLOOR', why: 'the inception — a per-account DISCOVERED fact that must not be frozen into the instrument' },
]
for (const req of REQUIRED) {
  if (!fixtureLines.some((l) => l.includes(req.needle))) {
    findings.push(`(c) no fixture names ${req.needle}: ${req.why}.`)
  }
}

if (findings.length) {
  console.error(`[drive-constants-have-fixtures] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ Every sized constant in this file gets a fixture from REAL RECORDED DATA on the WRONG side of it. The self-test proved the predicates for a week while the constants proved nothing.`)
  process.exitCode = 1
} else {
  console.log(`[drive-constants-have-fixtures] PASS — ${SCRIPT} --selftest exits 0 with ${fixtureLines.length} real-data fixture(s), one for each of QUIET_MS, CONSUMER_MAX_DURATION_S and FLOOR. ⛔ LIMIT: a fixture proves its constant is not obviously wrong on a trace that happened; it cannot prove the constant is right for a trace that has not.`)
}
