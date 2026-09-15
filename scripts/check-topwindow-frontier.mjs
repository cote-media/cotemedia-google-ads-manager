#!/usr/bin/env node
// LORAMER_TOPWINDOW_FRONTIER_PROOF_V1 — ONE SURFACE, ONE DATA POINT, RED FIRST.
//
// ⛔ WHAT THIS PROVES, AND IT IS DELIBERATELY NARROW: that ONE Foam OH surface —
// `campaign_search_term_view / segments.device`, top window 2026-03-09..2026-04-07 — is STUCK, and that the
// thing making it stuck is `coveredDaysStrict` stripping the newest day-with-rows while its `dayCommitted`
// escape hatch is never fed. Not the engine. Not the fleet. One surface.
//
// ⛔ IT DRIVES THE REAL PREDICATE AGAINST THE REAL DATABASE. `windowCoverage` / `rangesStillOwed` /
// `decideRepublish` are the SHIPPED functions, compiled from src/ by tsc into a temp dir and required here.
// The rows come from live `metrics_daily` and live `universe_attempt_log`.
// ⛔ IT NEVER HAND-FEEDS `dayCommitted`. That is the whole point (LORAMER_REAL_INPUT_GATE_A_V1: a Gate-A that
// hand-supplies the input which makes the flag fire is a REHEARSAL, not a proof). The test calls
// windowCoverage — the real entry — and lets the module decide for itself whether to consult the commit
// records. On today's code it does not, and A1 goes RED. After the fix it does, from the SAME real rows.
//
// ⛔ NO VENDOR REQUEST. NO WRITE. Two indexed reads per day of the window plus one attempt-log read.
//
// USAGE:  node scripts/check-topwindow-frontier.mjs
// EXIT:   0 all green · 1 one or more assertions RED · 2 CANNOT RUN (precondition absent / harness broken)

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// ── THE SINGLE DATA POINT, NAMED ONCE ───────────────────────────────────────────────────────────────────
// ── THE SUBJECT — DERIVED FROM THE LEDGER, PER CLIENT (LORAMER_CHECKDATA_FLEET_SHAPED_BATCH_B_V1) ────────
// The first cut typed Foam OH's campaign_search_term_view/segments.device 2026-03-09..04-07 with STUCK_DAY 04-05. The
// property (a committed top day is COVERED, the identical range is not re-asked, the residue is attestable) holds for
// every walked account, so the subject is now: per client, the NEWEST window on one surface carrying ≥ 2 day_committed
// records for the same day (the re-ask signature the fixture had: attempts 1, 2, 3 each committing 04-05). --client=
// names one client; --resource= --segment= --window=A..B --day= pin a subject. No qualifying client → CANNOT-RUN.
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null }
const CLIENT_ARG = arg('client') || process.env.LORAMER_CLIENT || null
const RESOURCE_ARG = arg('resource'), SEGMENT_ARG = arg('segment'), WINDOW_ARG = arg('window'), DAY_ARG = arg('day')
const VENDOR = 'google'
const results = []
const ok = (id, what) => results.push({ id, pass: true, what })
const red = (id, what, why) => results.push({ id, pass: false, what, why })

// ── ENV ─────────────────────────────────────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const p = join(ROOT, '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
}
loadEnvLocal()

// ⛔ REALTIME-ONLY SHIM, AND IT MUST NOT BE READ AS STUBBING THE DATABASE. supabase-js validates a native
// WebSocket AT CONSTRUCTION for its Realtime client; Node 20 has none, so `createClient` throws before a
// single query runs — a CANNOT-RUN wearing the costume of a harness bug (measured 2026-08-17: local Node
// 20.20.2, Vercel runs 24.x, so the local machine is the outlier and check:data spawns with process.execPath).
// This satisfies that constructor and NOTHING ELSE: the class throws if anyone ever opens it, and this check
// never subscribes. **THE QUERY PATH IS THE REAL supabase-js PostgREST CLIENT AGAINST THE LIVE DATABASE.**
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() { throw new Error('[topwindow-frontier] Realtime is never used by this check; the shim exists only so createClient() can construct on Node < 22.') }
  }
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) {
  console.error('[topwindow-frontier] CANNOT RUN — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absent (.env.local).')
  console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · env missing')
  process.exit(2)
}

