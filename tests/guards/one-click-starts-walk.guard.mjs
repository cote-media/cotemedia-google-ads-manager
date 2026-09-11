#!/usr/bin/env node
// LORAMER_ONE_CLICK_WALK_V1 (2/2 A) — THE "BACKFILL HISTORY" BUTTON FIRES THE RESUMER FOR ITS CLIENT, BESIDE THE JUNE-ENGINE KICK.
//
// Round 15 (2026-09-10) had the button publish through universe-start's core — which feeds the V1 topic consumer
// (/api/queues/google-ads-universe: universe_window_log, no inception, no attempt rows). Round 16 read the v2 path: the
// resumer's fire executes the worker INLINE (universe-resume/route.ts:812 processMessage) and the worker discovers the
// account's inception on first touch (universe-v2-worker.ts:234). So the button now fires the resumer once for that
// client — the same server-side CRON_SECRET kick pattern kickoffBackfill uses — and the v1 publish branch is gone.
// Ruling (n) keeps the drain kick: the legacy family stays the one writer of the 52 keys.
//
// LEGS
//  (a) src/lib/backfill/kickoff.ts exports kickoffWalk(origin, clientId) that fetches /api/cron/universe-resume?clientId=…&dryRun=0
//      with `Authorization: Bearer ${secret}` (CRON_SECRET server-side) inside waitUntil, like kickoffBackfill
//  (b) src/app/api/clients/backfill/route.ts calls kickoffWalk AFTER kickoffBackfill / kickoffGapBackfill (both kept), gated on
//      a google connection, and no longer imports or calls publishWalkStart (the v1 publish branch is retired)
//  (c) universe-start/route.ts still calls publishWalkStart( — the manual v1 path is untouched
//  (d) vercel.json holds exactly one universe-resume entry (the pin is 2/2 B's, live-path)
//  (e) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const KICK = 'src/lib/backfill/kickoff.ts'
const BTN = 'src/app/api/clients/backfill/route.ts'
const START = 'src/app/api/backfill/universe-start/route.ts'

const kick = strip(read(KICK))
if (!/export function kickoffWalk\s*\(/.test(kick)) findings.push(`(a) ${KICK} does not export kickoffWalk`)
else {
  const body = kick.slice(kick.indexOf('export function kickoffWalk'))
  if (!/\/api\/cron\/universe-resume\?clientId=/.test(body)) findings.push(`(a) kickoffWalk does not fetch /api/cron/universe-resume?clientId=…`)
  if (!/dryRun=0/.test(body)) findings.push(`(a) kickoffWalk omits dryRun=0 — the resumer's default is DRY, the kick would fire nothing`)
  if (!/Authorization:\s*`Bearer \$\{secret\}`/.test(body)) findings.push(`(a) kickoffWalk does not send the CRON_SECRET bearer`)
  if (!/waitUntil\s*\(/.test(body)) findings.push(`(a) kickoffWalk is not fire-and-forget under waitUntil — the button would block on a 300 s fire`)
}
const btn = strip(read(BTN))
if (!btn) findings.push(`(b) ${BTN} missing`)
else {
  const walk = btn.indexOf('kickoffWalk(')
  const kickI = btn.indexOf('kickoffBackfill(')
  const gap = btn.indexOf('kickoffGapBackfill(')
  if (walk === -1) findings.push(`(b) ${BTN} never calls kickoffWalk( — the button does not fire the resumer`)
  if (kickI === -1 || gap === -1) findings.push(`(b) ${BTN} dropped kickoffBackfill( or kickoffGapBackfill( — ruling (n): the legacy family keeps filling on the same click`)
  if (walk !== -1 && kickI !== -1 && walk < kickI) findings.push(`(b) ${BTN} fires the walk BEFORE the June-engine kick — the order is kick, then walk`)
  if (/publishWalkStart|universe-start-publish/.test(btn)) findings.push(`(b) ${BTN} still imports or calls publishWalkStart — the v1 publish branch must be gone (it feeds the v1 topic consumer, not the v2 walk)`)
  if (!/['"]google['"]/.test(btn)) findings.push(`(b) ${BTN} does not gate the walk kick on a google connection`)
}
const start = strip(read(START))
if (start && !/publishWalkStart\s*\(/.test(start)) findings.push(`(c) ${START} no longer calls publishWalkStart( — the manual v1 path moved`)
try {
  const crons = (JSON.parse(read('vercel.json')).crons || []).filter((c) => /universe-resume/.test(String(c.path || '')))
  if (crons.length !== 1) findings.push(`(d) vercel.json holds ${crons.length} universe-resume entr(ies) — the un-pin is 2/2 B (live-path)`)
} catch (e) { findings.push(`(d) vercel.json unreadable: ${e.message}`) }
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/one-click-starts-walk.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) { console.error('✗ one-click-starts-walk FAILED:'); for (const f of findings) console.error('  ' + f); process.exit(1) }
console.log("[one-click-starts-walk] PASS — /api/clients/backfill keeps the June-engine kick and then fires the resumer for its google client (kickoffWalk → universe-resume?clientId=…&dryRun=0, bearer, waitUntil); the v1 publish branch is gone; universe-start's manual path and the resumer's pin are untouched.")
