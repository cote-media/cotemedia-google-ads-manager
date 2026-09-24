#!/usr/bin/env node
// LORAMER_IMPLICIT_PRESENCE_REASK_V1 (2026-09-24, round 50) — THE RE-ASK QUEUE IS CONSUMED BY THE FIRE, INSIDE THE MISSED SLOT,
// FOR AT MOST HALF ITS BOUND, AND A ROW IS SETTLED BY THE LEDGER'S TERMINAL.
//
// WHY. Everything that makes an ask safe lives in the fire (the claim, the lane and fleet holds, the op budget, UNIT_CONCURRENCY, the
// ledger's open/finish). A side script asking Google has none of it. So the script only enqueues, and the fire asks — after the
// lookback lane (which holds the clock with the descend), inside the missed slot, taking at most REASK_REQUESTS_PER_RUN of the
// missed lane's MISSED_REQUESTS_PER_RUN so real holes keep the rest every fire. A row is done when its range is answered
// (ok|zero|nongrain), tries+1 on an error terminal, untouched when deferred; a unit that THROWS after writing its terminal is settled
// from the ledger, never marked by the throw. Source-pinned; red-first on the 2026-09-24 tree.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const R = 'src/app/api/cron/universe-resume/route.ts', S = 'src/lib/backfill/universe-resumer.ts', Q = 'src/lib/backfill/universe-reask-queue.ts', W = 'src/lib/backfill/universe-v2-worker.ts'
const read = (f) => { try { return readFileSync(resolve(ROOT, f), 'utf8') } catch { return '' } }
const route = read(R), resumer = read(S), queue = read(Q), worker = read(W)
const findings = []
const check = (ok, msg) => { if (!ok) findings.push(msg) }
check(/export const REASK_REQUESTS_PER_RUN = 4\b/.test(resumer) && /export const REASK_MAX_TRIES = 3\b/.test(resumer), `(a) ${S}: REASK_REQUESTS_PER_RUN = 4 and REASK_MAX_TRIES = 3 must be declared beside the missed lane's constants`)
check(/export const MISSED_REQUESTS_PER_RUN = 8\b/.test(resumer), `(a) ${S}: MISSED_REQUESTS_PER_RUN must stay 8 — the queue takes half of it, never more`)
check(queue.length > 0 && /export async function readReaskQueue\(/.test(queue) && /export async function settleReaskRow\(/.test(queue), `(b) ${Q}: the queue module must export readReaskQueue and settleReaskRow`)
check(/tries < REASK_MAX_TRIES|lt\('tries', REASK_MAX_TRIES\)/.test(queue), `(b) ${Q}: the read must exclude rows at REASK_MAX_TRIES — an erroring row is re-tried twice, then held visible, never forever`)
check(/\.is\('done_at', null\)/.test(queue), `(b) ${Q}: the read must select rows with done_at null`)
// (c) the fire: the queue is read inside the missed slot, before the hole scan, bounded by REASK_REQUESTS_PER_RUN, and the holes keep the rest
const i = { lookback: route.indexOf("lane: 'lookback' as const"), missed: route.indexOf("lane: 'missed' as const"), read: route.indexOf('readReaskQueue('), holes: route.indexOf('enumerateGoogleHoles({') }
check(i.lookback > 0 && i.missed > 0 && i.lookback < i.missed, `(c) ${R}: toSend must list the lookback lane before the missed lane (the two lanes that hold the clock run first)`)
check(i.read > 0 && i.holes > 0 && i.read < i.holes, `(c) ${R}: readReaskQueue must be called inside the missed slot BEFORE enumerateGoogleHoles — the queue reads first`)
check(/boundedSelection\(reaskCandidates, REASK_REQUESTS_PER_RUN\)/.test(route), `(c) ${R}: the queue's candidates must be bounded by REASK_REQUESTS_PER_RUN, never by the whole missed bound`)
check(/boundedSelection\(missed, MISSED_REQUESTS_PER_RUN - selReask\.requests\)/.test(route), `(c) ${R}: the hole scan must be bounded by MISSED_REQUESTS_PER_RUN − the queue's requests — holes keep at least four`)
check(/reaskQueued/.test(route) && /reaskSelected/.test(route) && /reaskDone/.test(route) && /reaskErrored/.test(route), `(c) ${R}: the fire instrument must carry reaskQueued, reaskSelected, reaskDone, reaskErrored`)
// (d) settlement: from the unit's outcome, and on a throw from the LEDGER's terminal
check(/outcome: lastOutcome/.test(worker) && /Promise<\{ requestsOpened: number; pastLineEmpty: number; outcome:/.test(worker), `(d) ${W}: processMessage must return the unit's outcome so the fire can settle a queue row from it`)
check(/settleReaskRow\(/.test(route), `(d) ${R}: the fire must settle a queue row after its unit`)
check(/terminalOutcomeFor\(/.test(queue) && /terminalOutcomeFor\(/.test(route), `(d) ${R}: on a throw the row must be settled from the ledger's terminal (terminalOutcomeFor), never from the throw — the terminal is already written (route.ts UNIT THREW)`)
if (findings.length) { console.error(`[reask-queue-shape] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  - ${f}`); process.exit(1) }
console.log('[reask-queue-shape] PASS — the queue is read inside the missed slot before the hole scan, bounded to REASK_REQUESTS_PER_RUN with holes keeping the rest; lookback stays ahead; rows settle from the unit outcome or the ledger terminal, tried at most REASK_MAX_TRIES.')
