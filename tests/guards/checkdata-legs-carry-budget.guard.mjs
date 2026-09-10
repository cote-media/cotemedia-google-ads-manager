#!/usr/bin/env node
// LORAMER_CHECKDATA_LEG_BUDGET_V1 — EVERY check:data LEG RUNS UNDER A BUDGET DERIVED FROM ITS OWN MEASURED HISTORY.
//
// ⛔ THE INCIDENT (★CHECKDATA-HAS-NO-PER-LEG-TIMEOUT): 2026-09-08 leg 29 of 32 (no-owed-day-left-behind) sat 35 min at
// 0.62 s CPU on a socket the 16:13:41Z instance restart had orphaned — no server backend, no timeout, no verdict
// line ever printed — until a human sent SIGTERM. scripts/run-checkdata.mjs:181 spawnSync carried no `timeout`;
// the guard's pg.Client carried no connectionTimeoutMillis / query_timeout. An instrument that can hang reports
// nothing, and nothing reads like green (LORAMER_BACKFILL_DONE_DONE_V1 condition 6).
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────
//   (a) the durations ledger scripts/lib/checkdata-durations.json exists and is valid JSON with a `legs` map —
//       the runner's recorded healthy ms per leg, the ONLY source of every budget below (never a typed number).
//   (b) scripts/run-checkdata.mjs reads that ledger, passes `timeout:` to spawnSync from a budget derived from it,
//       records each leg's wall-clock back into it, and classifies a budget kill as CRASHED with the budget named.
//   (c) tests/guards/no-owed-day-left-behind.guard.mjs derives connectionTimeoutMillis and query_timeout for its
//       pg.Client from the same ledger (its own leg's budget) and prints "unbudgeted" when no history exists.
//   (d) the budget rule is a MULTIPLE of the trailing max (stated in the runner), and a leg with no history is
//       explicitly UNBUDGETED and printed as such — never silently capped, never silently unbounded.
// RED ON HEAD (f75d8aa): (a)–(c) absent. Static source read; it proves the shape, never that a hang was killed —
// the runner's CRASHED line with "budget" in it is that record.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const LEDGER = resolve(ROOT, 'scripts/lib/checkdata-durations.json')
const RUNNER = resolve(ROOT, 'scripts/run-checkdata.mjs')
const OWED = resolve(ROOT, 'tests/guards/no-owed-day-left-behind.guard.mjs')
const findings = []

// (a)
if (!existsSync(LEDGER)) findings.push('(a) scripts/lib/checkdata-durations.json is MISSING — there is no measured history to derive a budget from.')
else {
  try {
    const j = JSON.parse(readFileSync(LEDGER, 'utf8'))
    if (!j || typeof j.legs !== 'object') findings.push('(a) the durations ledger has no `legs` map.')
  } catch (e) { findings.push(`(a) the durations ledger is not valid JSON (${e.message}).`) }
}

// (b)
if (!existsSync(RUNNER)) findings.push('(b) scripts/run-checkdata.mjs is missing.')
else {
  const src = readFileSync(RUNNER, 'utf8')
  if (!/checkdata-durations\.json/.test(src)) findings.push('(b) the runner never reads scripts/lib/checkdata-durations.json — budgets cannot be derived.')
  if (!/spawnSync\([\s\S]*?timeout:\s*budget/.test(src)) findings.push('(b) spawnSync in the runner carries no `timeout: budget…` — a hung leg still hangs the run.')
  if (!/BUDGET_MULTIPLE/.test(src)) findings.push('(b) the runner states no BUDGET_MULTIPLE — the budget rule (a multiple of the trailing max) is not visible.')
  if (!/recordDuration|durations\.legs\[/.test(src)) findings.push('(b) the runner does not record leg durations back into the ledger — the history never grows.')
  if (!/budget exceeded|BUDGET/.test(src)) findings.push('(b) a budget kill is not named in the CRASHED classification — a timeout would read like any other crash.')
  if (!/UNBUDGETED|unbudgeted/.test(src)) findings.push('(d) a leg without history is not printed as UNBUDGETED — silence on the first run is the 09-08 shape.')
}

// (c)
if (!existsSync(OWED)) findings.push('(c) tests/guards/no-owed-day-left-behind.guard.mjs is missing.')
else {
  const src = readFileSync(OWED, 'utf8')
  const client = src.match(/new pg\.Client\(\{[\s\S]*?\}\)/)
  if (!client) findings.push('(c) no pg.Client construction found in the no-owed-day guard.')
  else {
    if (!/connectionTimeoutMillis/.test(client[0])) findings.push('(c) pg.Client carries no connectionTimeoutMillis — an orphaned socket hangs the leg (09-08).')
    if (!/query_timeout/.test(client[0])) findings.push('(c) pg.Client carries no query_timeout — a stalled query hangs the leg.')
  }
  if (!/checkdata-durations\.json/.test(src)) findings.push('(c) the no-owed-day guard does not derive its timeouts from the durations ledger.')
  if (!/unbudgeted/i.test(src)) findings.push('(c) the no-owed-day guard does not print "unbudgeted" when it has no history.')
}

if (findings.length) {
  console.error(`[checkdata-legs-carry-budget] FAIL — ${findings.length} finding(s):\n  - ${findings.join('\n  - ')}`)
  process.exit(1)
}
console.log('[checkdata-legs-carry-budget] PASS — durations ledger present; the runner derives each leg\'s spawn timeout from it (a stated multiple of the trailing max), records durations back, names a budget kill, and prints UNBUDGETED legs; the no-owed-day guard derives its pg timeouts from the same ledger.')
