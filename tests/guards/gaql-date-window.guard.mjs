#!/usr/bin/env node
// LORAMER_GAQL_DATE_WINDOW_V1 — NO GAQL QUERY MAY INTERPOLATE A PRESET INTO `DURING`. ONE RESOLVER, EXPLICIT BETWEEN.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// `segments.date DURING ${dateRange}` is only valid when the runtime value happens to be a GAQL enum. Two of the
// presets the legacy UI actually offers are NOT enums — LAST_90_DAYS and CUSTOM — so the interpolation is a hard
// vendor error wearing a working query's clothes. It shipped EIGHT times, and every failure was silent: the
// route 500s, the caller's `d.rows || []` swallows it, and the screen shows 0 rows indistinguishable from a
// genuinely empty window. Proven live 2026-08-14 on the Campaigns drill (0 ad groups on LAST_90_DAYS while
// 30-day worked), and the keyword copy of the same defect shipped its fix scoped to keywords only (b1d8d3e) —
// this guard exists so the class is closed once, not one surface at a time.
//
// CLAUDE.md already states the rule ("there is no LAST_90_DAYS enum — use explicit BETWEEN via
// resolveDateWindow", Lesson 19). It was written down and shipped anyway, eight times. RULE-HOME LAW: a rule
// broken repeatedly needs an ENFORCER, not another entry. This is the enforcer.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
//   1. TREE-WIDE ZERO: no non-comment line in src/**/*.ts|tsx or mcp-server.js interpolates into DURING
//      (`DURING ${...}`). This is the CLASS half — a new file reintroducing the pattern fails the build.
//   2. The eight formerly-defective files each call resolveDateWindow AND emit the canonical
//      `segments.date BETWEEN '${startDate}' AND '${endDate}'` — so the fix is the ONE resolver, not a ninth
//      hand-rolled date computation.
//   3. resolveDateWindow's CUSTOM guard survives: CUSTOM with either date missing falls through to the default
//      window instead of returning {undefined, undefined} → `BETWEEN 'undefined' AND 'undefined'`.
//   4. /api/campaigns forwards customStart/customEnd (the params-dropped defect the keywords route had).
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// STATIC SOURCE READ. It proves no DURING interpolation exists and the resolver is wired; it cannot prove the
// emitted window is the one the user picked, that Google returns rows, or that a literal `DURING LAST_30_DAYS`
// (legal GAQL, deliberately out of scope) is used sensibly. The live half is scripts/rmf-adapter-gate.mjs --drill.
//
// USAGE: node tests/guards/gaql-date-window.guard.mjs [--inject-during] [--inject-drop-resolver] [--inject-drop-custom-guard]
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

const INJECT_DURING = process.argv.includes('--inject-during')
const DROP_RESOLVER = process.argv.includes('--inject-drop-resolver')
const DROP_CUSTOM_GUARD = process.argv.includes('--inject-drop-custom-guard')

// The eight sites that carried the defect on 2026-08-14 — each must now go through the one resolver.
const RESOLVED_FILES = [
  'src/app/api/google/adgroups/route.ts',
  'src/app/api/google/adgroups/daily/route.ts',
  'src/app/api/google/ads/route.ts',
  'src/app/api/platform/route.ts',
  'src/lib/google-ads.ts',
  'src/lib/platforms/google.ts',
  'src/lib/intelligence/google-intelligence.ts',
]
const CANONICAL = "segments.date BETWEEN '${startDate}' AND '${endDate}'"

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
export function decideGaqlDateWindow({ duringSites, unresolvedFiles, customGuardOk, campaignsForwardsCustoms }) {
  const f = []
  for (const s of duringSites) f.push(`LIVE \`DURING \${\` interpolation at ${s} — a hard GAQL error for LAST_90_DAYS/CUSTOM that renders as 0 rows. Route it through resolveDateWindow → explicit BETWEEN.`)
  for (const file of unresolvedFiles) f.push(`${file}: no resolveDateWindow call or no canonical BETWEEN template — the file has left the one-resolver shape (Lesson 19), which is how eight copies of this bug accumulated.`)
  if (!customGuardOk) f.push(`src/lib/date-range.ts: the CUSTOM guard is gone — dateRange === 'CUSTOM' with a missing date would again resolve to {undefined, undefined} and emit BETWEEN 'undefined' AND 'undefined'.`)
  if (!campaignsForwardsCustoms) f.push(`src/app/api/campaigns/route.ts: customStart/customEnd no longer forwarded to getAccountSummary — the params-dropped defect (a working-looking date picker feeding nothing) returns.`)
  return { findings: f, ok: f.length === 0 }
}

