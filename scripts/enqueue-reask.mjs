#!/usr/bin/env node
// LORAMER_IMPLICIT_PRESENCE_REASK_V1 (2026-09-24, round 50) — ENQUEUE named surface-windows for the FIRE to re-ask (it never asks itself).
//
// --use=dropped-side: for every client and each of the 5 asset-interaction entries, the covered span of existing rows
//   (breakdown_type asset_interaction_target_interaction_on_this_asset) in 360-day chunks — the false side was dropped by the writer
//   (implicit-presence bool), and those days read COVERED by the true rows, so no lane will re-ask them on its own.
// --use=retracted: Tri-Copy's retracted idle windows (LORAMER_IDLE_SEED_RETRACTION_V1) not yet answered by a later ok|zero|nongrain
//   terminal covering the whole range — the missed lane reaches them only as its cursor sweeps.
// IDEMPOTENT: the unique index (client, vendor, resource, segment, window, reason) refuses a duplicate; --dry counts what --apply would add.
// USAGE: node scripts/enqueue-reask.mjs --dry | --apply --use=dropped-side | --use=retracted
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const APPLY = process.argv.includes('--apply'), DRY = process.argv.includes('--dry')
const USE = (process.argv.find((a) => a.startsWith('--use=')) ?? '').slice(6)
if (APPLY === DRY || !['dropped-side', 'retracted'].includes(USE)) { console.error('usage: --dry | --apply --use=dropped-side | --use=retracted'); process.exit(2) }
const CHUNK = 360
const SEG = 'segments.asset_interaction_target.interaction_on_this_asset', BT = 'asset_interaction_target_interaction_on_this_asset'
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await db.connect()
await db.query(`set statement_timeout = '600s'`)
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const plan = []
if (USE === 'dropped-side') {
  const { rows } = await db.query(`select client_id, entity_level as resource, min(date)::text as s, max(date)::text as e, count(distinct date)::int as days
    from metrics_daily where platform='google' and breakdown_type=$1 group by 1, 2 order by 1, 2`, [BT])
  for (const r of rows) for (let s = r.s; s <= r.e; s = addDays(s, CHUNK)) {
    const e = addDays(s, CHUNK - 1) <= r.e ? addDays(s, CHUNK - 1) : r.e
    plan.push({ client: r.client_id, resource: r.resource, segment: SEG, ws: s, we: e, reason: 'dropped-side' })
  }
  console.log(`[enqueue] dropped-side: ${rows.length} client×surface span(s) → ${plan.length} window(s) of ≤${CHUNK} days`)
} else {
  const { rows } = await db.query(`with ret as (select distinct client_id, vendor, resource, coalesce(segment,'') as segment, window_start, window_end, recorded_at
      from universe_attempt_log where outcome='retracted')
    select r.client_id, r.resource, r.segment, r.window_start::text as ws, r.window_end::text as we
      from ret r where not exists (select 1 from universe_attempt_log a where a.client_id=r.client_id and a.vendor=r.vendor and a.resource=r.resource and coalesce(a.segment,'')=r.segment
        and a.phase='attempt_finished' and a.outcome in ('ok','zero','nongrain') and a.recorded_at > r.recorded_at and a.window_start <= r.window_start and a.window_end >= r.window_end)
      order by 1, 4, 2, 3`)
  for (const r of rows) plan.push({ client: r.client_id, resource: r.resource, segment: r.segment, ws: r.ws, we: r.we, reason: 'retracted' })
  console.log(`[enqueue] retracted: ${plan.length} retracted surface-window(s) still unanswered`)
}
let dup = 0, toWrite = 0, written = 0
for (const p of plan) {
  const { rows } = await db.query(`select 1 from universe_reask_queue where client_id=$1 and vendor='google' and resource=$2 and segment=$3 and window_start=$4 and window_end=$5 and reason=$6`, [p.client, p.resource, p.segment, p.ws, p.we, p.reason])
  if (rows.length) { dup++; continue }
  toWrite++
  if (APPLY) { await db.query(`insert into universe_reask_queue (client_id, vendor, resource, segment, window_start, window_end, reason, invocation) values ($1,'google',$2,$3,$4,$5,$6,$7)`, [p.client, p.resource, p.segment, p.ws, p.we, p.reason, `enqueue:LORAMER_IMPLICIT_PRESENCE_REASK_V1:${new Date().toISOString().slice(0, 10)}`]); written++ }
}
const byClient = plan.reduce((m, p) => m.set(p.client.slice(0, 8), (m.get(p.client.slice(0, 8)) ?? 0) + 1), new Map())
console.log(`[enqueue] ${DRY ? 'DRY' : 'APPLY'} ${USE}: ${toWrite} row(s) to enqueue · ${dup} already queued · by client ${[...byClient].map(([c, n]) => `${c} ${n}`).join(' · ')}${APPLY ? ` · APPLIED ${written}` : ''}`)
await db.end()
