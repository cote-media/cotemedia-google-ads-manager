#!/usr/bin/env node
// LORAMER_TOP_EDGE_LANE_V1 — IS THE TOP OF THE CALENDAR HELD, OR IS IT QUIETLY GROWING?
//
// ⛔ THE PROPERTY, AND IT IS THE ONE NO OTHER DETECTOR CAN SEE. The walk's anchor is monotonically
// non-increasing — a fresh connect anchors at YESTERDAY and every branch of `deriveAnchorEnd` thereafter
// returns either `lastWindowEnd` (hold) or `lastWindowStart − 1` (recede). Nothing in the repo raises it.
// So the ground between a surface's newest asked window and yesterday is held by NOTHING and grows one day
// per day, per surface, forever. MEASURED 2026-08-19 before this lane existed: **346 of 346 Foam OH surfaces
// topped out at 2026-08-12 with a 6-day strip each — 2,076 owed days, +346/day.**
//
// ⛔ AND `no-owed-day-left-behind` IS BLIND TO IT BY DEFINITION, which is why this is a separate guard and
// not a leg. Its own header defines `ASKED = every day covered by an attempt_started row's recorded bounds`
// and `SKIPPED = ASKED ∧ day > FRONTIER ∧ …`. Days ABOVE the highest window ever asked are not in ASKED, so
// they can never be SKIPPED. The detector built to find left-behind owed ground cannot see the class that
// sits above its own frontier.
//
// ⛔ IT SHIPS RED, AND THAT IS THE PROOF IT WORKS RATHER THAN A DEFECT. The strip is 6 days deep on every
// surface at the moment this lands; it goes green only when the top-edge lane has actually run. Same posture
// as `check-nongrain-window-resolves`, which the roster already describes as "the one check whose green is
// GATE-B by construction rather than by choice".
//
// ⚠ LIMITS, so the green is not over-read: it asks whether the top was ASKED, never whether the answer was
// right — a surface whose strip returns zero every day passes here and is correct to. It reads ALL lanes on
// purpose (a day held by the descent is held), and it says nothing about ground below the frontier.
//
// USAGE: node tests/guards/top-edge-is-held.guard.mjs [--client=<uuid>]
//
// ══ RE-SPEC 2026-09-14 — LORAMER_CHECKDATA_FLEET_SHAPED_BATCH_B_V1: THE THREE-LANE SEAM, PER CLIENT ══════════════════
// The top-edge lane was RETIRED on 2026-09-08 (d4eab64, lookback lane STEP 2A): under the three-lane design the top of the
// calendar is held by three things — the DESCENT anchors at yesterday on connect and only recedes; the LOOKBACK lane
// asks each surface's ground up to the restatement boundary T−B in full windows (deriveBoundaryStrip, a window only when
// it ends ≤ T−B); the FORWARD DRIVER covers [T−B+1 … yesterday] and its day-complete leg proves that. "Newest asked
// window within 1 day of yesterday" — the old assertion — is therefore the driver's property, not the walk's, and it
// read 349/349 RED on Foam OH for the wrong reason. The adversary (round 23) resolved to KEEP this leg, re-specced to the
// SEAM between driver and walk: per surface, does the walk's own ground (descent ∪ lookback ∪ missed) reach the
// boundary from below? Nothing else proves that, and it is exactly where a hole hides.
//   · HELD           — the lane's own strip derivation says WAITING: the next full window would end above T−B, so
//                      there is no askable, unasked ground below the boundary on this surface.
//   · BEHIND         — the derivation yields a WINDOW: ground at or below T−B that the lane could ask now and has not.
//   · NEVER-DESCENDED — the descent has never asked the surface; its history is the descent's, not this leg's.
// B is the account's restatement boundary — `boundaryDaysFor` (lookback-boundary.ts, read from entity_state_history)
// and `deriveBoundaryStrip` / `addDaysISO` / `LOOKBACK_WINDOW_DAYS_BASIC` (universe-resumer.ts), tsc-compiled and
// IMPORTED, never re-derived here; UNKNOWN boundary → the account is skipped and named. An account whose MISSED lane
// has not completed one sweep (universe_missed_cursor.sweep = 0) reads NOT-YET with its lap count — the missed lane is
// what fills the holes this leg would otherwise call BEHIND — not red. `--client=<uuid>` / LORAMER_CLIENT names one
// client; the default is every client with a google descend ledger. T−B is printed per account.
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CLIENT_ARG = (process.argv.find((a) => a.startsWith('--client=')) || '').slice('--client='.length) || process.env.LORAMER_CLIENT || null
const VENDOR = 'google'
const findings = []
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))
const cannot = (msg) => { console.error(`✗ top-edge-is-held CANNOT RUN — ${msg}. ⛔ A BROKEN INSTRUMENT IS NOT A PASS.`); process.exitCode = 2; process.exit() }