// ── INPUTS ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Tree walk: every .ts/.tsx under src, plus mcp-server.js. Comment lines are excluded — the fix commentary
// legitimately names the banned pattern; only executable interpolation is the defect.
const files = ['mcp-server.js']
const walk = (dir) => {
  for (const e of readdirSync(path.resolve(ROOT, dir))) {
    const rel = `${dir}/${e}`
    const st = statSync(path.resolve(ROOT, rel))
    if (st.isDirectory()) walk(rel)
    else if (/\.(ts|tsx)$/.test(e)) files.push(rel)
  }
}
walk('src')

const duringSites = INJECT_DURING ? ['src/lib/injected-example.ts:1'] : []
if (!INJECT_DURING) {
  for (const rel of files) {
    const src = read(rel)
    if (src === null) continue
    src.split('\n').forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      if (/DURING\s*\$\{/.test(line)) duringSites.push(`${rel}:${i + 1}`)
    })
  }
}

const unresolvedFiles = RESOLVED_FILES.filter((rel) => {
  if (DROP_RESOLVER) return true
  const src = read(rel)
  if (src === null) return true
  return !(src.includes('resolveDateWindow(') && src.includes(CANONICAL))
})

const dateRangeSrc = read('src/lib/date-range.ts') || ''
// The guard property: the custom branch requires BOTH dates (no `|| dateRange === 'CUSTOM'` shortcut back).
const customGuardOk = !DROP_CUSTOM_GUARD
  && /if \(customStart && customEnd\) \{/.test(dateRangeSrc)
  && !/\(customStart && customEnd\) \|\| dateRange === 'CUSTOM'/.test(dateRangeSrc)

const campaignsSrc = read('src/app/api/campaigns/route.ts') || ''
const campaignsForwardsCustoms = /getAccountSummary\(session\.refreshToken,\s*accountId,\s*dateRange,\s*customStart,\s*customEnd\)/.test(campaignsSrc)

for (const [flag, note] of [
  [INJECT_DURING, '[--inject-during] simulated one live DURING interpolation in the check INPUT (no file written)'],
  [DROP_RESOLVER, '[--inject-drop-resolver] treated every resolver wiring as absent in the check INPUT'],
  [DROP_CUSTOM_GUARD, '[--inject-drop-custom-guard] treated the CUSTOM guard as removed in the check INPUT'],
]) if (flag) console.log(`  ${note} — it must go RED.`)

// ── REPORT, ALWAYS WITH ITS DENOMINATOR ─────────────────────────────────────────────────────────────────────────
const v = decideGaqlDateWindow({ duringSites, unresolvedFiles, customGuardOk, campaignsForwardsCustoms })
console.log(`[gaql-date-window] scanned ${files.length} files · live DURING interpolations: ${duringSites.length} · resolver-wired: ${RESOLVED_FILES.length - unresolvedFiles.length}/${RESOLVED_FILES.length} named files`)
console.log(`[gaql-date-window] resolver CUSTOM guard=${customGuardOk} · /api/campaigns forwards customs=${campaignsForwardsCustoms}`)
console.log('[gaql-date-window] STATIC READ — proves the pattern is gone and the resolver is wired, NOT that Google returns rows. Live half: scripts/rmf-adapter-gate.mjs --drill.')
if (!v.ok) {
  console.error(`✗ gaql-date-window FAIL — ${v.findings.length} finding(s):`)
  for (const f of v.findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ gaql-date-window OK — zero DURING interpolations tree-wide; one resolver everywhere it was ever wrong.')
process.exit(0)
