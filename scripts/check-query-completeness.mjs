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
import { createRequire } from 'node:module'

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

// SLICE 2 — the -next metric ROUTES attach the flag, and the render SURFACES it (a partial total can't render whole).
const CM = read('src/app/api/next/client-metrics/route.ts')
if (CM && !(CM.includes('annotateContribution(') && CM.includes('revenueSourceSubstituted'))) findings.push('client-metrics/route.ts does not attach the completeness flag (annotateContribution + revenueSourceSubstituted) — a card total can omit a failing platform silently.')
const PM = read('src/app/api/next/portfolio-metrics/route.ts')
if (PM && !(PM.includes('annotateContributionBatch(') && PM.includes('complete'))) findings.push('portfolio-metrics/route.ts does not attach the batched completeness flag.')
const CR = read('src/app/api/next/card-roas/route.ts')
if (CR && !(CR.includes('annotateContribution(') && CR.includes('incompleteNote'))) findings.push('card-roas/route.ts does not attach incompleteNote — a partial ROAS (the highest-visibility false-whole-number) renders clean.')
const SS = read('src/app/api/next/store-stats/route.ts')
if (SS && !(SS.includes('annotateContribution(') && SS.includes('incompleteNote'))) findings.push('store-stats/route.ts does not attach incompleteNote — a partial store stat renders whole.')
const MV = read('src/components/redesign/MerView.tsx')
if (MV && !MV.includes('incompleteNote')) findings.push('MerView.tsx does not SURFACE incompleteNote — a partial blended total would render as whole.')
const CV = read('src/components/redesign/cards/CardViz.tsx')
if (CV && !CV.includes('incompleteNote')) findings.push('CardViz.tsx does not render incompleteNote — stat/ROAS cards cannot mark a partial total.')
const UCD = read('src/components/redesign/cards/useCardData.ts')
if (UCD && !UCD.includes('incompleteNote')) findings.push('useCardData.ts does not carry incompleteNote — stat cards cannot mark a partial total.')
// SLICE 3 — the money + ga-overview TOTAL surfaces (the two that were missed) attach + render the flag.
const MO = read('src/app/api/next/money/route.ts')
if (MO && !(MO.includes('annotateContribution(') && MO.includes('incompleteNote'))) findings.push('money/route.ts does not attach incompleteNote — the money card renders a partial total whole (the live defect).')
const GO = read('src/app/api/next/ga-overview/route.ts')
if (GO && !(GO.includes('annotateContribution(') && GO.includes('incompleteNote'))) findings.push('ga-overview/route.ts does not attach incompleteNote — a stale GA total renders whole.')
const MW = read('src/components/redesign/MoneyWaterfall.tsx')
if (MW && !MW.includes('incompleteNote')) findings.push('MoneyWaterfall.tsx does not render incompleteNote.')

// SLICE 3 BEHAVIORAL — the stale-tail flag must NOT be gated behind the health streak. Transpile computeContribution
// and run the EXACT live case that shipped broken: healthy connection, no streak, coverage 'covered', lastCaptured 2
// days behind the window end → it MUST return 'stale_tail'. On the pre-slice-3 code (gated on streakActive) it returns
// 'ok' → this fails. This guards the CLASS: any future edit that re-gates the tail test behind health breaks the build.
try {
  const require = createRequire(path.join(ROOT, 'package.json'))
  const ts = require('typescript')
  const js = ts.transpileModule(read('src/lib/next/query-completeness.ts') || '', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('exports', 'require', 'module', js)(m.exports, (s) => s === '@/lib/supabase' ? { supabaseAdmin: {} } : s === './coverage' ? {} : require(s), m)
  const health = new Map([['woocommerce', { health: 'healthy', consecutive_failures: 0, first_failure_at: null }]])
  const cov = [[{ platform: 'woocommerce', connected: true, isNA: false, captureFloor: '2018-12-11', floorConfirmed: true, coversWindow: true, state: 'covered', lastCaptured: '2026-07-19' }]]
  const r = m.exports.computeContribution(health, [{ startDate: '2026-05-02', endDate: '2026-07-21' }], cov)
  const st = r?.perWindow?.[0]?.[0]?.status
  if (st !== 'stale_tail') findings.push(`BEHAVIORAL: a healthy connection (no streak) with lastCaptured 2 days behind the window end returns '${st}', not 'stale_tail' — the stale-tail flag is gated behind the health signal (the live defect that shipped in slice 2).`)

  // SLICE 4 PER-METRIC — a store stale tail must NOT caption a metric it does not feed (the live Shelley Spend false
  // statement). Same real shape: google/meta ok, woo stale_tail. Spend/Conversions → NO note; Revenue/ROAS → named.
  const shelley = [
    { platform: 'google', status: 'ok', contributed: true, detail: '' },
    { platform: 'meta', status: 'ok', contributed: true, detail: '' },
    { platform: 'woocommerce', status: 'stale_tail', contributed: true, detail: '' },
  ]
  const spendNote = m.exports.buildIncompleteNote(shelley, null, 'spend')
  const convNote = m.exports.buildIncompleteNote(shelley, null, 'conversions')
  const revNote = m.exports.buildIncompleteNote(shelley, null, 'revenue')
  const roasNote = m.exports.buildIncompleteNote(shelley, null, 'roas')
  if (spendNote) findings.push(`BEHAVIORAL: Spend is captioned ("${spendNote}") for a woo stale tail — WooCommerce feeds no spend; a metric captioned for a platform that does not contribute to it is a FALSE statement (the live defect).`)
  if (convNote) findings.push(`BEHAVIORAL: Conversions is captioned for a woo stale tail — WooCommerce does not feed ad conversions.`)
  if (!revNote || !/WooCommerce/.test(revNote)) findings.push(`BEHAVIORAL: Revenue is NOT captioned (or omits WooCommerce) for a woo stale tail — revenue IS understated by it.`)
  if (!roasNote || !/WooCommerce/.test(roasNote)) findings.push(`BEHAVIORAL: ROAS (blended-store) is NOT captioned for a woo stale tail — the blended basis IS understated by it.`)
} catch (e) {
  findings.push('BEHAVIORAL stale-tail / per-metric check could not run: ' + (e?.message || String(e)))
}

// SLICE 4 STATIC — the per-metric caption must reach the stat cards (route returns the map; the card reads its own).
if (mod && !mod.includes('metricContributors')) findings.push('query-completeness.ts does not define metricContributors — the ONE metric→platform map is missing.')
const CM2 = read('src/app/api/next/client-metrics/route.ts')
if (CM2 && !CM2.includes('incompleteNotes')) findings.push('client-metrics/route.ts does not return incompleteNotes — every stat card would share one client-wide note (Spend captioned for a store stale tail).')
const UCD2 = read('src/components/redesign/cards/useCardData.ts')
if (UCD2 && !UCD2.includes('incompleteNotes')) findings.push('useCardData.ts does not read incompleteNotes — the stat card shows the client-wide note on every metric.')

if (findings.length) {
  console.error('✗ GATE FAILED — query_metrics / the -next routes can hand a silently-incomplete total:')
  for (const f of findings) console.error('  · ' + f)
  console.error(`\n${findings.length} finding(s). Every coverage-annotated total must also carry the contribution + complete flag (from the real health signal), the description must teach it, and a thrown query must be is_error. (Guards the attach class; NOT a proof Lora words it correctly.)`)
  process.exit(1)
}
console.log('✓ GATE PASSED — query_metrics attaches the per-platform contribution + top-level completeness verdict (from the real health signal), teaches it, and a thrown query is a hard tool error.')
process.exit(0)