/** THE PURE DECISION over the lane's own strip verdict. */
export function seamVerdict(strip) {
  if (strip.kind === 'waiting') return { state: 'held', behindDays: 0 }
  if (strip.kind === 'none') return { state: 'never-descended', behindDays: 0 }
  // 'window': askable ground exists at/below the boundary that has not been asked
  const behindDays = Math.round((Date.parse(strip.boundaryEnd + 'T00:00:00Z') - Date.parse(strip.windowStart + 'T00:00:00Z')) / 86400000) + 1
  return { state: 'behind', behindDays, from: strip.windowStart }
}

// ── compile the lane's own derivations ──
const out = mkdtempSync(join(tmpdir(), 'loramer-topedge-'))
let R, boundaryJs
{
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'), resolve(ROOT, 'src/lib/backfill/lookback-boundary.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) cannot(`tsc did not run: ${r.error.message}`)
  const resumerJs = join(out, 'src/lib/backfill/universe-resumer.js')
  boundaryJs = join(out, 'src/lib/backfill/lookback-boundary.js')
  if (!existsSync(resumerJs) || !existsSync(boundaryJs)) cannot(`tsc produced no output (${(r.stdout || '').slice(0, 200)})`)
  R = createRequire(import.meta.url)(resumerJs)
  for (const fn of ['deriveBoundaryStrip', 'addDaysISO']) if (typeof R[fn] !== 'function') cannot(`${fn} is not exported by universe-resumer.ts — the subject moved`)
  if (!(R.LOOKBACK_WINDOW_DAYS_BASIC > 0)) cannot('LOOKBACK_WINDOW_DAYS_BASIC is not exported')
}

// ── self-test: the decision driven through the REAL deriveBoundaryStrip, no clock, no DB ──
{
  const T = '2026-09-14', newestServable = R.addDaysISO(T, -1), B = 90, W = R.LOOKBACK_WINDOW_DAYS_BASIC, boundaryEnd = R.addDaysISO(T, -B)
  const strip = (descendTopEnd, lastLookbackEnd) => R.deriveBoundaryStrip({ descendTopEnd, lastLookbackEnd, newestServable, boundaryDays: B, widthDays: W })
  const cases = [
    { name: `lookback frontier at T−B−${W - 2} → next full window ends above T−B → HELD (waiting)`, v: seamVerdict(strip('2026-05-01', R.addDaysISO(boundaryEnd, -(W - 2)))), want: 'held' },
    { name: 'lookback frontier 20 days below T−B → an askable window is owed → BEHIND', v: seamVerdict(strip('2026-05-01', R.addDaysISO(boundaryEnd, -20))), want: 'behind' },
    { name: 'fresh connect: descent top at yesterday, no lookback yet → HELD', v: seamVerdict(strip(newestServable, null)), want: 'held' },
    { name: 'descent never asked the surface → NEVER-DESCENDED', v: seamVerdict(strip(null, null)), want: 'never-descended' },
    { name: 'descent top 30 days below T−B, no lookback → BEHIND by the strip from descent+1', v: seamVerdict(strip(R.addDaysISO(boundaryEnd, -30), null)), want: 'behind' },
  ]
  const bad = cases.filter((c) => c.v.state !== c.want)
  if (bad.length) cannot(`the decision failed its own self-test on ${bad.length} fixture(s): ` + bad.map((c) => `${c.name} → ${c.v.state}`).join(' · '))
  console.log(`[top-edge-is-held] self-test PASS — 5/5 fixtures through the real deriveBoundaryStrip (W=${W}, imported): waiting→HELD, window→BEHIND, none→NEVER-DESCENDED; T−B=${boundaryEnd} for T=${T} B=${B}`)
}

