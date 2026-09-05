#!/usr/bin/env node
// LORAMER_FORWARD_OBSERVATION_LOG_V1 — EVERY FORWARD PRODUCER LEAVES A PER-SURFACE RECORD OF WHAT IT ASKED AND
// WHAT CAME BACK. Ruling (F), DECISIONS 2026-09-04: never a "didn't ask" day. Before this ledger the ten Google
// forward producers wrote rows or silence — an empty grain left NO row (every breadth builder skips all-zero
// rows), so a dormant day and a day nobody asked were the same absence, and yesterday's 16 vendor errors left
// nothing durable at all (forward writes no capture_pass_log, no attempt row; the Vercel log expired in an hour).
//
// WHAT THIS PINS (structure; the platform's own answer cannot be observed by a build):
//  (a) the one observation module exports FORWARD_PRODUCER_SURFACES with all ten producer keys, each with ≥1
//      catalogue surface (resource, segment) — the ONE place forward's surface spelling lives
//  (b) the google section of cron/sync/route.ts calls observeForward('<producer>', …) for each of the ten —
//      inside the producer's own block, so the record is written whether the block succeeded or threw
//  (c) observeForward catches the append and pushes into summary.errors (DEGRADED) — a failed record never
//      throws into capture
//  (d) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const PRODUCERS = [
  'google-account-row', 'google-campaign-backfill', 'google-adgroup-ad-backfill', 'google-dimensional',
  'google-device', 'google-conversion-action', 'google-impression-share', 'google-geo', 'google-hour', 'google-demographic',
]
const SYNC = 'src/app/api/cron/sync/route.ts'
const MODULE = 'src/lib/backfill/forward-observation-log.ts'

// (a) the surface map
const mod = strip(read(MODULE))
if (!mod) findings.push(`(a) ${MODULE} does not exist — there is no observation module and no surface map`)
else {
  const at = mod.indexOf('export const FORWARD_PRODUCER_SURFACES')
  if (at === -1) findings.push(`(a) ${MODULE} exports no FORWARD_PRODUCER_SURFACES — the producer→catalogue map is the one place forward's surface spelling may live`)
  else {
    const block = mod.slice(at, at + 6000)
    for (const p of PRODUCERS) {
      const m = block.match(new RegExp(`'${p}'\\s*:\\s*\\[([\\s\\S]*?)\\]`))
      if (!m) findings.push(`(a) FORWARD_PRODUCER_SURFACES has no entry for '${p}'`)
      else if (!/resource:/.test(m[1])) findings.push(`(a) FORWARD_PRODUCER_SURFACES['${p}'] names no surface (no resource:)`)
    }
  }
}

// (b) + (c) the route
const sync = strip(read(SYNC))
if (!sync) findings.push(`cannot read ${SYNC}`)
else {
  const gStart = sync.indexOf("platform === 'google'")
  const gEnd = sync.indexOf('end google guard')
  const section = gStart !== -1 && gEnd !== -1 ? sync.slice(gStart, gEnd) : ''
  if (!section) findings.push(`(b) cannot locate the google section in ${SYNC}`)
  for (const p of PRODUCERS) {
    if (!new RegExp(`observeForward\\(\\s*'${p}'`).test(section)) findings.push(`(b) the google section never calls observeForward('${p}', …) — that producer's ask leaves no per-surface record, and an empty answer from it is a "didn't ask" day by another name`)
  }
  if (!/async function observeForward\(/.test(sync)) findings.push(`(c) ${SYNC} defines no observeForward helper`)
  else {
    const i = sync.indexOf('async function observeForward(')
    const helper = sync.slice(i, i + 2500)
    if (!/appendForwardObservation\(/.test(helper)) findings.push(`(c) observeForward does not call appendForwardObservation`)
    if (!/catch\s*\(/.test(helper) || !/summary\.errors\.push/.test(helper)) findings.push(`(c) observeForward does not catch the append into summary.errors — a failed record would throw into capture`)
  }
  if (!/from '@\/lib\/backfill\/forward-observation-log'/.test(sync)) findings.push(`(b) ${SYNC} does not import the observation module`)
}

// (d) registered
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/forward-producers-are-observed.guard.mjs')) findings.push('(d) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length === 0) {
  console.log(`forward-producers-are-observed: PASSED — all ${PRODUCERS.length} Google forward producers record what they asked and what came back through observeForward, the surface map lives in one module, and a failed record degrades rather than throws.`)
  process.exit(0)
}
console.error(`forward-producers-are-observed: FAILED — ${findings.length} finding(s)`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
