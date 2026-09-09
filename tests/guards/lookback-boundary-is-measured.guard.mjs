#!/usr/bin/env node
// LORAMER_LOOKBACK_LANE_V1 — THE RESTATEMENT BOUNDARY IS READ FROM THE STORE AND NEVER TYPED.
//
// DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (i): the boundary is PER ACCOUNT and MEASURED —
// boundary(account) = max(max click-through lookback, max view-through lookback, COST_HORIZON_DAYS), read from
// `conversion_action` state, stored, guarded, re-read every forward fire. A fleet constant survives only as the
// FLOOR the read is checked against, never the boundary itself. This guard pins the SHAPE of that rule in code:
//   (a) the derivation module (lookback-boundary.ts) IMPORTS THE STORE and reads entity_state_history — a
//       boundary that does not come from a row is a typed constant wearing a function.
//   (b) the pure derivation (deriveBoundaryDays, universe-resumer.ts) carries NO day literal ≥ 2 — only the
//       named COST_HORIZON_DAYS and LOOKBACK_FLEET_FLOOR_DAYS may appear, and each declaration must carry its
//       provenance on the line (`measured YYYY-MM-DD` / a dated ruling).
//   (c) the derivation REFUSES on an absent row (returns null) — an UNKNOWN boundary never defaults.
// ⛔ SELF-TEST: a planted body with `Math.max(a, b, 90)` must red; if it does not, the guard exits 2.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const STORE_MODULE = 'src/lib/backfill/lookback-boundary.ts'
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function bodyOf(src, fnName) {
  const at = src.indexOf(`function ${fnName}(`)
  if (at === -1) return null
  // ⛔ THE BODY OPENER IS THE LAST `{` ON THE SIGNATURE LINE — a return-type annotation such as
  // `: { days: number } | null {` carries braces of its own, and the first `{` after the parameter list is one
  // of THOSE, not the body. Seen wrong on the guard's first live run (2026-09-08): it read the return type as
  // the body and reported three false findings. The self-test fixture now carries a return type for that reason.
  const nl = src.indexOf('\n', at)
  const sigLine = src.slice(at, nl === -1 ? src.length : nl)
  const open = at + sigLine.lastIndexOf('{')
  if (sigLine.lastIndexOf('{') === -1) return null
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open, j + 1) }
  }
  return null
}

export function findingsFor({ resumerSrc, storeSrc }) {
  const out = []
  const code = stripComments(resumerSrc)
  const body = bodyOf(code, 'deriveBoundaryDays')
  if (body === null) out.push(`(b) ${RESUMER} exports no \`deriveBoundaryDays(\` — the boundary derivation does not exist as a drivable function.`)
  else {
    const literals = [...body.matchAll(/(?<![\w.'])(\d+)(?![\w'])/g)].map((m) => Number(m[1])).filter((n) => n >= 2)
    if (literals.length) out.push(`(b) deriveBoundaryDays carries day literal(s) ${literals.join(', ')} in its body — the boundary must come from the store's facts and the NAMED COST_HORIZON_DAYS / LOOKBACK_FLEET_FLOOR_DAYS, never a typed number.`)
    if (!/COST_HORIZON_DAYS/.test(body)) out.push('(b) deriveBoundaryDays does not use COST_HORIZON_DAYS — the cost-restatement term (spend moves to age 96) is missing from the max().')
    if (!/LOOKBACK_FLEET_FLOOR_DAYS/.test(body)) out.push('(b) deriveBoundaryDays does not check the read against LOOKBACK_FLEET_FLOOR_DAYS — the fleet floor is what a suspect read is refused against.')
    if (!/return\s+null/.test(body)) out.push('(c) deriveBoundaryDays never `return null`s — an absent row must REFUSE (UNKNOWN), never default to a number.')
  }
  if (!/export const COST_HORIZON_DAYS\s*=\s*\d+[^\n]*measured 20\d\d-\d\d-\d\d/.test(resumerSrc)) out.push('(b) `export const COST_HORIZON_DAYS = <n>` must carry `measured YYYY-MM-DD` on its own line — a horizon without a measurement date is a constant nobody can re-measure.')
  if (!/export const LOOKBACK_FLEET_FLOOR_DAYS\s*=\s*\d+[^\n]*(DECISIONS|ruling)[^\n]*20\d\d-\d\d-\d\d/.test(resumerSrc)) out.push('(b) `export const LOOKBACK_FLEET_FLOOR_DAYS = <n>` must cite the dated ruling that set the floor on its own line.')
  const store = storeSrc === null ? null : stripComments(storeSrc)
  if (store === null) out.push(`(a) ${STORE_MODULE} is missing — the boundary is not read from anywhere.`)
  else {
    if (!/from\s+'@\/lib\/supabase'/.test(store)) out.push(`(a) ${STORE_MODULE} does not import the store ('@/lib/supabase') — a boundary that does not come from a row is a typed constant.`)
    if (!/\.from\('entity_state_history'\)/.test(store)) out.push(`(a) ${STORE_MODULE} does not read entity_state_history — the conversion_action lookback windows live there (★CONVERSION-ACTION-CAPTURE-DARK's replacement).`)
    if (!/click_through_lookback_window_days/.test(store) || !/view_through_lookback_window_days/.test(store)) out.push(`(a) ${STORE_MODULE} does not read both lookback keys (click_through_lookback_window_days · view_through_lookback_window_days).`)
    if (!/deriveBoundaryDays/.test(store)) out.push(`(a) ${STORE_MODULE} does not hand its facts to deriveBoundaryDays — two derivations would be two walks.`)
  }
  return out
}

