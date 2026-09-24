#!/usr/bin/env node
// LORAMER_IDLE_SEED_RETRACTION_V1 (2026-09-24, round 45) — EVERY ATTESTATION READER READS THE ONE VIEW.
//
// WHY. A retraction row (outcome 'retracted', migration 104) un-attests a day ONLY through readers that honour it. Before this
// build every reader of vendor-attested empties read universe_attempt_log directly with an ANY-ROW filter on
// outcome zero|nongrain, so 390 false idle terminals attested 138,600 surface-days that no later row could reach. The view
// public.universe_attesting_terminals is the single owner of "what attests"; this guard pins (a) that each attestation
// reader names it and (b) that no file under src, scripts or tests/guards reads the table with a zero|nongrain outcome
// filter again — the shape that re-trusts a retracted row. Red-first on the 2026-09-24 tree (6 readers on the table).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const VIEW = 'universe_attesting_terminals'
const READERS = [
  'src/lib/backfill/universe-coverage.ts',
  'scripts/check-capture-landing.mjs',
  'tests/guards/no-owed-day-left-behind.guard.mjs',
]
const SELF = 'tests/guards/attesting-readers-use-the-view.guard.mjs'
const findings = []
for (const f of READERS) {
  const s = readFileSync(resolve(ROOT, f), 'utf8')
  if (!s.includes(VIEW)) findings.push(`(a) ${f} does not read ${VIEW} — a retraction row cannot reach it`)
}
// The TS reader must read the view at every attestation site (three in universe-coverage.ts), never the table with the old filter.
const cov = readFileSync(resolve(ROOT, READERS[0]), 'utf8')
const viewReads = (cov.match(/\.from\('universe_attesting_terminals'\)/g) ?? []).length
if (viewReads < 3) findings.push(`(a) universe-coverage.ts reads the view ${viewReads} time(s); attestedEmptyDays, daysNoLongerOwedSince and askingWithoutProgressSince make three attestation reads`)
const FORBIDDEN = [
  /\.in\(\s*'outcome'\s*,\s*\[\s*'zero'\s*,\s*'nongrain'\s*\]\s*\)/,
  /outcome\s+in\s*\(\s*'zero'\s*,\s*'nongrain'\s*\)/i,
  /outcome\s+in\s*\(\s*'ok'\s*,\s*'zero'\s*,\s*'nongrain'\s*\)/i,
]
const walk = (dir, out = []) => { for (const e of readdirSync(dir)) { const p = join(dir, e); const st = statSync(p); if (st.isDirectory()) { if (e !== 'node_modules' && e !== '.next') walk(p, out) } else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p) } return out }
for (const dir of ['src', 'scripts', 'tests/guards']) {
  for (const p of walk(resolve(ROOT, dir))) {
    const rel = relative(ROOT, p)
    if (rel === SELF) continue
    // comment lines never read anything: strip `//` and `--` lines (a comment quoting the old filter is prose, not a read)
    const s = readFileSync(p, 'utf8').split('\n').map((l) => (/^\s*(\/\/|--|\*)/.test(l) ? '' : l)).join('\n')
    // the ok|zero|nongrain triple sizes lanes in top-edge-is-held (held_top) and route.ts:335 (lookback frontier) — those are
    // ANSWER reads, not attestation, and stay on the table; the triple is forbidden only inside the attestation readers.
    const pats = READERS.includes(rel) ? FORBIDDEN : FORBIDDEN.slice(0, 2)
    for (const re of pats) {
      const m = s.match(re)
      if (m) { const line = s.slice(0, m.index).split('\n').length; findings.push(`(b) ${rel}:${line} filters universe_attempt_log on outcome zero|nongrain directly (${m[0]}) — read ${VIEW}; a direct read re-trusts a retracted row`) }
    }
  }
}
if (findings.length) { console.error(`[attesting-readers-use-the-view] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  - ${f}`); process.exit(1) }
console.log(`[attesting-readers-use-the-view] PASS — ${READERS.length} attestation readers name ${VIEW} (universe-coverage.ts reads it ${viewReads}×) and no file under src, scripts or tests/guards filters the table on zero|nongrain directly.`)
