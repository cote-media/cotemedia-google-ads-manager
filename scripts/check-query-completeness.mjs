#!/usr/bin/env node
// LORAMER_LORA_INCOMPLETE_TOTAL_V1 — FIX-WITH-GUARD for the query_metrics incomplete-total flag (T0 #2 slice 1).
//
// THE CLASS IT GUARDS: query_metrics must NOT hand Lora a total that silently omits a currently-FAILING platform.
// Whenever the tool annotates a result with coverage, it must ALSO annotate it with the per-platform CONTRIBUTION
// flag + a top-level completeness verdict — computed from the REAL signal (platform_connections.health /
// consecutive_failures / first_failure_at), never a re-invented one. If the coverage attach ships without the
// completeness attach, a partial total can be stated as a whole number — that is the bug this guard fails on.
//
// Hermetic: reads source text only. No network/DB. CI-safe.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8') } catch { return null } }
const findings = []

// 1) The one-source completeness module exists and reads the REAL signal (no invented one).
const MOD = 'src/lib/next/query-completeness.ts'
const mod = read(MOD)
if (!mod) findings.push(`${MOD} is MISSING — the completeness annotator does not exist.`)
else {
  for (const need of ['consecutive_failures', 'first_failure_at', "platform_connections", "'capture_failing'", 'export async function annotateContribution']) {
    if (!mod.includes(need)) findings.push(`${MOD} does not reference ${need} — it must read the shipped health signal and expose the capture_failing status.`)
  }
}

// 2) claude-tools.ts — wherever query_metrics attaches COVERAGE it must ALSO attach the COMPLETENESS verdict.
const CT = 'src/lib/claude-tools.ts'
const ct = read(CT)
if (!ct) findings.push(`${CT} is MISSING.`)
else {
  const usesCoverage = ct.includes('getCoverageForWindows(')
  const usesCompleteness = ct.includes('annotateContribution(')
  if (usesCoverage && !usesCompleteness) {
    findings.push(`${CT} annotates query_metrics with coverage but NOT with annotateContribution — a total can be emitted without the incomplete flag (the SEV-1 bug).`)
  }
  // the completeness result must be fully consumed: top-level verdict + per-window + per-platform.
  for (const need of ['comp.overallComplete', 'comp.completePerWindow', 'comp.perWindow']) {
    if (!ct.includes(need)) findings.push(`${CT} does not attach ${need} — the completeness verdict is computed but not surfaced to Lora.`)
  }
  // 3) the tool DESCRIPTION must teach Lora to treat a flagged total as PARTIAL.
  if (!(ct.includes('capture_failing') && ct.includes('PARTIAL'))) {
    findings.push(`${CT} query_metrics description does not teach the completeness contract (needs 'capture_failing' + 'PARTIAL').`)
  }
  // 4) a thrown query must be a HARD tool error, not error-text as normal content.
  if (!ct.includes('is_error')) {
    findings.push(`${CT} tool loop never sets is_error — a thrown query rides as normal content and can read as data.`)
  }
}

if (findings.length) {
  console.error('✗ GATE FAILED — query_metrics can hand Lora a silently-incomplete total:')
  for (const f of findings) console.error('  · ' + f)
  console.error(`\n${findings.length} finding(s). Every coverage-annotated total must also carry the contribution + complete flag (from the real health signal), the description must teach it, and a thrown query must be is_error. (Guards the attach class; NOT a proof Lora words it correctly.)`)
  process.exit(1)
}
console.log('✓ GATE PASSED — query_metrics attaches the per-platform contribution + top-level completeness verdict (from the real health signal), teaches it, and a thrown query is a hard tool error.')
process.exit(0)