// ── SELF-TEST — a planted literal must red ────────────────────────────────────────────────────────────
const goodResumer = `export const COST_HORIZON_DAYS = 90 // ⇐ measured 2026-09-05 N=64\nexport const LOOKBACK_FLEET_FLOOR_DAYS = 90 // DECISIONS (i) 2026-09-05\nexport function deriveBoundaryDays(f: { a: number | null; b: number | null } | null): { days: number } | null {\n  if (f === null) return null\n  const days = Math.max(f.a ?? 0, f.b ?? 0, COST_HORIZON_DAYS)\n  if (days < LOOKBACK_FLEET_FLOOR_DAYS) return null\n  return { days }\n}\n`
const goodStore = `import { supabaseAdmin } from '@/lib/supabase'\nimport { deriveBoundaryDays } from '@/lib/backfill/universe-resumer'\nexport async function readBoundaryFacts() { const { data } = await supabaseAdmin.from('entity_state_history').select('state_key').in('state_key', ['click_through_lookback_window_days', 'view_through_lookback_window_days']); return deriveBoundaryDays(data ? { a: 1, b: 1 } : null) }\n`
const plantedResumer = goodResumer.replace('Math.max(f.a ?? 0, f.b ?? 0, COST_HORIZON_DAYS)', 'Math.max(f.a ?? 0, f.b ?? 0, 90)')
if (findingsFor({ resumerSrc: goodResumer, storeSrc: goodStore }).length !== 0) {
  console.error(`✗ lookback-boundary-is-measured SELF-TEST FAILED — the well-formed fixture produced findings: ${findingsFor({ resumerSrc: goodResumer, storeSrc: goodStore }).join(' · ')}`)
  process.exit(2)
}
if (!findingsFor({ resumerSrc: plantedResumer, storeSrc: goodStore }).some((f) => /day literal/.test(f))) {
  console.error('✗ lookback-boundary-is-measured SELF-TEST FAILED — a planted `Math.max(a, b, 90)` produced no day-literal finding.')
  process.exit(2)
}

let resumerSrc = '', storeSrc = null
try { resumerSrc = readFileSync(resolve(ROOT, RESUMER), 'utf8') } catch (e) {
  console.error(`✗ lookback-boundary-is-measured CANNOT RUN — ${RESUMER} unreadable (${e.message}).`)
  process.exit(2)
}
try { storeSrc = readFileSync(resolve(ROOT, STORE_MODULE), 'utf8') } catch { storeSrc = null }
const f = findingsFor({ resumerSrc, storeSrc })
if (f.length) {
  console.error(`✗ LOOKBACK-BOUNDARY-IS-MEASURED FAILED — ${f.length} finding(s):`)
  for (const x of f) console.error(`  - ${x}`)
  console.error('  ⇒ SPEC: DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (i); QUEUE ★LOOKBACK-LANE-OWNS-PROMOTION (1).')
  process.exit(1)
}
console.log('[lookback-boundary-is-measured] PASS — the boundary is derived from stored conversion_action facts (store imported, both keys read), the pure derivation carries no day literal, COST_HORIZON_DAYS and the fleet floor carry their provenance, and an absent row refuses (planted literal seen red in the self-test).')
