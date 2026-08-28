#!/usr/bin/env node
// LORAMER_DEVICE_LEGACY_RESPELL_V1 — LEGACY-LEVEL DEVICE ROWS CARRY EXACTLY ONE SPELLING, THE RULED CANON (names).
//
// ⛔ THE DEFECT THIS PINS, measured live 2026-08-26 on real rows: the pre-canonical writes left 3,751 google
// device rows at the LEGACY levels (campaign 2,017 · ad_group 1,734, Foam OH only, 2022-03-05..2023-06-27)
// spelled as raw vendor ints '2'..'6' beside the canonical names — 143 of them TWINS of an existing named row
// under the 7-column key (identical across every metric column, re-proven 2026-08-26). Consequence today:
// Lora's device ranking renders buckets literally named "2"/"3"/"4" beside MOBILE/TABLET/DESKTOP, and every
// sum crossing the twin span double-counts those 143 keys. The mapping is the VENDOR'S OWN NUMBERING
// (protos.json decode table in the installed google-ads-api 23.0.0: MOBILE=2 TABLET=3 DESKTOP=4 OTHER=5
// CONNECTED_TV=6 — adversary-verified against the warehouse twins themselves, 2026-08-26), owned in code by
// DEVICE_ENUM_NAME / canonicalBreakdownValue (universe-surfaces.ts), which canonical-key-spelling.guard leg (r)
// pins to the producer. The map below restates it ONLY as a filter/probe key, exactly like the hour check.
//
// TWO BEHAVIOURAL LEGS, reading the same rows the merge writes (DB-reading → check:data roster, never the
// build path). Per-client × QUARTER windows (the live PostgREST ceiling is 8s; the row cap is ~1000 — both
// bit the hour check first, so this one is born scoped and paginated):
//  (a) NO ordinal device row remains on platform google at entity_level campaign or ad_group.
//  (b) NO (client, entity_level, entity_id, date) holds BOTH an ordinal and its named form.
// This check is DESIGNED-RED until the approved merge executes; registration in run-checkdata.mjs follows
// the execution commit, per the device-respell and hour-respell precedent (a designed-red check is not registered).
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
if (existsSync(resolve(ROOT, '.env.local'))) {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('✗ device-legacy-spelling-merge: no Supabase credentials (needs .env.local)'); process.exit(1) }

const NAME_OF = { '0': 'UNSPECIFIED', '1': 'UNKNOWN', '2': 'MOBILE', '3': 'TABLET', '4': 'DESKTOP', '5': 'OTHER', '6': 'CONNECTED_TV' }
const LEVELS = 'entity_level=in.(campaign,ad_group)'
const QUARTERS = []
for (let y = 2022; y <= 2026; y++) for (const q of ['01-01', '04-01', '07-01', '10-01']) {
  const from = `${y}-${q}`
  const to = q === '10-01' ? `${y + 1}-01-01` : `${y}-${q === '01-01' ? '04-01' : q === '04-01' ? '07-01' : '10-01'}`
  QUARTERS.push([from, to])
}
async function rest(path) {
  const out = []
  const PAGE = 1000
  for (let start = 0; ; start += PAGE) {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${start}-${start + PAGE - 1}` } })
    if (!r.ok && r.status !== 206) throw new Error(`PostgREST ${r.status} on ${path.split('?')[0]}: ${(await r.text()).slice(0, 160)}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < PAGE) return out
  }
}
const conns = await rest(`platform_connections?select=client_id&platform=eq.google`)
const clientIds = [...new Set(conns.map((c) => c.client_id))]
const singles = []
for (const cid of clientIds) {
  for (const [from, to] of QUARTERS) {
    const rows = await rest(`metrics_daily?select=client_id,entity_level,entity_id,date,breakdown_value&client_id=eq.${cid}&platform=eq.google&${LEVELS}&breakdown_type=eq.device&breakdown_value=in.(0,1,2,3,4,5,6)&date=gte.${from}&date=lt.${to}`)
    singles.push(...rows)
  }
}
const findings = []
if (singles.length) {
  const levels = [...new Set(singles.map((r) => r.entity_level))].sort().join(', ')
  findings.push(`(a) ${singles.length} device row(s) still spelled as vendor ints at the legacy levels (${levels}) — Lora renders them as buckets literally named "2"/"3"/"4" beside the named ones, splitting every device ranking that crosses them.`)
  let twinCount = 0
  for (const [from, to] of QUARTERS) {
    const inQ = singles.filter((r) => r.date >= from && r.date < to)
    if (!inQ.length) continue
    const namedKeys = new Set()
    for (const cid of [...new Set(inQ.map((r) => r.client_id))]) {
      const named = await rest(`metrics_daily?select=client_id,entity_level,entity_id,date,breakdown_value&client_id=eq.${cid}&platform=eq.google&${LEVELS}&breakdown_type=eq.device&breakdown_value=in.(UNSPECIFIED,UNKNOWN,MOBILE,TABLET,DESKTOP,OTHER,CONNECTED_TV)&date=gte.${from}&date=lt.${to}`)
      for (const r of named) namedKeys.add(`${r.client_id}|${r.entity_level}|${r.entity_id}|${r.date}|${r.breakdown_value}`)
    }
    for (const s of inQ) if (namedKeys.has(`${s.client_id}|${s.entity_level}|${s.entity_id}|${s.date}|${NAME_OF[s.breakdown_value]}`)) twinCount++
  }
  if (twinCount) findings.push(`(b) ${twinCount} of them are TWINS — the named row already exists under the same 7-column key, so those devices DOUBLE-COUNT in any sum today.`)
}
if (findings.length) {
  console.error(`✗ DEVICE-LEGACY-SPELLING-MERGE FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ device-legacy-spelling-merge OK — zero ordinal device rows remain at the legacy levels and no key holds two spellings; the device axis speaks the ruled canon everywhere Lora reads it.')
