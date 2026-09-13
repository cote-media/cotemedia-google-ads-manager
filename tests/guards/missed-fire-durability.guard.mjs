#!/usr/bin/env node
// LORAMER_MISSED_FIRE_DURABILITY_V1 — PER-FIRE MISSED-LANE STATE IS DURABLE IN universe_fire_log.
//
// WHY: the missed lane's per-fire cursor facts (missedCursorFrom / missedNextEntry / missedWrapped) lived ONLY in the
// FIRE console line (Vercel, ~1 h retention) and the response body nobody stores. Round 1 (2026-09-13) could not read
// the cut/resume pair for 136 of 144 fires because the hour had passed; the first LIVE allowance cut then landed on
// Glenn Stearns at 18:15Z (cursor 0 → nextEntry 4 of 16) and its resume read at the next turn would have raced the same
// hour. The fire IS the unit and universe_fire_log already holds one row per fire (LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1),
// so the three scalars ride that row — migration 092, three NULLABLE columns, no defaults, no backfill.
//
// LEGS:
//  (α) the schema: migrations/092 adds missed_cursor_from (integer), missed_next_entry (integer), missed_wrapped (boolean),
//      all nullable, no default. With Supabase credentials in .env.local the LIVE table is also read through PostgREST
//      (select the three columns, limit 1 → HTTP 200); without credentials the DB half is skipped and SAID so (hermetic).
//  (β) the write: the ONE writer (universe-resume/route.ts fireHeartbeat) accepts `missed` and maps the three columns with
//      `?? null`; the completed AND meter-held heartbeats pass missedFireColumns(...) (both run AFTER the enumeration and
//      the cursor write); the pure decider universe-resumer.ts missedFireColumns returns the three values when the lane
//      enumerated and THREE NULLS when it did not (refused, errored, held before the lane) — a NULL means "the lane did not
//      run", never zero. Driven with fixtures against the compiled module.
//  (e) registered in scripts/run-guards.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const MIGRATION = 'migrations/092_universe_fire_log_missed_columns.sql'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const DECIDER = 'src/lib/backfill/universe-resumer.ts'
const COLS = ['missed_cursor_from', 'missed_next_entry', 'missed_wrapped']

