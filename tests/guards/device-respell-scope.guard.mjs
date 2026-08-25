#!/usr/bin/env node
// LORAMER_ORDINAL_DEVICE_RESPELL_V1 — the repair's own gate, in two halves in ONE file.
//
// ⛔ WHY THIS IS A check:data CHECK AND NOT IN `npm run guard`: leg (a) READS THE LIVE WAREHOUSE
// (guards run on Vercel with no DB). It shipped DESIGNED RED — failing while any ordinal device value
// remained at detail_placement_view — and was left UNREGISTERED until Russ authorized the execution
// (registering a designed-red check would have painted his board red for a state awaiting his word).
// The respell EXECUTED 2026-08-25 (92,509 rows, the approved manifest, 0 residue); this flipped green
// on the live read and was registered in run-checkdata.mjs in the same commit. From here it is the
// REGRESSION guard: red again means ordinals came back, or a repair leaked outside its scope.
//
// LEG (a) — THE STATE: zero ordinal device rows may remain at
//   (client 957d484e · google · detail_placement_view · device · value IN '2'..'6').
//   RED today by construction: 92,509 such rows exist (measured 2026-08-25).
// LEG (b) — THE SCOPE PIN, from the MANIFEST + the SCRIPT SOURCE: the repair may not be able to touch
//   any other entity_level, client, platform or breakdown_type. Proven two ways:
//     · the script's every UPDATE/SELECT carries the full five-predicate scope (source-read, comments
//       stripped — its own header names the strings it hunts);
//     · the OUT-OF-SCOPE ordinal populations are counted live BEFORE any execution and pinned into
//       .device-respell-scope-baseline.json on first run; after an execution, leg (b) re-counts and fails
//       if ANY out-of-scope population shrank — a repair that leaked outside its scope cannot pass.
//       (Growth is fine — other lanes write; only SHRINKAGE indicts the repair.)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const NAME = 'device-respell-scope'
const CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252'
const BASELINE = resolve(ROOT, '.device-respell-scope-baseline.json')
const findings = []

for (const l of (() => { try { return readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n') } catch { return [] } })()) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !K) { console.error(`✗ ${NAME} CANNOT RUN — Supabase env missing. A broken instrument is not a pass.`); process.exit(2) }
let readFailure = null
const count = async (q) => {
  const r = await fetch(`${SB}/rest/v1/metrics_daily?select=id&${q}&limit=1`, {
    headers: { apikey: K, Authorization: `Bearer ${K}`, Prefer: 'count=exact', Range: '0-0' },
  })
  if (!r.ok && r.status !== 206 && r.status !== 416) { readFailure = `HTTP ${r.status}`; return null }
  const cr = r.headers.get('content-range') || ''
  const n = Number(cr.split('/')[1])
  if (!Number.isFinite(n)) { readFailure = `unparseable content-range "${cr}"`; return null }
  return n
}
const ORD = 'breakdown_value=in.("2","3","4","5","6")'

// ── LEG (a): the state — designed RED until the respell executes ─────────────────────────────────────
const inScope = await count(`client_id=eq.${CLIENT}&platform=eq.google&entity_level=eq.detail_placement_view&breakdown_type=eq.device&${ORD}`)
if (inScope === null) { console.error(`✗ ${NAME} CANNOT RUN — in-scope count failed: ${readFailure}`); process.exit(2) }
if (inScope !== 0) {
  findings.push(`(a) ${inScope} ordinal device row(s) remain at detail_placement_view — the respell has not run (RED IS THE DESIGNED STATE until Russ authorizes execution; the count is the manifest's own 92,509 until then).`)
}

// ── LEG (b1): the script's statements all carry the full scope ───────────────────────────────────────
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
let src = null
try { src = stripComments(readFileSync(resolve(ROOT, 'scripts/respell-device-ordinals.mjs'), 'utf8')) } catch { /* absent */ }
if (src === null) {
  findings.push('(b1) scripts/respell-device-ordinals.mjs does not exist — the repair this guard gates is missing')
} else {
  for (const [what, re] of [
    ['the client pin', /client_id = '\$\{CLIENT\}'|CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252'/],
    ['platform google', /platform = 'google'/],
    ["entity_level = detail_placement_view (and ONLY it)", /LEVEL = 'detail_placement_view'/],
    ['breakdown_type device', /breakdown_type = 'device'/],
    ['the Russ execution gate', /LORAMER_REPAIR_CONFIRM(\s*!==?\s*|=)'?device-respell'?/],
    ['mapping read from canonicalBreakdownValue, not restated', /canonicalBreakdownValue\(/],
  ]) {
    if (!re.test(src)) findings.push(`(b1) the respell script no longer carries ${what}`)
  }
  for (const forbidden of ['group_placement_view', "'campaign'", "'ad_group'"]) {
    if (src.includes(forbidden)) findings.push(`(b1) the respell script references ${forbidden} — outside its ruled scope`)
  }
}

// ── LEG (b2): out-of-scope ordinal populations may never SHRINK across a repair ──────────────────────
const outOfScope = {
  group_placement_view: await count(`client_id=eq.${CLIENT}&platform=eq.google&entity_level=eq.group_placement_view&breakdown_type=eq.device&${ORD}`),
  legacy_campaign: await count(`client_id=eq.${CLIENT}&platform=eq.google&entity_level=eq.campaign&breakdown_type=eq.device&${ORD}`),
  legacy_ad_group: await count(`client_id=eq.${CLIENT}&platform=eq.google&entity_level=eq.ad_group&breakdown_type=eq.device&${ORD}`),
  search_term_view: await count(`client_id=eq.${CLIENT}&platform=eq.google&entity_level=eq.search_term_view&breakdown_type=eq.device&${ORD}`),
  other_bt_same_level: await count(`client_id=eq.${CLIENT}&platform=eq.google&entity_level=eq.detail_placement_view&breakdown_type=eq.ad_network_type`),
}
for (const [k, v] of Object.entries(outOfScope)) {
  if (v === null) { console.error(`✗ ${NAME} CANNOT RUN — out-of-scope count "${k}" failed: ${readFailure}`); process.exit(2) }
}
if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify({ marker: 'LORAMER_ORDINAL_DEVICE_RESPELL_V1', pinnedAt: new Date().toISOString(), outOfScope }, null, 1))
  console.log(`[${NAME}] baseline PINNED: ${JSON.stringify(outOfScope)}`)
} else {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')).outOfScope
  for (const [k, v] of Object.entries(base)) {
    if (outOfScope[k] < v) findings.push(`(b2) OUT-OF-SCOPE population "${k}" SHRANK ${v} → ${outOfScope[k]} — something deleted or respelled rows outside the ruled scope`)
  }
}

if (findings.length === 0) {
  console.log(`✓ ${NAME} OK — zero ordinal device rows remain at detail_placement_view, the script is scope-pinned, and no out-of-scope population shrank.`)
  process.exit(0)
}
console.error(`✗ ${NAME} FAILED — ${findings.length} finding(s):`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
