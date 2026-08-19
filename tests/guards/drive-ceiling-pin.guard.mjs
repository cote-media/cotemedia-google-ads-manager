#!/usr/bin/env node
// LORAMER_COMPLETION_SIGNAL_V1 — THE CEILING IS ONE CONTRACT, READ IN THREE PLACES, WRITTEN IN NONE.
//
// ⛔ WHY THIS EXISTS. An observer has to know how long an invocation may live, and the only legitimate source
// is a DECLARED CONTRACT ENFORCED BY SOMEBODY OTHER THAN THE OBSERVER — Vercel's own wording is "if a function
// runs for longer than its set maximum duration, Vercel will terminate it"
// (vercel.com/docs/functions/configuring-functions/duration, page last_updated 2026-07-01). That is the bar
// Temporal's Start-To-Close and SQS's visibility timeout both meet.
// The drive's old ceiling met NONE of it: `PASS_TIMEOUT_MS = 180_000` mirrored `WALK_BUDGET_MS`, the
// consumer's budget for TAKING a new range — a different quantity entirely — and its quiesce came from a
// measured 1-4s inter-range gap. Both were OBSERVATIONS wearing a contract's job.
//
// ⛔ AND 300 IS OUR CHOICE, NOT THE PLATFORM'S CEILING, WHICH IS THE WHOLE REASON FOR A PIN. The same Vercel
// page gives Pro a maximum of 800s and an extended maximum of 1800s. Raising the consumer's maxDuration is
// legal and plausible; on the day it happens, anything holding 300 becomes silently wrong — and "silently"
// is the word that matters, because a ceiling that is too SHORT reports INDETERMINATE for passes that were
// simply still running.
//
// THREE LEGS: (a) the contract declares it · (b) the route's `maxDuration` export REFERENCES the constant
// rather than restating a number · (c) the drive DERIVES its ceiling from the contract and holds no
// hard-coded pass timeout.
//
// ⚠ LIMIT: this pins the three to ONE value. It cannot tell you whether that value is the right one for the
// work — only that nothing is quietly disagreeing about it.
//
// USAGE: node tests/guards/drive-ceiling-pin.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const ROUTE = 'src/app/api/queues/google-ads-universe-v2/route.ts'
const DRIVE = 'scripts/drive-one-surface.mjs'
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) {
    findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`)
    return ''
  }
}

const contract = read(CONTRACT), route = read(ROUTE), drive = read(DRIVE)

// ── (a) THE CONTRACT DECLARES IT ──────────────────────────────────────────────────────────────────────────
const m = contract.match(/export const CONSUMER_MAX_DURATION_S\s*=\s*(\d+)/)
if (!m) {
  findings.push(`(a) ${CONTRACT} does not export CONSUMER_MAX_DURATION_S. Without a declared contract the ceiling has nothing to derive from, and a derived-from-nothing ceiling is the defect this replaced.`)
}
const declared = m ? Number(m[1]) : null

// ── (b) THE ROUTE REFERENCES IT, NEVER RESTATES IT ────────────────────────────────────────────────────────
if (route) {
  if (!/export const maxDuration = CONSUMER_MAX_DURATION_S\b/.test(route)) {
    const lit = route.match(/export const maxDuration = (\d+)/)
    findings.push(`(b) ${ROUTE} sets \`maxDuration\`${lit ? ` to the LITERAL ${lit[1]}` : ' by some other means'} instead of to CONSUMER_MAX_DURATION_S. Vercel enforces the value the ROUTE sets, so the route is the authority — and an observer that cannot read it is guessing. One value, referenced, never restated.`)
  }
  if (!/CONSUMER_MAX_DURATION_S/.test(route.split('\n').filter((l) => l.startsWith('import ')).join('\n'))) {
    findings.push(`(b) ${ROUTE} does not import CONSUMER_MAX_DURATION_S from the contract.`)
  }
}

// ── (c) THE DRIVE DERIVES, AND HOLDS NO HARD-CODED PASS TIMEOUT ───────────────────────────────────────────
if (drive) {
  if (!/readConsumerMaxDurationS/.test(drive)) {
    findings.push(`(c) ${DRIVE} does not read CONSUMER_MAX_DURATION_S from the contract. Its ceiling is then its own opinion, which is how PASS_TIMEOUT_MS came to mirror WALK_BUDGET_MS — the consumer's budget for taking a range, not the platform's kill.`)
  }
  if (/const PASS_TIMEOUT_MS\s*=\s*\d/.test(drive)) {
    findings.push(`(c) ${DRIVE} still declares a hard-coded PASS_TIMEOUT_MS. That constant was 180_000 against a 300s platform ceiling: the drive could give up while the consumer was legitimately still running for another 120 seconds.`)
  }
  if (/const QUIET_MS\s*=\s*\d/.test(drive)) {
    findings.push(`(c) ${DRIVE} still declares QUIET_MS. Waiting for SILENCE is the defect — Airbyte, Temporal and SQS all treat absence as failure-or-not-yet and never as completion. Wait for the terminal row.`)
  }
  if (/const FLOOR\s*=\s*'\d{4}-\d{2}-\d{2}'/.test(drive)) {
    findings.push(`(c) ${DRIVE} hard-codes a FLOOR date. The inception is DISCOVERED per (account, surface) and the route returns it as stopBasis — a frozen constant here is LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 reintroduced in the instrument.`)
  }
}

if (findings.length) {
  console.error(`[drive-ceiling-pin] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exitCode = 1
} else {
  console.log(`[drive-ceiling-pin] PASS — CONSUMER_MAX_DURATION_S=${declared}s is declared once in the contract, referenced by the route's maxDuration export, and read by the drive; no hard-coded pass timeout, quiesce window or floor date survives. ⛔ LIMIT: this proves the three AGREE, never that ${declared}s is the right number for the work.`)
}
