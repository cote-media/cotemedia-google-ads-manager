#!/usr/bin/env node
// LORAMER_ORDINAL_HOUR_RESPELL_V1 — HOUR ROWS CARRY EXACTLY ONE SPELLING, THE RULED CANON ('00'-'23').
//
// ⛔ THE DEFECT THIS PINS, measured live 2026-08-26 on real rows: the pre-canonical walk (written
// 2026-08-03..05, before LORAMER_CANONICAL_KEY_SPELLING_V1 shipped 2026-08-09) left 18,073 google hour rows
// spelled '0'-'9' beside the drain's '00'-'09' canon — 695 of them TWINS of an existing padded row under
// the 7-column key. Proven consequence, one customer-day (Foam OH 2026-04-05): 34 buckets rendered for 24
// real hours, SUM(impressions) 146,061 raw vs 84,831 canonical — a +72% overstatement from double-counted
// twinned hours, and a group-by that splits one hour into two buckets. The canon is OURS and RULED
// (vendor serves int32 0-23 with no string form — segments.proto v23; padding chosen for lexical sort,
// LORAMER_GOOGLE_HOUR_CAPTURE_V1 e6c2059, elevated system-wide by LORAMER_CANONICAL_KEY_SPELLING_V1).
//
// TWO BEHAVIOURAL LEGS, reading the same rows the merge writes (DB-reading → check:data roster, never the
// build path). Year-scoped queries because full-span scans exceed the statement ceiling:
//  (a) NO single-digit hour row remains on platform google, any entity_level.
//  (b) NO (client, entity_level, entity_id, date) holds BOTH spellings of the same hour.
// This check is DESIGNED-RED until the approved merge executes; registration in run-checkdata.mjs follows
// the execution commit, per the device-respell precedent (a designed-red check is not registered).
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
if (!SB || !KEY) { console.error('✗ hour-spelling-merge: no Supabase credentials (needs .env.local)'); process.exit(1) }

// PostgREST cannot express the twin self-join; both legs run through a tiny RPC-free REST read per year
// window using the single-digit filter, and leg (b) re-derives twins client-side from leg (a)'s rows —
// which is exact, because a twin REQUIRES a single-digit side, and leg (a) fetches every one of them.
// ⛔ SCOPED PER CLIENT × YEAR, NOT FLEET × YEAR — the live PostgREST ceiling is 8 SECONDS (the authenticator
// role's statement_timeout; the 120s figure is MCP-only), and this check's own first run proved it: a
// fleet-wide year scan died 57014 before returning a row. Per-client windows ride the
// (client, platform, breakdown_type, ...) index and return in milliseconds.
// Quarter windows, not years: after the merge the GREEN case is the expensive one (zero matches = the
// index range is scanned to exhaustion), and a client-year of hour rows can exceed the 8s ceiling cold.
// Quarters keep every scan comfortably inside it. Seen both ways on 2026-08-26: year windows passed red,
// then timed out green.
const YEARS = []
for (let y = 2022; y <= 2026; y++) for (const q of ['01-01', '04-01', '07-01', '10-01']) {
  const from = `${y}-${q}`
  const to = q === '10-01' ? `${y + 1}-01-01` : `${y}-${q === '01-01' ? '04-01' : q === '04-01' ? '07-01' : '10-01'}`
  YEARS.push([from, to])
}
// ⛔ PAGINATED, BECAUSE THE FIRST RED WAS THE INSTRUMENT LYING: PostgREST caps a response at max-rows
// (observed ~1000), and the un-paged first run reported 580 singles / 21 twins against 18,073 / 695 in the
// warehouse — the supabase silent row-cap class (Lesson 8), reproduced in a guard built the same day the
// lesson was cited. Pages loop until a short page; every fetch is exact or it throws.
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
  for (const [from, to] of YEARS) {
    const rows = await rest(`metrics_daily?select=client_id,entity_level,entity_id,date,breakdown_value&client_id=eq.${cid}&platform=eq.google&breakdown_type=eq.hour&breakdown_value=in.(0,1,2,3,4,5,6,7,8,9)&date=gte.${from}&date=lt.${to}`)
    singles.push(...rows)
  }
}
const findings = []
if (singles.length) {
  const levels = [...new Set(singles.map((r) => r.entity_level))].sort().join(', ')
  findings.push(`(a) ${singles.length} hour row(s) still spelled '0'-'9' (entity_levels: ${levels}) — the pre-canonical class stands and every SUM/group-by crossing it is wrong exactly as measured (34 buckets for 24 hours, +72% on the proven day).`)
  // (b) twins among them — one padded-existence probe per single row is too chatty; probe per distinct key day
  let twinCount = 0
  for (const [from, to] of YEARS) {
    const inYear = singles.filter((r) => r.date >= from && r.date < to)
    if (!inYear.length) continue
    // fetch padded rows for the same year once, key locally
    const padKeys = new Set()
    for (const cid of [...new Set(inYear.map((r) => r.client_id))]) {
      const padded = await rest(`metrics_daily?select=client_id,entity_level,entity_id,date,breakdown_value&client_id=eq.${cid}&platform=eq.google&breakdown_type=eq.hour&breakdown_value=in.(00,01,02,03,04,05,06,07,08,09)&date=gte.${from}&date=lt.${to}`)
      for (const r of padded) padKeys.add(`${r.client_id}|${r.entity_level}|${r.entity_id}|${r.date}|${r.breakdown_value}`)
    }
    for (const s of inYear) if (padKeys.has(`${s.client_id}|${s.entity_level}|${s.entity_id}|${s.date}|0${s.breakdown_value}`)) twinCount++
  }
  if (twinCount) findings.push(`(b) ${twinCount} of them are TWINS — the padded row already exists under the same 7-column key, so those hours DOUBLE-COUNT in any sum today.`)
}
if (findings.length) {
  console.error(`✗ HOUR-SPELLING-MERGE FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ hour-spelling-merge OK — zero single-digit hour rows remain and no key holds two spellings; the hour axis speaks the ruled canon everywhere.')
