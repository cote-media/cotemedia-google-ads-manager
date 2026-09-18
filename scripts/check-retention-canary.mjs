#!/usr/bin/env node
// LORAMER_RETENTION_WALL_CANARY_V1 — THE LOUD SURFACE. Red when the retention canary is missing, stale (> 30 h) or not
// SERVED, and red when any empty answer past the wall was left UNRESOLVED in the last 7 days. This is how the day
// Google begins enforcing its 37-month wall is KNOWN within a day, and how a silent wall shows up as a stalled walk
// rather than as history sealed empty.
//
// DB-READING BY DESIGN → lives in `npm run check:data`, NEVER in `npm run guard`/build (Vercel has no DB).
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { restAll } from './lib/rest-all.mjs' // LORAMER_REST_ROW_CAP_READER_V1 — the one PostgREST reader that cannot return a partial set

const ROOT = process.cwd()
if (existsSync(resolve(ROOT, '.env.local'))) {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('✗ retention-canary: no Supabase credentials (needs .env.local)'); process.exit(1) }

const RETENTION_CANARY_MARKER = 'retention_canary'      // retention-wall.ts owns the name; copied here so this leg needs no TS import
const UNRESOLVED_MARKER = 'UNRESOLVED_PAST_WALL'         // retention-wall.ts UNRESOLVED_PAST_WALL_MARKER
const FRESH_MS = 30 * 60 * 60 * 1000

const rest = (path) => restAll(path)

const findings = []
// ⛔ NO `limit=1` THROUGH restAll: it pages by Range and overran the total the moment a SECOND canary row existed
// (2026-09-18 10:15Z → "416 Range Not Satisfiable at 1 … overran the total it read (2)", the leg CRASHED). The canary
// writes one row a day; reading them all and taking the newest is a handful of rows, and it cannot overrun.
const rows = await rest(`capture_pass_log?select=outcome,detail,ran_at&pass_marker=eq.${RETENTION_CANARY_MARKER}&platform=eq.google&order=ran_at.desc`)
const row = rows[0]
if (!row) {
  findings.push('no retention canary row exists — /api/cron/retention-canary has never run (or never recorded). Until it does, every empty answer past the wall is UNRESOLVED and the walk spends nothing there.')
} else {
  const ageH = (Date.now() - Date.parse(row.ran_at)) / 3600000
  let detail = null
  try { detail = row.detail ? JSON.parse(row.detail) : null } catch { detail = null }
  const state = row.outcome === 'ok' ? 'served' : detail?.state ?? 'failed'
  if (ageH * 3600000 > FRESH_MS) findings.push(`the newest canary answer is ${ageH.toFixed(1)} h old (fresh ≤ 30 h) — the day enforcement begins would not be known within a day. Last state: ${state}.`)
  if (state !== 'served') findings.push(`the canary reads ${state.toUpperCase()} at ${row.ran_at}: ${detail?.summary ?? row.detail ?? '(no detail)'}. ⛔ If REFUSED, Google has begun enforcing the 37-month wall (the documented shape). If SILENT, it has begun WITHOUT an error — nothing past the wall retires on silence until this clears. If FAILED, the canary could not ask.`)
}
const since = new Date(Date.now() - 7 * 86400000).toISOString()
const unresolved = await rest(`universe_attempt_log?select=client_id,resource,segment,window_start,window_end,recorded_at&phase=eq.attempt_finished&outcome=eq.error&error=like.${encodeURIComponent(UNRESOLVED_MARKER + '%')}&recorded_at=gte.${since}&order=recorded_at.desc&limit=50`)
// LORAMER_WALL_HOLD_NEVER_RETIRE_V1 (Q6, 2026-09-18): an UNRESOLVED empty past the wall is now the EXPECTED outcome
// (silence past the wall is not evidence; the missed lane re-asks it). It is reported, never a finding. This leg stays
// red only when the canary itself is not SERVED — the day Google begins enforcing the wall.
if (unresolved.length) {
  const clients = new Set(unresolved.map((u) => u.client_id)).size
  console.log(`${unresolved.length}${unresolved.length === 50 ? '+' : ''} empty answer(s) past the wall left UNRESOLVED in the last 7 days across ${clients} client(s) — oldest window ${unresolved.reduce((m, u) => (m === null || u.window_start < m ? u.window_start : m), null)}, newest record ${unresolved[0].recorded_at}. These days retired nothing; the missed lane re-asks them once the canary is green.`)
}

if (findings.length) {
  console.error(`✗ retention-canary FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ retention-canary OK — canary SERVED at ${row.ran_at} (${((Date.now() - Date.parse(row.ran_at)) / 3600000).toFixed(1)} h ago); ${unresolved.length} unresolved empties past the wall in the last 7 days are HELD, not retired (Q6).`)
