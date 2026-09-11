#!/usr/bin/env node
// LORAMER_ONE_CLICK_WALK_V1 (1/2) — THE DATA-HISTORY READOUT ANSWERS FOR GOOGLE FROM THE WALK'S FLOOR, NOT A JUNE-ENGINE CURSOR.
//
// Round 14 (2026-09-10) measured the old readout: Escential read "Complete back to 2026-02-23" from a sync_state cursor
// swept to 2015 while the account's inception is 2022-08-13 — a completion claim over ground nobody walked (the
// ★check-completion-claims class). For google the answer is now the walk's: inception UNKNOWN → not-started; every
// catalogue surface floor-sealed → complete back to the floor; otherwise partial back to the walk's earliest window.
//
// LEGS
//  (a) src/app/api/backfill/status/route.ts calls readWalkStopAccountFacts( for google and skips the sync_state-derived
//      entry for platform 'google' (the loop must `continue` on google before it reads r.backfill_complete)
//  (b) the google branch never assigns from backfill_complete / backfill_earliest_date (the stripped source of the
//      google block carries neither name)
//  (c) it carries the three states 'not-started' · 'complete' · 'partial'
//  (d) src/components/redesign/ClientPage.tsx renders 'Not started' for state 'not-started'
//  (e) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const STATUS = 'src/app/api/backfill/status/route.ts'
const PAGE = 'src/components/redesign/ClientPage.tsx'
const st = strip(read(STATUS))
if (!st) findings.push(`(a) ${STATUS} missing`)
else {
  if (!/readWalkStopAccountFacts\s*\(/.test(st)) findings.push(`(a) ${STATUS} never calls readWalkStopAccountFacts( — the google readout is not the walk's`)
  if (!/r\.platform === ['"]google['"]\)\s*continue/.test(st.replace(/\s+/g, ' '))) findings.push(`(a) ${STATUS} does not skip platform 'google' in the sync_state loop — the June-engine cursor still answers for google`)
  const gIdx = st.indexOf('async function googleWalkStatus')
  if (gIdx === -1) findings.push(`(b) ${STATUS} has no googleWalkStatus( — the walk-floor branch is not isolated`)
  else {
    const block = st.slice(gIdx, st.indexOf('\n}', gIdx) + 2)
    if (/backfill_complete|backfill_earliest_date/.test(block)) findings.push(`(b) googleWalkStatus reads backfill_complete / backfill_earliest_date — the walk floor must not be a cursor`)
    for (const s of ["'not-started'", "'complete'", "'partial'"]) if (!block.includes(s)) findings.push(`(c) googleWalkStatus lacks the state ${s}`)
  }
}
const page = read(PAGE)
if (page && !/Not started/.test(page)) findings.push(`(d) ${PAGE} does not render 'Not started'`)
if (page && !/state === ['"]not-started['"]/.test(page.replace(/\s+/g, ' '))) findings.push(`(d) ${PAGE} does not branch on state 'not-started'`)
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/readout-reads-walk-floor.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) { console.error('✗ readout-reads-walk-floor FAILED:'); for (const f of findings) console.error('  ' + f); process.exit(1) }
console.log("[readout-reads-walk-floor] PASS — /api/backfill/status answers google from readWalkStopAccountFacts + the walk's seals (not-started · complete · partial), never from backfill_complete / backfill_earliest_date; ClientPage renders 'Not started'.")
