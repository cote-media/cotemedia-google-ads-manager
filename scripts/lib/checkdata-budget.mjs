// LORAMER_CHECKDATA_LEG_BUDGET_V1 — ONE OWNER of the check:data per-leg budget rule and its ledger.
//
// The ledger scripts/lib/checkdata-durations.json holds, per leg, the last few COMPLETED runs' wall-clock ms
// (a run the budget killed never enters it — a hang must not inflate the budget that catches the next hang).
// A leg's budget is BUDGET_MULTIPLE × the trailing max of those completed runs. A leg with NO history is
// UNBUDGETED and says so; the run that follows records it, so the second run is budgeted.
//
// ⛔ WHY A MULTIPLE OF THE TRAILING MAX, AND WHY THIS MULTIPLE: the 2026-09-08 hang sat 35 minutes on a leg whose
// healthy runs finish in well under two — more than fifteen times its worst honest run. Three times the worst
// completed run is far above jitter (legs vary by network and pooler warmth, not by 3×) and far below a hang.
// The number is the rule's shape, not a tuned threshold: every actual budget is derived from measurement.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

export const LEDGER_REL = 'scripts/lib/checkdata-durations.json'
export const BUDGET_MULTIPLE = 3
export const KEEP_RUNS = 5 // trailing completed runs kept per leg — a window for the max, small in git

export function loadLedger(root) {
  try {
    const j = JSON.parse(readFileSync(resolve(root, LEDGER_REL), 'utf8'))
    if (j && typeof j.legs === 'object') return j
  } catch { /* absent or unreadable → empty history, every leg UNBUDGETED and printed as such */ }
  return { legs: {} }
}

export function saveLedger(root, ledger) {
  const p = resolve(root, LEDGER_REL)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ $comment: 'LORAMER_CHECKDATA_LEG_BUDGET_V1 — per-leg wall-clock ms of the last completed check:data runs; the ONLY source of each leg\'s spawn/pg budget (BUDGET_MULTIPLE × trailing max). Written by scripts/run-checkdata.mjs; never hand-edited.', legs: ledger.legs }, null, 2) + '\n')
}

/** { budgetMs, basis } — budgetMs null when the leg has no completed history (UNBUDGETED). */
export function budgetFor(ledger, name) {
  const runs = Array.isArray(ledger?.legs?.[name]) ? ledger.legs[name].filter((r) => Number.isFinite(Number(r.ms)) && r.ms > 0) : []
  if (!runs.length) return { budgetMs: null, basis: 'UNBUDGETED — no recorded history for this leg; recording this run' }
  const max = Math.max(...runs.map((r) => Number(r.ms)))
  return { budgetMs: max * BUDGET_MULTIPLE, basis: `${BUDGET_MULTIPLE} × trailing max ${max} ms over ${runs.length} completed run(s)` }
}

export function recordDuration(ledger, name, ms, bucket) {
  if (bucket === 'CRASHED') return ledger // a killed or crashed run is not a healthy duration
  const runs = Array.isArray(ledger.legs[name]) ? ledger.legs[name] : []
  runs.push({ ms: Math.round(ms), ts: new Date().toISOString(), bucket })
  ledger.legs[name] = runs.slice(-KEEP_RUNS)
  return ledger
}
