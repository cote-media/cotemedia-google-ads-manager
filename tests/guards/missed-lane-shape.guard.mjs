#!/usr/bin/env node
// LORAMER_MISSED_DAY_WALK_V1 — THE FOURTH LANE HAS EXACTLY THE SHAPE THE RULING NAMED, AND NO OTHER.
//
// QUEUE ★MISSED-DAY-WALK (Russ, 2026-09-12): "a walk that RE-ASKS ANY DAY THE LEDGER SHOWS NEVER ASKED OR FAILED — any age,
// any client — once it is past the restatement boundary, on the same meter." DECISIONS LORAMER_MISSED_DAY_WALK_V1 owns
// the shape; this guard pins the parts a later edit could quietly lose:
//  (a) the route's missed candidates come from the hole map (enumerateGoogleHoles) — never from the clock or the rotation
//  (b) the enumeration's END is the boundary (T−B, the same boundary the lookback lane derives) — a hole above it is
//      inside the restatement window and is NOT the missed lane's to ask
//  (c) the route publishes the lane value 'missed' and never stamps it into the lookback frontier read (that read stays
//      .eq('lane', 'lookback')) — reusing 'lookback' would make a hole window the strip's frontier
//  (d) the worker refuses advance() for a 'missed' message before BOTH advance() sites — a missed message never self-chains
//  (e) coverage's attesting set is exactly {descend, lookback, missed} (ATTESTING_LANES) — a missed zero seals a day
//  (f) the missed lane has its own bound (MISSED_REQUESTS_PER_RUN) and is metered with the other lanes in mayFetchProgram
//  (g) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'
const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const route = strip(read(ROUTE)), worker = strip(read(WORKER)), coverage = strip(read(COVERAGE)), resumer = strip(read(RESUMER))
if (!route) findings.push(`(a) ${ROUTE} not found`)
// (a) candidates from the hole map
if (route && !/enumerateGoogleHoles\(\{/.test(route)) findings.push(`(a) ${ROUTE} never calls enumerateGoogleHoles — the missed lane's candidates must come from the hole map, never from the clock`)
if (route && !/from '@\/lib\/backfill\/google-hole-map'/.test(route)) findings.push(`(a) ${ROUTE} does not import google-hole-map`)
// (b) end = T−B
if (route && !/end:\s*missedBoundaryEnd/.test(route)) findings.push(`(b) the enumeration's end is not missedBoundaryEnd (T−B) — a hole inside the restatement window would be asked`)
if (route && !/missedBoundaryEnd\s*=\s*addDaysISO\(addDaysISO\(yesterday,\s*1\),\s*-Math\.max\(1,\s*Math\.floor\(boundary\.days\)\)\)/.test(route)) findings.push(`(b) missedBoundaryEnd is not derived as today − boundary.days (deriveBoundaryStrip's own arithmetic)`)
// (c) lane value + frontier read untouched
if (route && !/lane:\s*'missed'\s*as const/.test(route)) findings.push(`(c) ${ROUTE} never publishes lane 'missed'`)
{
  const i = route.indexOf("const lookbackFrontier = new Map")
  const j = route.indexOf("const doc = loadUniverse()", i)
  const frontierRead = i >= 0 && j > i ? route.slice(i, j) : ''
  if (!frontierRead || !/\.eq\('lane',\s*'lookback'\)/.test(frontierRead)) findings.push(`(c) the lookback frontier read no longer filters lane='lookback' — a 'missed' window would become the strip's frontier`)
  if (frontierRead && /'missed'/.test(frontierRead)) findings.push(`(c) the lookback frontier read mentions 'missed' — the two lanes must not share a frontier`)
}
// (d) both advance() sites refuse 'missed'
{
  const sites = [...worker.matchAll(/await\s+advance\(/g)].map((m) => m.index)
  if (sites.length < 2) findings.push(`(d) ${WORKER} has ${sites.length} advance() site(s); expected 2`)
  const GUARD = /if\s*\(\s*lane\s*===\s*'missed'\s*\)\s*\{[\s\S]{0,600}?\breturn\b/
  const unguarded = sites.filter((i) => !GUARD.test(worker.slice(Math.max(0, i - 1500), i)))
  if (unguarded.length) findings.push(`(d) ${unguarded.length} of ${sites.length} advance() site(s) in ${WORKER} are NOT preceded by an \`if (lane === 'missed') { … return }\` refusal — a missed message would self-chain into a second descent`)
}
// (e) attesting set
if (!/ATTESTING_LANES[^=]*=\s*new Set\(\['descend',\s*'lookback',\s*'missed'\]\)/.test(coverage)) findings.push(`(e) ${COVERAGE} ATTESTING_LANES is not exactly ['descend', 'lookback', 'missed']`)
if (!/if\s*\(!ATTESTING_LANES\.has\(lane\)\)\s*continue/.test(coverage)) findings.push(`(e) attestedEmptyDays does not filter by ATTESTING_LANES`)
// (f) own bound + shared meter
if (!/export const MISSED_REQUESTS_PER_RUN\s*=\s*\d+/.test(resumer)) findings.push(`(f) ${RESUMER} declares no MISSED_REQUESTS_PER_RUN`)
if (route && !/boundedSelection\(missed,\s*MISSED_REQUESTS_PER_RUN\)/.test(route)) findings.push(`(f) ${ROUTE} does not admit missed candidates under MISSED_REQUESTS_PER_RUN`)
if (route && !/mayFetchProgram\(adapter,\s*\[\.\.\.sel\.taken,\s*\.\.\.lookbackToSend,\s*\.\.\.selMissed\.taken\]/.test(route)) findings.push(`(f) ${ROUTE} does not meter the missed lane's spans with the other lanes in mayFetchProgram — a lane the meter cannot see is a governor granting itself the difference`)
// (g) registered
if (!/missed-lane-shape\.guard\.mjs/.test(read('scripts/run-guards.mjs'))) findings.push('(g) not registered in scripts/run-guards.mjs')
if (findings.length) {
  console.error(`[missed-lane-shape] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log("[missed-lane-shape] PASS — missed candidates come from the hole map, end at T−B, publish lane 'missed' without touching the lookback frontier, never self-chain (both advance() sites), attest, and are bounded and metered with the other lanes.")