// ── COMPILE THE REAL MODULES (the universe-stream-consumer.guard harness, same shape) ────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-topwindow-'))
const origResolve = Module._resolveFilename
let restored = false
const cleanup = () => { if (!restored) { Module._resolveFilename = origResolve; restored = true } rmSync(out, { recursive: true, force: true }) }

const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const RESUMER = 'src/lib/backfill/universe-resumer.ts'

let cov, resumer, sb, surf
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [
    resolve(ROOT, COVERAGE), resolve(ROOT, SURFACES), resolve(ROOT, RESUMER),
    resolve(ROOT, 'src/lib/concurrency.ts'), // LORAMER_FANOUT_BOUNDED_GUARD_V1 lifted mapBounded here; this harness resolves it too
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)

  // ⛔ THE SUPABASE SHIM IS A REAL CLIENT, NOT A STUB. Stubbing it here would make this test measure its own
  // fixture — the exact failure universe-stream-consumer.guard documents at its resolver hook. The module
  // under test must issue its OWN queries against the live warehouse.
  const { createClient } = createRequire(import.meta.url)('@supabase/supabase-js')
  sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  const shim = join(out, '__supabase.js')
  writeFileSync(shim, 'module.exports = { supabaseAdmin: global.__LORAMER_SB__, supabase: global.__LORAMER_SB__ }')
  global.__LORAMER_SB__ = sb

  const surfacesJs = join(out, 'src/lib/backfill/universe-surfaces.js')
  Module._resolveFilename = function (request, ...rest) {
    if (/universe-surfaces$/.test(request)) return surfacesJs          // REAL alias map + segment mapping
    if (/\/concurrency$/.test(request)) return join(out, 'src/lib/concurrency.js') // the bounded fan-out home
    if (/@\/lib\/supabase$/.test(request)) return shim                 // REAL client
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  cov = req(join(out, 'src/lib/backfill/universe-coverage.js'))
  resumer = req(join(out, 'src/lib/backfill/universe-resumer.js'))
  surf = req(surfacesJs)
} catch (e) {
  cleanup()
  console.error(`[topwindow-frontier] CANNOT RUN — harness failed: ${e.message}`)
  console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · harness')
  process.exit(2)
}

