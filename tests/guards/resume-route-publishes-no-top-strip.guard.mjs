#!/usr/bin/env node
// LORAMER_LOOKBACK_LANE_V1 — THE TOP-EDGE LANE IS RETIRED INSIDE THE LOOKBACK COMMIT (DECISIONS
// LORAMER_SESSION_2026_09_05_RULINGS (j)); NO LIVE CALL MAY DERIVE OR PUBLISH A TOP STRIP AGAIN.
//
// ⛔ WHY A GUARD AND NOT A DELETION: deriveTopStrip is deleted from universe-resumer.ts in the same commit, so a
// re-introduction would also fail tsc — but tsc fails LATE (at build) and says nothing about WHY the symbol is
// gone. This guard fails FIRST and names the ruling. It is a STRUCTURAL read of the route (comments stripped):
// three shapes, any one of which re-opens the lane the ruling closed —
//   (a) a live `deriveTopStrip(` call,
//   (b) a message published under `lane: 'top-edge'`,
//   (c) a selection bounded by `TOP_EDGE_REQUESTS_PER_RUN`.
// The lane's HISTORY stays readable (20k+ 'top-edge' rows; resolveTerminalLane still resolves them, never
// attesting) — this guard is about PUBLISHING, and the string 'top-edge' inside coverage reads is not its subject.
// ⛔ SELF-TEST FIRST: a planted call must produce a finding, or the guard is measuring nothing and says so (exit 2).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const ROUTE = process.env.LORAMER_RESUME_ROUTE || 'src/app/api/cron/universe-resume/route.ts'
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

export function findingsFor(code) {
  const out = []
  const m1 = code.match(/\bderiveTopStrip\s*\(/)
  if (m1) out.push(`(a) a live \`deriveTopStrip(\` call is present — the top strip is being derived again. Ruling (j): the strip is the driver's; the resume route's second slot derives BOUNDARY windows (deriveBoundaryStrip) only.`)
  if (/lane:\s*'top-edge'/.test(code)) out.push(`(b) a message is published under \`lane: 'top-edge'\` — the retired lane is publishing. Only 'descend' and 'lookback' may be published.`)
  if (/\bTOP_EDGE_REQUESTS_PER_RUN\b/.test(code)) out.push(`(c) \`TOP_EDGE_REQUESTS_PER_RUN\` is referenced — a selection is being bounded for the retired lane. The second slot's bound is LOOKBACK_REQUESTS_PER_RUN.`)
  return out
}

// ── SELF-TEST — the planted shapes must red, or this guard is a comment ────────────────────────────────
const planted = [
  "const s = deriveTopStrip({ descendTopEnd: null, newestServable: 'x', maxSpanDays: 1 })",
  "toSend.push({ c, lane: 'top-edge' as const })",
  'const selTop = boundedSelection(topEdge, TOP_EDGE_REQUESTS_PER_RUN)',
]
for (const p of planted) {
  if (findingsFor(stripComments(p)).length === 0) {
    console.error(`✗ resume-route-publishes-no-top-strip SELF-TEST FAILED — planted \`${p}\` produced no finding. A guard that cannot see its own fixture is not a guard.`)
    process.exit(2)
  }
}
// a comment mentioning the symbol is NOT a finding — history stays describable
if (findingsFor(stripComments('// deriveTopStrip( used to live here; see ruling (j)')).length !== 0) {
  console.error('✗ resume-route-publishes-no-top-strip SELF-TEST FAILED — a comment tripped the guard; comments must be stripped before matching.')
  process.exit(2)
}

let src = ''
try { src = stripComments(readFileSync(resolve(ROOT, ROUTE), 'utf8')) } catch (e) {
  console.error(`✗ resume-route-publishes-no-top-strip CANNOT RUN — ${ROUTE} unreadable (${e.message}). A guard that cannot read its subject FAILS rather than passing.`)
  process.exit(2)
}
const f = findingsFor(src)
if (f.length) {
  console.error(`✗ RESUME-ROUTE-PUBLISHES-NO-TOP-STRIP FAILED — ${f.length} finding(s) in ${ROUTE}:`)
  for (const x of f) console.error(`  - ${x}`)
  console.error('  ⇒ SPEC: DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (j) + QUEUE ★LOOKBACK-LANE-OWNS-PROMOTION (2)/(5). The lookback lane IS the top-edge lane converted; retirement is inside that commit.')
  process.exit(1)
}
console.log(`[resume-route-publishes-no-top-strip] PASS — ${ROUTE} derives no top strip, publishes no 'top-edge' message and selects under no TOP_EDGE bound (3 planted shapes seen red in the self-test).`)
