#!/usr/bin/env node
// LORAMER_PAST_LINE_EMPTY_V1 (2026-09-23) — ONE-TIME: attest the held windows the month-grain witness proved empty.
//
// WHAT IT DOES. For every window the walk held as UNRESOLVED_PAST_WALL (outcome 'error' + marker, 2026-09-18..23) that
// round 40's witness classified EMPTY (≥1 full calendar month inside the window, every one empty at segments.month grain)
// or EMPTY_BY_MONTH (no full month inside, every touched month empty at month grain), append ONE attempt_finished row
// with outcome 'zero' — the outcome attestedEmptyDays (universe-coverage.ts) reads — citing the witness ask on its face.
// Nothing for PARTIAL_UNDECIDED (a touched month has rows on other days) or UNWITNESSED (the 11 surfaces with no coarse
// grain): the lanes re-ask those and, under LORAMER_PAST_LINE_EMPTY_V1, attest them from Google's own daily answer.
// APPEND-ONLY: the ledger forbids UPDATE/DELETE (061); a held row is never touched. IDEMPOTENT: a window that already
// holds a 'WITNESSED EMPTY' terminal is skipped. USAGE: node scripts/reclassify-witnessed-empty.mjs --dry | --apply
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const APPLY = process.argv.includes('--apply'), DRY = process.argv.includes('--dry')
if (APPLY === DRY) { console.error('usage: --dry | --apply'); process.exit(2) }
const WITNESS = process.argv.find((a) => a.startsWith('--witness='))?.slice(10) ?? 'scratch/round40/witness.json'
const NO_COARSE = new Set(['campaign_budget', 'detail_content_suitability_placement_view', 'group_content_suitability_placement_view', 'performance_max_placement_view'])
const monthsBetween = (a, b) => { const o = []; let y = +a.slice(0,4), m = +a.slice(5,7); const ey = +b.slice(0,4), em = +b.slice(5,7); while (y < ey || (y === ey && m <= em)) { o.push(`${y}-${String(m).padStart(2,'0')}`); m++; if (m > 12) { m = 1; y++ } } return o }
const isFull = (ym, ws, we) => { const first = ym + '-01'; const last = new Date(Date.UTC(+ym.slice(0,4), +ym.slice(5,7), 0)).toISOString().slice(0,10); return ws <= first && we >= last }
const witness = JSON.parse(readFileSync(resolve(ROOT, WITNESS), 'utf8'))
const askedOn = new Date(witness.__askedOn ?? '2026-09-24T00:00:00Z').toISOString().slice(0, 10)
const plan = []; const tally = { EMPTY: 0, EMPTY_BY_MONTH: 0, PARTIAL_UNDECIDED: 0, UNWITNESSED: 0, WITNESS_ERROR: 0 }
for (const r of witness) {
  const [resource, segment] = r.key.split('|')
  for (const [ws, we] of r.windows) {
    const months = monthsBetween(ws.slice(0,7), we.slice(0,7)); const full = months.filter((m) => isFull(m, ws, we))
    let c
    if (NO_COARSE.has(resource)) c = 'UNWITNESSED'
    else if (r.witness.error) c = 'WITNESS_ERROR'
    else if (full.length === 0) c = months.some((m) => r.witness.months.includes(m)) ? 'PARTIAL_UNDECIDED' : 'EMPTY_BY_MONTH'
    else c = full.some((m) => r.witness.months.includes(m)) ? 'PARTIAL_UNDECIDED' : 'EMPTY'
    tally[c]++
    if (c === 'EMPTY' || c === 'EMPTY_BY_MONTH') plan.push({ client: r.client, resource, segment, ws, we, grain: r.grain, span: r.span, months: c === 'EMPTY' ? full : months, cls: c })
  }
}
// one row per DISTINCT window (the same window can hold several UNRESOLVED rows)
const seen = new Set(); const distinct = plan.filter((p) => { const k = `${p.client}|${p.resource}|${p.segment}|${p.ws}|${p.we}`; if (seen.has(k)) return false; seen.add(k); return true })
console.log(`[reclassify] witness classes: ${JSON.stringify(tally)} · candidate windows ${plan.length} · distinct ${distinct.length}`)
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL }); await db.connect()
let skipped = 0, toWrite = 0, written = 0
const rows = []
for (const p of distinct) {
  const { rows: held } = await db.query(
    `select lane, segment, max(attempt_no)::int as max_no,
            bool_or(error like 'WITNESSED EMPTY%') as already
       from universe_attempt_log
      where client_id = $1 and vendor = 'google' and resource = $2 and coalesce(segment,'') = $3 and window_start = $4 and window_end = $5
      group by lane, segment order by lane limit 1`, [p.client, p.resource, p.segment, p.ws, p.we])
  const h = held[0]
  if (!h) { skipped++; continue }
  if (h.already) { skipped++; continue }
  toWrite++
  rows.push({ ...p, lane: h.lane, seg: h.segment, attemptNo: (h.max_no ?? 0) + 1,
    error: `WITNESSED EMPTY — LORAMER_PAST_LINE_EMPTY_V1: month-grain ask ${p.span[0]}..${p.span[1]} (segments.${p.grain}) on ${askedOn} returned no rows for ${p.months.join(',')}; the daily answer of ${p.ws}..${p.we} was empty (held as UNRESOLVED_PAST_WALL under the 2026-09-18 rule; attested under Russ's 2026-09-23 ruling)` })
}
console.log(`[reclassify] ${DRY ? 'DRY' : 'APPLY'}: ${toWrite} row(s) to append · ${skipped} skipped (already witnessed or no held row)`)
if (APPLY) {
  for (const r of rows) {
    await db.query(
      `insert into universe_attempt_log (client_id, vendor, resource, segment, window_start, window_end, attempt_no, phase, outcome, message_key, invocation_id, lane, rows_written, requests_spent, error)
       values ($1, 'google', $2, $3, $4, $5, $6, 'attempt_finished', 'zero', null, $7, $8, 0, 0, $9)`,
      [r.client, r.resource, r.seg, r.ws, r.we, r.attemptNo, `reclassify:LORAMER_PAST_LINE_EMPTY_V1:${askedOn}`, r.lane, r.error])
    written++
    if (written % 1000 === 0) console.log(`[reclassify] ${written}/${rows.length}`)
  }
  console.log(`[reclassify] APPLIED — ${written} attempt_finished row(s) appended with outcome 'zero'`)
}
await db.end()