try {
  // ── subjects ──
  let subjects = []
  if (CLIENT_ARG && RESOURCE_ARG && SEGMENT_ARG !== null && WINDOW_ARG && DAY_ARG) {
    const [ws, we] = WINDOW_ARG.split('..')
    const { data: c } = await sb.from('clients').select('id, name').eq('id', CLIENT_ARG).maybeSingle()
    if (!c) throw new Error(`--client ${CLIENT_ARG} is not a client`)
    subjects = [{ client_id: c.id, name: c.name, resource: RESOURCE_ARG, segment: SEGMENT_ARG, ws, we, day: DAY_ARG, how: 'pinned by args' }]
  } else {
    // newest window per client holding ≥ 2 day_committed records for the same day on one surface — aggregated
    // server-side over pg (PostgREST caps a page at 1,000 rows; a client-side group-by over one page misses the ledger).
    if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL missing — the subject read aggregates the ledger server-side')
    const pg = (await import('pg')).default
    const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
    await db.connect()
    let agg
    try {
      await db.query("SET statement_timeout='115s'")
      agg = (await db.query(`
        with k as (
          select client_id, resource, coalesce(segment, '') as segment, window_start::date::text as ws, window_end::date::text as we, day::date::text as day,
                 count(*)::int as n, max(recorded_at) as newest
            from public.universe_attempt_log
           where vendor = $1::text and phase = 'day_committed' and resource <> '__account_inception'
             ${CLIENT_ARG ? 'and client_id = $2::uuid' : ''}
           group by 1, 2, 3, 4, 5, 6 having count(*) >= 2
        )
        select distinct on (client_id) client_id, resource, segment, ws, we, day, n, newest
          from k order by client_id, newest desc`, CLIENT_ARG ? [VENDOR, CLIENT_ARG] : [VENDOR])).rows
    } finally { await db.end() }
    const perClient = new Map(agg.map((r) => [r.client_id, { r, n: r.n }]))
    if (perClient.size === 0) {
      cleanup(); console.error(`[topwindow-frontier] CANNOT RUN — ${CLIENT_ARG ? `client ${CLIENT_ARG} has NO` : 'no client has a'} window with ≥ 2 day_committed records for one day; there is no subject, and no subject is not a pass.`)
      console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · no qualifying window'); process.exit(2)
    }
    const { data: names } = await sb.from('clients').select('id, name').in('id', [...perClient.keys()])
    const nameOf = new Map((names || []).map((n) => [n.id, n.name]))
    subjects = [...perClient.entries()].map(([id, { r, n }]) => ({
      client_id: id, name: nameOf.get(id) || id, resource: r.resource, segment: r.segment,
      ws: r.ws, we: r.we, day: r.day, how: `${n} day_committed records for that day, newest ${new Date(r.newest).toISOString().slice(0, 16)}`,
    })).sort((a, b) => a.name.localeCompare(b.name))
  }
  console.log(`[topwindow-frontier] ${CLIENT_ARG ? 'client named by --client' : 'fleet default'} — ${subjects.length} subject(s), one per client: its newest window with a day committed ≥ 2 times`)

  for (const S of subjects) {
    const tag = (id) => `${id}·${S.name}`
    const BREAKDOWN = surf.breakdownTypeForSurface(S.resource, S.segment)
    const KEY = { clientId: S.client_id, platform: VENDOR, entityLevel: S.resource, breakdownType: BREAKDOWN }
    const STUCK_RANGE = { start: S.day, end: S.we }
    const { data: commits, error: cErr } = await sb.from('universe_attempt_log')
      .select('attempt_no, rows_written, recorded_at')
      .eq('client_id', S.client_id).eq('vendor', VENDOR).eq('resource', S.resource).eq('segment', S.segment)
      .eq('phase', 'day_committed').eq('day', S.day)
    if (cErr) throw new Error(`precondition read failed: ${cErr.message}`)
    if (!commits || commits.length === 0) { red(tag('A0'), 'the subject day must carry a real day_committed record', `none for ${S.resource}/${S.segment} on ${S.day} (${S.how})`); continue }
    console.log(`[topwindow-frontier] ${S.name}: ${S.resource}/${S.segment} ${S.ws}..${S.we}, committed day ${S.day} (${S.how}) — attempt_no ${commits.map((c) => c.attempt_no).join(', ')}; ${commits.map((c) => c.rows_written).join('/')} rows each`)
    const owed = await cov.rangesStillOwed(KEY, S.ws, S.we)
    const c = owed.coverage
    console.log(`  windowCoverage: ${c.covered.length} covered · ${c.attestedEmpty.length} attested-empty · ${c.uncovered.length} owed in ${owed.ranges.length} range(s) · ${c.probes} probes / ${c.ms}ms · owed ${JSON.stringify(owed.ranges)}`)
    // A1 — a committed day must be RESOLVED: a day committed WITH rows must read COVERED (the commit record consulted);
    // a day committed with ZERO rows (the vendor answered nothing at this grain) must read COVERED or ATTESTED. Which one
    // is the ledger's to say — rows_written on the commit records — never this check's.
    const rowsCommitted = commits.reduce((n, r) => n + Number(r.rows_written ?? 0), 0)
    const resolvedAs = c.covered.includes(S.day) ? 'covered' : c.attestedEmpty.includes(S.day) ? 'attested-empty' : null
    if (rowsCommitted > 0 ? resolvedAs === 'covered' : resolvedAs !== null) {
      ok(tag('A1'), `${S.day} (committed with ${rowsCommitted} row(s) over ${commits.length} record(s)) reads ${resolvedAs.toUpperCase()} — the committed day is resolved.`)
    } else {
      red(tag('A1'), `${S.day} must be ${rowsCommitted > 0 ? 'COVERED' : 'COVERED or ATTESTED'} once it has been committed (${rowsCommitted} row(s) committed).`,
        `windowCoverage returned it as ${resolvedAs ?? (c.uncovered.includes(S.day) ? 'UNCOVERED' : 'absent')}. ` +
        (rowsCommitted > 0
          ? `coveredDaysStrict strips the NEWEST day-with-rows unless opts.dayCommitted names it; ${commits.length} real commit record(s) for this day sit in universe_attempt_log — if nothing reads them the day is stripped on every walk read.`
          : `a zero-row committed day that neither covers nor attests is owed forever — the nongrain/zero terminal for it is missing or unread.`))
    }
    const identical = owed.ranges.some((r) => r.start === STUCK_RANGE.start && r.end === STUCK_RANGE.end)
    if (!identical && !c.uncovered.includes(S.day)) {
      ok(tag('A2'), `the owed set no longer contains ${S.day}; the identical ${STUCK_RANGE.start}..${STUCK_RANGE.end} range is not re-asked.`)
    } else {
      red(tag('A2'), `the top window must stop re-asking the identical range ${STUCK_RANGE.start}..${STUCK_RANGE.end}.`,
        `it is still owed verbatim (${JSON.stringify(owed.ranges)}). Every fire re-asks it, spends one vendor request, re-writes the same rows and advances nothing.`)
    }
    const withRows = []
    for (const day of c.uncovered) {
      const { data, error } = await sb.from('metrics_daily').select('date')
        .eq('client_id', S.client_id).eq('platform', VENDOR)
        .eq('entity_level', S.resource).eq('breakdown_type', BREAKDOWN).eq('date', day).limit(1)
      if (error) throw new Error(`residue probe failed on ${day}: ${error.message}`)
      if ((data?.length ?? 0) > 0) withRows.push(day)
    }
    if (withRows.length === 0) {
      ok(tag('A3'), 'every remaining owed day holds ZERO rows — a real pass returns zero, attests, and the anchor recedes.')
    } else {
      red(tag('A3'), 'the owed residue must be days a zero-returning pass can attest.',
        `${withRows.length} owed day(s) STILL HOLD ROWS: ${withRows.join(', ')}. A pass over this range returns rows, so its outcome is 'ok' and never 'zero' — ` +
        `attestedEmptyDays can never clear the days beside it. That is the deadlock: the day with rows cannot cover, and the empty days cannot attest.`)
    }
  }
  // A4 is pure — the no-progress bound, once, subject-free
  const verdict = resumer.decideRepublish({
    owedDays: 3, owedDaysAtLastAttempt: 3,
    attemptsAtMinSpan: 1, maxAttemptsAtMinSpan: 3, spanDays: 3, minSpanDays: 1,
    last: { outcome: 'ok', attemptNo: 3, daysCommitted: 1 },
  })
  if (verdict.publish === false && verdict.verdict === 'no-progress') {
    ok('A4', 'decideRepublish refuses a lap that committed a day and shrank nothing.')
  } else {
    red('A4', 'the no-progress bound must fire when a lap commits a day but the owed set does not shrink.',
      `decideRepublish returned ${JSON.stringify(verdict)}. A stuck surface commits exactly ONE day per pass; a bound that tests daysCommitted === 0 never fires — it measures "did we commit a day", not "did the owed set shrink".`)
  }
} catch (e) {
  cleanup()
  console.error(`[topwindow-frontier] CANNOT RUN — ${e.message}`)
  console.log('[topwindow-frontier] VERDICT — CANNOT-RUN · 0 green · 0 red · exception')
  process.exit(2)
}
cleanup()

// ── REPORT. THE VERDICT IS THE LAST LINE AND THE EXIT IS ITS OWN FIELD (LORAMER_CHECKDATA_VERDICT_LINE_V1).
console.log('')
for (const r of results) {
  if (r.pass) console.log(`  ✓ ${r.id}  ${r.what}`)
  else { console.log(`  ✗ ${r.id}  ${r.what}`); console.log(`        WHY: ${r.why}`) }
}
const reds = results.filter((r) => !r.pass)
console.log('')
console.log(`[topwindow-frontier] VERDICT — EXIT ${reds.length ? 1 : 0} · ${results.length} assertions: ` +
  `${results.length - reds.length} green · ${reds.length} red` +
  (reds.length ? ` (${reds.map((r) => r.id).join(', ')})` : ''))
// ⛔ exitCode, NEVER process.exit — the same reason run-checkdata.mjs banks: process.exit forces exit even
// with pending async stdout writes, and stdout to a PIPE is async, so the verdict line above could be
// truncated by the very consumer it exists for. check:data spawns this with piped stdio.
process.exitCode = reds.length ? 1 : 0