// (α) schema — the migration file
const mig = read(MIGRATION)
if (!mig) findings.push(`(α) ${MIGRATION} does not exist — the three missed columns have no migration`)
else {
  const m = strip(mig).replace(/--.*$/gm, '')
  const want = [
    [/add\s+column\s+(if\s+not\s+exists\s+)?missed_cursor_from\s+integer/i, 'missed_cursor_from integer'],
    [/add\s+column\s+(if\s+not\s+exists\s+)?missed_next_entry\s+integer/i, 'missed_next_entry integer'],
    [/add\s+column\s+(if\s+not\s+exists\s+)?missed_wrapped\s+boolean/i, 'missed_wrapped boolean'],
  ]
  for (const [re, label] of want) if (!re.test(m)) findings.push(`(α) ${MIGRATION} does not add ${label} to universe_fire_log`)
  if (!/alter\s+table\s+(public\.)?universe_fire_log/i.test(m)) findings.push(`(α) ${MIGRATION} does not ALTER universe_fire_log`)
  if (/not\s+null|default\s/i.test(m)) findings.push(`(α) ${MIGRATION} declares NOT NULL or a DEFAULT — the columns must be nullable with no default: NULL means "the lane did not run"`)
  if (/update\s+(public\.)?universe_fire_log/i.test(m)) findings.push(`(α) ${MIGRATION} backfills old rows — old fires carry NULL, honestly`)
}
// (α) schema — the live table, when credentials exist
{
  const envFile = read('.env.local')
  const env = {}
  for (const line of envFile.split('\n')) { const mm = line.match(/^([A-Z0-9_]+)=(.*)$/); if (mm) env[mm[1]] = mm[2].replace(/^["']|["']$/g, '') }
  const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !KEY) console.log('[missed-fire-durability] (α) live-table read SKIPPED — no Supabase credentials in .env.local (hermetic run; the migration file is the only schema witness here)')
  else {
    try {
      // HEAD, not GET: this asks whether the columns EXIST (PostgREST 400 42703 when one does not), never for rows —
      // LORAMER_REST_ROW_CAP_READER_V1 (rest-row-cap-readers guard) admits HEAD; a page read here would be a row set.
      const r = await fetch(`${SB}/rest/v1/universe_fire_log?select=${COLS.join(',')}&limit=1`, { method: 'HEAD', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
      if (!r.ok) findings.push(`(α) LIVE universe_fire_log does not serve ${COLS.join(', ')} — PostgREST ${r.status}: ${(await r.text()).slice(0, 200)}`)
      else console.log(`[missed-fire-durability] (α) live-table read OK — universe_fire_log serves ${COLS.join(', ')}`)
    } catch (e) { findings.push(`(α) live-table read THREW: ${e.message}`) }
  }
}

// (β) the write — source pins on the one writer
const route = strip(read(ROUTE))
if (!route) findings.push(`(β) ${ROUTE} does not exist`)
else {
  const hbStart = route.indexOf('const fireHeartbeat = async')
  const hb = hbStart === -1 ? '' : route.slice(hbStart, hbStart + 2600)
  if (!hb) findings.push(`(β) ${ROUTE} no longer defines fireHeartbeat — the one writer moved`)
  else {
    if (!/missed\?:\s*\{\s*cursorFrom:\s*number\s*\|\s*null;\s*nextEntry:\s*number\s*\|\s*null;\s*wrapped:\s*boolean\s*\|\s*null\s*\}\s*\|\s*null/.test(hb)) findings.push(`(β) fireHeartbeat does not accept missed?: { cursorFrom; nextEntry; wrapped } | null`)
    for (const [col, field] of [['missed_cursor_from', 'cursorFrom'], ['missed_next_entry', 'nextEntry'], ['missed_wrapped', 'wrapped']]) {
      const re = new RegExp(`${col}:\\s*h\\.missed\\?\\.${field}\\s*\\?\\?\\s*null`)
      if (!re.test(hb)) findings.push(`(β) fireHeartbeat's insert does not map ${col}: h.missed?.${field} ?? null — a missing lane must write NULL, never 0/false`)
    }
  }
  const completed = route.match(/fireHeartbeat\(\{\s*fireOutcome: 'completed'[\s\S]*?\}\)/)
  if (!completed) findings.push(`(β) no completed heartbeat call in ${ROUTE}`)
  else if (!/missed:\s*missedFireColumns\(/.test(completed[0])) findings.push(`(β) the completed heartbeat does not pass missed: missedFireColumns(…) — the durable row would carry NULL on every completed fire`)
  const held = route.match(/fireHeartbeat\(\{\s*fireOutcome: 'meter-held'[\s\S]*?\}\)/)
  if (!held) findings.push(`(β) no meter-held heartbeat call in ${ROUTE}`)
  else if (!/missed:\s*missedFireColumns\(/.test(held[0])) findings.push(`(β) the meter-held heartbeat does not pass missed: missedFireColumns(…) — the enumeration and the cursor write happen BEFORE the meter gate, so a held fire still moved the cursor and must say so`)
  for (const outcome of ['lease-held', 'quota-hold', 'rotation-error']) {
    const call = route.match(new RegExp(`fireHeartbeat\\(\\{\\s*fireOutcome: '${outcome}'[\\s\\S]*?\\}\\)`))
    if (call && /missed:/.test(call[0])) findings.push(`(β) the ${outcome} heartbeat passes missed — that fire exits before the lane runs; it must leave the columns NULL`)
  }
  if (!/import\s*\{[^}]*\bmissedFireColumns\b[^}]*\}\s*from\s*['"]@\/lib\/backfill\/universe-resumer['"]/.test(route)) findings.push(`(β) ${ROUTE} does not import missedFireColumns from universe-resumer — the route must use the driven decider, not an inline copy`)
}

// (β) the decider — driven
if (!read(DECIDER)) findings.push(`(β) ${DECIDER} does not exist`)
else {
  const out = mkdtempSync(join(tmpdir(), 'loramer-missed-fire-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
      resolve(ROOT, DECIDER), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
      '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
    ], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-resumer.js'))
    if (typeof R.missedFireColumns !== 'function') findings.push(`(β) ${DECIDER} exports no missedFireColumns`)
    else {
      const ran = R.missedFireColumns({ enumerated: true, cursorFrom: 0, nextEntry: 4, wrapped: false })
      if (!ran || ran.cursorFrom !== 0 || ran.nextEntry !== 4 || ran.wrapped !== false) findings.push(`(β) a fire that enumerated (Glenn 18:15Z: 0 → 4, no wrap) must yield { cursorFrom: 0, nextEntry: 4, wrapped: false }; got ${JSON.stringify(ran)}`)
      const wrap = R.missedFireColumns({ enumerated: true, cursorFrom: 340, nextEntry: null, wrapped: true })
      if (!wrap || wrap.cursorFrom !== 340 || wrap.nextEntry !== null || wrap.wrapped !== true) findings.push(`(β) a wrap fire (cursor 340, catalogue end reached) must yield { cursorFrom: 340, nextEntry: null, wrapped: true }; got ${JSON.stringify(wrap)}`)
      const not = R.missedFireColumns({ enumerated: false, cursorFrom: 0, nextEntry: null, wrapped: false })
      if (not !== null) findings.push(`(β) a fire whose lane did NOT enumerate (refused / errored / held before the lane) must yield null — three NULL columns, never 0/false; got ${JSON.stringify(not)}`)
    }
  } catch (e) { findings.push(`(β) ${DECIDER} could not be compiled or driven: ${e.message}`) }
  finally { rmSync(out, { recursive: true, force: true }) }
}

const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/missed-fire-durability.guard.mjs')) findings.push('(e) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) {
  console.error('✗ missed-fire-durability FAILED:')
  for (const f of findings) console.error('  ' + f)
  process.exit(1)
}
console.log('[missed-fire-durability] PASS — migration 092 adds missed_cursor_from · missed_next_entry · missed_wrapped (nullable, no default, no backfill); fireHeartbeat maps them with ?? null; the completed and meter-held heartbeats pass missedFireColumns(…), the pre-lane exits do not; the decider yields the three values when the lane enumerated and null when it did not.')