async function main() {
  try {
    for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue
      const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* ambient env */ }
  if (!process.env.SUPABASE_DB_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) cannot('Supabase env missing (SUPABASE_DB_URL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
  // boundaryDaysFor reads through supabaseAdmin — shim it with a real client
  const req = createRequire(import.meta.url)
  const { createClient } = req('@supabase/supabase-js')
  if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = class { constructor() { throw new Error('Realtime unused') } }
  global.__LORAMER_TOPEDGE_SB__ = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const shim = join(out, '__supabase.js')
  writeFileSync(shim, 'module.exports = { supabaseAdmin: global.__LORAMER_TOPEDGE_SB__, supabase: global.__LORAMER_TOPEDGE_SB__ }')
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (/@\/lib\/supabase$/.test(request)) return shim
    if (/universe-resumer$/.test(request)) return join(out, 'src/lib/backfill/universe-resumer.js')
    return origResolve.call(this, request, ...rest)
  }
  const { boundaryDaysFor } = req(boundaryJs)
  Module._resolveFilename = origResolve

  const pg = (await import('pg')).default
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  await db.query("SET statement_timeout='115s'")
  const q = async (s, p = []) => (await db.query(s, p)).rows
  try {
    const clients = CLIENT_ARG
      ? await q(`select id, name from public.clients where id = $1::uuid`, [CLIENT_ARG])
      : await q(`select distinct c.id, c.name from public.universe_attempt_log a join public.clients c on c.id = a.client_id where a.vendor = $1::text and a.lane = 'descend' order by c.name`, [VENDOR])
    if (!clients.length) cannot(CLIENT_ARG ? `--client ${CLIENT_ARG} is not a client` : 'no client has a google descend ledger')
    const T = new Date().toISOString().slice(0, 10)
    const newestServable = R.addDaysISO(T, -1)
    const W = R.LOOKBACK_WINDOW_DAYS_BASIC
    console.log(`[top-edge-is-held] ${CLIENT_ARG ? 'client named by --client' : `fleet default — ${clients.length} client(s) with a google descend ledger`} · T=${T} · window width W=${W} (LOOKBACK_WINDOW_DAYS_BASIC, imported)`)
    let notYet = 0, unknown = 0, graded = 0
    for (const c of clients) {
      const t0 = Date.now()
      const [conn] = await q(`select account_id from public.platform_connections where client_id = $1::uuid and platform = $2::text and account_id is not null order by account_id limit 1`, [c.id, VENDOR])
      if (!conn) { unknown++; console.log(`  ? ${c.name} ${c.id}: no google connection with an account id — boundary UNKNOWN, skipped`); continue }
      const v = await boundaryDaysFor(c.id, conn.account_id)
      if (!v.known) { unknown++; console.log(`  ? ${c.name} ${c.id}: boundary UNKNOWN — skipped, not defaulted (${v.reason.slice(0, 140)})`); continue }
      const boundaryEnd = R.addDaysISO(T, -v.days)
      const [cur] = await q(`select sweep, cursor from public.universe_missed_cursor where client_id = $1::uuid and vendor = $2::text`, [c.id, VENDOR])
      const sweep = cur ? Number(cur.sweep) : 0
      const surfaces = await q(`
        select resource, coalesce(segment, '') as segment,
               max(window_end) filter (where lane = 'descend' and phase = 'attempt_started')::date::text as descend_top,
               max(window_end) filter (where lane in ('lookback', 'missed') and phase = 'attempt_finished' and outcome in ('ok', 'zero', 'nongrain'))::date::text as held_top
          from public.universe_attempt_log
         where client_id = $1::uuid and vendor = $2::text and resource <> '__account_inception'
         group by 1, 2`, [c.id, VENDOR])
      let held = 0, behind = 0, never = 0, behindDays = 0
      const worst = []
      for (const s of surfaces) {
        const strip = R.deriveBoundaryStrip({ descendTopEnd: s.descend_top, lastLookbackEnd: s.held_top, newestServable, boundaryDays: v.days, widthDays: W })
        const sv = seamVerdict(strip)
        if (sv.state === 'held') held++
        else if (sv.state === 'never-descended') never++
        else { behind++; behindDays += sv.behindDays; worst.push({ k: `${s.resource}${s.segment ? '/' + s.segment : ''}`, from: sv.from, days: sv.behindDays }) }
      }
      worst.sort((a, b) => b.days - a.days)
      const state = sweep === 0 ? 'NOT-YET' : behind === 0 ? 'HELD' : 'BEHIND'
      const mark = state === 'HELD' ? '✓' : state === 'BEHIND' ? '✗' : '…'
      console.log(`  ${mark} ${c.name} ${c.id}: T−B=${boundaryEnd} (B=${v.days} ⇐ ${v.basis}) · ${surfaces.length} surface(s): ${held} held · ${behind} behind (${behindDays} askable unasked day(s)) · ${never} never-descended · missed lane sweep ${sweep} (cursor ${cur ? cur.cursor : '—'}) · ${state}${state === 'NOT-YET' ? ' — the missed lane has not completed a sweep; counts reported, not graded' : ''} · ${Date.now() - t0} ms`)
      if (state === 'BEHIND') {
        graded++
        findings.push(`${c.name}: ${behind} of ${surfaces.length} surface(s) have askable, unasked ground at or below T−B=${boundaryEnd} — ${behindDays} day(s) the walk's own lanes could ask now and have not (missed lane sweep ${sweep}). Deepest: ${worst.slice(0, 5).map((w) => `${w.k} from ${w.from} (${w.days}d)`).join(' · ')}${worst.length > 5 ? ` · …and ${worst.length - 5} more` : ''}.`)
      } else if (state === 'HELD') graded++
      else notYet++
    }
    console.log(`[top-edge-is-held] ${clients.length} client(s): ${graded} graded · ${notYet} NOT-YET (missed lane unswept) · ${unknown} boundary unknown`)
  } finally { await db.end() }
}
try { await main() } catch (e) { rmSync(out, { recursive: true, force: true }); cannot(e.message) }
rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error(`[top-edge-is-held] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error('  ⇒ SPEC: DECISIONS LORAMER_LOOKBACK_LANE_V1 (the strip law) + LORAMER_RESTATEMENT_WINDOW_LAW_V1. The ground below T−B is the walk\'s to hold; the driver holds above it.')
  process.exitCode = 1
} else {
  console.log(`[top-edge-is-held] PASS — on every graded account the walk's own lanes reach the restatement boundary from below (no askable, unasked ground at or below T−B). ⛔ LIMIT: NOT-YET accounts are reported, not graded; this proves the ground was ASKED, never that the answer was right.`)
}
