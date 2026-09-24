#!/usr/bin/env node
// LORAMER_IMPLICIT_PRESENCE_REASK_V1 (2026-09-24, round 50) — check:data leg reask-queue-exhausted: a queue row that reached
// REASK_MAX_TRIES with done_at null is a FINDING (the fire will not re-try it; a human must), never a silent stall. Also prints
// the pending / done counts per reason so a stuck queue is visible.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { restAll } from './lib/rest-all.mjs'
const ROOT = process.cwd()
if (existsSync(resolve(ROOT, '.env.local'))) for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const REASK_MAX_TRIES = 3 // mirrors universe-resumer.ts REASK_MAX_TRIES (the guard reask-queue-shape pins the source value)
let rows
try { rows = await restAll(`universe_reask_queue?select=id,client_id,resource,segment,window_start,window_end,reason,tries,done_at,last_error,enqueued_at`) }
catch (e) { console.error(`[reask-queue] CANNOT RUN — ${e.message}`); process.exit(2) }
const pending = rows.filter((r) => !r.done_at && r.tries < REASK_MAX_TRIES), done = rows.filter((r) => r.done_at), exhausted = rows.filter((r) => !r.done_at && r.tries >= REASK_MAX_TRIES)
const by = (xs) => { const m = new Map(); for (const r of xs) m.set(r.reason, (m.get(r.reason) ?? 0) + 1); return [...m].map(([k, n]) => `${k} ${n}`).join(' · ') || 'none' }
console.log(`[reask-queue] rows ${rows.length} · pending ${pending.length} (${by(pending)}) · done ${done.length} (${by(done)}) · exhausted ${exhausted.length}`)
if (exhausted.length) {
  console.error(`✗ reask-queue-exhausted FAILED — ${exhausted.length} row(s) reached ${REASK_MAX_TRIES} tries with done_at null (the fire will not re-try them):`)
  for (const r of exhausted.slice(0, 20)) console.error(`  - ${r.client_id.slice(0, 8)} ${r.resource}${r.segment ? '/' + r.segment : ''} ${r.window_start}..${r.window_end} (${r.reason}): ${String(r.last_error ?? '').slice(0, 140)}`)
  process.exit(1)
}
console.log(`✓ reask-queue OK — no row exhausted its tries.`)
