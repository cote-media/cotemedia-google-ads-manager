#!/usr/bin/env node
// LORAMER_FORWARD_DRIVER_V1 (2/2) — check:data leg: forward-driver-connection-day-complete.
//
// Ruling (q): completeness is READ FROM THE LEDGER, never the schedule. The driver's window is */10 11:00–16:50Z with
// make-ups at 17:30Z and 21:30Z; the cutoff this leg judges is 17:00Z. For the judged day D, every eligible google
// connection (live client, google connection, not DRIVER_EXCLUDED_CLIENTS) must hold ≥ 319 forward_observation_log rows
// with producer like 'driver-%' and window_end = D — 319 = HEAVY 50 + REST 269, the catalogue the driver owns
// (forward-driver-slices.ts; a surface observed twice in a day still counts once here).
//   D = yesterday if now ≥ 17:00Z, else the day before yesterday (the window that has had its cutoff).
// RED lists the short connections with their counts. Before the first window completes this leg is RED BY DESIGN
// and queue-owned by ★FORWARD-DRIVER-SHAPE.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { restAll, restAllCounted } from './lib/rest-all.mjs' // LORAMER_REST_ROW_CAP_READER_V1 — pages from the server total, throws on a partial set

const ROOT = process.cwd()
if (existsSync(resolve(ROOT, '.env.local'))) {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('✗ forward-driver-connection-day-complete: no Supabase credentials (needs .env.local)'); process.exit(1) }
// ⛔ LORAMER_REST_ROW_CAP_READER_V1 — the first cut fetched `…&limit=100000` through a bare fetch and received 1,000 of 5,423
// rows (HTTP 206, Content-Range 0-999/5423, measured 2026-09-11 17:02Z): 16 of 17 connections read SHORT while every one
// held 319/319. A client limit= cannot raise the server's max-rows. Every read here now pages from the server's own total
// and THROWS on a partial set; the denominator printed below is the server's, not the page's.
const REQUIRED = 319 // HEAVY 50 + REST 269 (forward-driver-slices.ts; Gate-A 2026-09-10 N=319)
const EXCLUDED = new Set(['2617b163-f392-427e-9a29-f134acc51406']) // DRIVER_EXCLUDED_CLIENTS — the RMF-frozen demo twin (DECISIONS:2461); identity per the registry, src/lib/clients/canonical.ts

const now = new Date()
const dayShift = now.getUTCHours() >= 17 ? 1 : 2
const D = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayShift)).toISOString().slice(0, 10)

// clients!inner(…) is a 1:1 embed (one client per connection) — the embedded-resource cap (PostgREST #2776) cannot bite a 1:1 join.
const conns = await restAll(`platform_connections?select=client_id,account_id,clients!inner(id,name,deleted_at)&platform=eq.google`)
const eligible = conns.filter((c) => !c.clients?.deleted_at && !EXCLUDED.has(c.client_id))
const { rows: obs, total: obsTotal } = await restAllCounted(`forward_observation_log?select=client_id,resource,segment&vendor=eq.google&producer=like.driver-*&window_end=eq.${D}`)
const perClient = new Map()
for (const o of obs) { const k = `${o.resource}|${o.segment ?? ''}`; if (!perClient.has(o.client_id)) perClient.set(o.client_id, new Set()); perClient.get(o.client_id).add(k) }
const short = eligible.map((c) => ({ ...c, n: perClient.get(c.client_id)?.size ?? 0 })).filter((c) => c.n < REQUIRED)

console.log(`[forward-driver-connection-day-complete] judged day ${D} (cutoff 17:00Z) · ${eligible.length} eligible google connection(s) (${conns.length - eligible.length} excluded/deleted) · ${obs.length} driver observation row(s) held of ${obsTotal} server total · ${eligible.length - short.length} complete at ≥ ${REQUIRED} surfaces · ${short.length} short.`)
if (short.length) {
  console.error(`✗ FORWARD-DRIVER CONNECTION-DAY INCOMPLETE — ${short.length} of ${eligible.length} eligible google connection(s) hold fewer than ${REQUIRED} driver-observed surfaces for ${D}:`)
  for (const c of short) console.error(`  ${c.client_id} ${c.clients?.name ?? ''} · ${c.account_id} · ${c.n}/${REQUIRED}`)
  console.error('  ⇒ SPEC: DECISIONS ruling (q) + QUEUE ★FORWARD-DRIVER-SHAPE. RED BY DESIGN until the first driver window (*/10 11-16Z) completes; after that a short connection is a fire that was killed, refused or never claimed — read cron_runs mode=driver for the day.')
  process.exit(1)
}
console.log(`✓ forward-driver-connection-day-complete OK — every eligible google connection holds ≥ ${REQUIRED} driver-observed surfaces for ${D}.`)
