#!/usr/bin/env node
// LORAMER_ONE_CLICK_WALK_V1 (1/2) — THE "BACKFILL HISTORY" BUTTON STARTS THE WALK, ONCE, BESIDE THE JUNE-ENGINE KICK.
//
// ESSENCE LORAMER_BACKFILL_DONE_DONE_V1: done is proven "through the REAL entry path" — one Backfill button. Round 14
// (2026-09-10) read that the button reached the June engine only (/api/clients/backfill → kickoffBackfill → /api/cron/drain)
// and that nothing but a manual, unscheduled universe-start ever published the walk's first-touch message. This commit
// makes the button publish it — for THIS client, most recent window, every selectable entry — through the SAME publish
// universe-start uses (extracted to src/lib/backfill/universe-start-publish.ts; universe-start keeps its shell).
// Ruling (n) keeps the drain kick: the legacy family stays the one writer of the 52 keys; the surfaces are disjoint.
//
// LEGS
//  (a) src/app/api/clients/backfill/route.ts imports publishWalkStart from @/lib/backfill/universe-start-publish and calls it
//      for a google connection, AFTER the existing kickoffBackfill / kickoffGapBackfill calls (both must remain)
//  (b) the publish core refuses a client that already holds an inception row or attempt rows: universe-start-publish.ts reads
//      universe_account_inception (readAccountInception) and universe_attempt_log before send(, and carries the literal
//      'already-started'
//  (c) universe-start/route.ts still calls publishWalkStart (the shell) — the two callers share one core
//  (d) vercel.json is untouched by this commit: the universe-resume entry count is still exactly 1 (round 16 is per-client)
//  (e) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const BTN = 'src/app/api/clients/backfill/route.ts'
const CORE = 'src/lib/backfill/universe-start-publish.ts'
const START = 'src/app/api/backfill/universe-start/route.ts'

const btn = strip(read(BTN))
if (!btn) findings.push(`(a) ${BTN} missing`)
else {
  if (!/from\s+['"]@\/lib\/backfill\/universe-start-publish['"]/.test(btn)) findings.push(`(a) ${BTN} does not import @/lib/backfill/universe-start-publish — the button does not start the walk`)
  const pub = btn.indexOf('publishWalkStart(')
  const kick = btn.indexOf('kickoffBackfill(')
  const gap = btn.indexOf('kickoffGapBackfill(')
  if (pub === -1) findings.push(`(a) ${BTN} never calls publishWalkStart( — the button reaches the June engine only`)
  if (kick === -1 || gap === -1) findings.push(`(a) ${BTN} dropped kickoffBackfill( or kickoffGapBackfill( — ruling (n): the legacy family keeps filling on the same click`)
  if (pub !== -1 && kick !== -1 && pub < kick) findings.push(`(a) ${BTN} publishes the walk BEFORE the June-engine kick — the order is kick, then walk`)
  if (!/['"]google['"]/.test(btn)) findings.push(`(a) ${BTN} does not gate the walk publish on a google connection`)
}
const core = strip(read(CORE))
if (!core) findings.push(`(b) ${CORE} missing — the publish core was not extracted`)
else {
  if (!/export async function publishWalkStart\s*\(/.test(core)) findings.push(`(b) ${CORE} does not export publishWalkStart`)
  const incep = core.indexOf('readAccountInception(')
  const attempts = core.indexOf("from('universe_attempt_log')")
  const sendIdx = core.indexOf('send(')
  if (incep === -1) findings.push(`(b) ${CORE} never reads universe_account_inception (readAccountInception) — a second click would re-publish a walked client`)
  if (attempts === -1) findings.push(`(b) ${CORE} never reads universe_attempt_log — a client with rotation rows must not be re-started`)
  if (sendIdx === -1) findings.push(`(b) ${CORE} never calls send( — nothing is published`)
  if (incep !== -1 && sendIdx !== -1 && incep > sendIdx) findings.push(`(b) ${CORE} reads the inception row AFTER send( — the idempotency check must precede the publish`)
  if (!/already-started/.test(core)) findings.push(`(b) ${CORE} carries no 'already-started' outcome`)
}
const start = strip(read(START))
if (start && !/publishWalkStart\s*\(/.test(start)) findings.push(`(c) ${START} does not call publishWalkStart( — two publish cores would drift`)
try {
  const crons = (JSON.parse(read('vercel.json')).crons || []).filter((c) => /universe-resume/.test(String(c.path || '')))
  if (crons.length !== 1) findings.push(`(d) vercel.json holds ${crons.length} universe-resume entr(ies) — this commit must not touch the resumer's schedule (round 16, live-path)`)
} catch (e) { findings.push(`(d) vercel.json unreadable: ${e.message}`) }
// (f) THE ENOENT TRAP, indirect edition (measured 2026-09-10 20:52Z on the driver route): the button route reaches loadUniverse()
//     through the publish core, so it needs its own outputFileTracingIncludes entry.
const cfg = read('next.config.js')
if (!/['"]\/api\/clients\/backfill['"]\s*:\s*\[\s*['"]\.\/docs\/google-ads-capture-universe\.json['"]\s*\]/.test(cfg)) findings.push("(f) next.config.js outputFileTracingIncludes has no '/api/clients/backfill': ['./docs/google-ads-capture-universe.json'] entry — the walk publish ENOENTs on Vercel while passing every local check")

const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/one-click-starts-walk.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) { console.error('✗ one-click-starts-walk FAILED:'); for (const f of findings) console.error('  ' + f); process.exit(1) }
console.log('[one-click-starts-walk] PASS — /api/clients/backfill keeps the June-engine kick and then publishes the walk\'s first-touch messages for a google connection through the one extracted core (idempotent on inception/attempt rows); universe-start shares that core; the resumer entry is untouched.')
