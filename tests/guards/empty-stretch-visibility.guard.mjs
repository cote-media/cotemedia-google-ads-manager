#!/usr/bin/env node
// LORAMER_EMPTY_STRETCH_VISIBILITY_V1 — A LONG EMPTY STRETCH IS REPORTED, NEVER STOPPED ON.
//
// ⛔ BOTH FAILURE DIRECTIONS ARE GUARDED, AND THE SECOND IS THE ONE THAT KILLED THE FIRST DESIGN:
//   · NO COUNTER — an account served past the wall with a long dead stretch walks on nothing but
//     `windowsRemaining` pacing, invisibly. Bounded by Google's epoch, but a quota spend nobody can see.
//   · A COUNTER THAT STOPS — the park-the-surface design, adversarially killed 2026-08-10: the longest
//     dormancy measured in the roster is BusyBee's 2,267 DAYS with real data on BOTH sides. Any N small
//     enough to bound a leak parks that walk mid-gap and refuses the 2019 history behind it. So the counter
//     REPORTS (one abandoned_owed-class record) and the walk CONTINUES. Visibility, never a verdict.
//
// ⛔ THE COUNTER IS CHAIN-LOCAL AND MAY RIDE THE MESSAGE — windowsRemaining's shape: one writer, one reader,
// no second owner. (A FLOOR may not ride the message; that fact has two owners and a 24h TTL against a
// boundary that moves daily. universe-floor-execute-time.guard.mjs owns that rule; this guard owns this one.)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const stripped = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const CONSUMER = 'src/app/api/queues/google-ads-universe-v2/route.ts'
const contract = stripped(read(CONTRACT))
const consumer = read(CONSUMER)
const code = stripped(consumer)

// ── (a) THE THRESHOLD EXISTS, IS 400, AND ITS JUSTIFICATION IS THE MEASURED GAP ──────────────────────
{
  const m = contract.match(/EMPTY_STRETCH_REPORT_AFTER\s*=\s*(\d+)/)
  if (!m) findings.push(`(a) ${CONTRACT} declares no EMPTY_STRETCH_REPORT_AFTER — the stretch has no reporting threshold at all.`)
  else if (Number(m[1]) < 350) {
    findings.push(`(a) EMPTY_STRETCH_REPORT_AFTER = ${m[1]}, BELOW the measured worst dormancy (BusyBee: 2,267 days ≈ 324 seven-day ` +
      `windows). A threshold under ~350 fires on a REAL client's REAL quiet years — that is the parked-surface design wearing a report's clothes.`)
  }
  if (!/2,?267/.test(read(CONTRACT))) {
    findings.push(`(a) the threshold's justification (the measured 2,267-day gap) is not recorded beside it in ${CONTRACT}. ` +
      `An unexplained 400 will be "tuned" by the next reader; the number survives only with its argument attached.`)
  }
}

// ── (b) THE COUNTER INCREMENTS ON EMPTY, RESETS ON ROWS, AND RIDES THE CHAIN ─────────────────────────
{
  if (!/emptyStretch/.test(contract)) {
    findings.push(`(b) UniverseMessageV2 carries no \`emptyStretch\` — the counter has nowhere chain-local to live, and a stateless ` +
      `consumer cannot count consecutive anything without it.`)
  }
  if (!/\(\s*msg\.emptyStretch\s*\?\?\s*0\s*\)\s*\+\s*1/.test(code)) {
    findings.push(`(b) ${CONSUMER} never INCREMENTS the stretch ((msg.emptyStretch ?? 0) + 1). A counter that never increments never reports.`)
  }
  if (!/allEmpty\s*\?\s*\(\s*msg\.emptyStretch\s*\?\?\s*0\s*\)\s*\+\s*1\s*:\s*0/.test(code)) {
    findings.push(`(b) ${CONSUMER} does not RESET the counter to 0 on a non-empty invocation. Without the reset, scattered quiet windows ` +
      `across years accumulate into a false "unprecedented stretch" and the report fires on ordinary history.`)
  }
  if (!/advance\s*\(\s*\{\s*\.\.\.msg,\s*emptyStretch\s*\}/.test(code)) {
    findings.push(`(b) ${CONSUMER} does not hand the updated counter to advance() ({ ...msg, emptyStretch }) — the next window's message ` +
      `would carry the STALE count and the stretch could never reach the threshold.`)
  }
}

// ── (c) AT THRESHOLD: ONE UNCHARGED REPORT, AND THE WALK CONTINUES ───────────────────────────────────
{
  if (!/emptyStretch\s*===\s*EMPTY_STRETCH_REPORT_AFTER/.test(code)) {
    findings.push(`(c) ${CONSUMER} never compares the stretch to EMPTY_STRETCH_REPORT_AFTER — the threshold is declared but nothing fires on it.`)
  }
  // The report must be the ===-guarded single record, charged nothing.
  const reportBlock = code.match(/emptyStretch\s*===\s*EMPTY_STRETCH_REPORT_AFTER[\s\S]{0,700}/)
  if (reportBlock) {
    if (!/abandoned_owed/.test(reportBlock[0])) {
      findings.push(`(c) the threshold block does not write an 'abandoned_owed'-class record. That outcome word already means ` +
        `"stopped-for-a-human, seals nothing" (v2 BROKEN path); a NEW status word here would be a second spelling of it (G1).`)
    }
    if (!/nextAttemptNoWithoutCharging/.test(reportBlock[0])) {
      findings.push(`(c) the empty-stretch report CHARGES an attempt. A path that calls no vendor must not bill a request — ` +
        `the budget-stop record above it states the rule and this record must follow it.`)
    }
    if (/\breturn\b/.test(reportBlock[0].slice(0, reportBlock[0].indexOf('advance') === -1 ? undefined : reportBlock[0].indexOf('advance')))) {
      findings.push(`(c) the threshold block RETURNS before advance() — that is a STOP. The entire design is report-and-continue: ` +
        `a row's absence proves nothing, so the walk may not end on it.`)
    }
  }
  // And the strongest form of "continues": advance() must still be reachable after the block — the call that
  // hands the counter forward is the same call that continues the walk, so (b)'s advance check covers it; here
  // we assert the threshold comparison sits BEFORE that advance in the file, i.e. inside the live path.
  const cmpAt = code.search(/emptyStretch\s*===\s*EMPTY_STRETCH_REPORT_AFTER/)
  const advAt = code.search(/advance\s*\(\s*\{\s*\.\.\.msg,\s*emptyStretch\s*\}/)
  if (cmpAt !== -1 && advAt !== -1 && advAt < cmpAt) {
    findings.push(`(c) the threshold check sits AFTER the advance that publishes the next window — the report can never see the ` +
      `count it is supposed to report on.`)
  }
}

if (findings.length) {
  console.error(`[empty-stretch-visibility] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[empty-stretch-visibility] PASS — the chain-local counter increments on all-empty, resets on rows, rides the message to advance() · at EMPTY_STRETCH_REPORT_AFTER (≥350, justified in the contract by the measured 2,267-day dormancy) it writes ONE uncharged abandoned_owed record · and the walk CONTINUES — no return, no park, no new status word. LIMIT: structural; the counter has never fired in production (v2 has never run).`)
