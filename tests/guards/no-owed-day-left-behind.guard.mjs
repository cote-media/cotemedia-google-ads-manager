#!/usr/bin/env node
// LORAMER_NO_OWED_DAY_LEFT_BEHIND_V1 — THE WALK MUST NOT LEAVE OWED GROUND ABOVE ITS OWN FRONTIER.
//
// ⛔ WHY THIS EXISTS AND WHY IT IS NOT THE ANCHOR GUARD AGAIN. `anchor-recedes-by-window.guard.mjs` is a UNIT
// DRIVE of `deriveAnchorEnd`: it proves the STEP SIZE is wrong. It is structurally BLIND to the two skip
// mechanisms found by the 2026-08-18 adversary pass, because both live at the CALLERS, not in the function:
//   G1 — the HOLD branch (universe-resumer.ts:316-321) returns `lastWindowEnd` taken from the rotation, with
//        NO fully-answered check of any kind. When the rotation's newest bounds END BELOW the previous anchor,
//        the anchor drops and nothing gates it. The recede gate guards only the OTHER branch.
//   G2 — MIS-SIZED narrowing (google-ads-universe-v2/route.ts:286) republishes `{…msg, endDate: narrowedEnd}`,
//        i.e. the OLDER half, and NOTHING ever republishes [narrowedEnd+1, endDate]. The upper half is dropped
//        at the PUBLISH site. ⛔ THE BANKED parent_window_start/end DESIGN DOES NOT CLOSE THIS — the narrowed
//        message's window genuinely IS the narrow one, so a parent column would record it faithfully.
//
// ⛔ SO THIS GUARD MEASURES THE PROPERTY, NOT THE MECHANISM. "Did the walk leave owed ground behind it?" is
// answerable from the WAREHOUSE ALONE and stays true no matter how the anchor is later re-plumbed. A detector
// written against a mechanism dies with the mechanism; this one outlives the fix and is what proves it worked.
//
// THE PREDICATE, per (resource, segment) surface of one client:
//   FRONTIER = the anchorEnd the LIVE resumer would derive THIS fire — `universe_surface_rotation` (the real
//              RPC, called, not re-queried) fed into the REAL COMPILED `deriveAnchorEnd`. Not re-implemented:
//              a guard that re-derives the arithmetic proves its own arithmetic (banked 2026-08-17).
//   ASKED    = every day covered by an `attempt_started` row's recorded bounds. That is what the log HOLDS.
//   SKIPPED  = ASKED  ∧  day > FRONTIER  ∧  no metrics_daily row  ∧  no 'zero'/'nongrain' attestation overlapping it.
//              i.e. we asked for it, we hold nothing for it, no vendor attested it empty, and the walk has
//              already moved below it — so nothing will ever ask again. The anchor only moves DOWN.
//
// ⛔ TWO DELIBERATE CONSERVATISMS, STATED SO THE COUNT IS READ AS A FLOOR AND NEVER AS A TOTAL:
//   1. COVERED for the skip test is LOOSE (any row present), not `coveredDaysStrict`. Strictness would mark
//      MORE days uncovered and report MORE skips. Loose under-reports. A floor is the honest direction.
//   2. The ASKED band is built from the RECORDED bounds, which for the multi-range case are RANGE bounds —
//      strictly narrower than the window that was really asked. Days owed inside a window but never opened as
//      a range are INVISIBLE here. ⇒ THIS GUARD CANNOT SEE THE DEFERRAL SKIP AT ALL; it sees the mis-sized and
//      hold-branch skips. `BUDGET STOP` rows = 0 all-time as of 2026-08-18, so nothing is being missed TODAY.
//
// ⛔ GUARD-ON-GUARD. A detector that cannot see the skip we already traced by hand is not evidence, it is
// decoration — and it would read exactly like a clean bill of health. If the known-live skip does not appear,
// this EXITS 2 (BROKEN), never 0 and never 1. `run-guards.mjs` counts CRASHED apart from FAILED for exactly
// this reason.
//
// SHIPS RED, like `anchor-recedes-by-window`. In check:data, NOT in `npm run guard` — a red in the build would
// block every unrelated push, and the skips it reports are HISTORY that only a re-walk can clear.
//
// USAGE: node tests/guards/no-owed-day-left-behind.guard.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252'   // Foam OH — the only client the walk has ever run for
const VENDOR = 'google'

// The skip traced BY HAND on 2026-08-18 from the attempt log + metrics_daily. If the detector cannot see this,
// it is broken. Asked once as part of [2026-07-14..2026-08-12], errored, never asked again; zero rows held.
const KNOWN = { resource: 'group_content_suitability_placement_view', segment: '', from: '2026-07-29', to: '2026-08-12' }

const findings = []
const out = mkdtempSync(join(tmpdir(), 'loramer-owed-'))
const broken = (msg) => {
  rmSync(out, { recursive: true, force: true })
  console.error(`[no-owed-day-left-behind] CANNOT RUN — ${msg}. A guard that cannot drive its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}

// ── env, loaded here: check:data invokes guards as bare `node <path>` with nothing preloaded ──────────────
try {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* the SUPABASE_DB_URL check below is the real gate */ }
if (!process.env.SUPABASE_DB_URL) broken('SUPABASE_DB_URL is missing — REFUSING TO PASS QUIETLY, a skipped data check reads exactly like a passing one')

// ── compile + require the REAL subjects. Both files are import-free, so --noResolve emits runnable JS ─────
let R, S
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'),
    resolve(ROOT, 'src/lib/backfill/universe-surfaces.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const req = createRequire(import.meta.url)
  R = req(join(out, 'src/lib/backfill/universe-resumer.js'))
  S = req(join(out, 'src/lib/backfill/universe-surfaces.js'))
} catch (e) { broken(e.message) }
if (typeof R.deriveAnchorEnd !== 'function') broken('deriveAnchorEnd is not exported — the subject moved')
if (typeof S.breakdownTypeForSurface !== 'function' || typeof S.drainAliasFor !== 'function') {
  broken('breakdownTypeForSurface / drainAliasFor are not exported — the surface mapping moved')
}

const pg = (await import('pg')).default
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))
let rot = [], frontiers = [], skipped = [], rotHasParentKnown = false
try {
  await db.connect()
  const q = async (s, p = []) => (await db.query(s, p)).rows

  // ── 1 · THE ROTATION, FROM THE REAL RPC ───────────────────────────────────────────────────────────────
  rot = await q(`select * from public.universe_surface_rotation($1::uuid, $2::text)`, [CLIENT, VENDOR])
  if (!rot.length) broken(`universe_surface_rotation returned no surfaces for ${CLIENT}/${VENDOR} — nothing to measure`)

  // surface → the coverage grain, from the REAL mapping (never re-spelled here)
  const surfaces = rot.map((r) => {
    const segment = r.segment ?? ''
    const bt = S.breakdownTypeForSurface(r.resource, segment)
    const alias = S.drainAliasFor(r.resource, bt)
    return {
      resource: r.resource, segment, bt,
      a_el: alias ? alias.entityLevel : null, a_bt: alias ? alias.breakdownType : null,
      ws: iso(r.last_window_start), we: iso(r.last_window_end),
    }
  })

  // ── 2 · IS THE ROTATION'S LAST WINDOW FULLY ANSWERED? — the gate's input, computed the way the resumer's
  // coverage read computes it: covered (STRICT: the newest day-with-rows does not close itself unless a
  // day_committed record exists) ∪ attested-empty, subtracted from the window's days.
  const uncovered = await q(`
    with s as (
      select * from json_to_recordset($2::json)
        as x(resource text, segment text, bt text, a_el text, a_bt text, ws date, we date)
    ),
    d as (
      select s.*, gs::date as day
      from s cross join lateral generate_series(s.ws, s.we, interval '1 day') gs
    ),
    withrows as (
      select d.*, exists (
        select 1 from public.metrics_daily md
        where md.client_id = $1::uuid and md.platform = $3::text and md.date = d.day
          and ( (md.entity_level = d.resource and md.breakdown_type = d.bt)
             or (d.a_el is not null and md.entity_level = d.a_el and md.breakdown_type = d.a_bt) )
      ) as has_rows
      from d
    ),
    marked as (
      select w.*,
        ( w.has_rows and (
            w.day <> max(case when w.has_rows then w.day end) over (partition by w.resource, w.segment)
            or exists (select 1 from public.universe_attempt_log c
                        where c.client_id = $1::uuid and c.vendor = $3::text and c.phase = 'day_committed'
                          and c.resource = w.resource and c.segment = w.segment and c.day = w.day)
        ) ) as covered,
        exists (select 1 from public.universe_attempt_log a
                 where a.client_id = $1::uuid and a.vendor = $3::text and a.phase = 'attempt_finished'
                   and a.outcome in ('zero','nongrain')
                   and a.resource = w.resource and a.segment = w.segment
                   and a.window_start <= w.day and a.window_end >= w.day) as attested
      from withrows w
    )
    select resource, segment, count(*) filter (where not covered and not attested)::int as owed
    from marked group by resource, segment`,
    [CLIENT, JSON.stringify(surfaces), VENDOR])
  const owedAt = new Map(uncovered.map((u) => [`${u.resource}|${u.segment}`, u.owed]))

  // ── 3 · THE FRONTIER — the REAL compiled deriveAnchorEnd, one call per surface, exactly as the resumer
  // calls it at universe-resume/route.ts:255-260.
  const newestGround = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()
  // ⛔ THE DETECTOR MUST MODEL THE ENGINE THAT IS ACTUALLY RUNNING, IN BOTH ERAS, OR ITS FRONTIER IS FICTION.
  // Before migrations/082 the rotation returns FIVE columns and the deployed resumer trusts whatever bounds it
  // gets — so `lastWindowKnown` is passed TRUE, reproducing that trust. After 082 the rotation returns
  // `parent_known` and the guard uses it. Hard-coding either would silently mis-place the frontier by up to a
  // full window, in the direction that HIDES skips, which is the failure this whole guard exists to refuse.
  rotHasParentKnown = Object.prototype.hasOwnProperty.call(rot[0], 'parent_known')
  const knownAt = new Map(rot.map((r) => [`${r.resource}|${r.segment ?? ''}`, rotHasParentKnown ? r.parent_known === true : true]))
  frontiers = surfaces.map((s) => {
    const owed = owedAt.get(`${s.resource}|${s.segment}`) ?? 0
    const a = R.deriveAnchorEnd({
      newestGround,
      lastWindowStart: s.ws, lastWindowEnd: s.we,
      lastWindowFullyAnswered: owed === 0,
      lastWindowKnown: knownAt.get(`${s.resource}|${s.segment}`) === true,
    })
    return { resource: s.resource, segment: s.segment, bt: s.bt, a_el: s.a_el, a_bt: s.a_bt,
             frontier: a.anchorEnd, receded: a.receded, owed, ws: s.ws, we: s.we }
  })

  // ── 4 · WHAT WAS ASKED, IS ABOVE THE FRONTIER, AND IS HELD BY NOTHING ─────────────────────────────────
  skipped = await q(`
    with s as (
      select * from json_to_recordset($2::json)
        as x(resource text, segment text, bt text, a_el text, a_bt text, frontier date)
    ),
    asked as (
      select distinct l.resource, l.segment, gs::date as day
      from public.universe_attempt_log l
      cross join lateral generate_series(l.window_start, l.window_end, interval '1 day') gs
      where l.client_id = $1::uuid and l.vendor = $3::text
        and l.phase = 'attempt_started' and l.resource <> '__account_inception'
    ),
    cand as (
      select s.resource, s.segment, s.bt, s.a_el, s.a_bt, a.day
      from asked a join s on s.resource = a.resource and s.segment = a.segment
      where a.day > s.frontier
    ),
    verdict as (
      select c.*,
        exists (
          select 1 from public.metrics_daily md
          where md.client_id = $1::uuid and md.platform = $3::text and md.date = c.day
            and ( (md.entity_level = c.resource and md.breakdown_type = c.bt)
               or (c.a_el is not null and md.entity_level = c.a_el and md.breakdown_type = c.a_bt) )
        ) as has_rows,
        exists (
          select 1 from public.universe_attempt_log a
          where a.client_id = $1::uuid and a.vendor = $3::text and a.phase = 'attempt_finished'
            and a.outcome in ('zero','nongrain')
            and a.resource = c.resource and a.segment = c.segment
            and a.window_start <= c.day and a.window_end >= c.day
        ) as attested
      from cand c
    )
    select resource, segment, count(*)::int as days, min(day) as oldest, max(day) as newest
    from verdict where not has_rows and not attested
    group by resource, segment order by count(*) desc, resource, segment`,
    [CLIENT, JSON.stringify(frontiers.map((f) => ({ resource: f.resource, segment: f.segment, bt: f.bt, a_el: f.a_el, a_bt: f.a_bt, frontier: f.frontier }))), VENDOR])
} catch (e) {
  try { await db.end() } catch { /* the throw below is the report */ }
  broken(e.message)
}
await db.end()
rmSync(out, { recursive: true, force: true })

// ── GUARD-ON-GUARD — can this detector see the skip we already traced by hand? ────────────────────────────
const known = skipped.find((s) => s.resource === KNOWN.resource && (s.segment ?? '') === KNOWN.segment)
const knownInBand = known && iso(known.oldest) <= KNOWN.to && iso(known.newest) >= KNOWN.from
if (!knownInBand) {
  console.error(
    `[no-owed-day-left-behind] BROKEN — the detector does NOT see the known-live skip.\n` +
    `  expected ${KNOWN.resource} segment '${KNOWN.segment}' to report >=1 skipped day overlapping ${KNOWN.from}..${KNOWN.to}\n` +
    `  got: ${known ? `${known.days} day(s) ${iso(known.oldest)}..${iso(known.newest)} — outside the band` : 'that surface reported NO skipped days at all'}\n` +
    `  ⛔ A DETECTOR THAT CANNOT SEE THE SKIP WE TRACED BY HAND IS WORSE THAN NONE: it would read as a clean bill of health.\n` +
    `  Re-derive it against the attempt log before trusting any verdict from it.`)
  process.exitCode = 2
  process.exit()
}

const totalDays = skipped.reduce((n, s) => n + s.days, 0)
console.log(`[no-owed-day-left-behind] measured ${rot.length} surface(s) of ${CLIENT}/${VENDOR} · frontier from the live rotation + the real deriveAnchorEnd (parent_known ${rotHasParentKnown ? 'READ FROM THE ROTATION — 082 is applied' : 'ABSENT — pre-082 rotation, modelling the deployed resumer'}) · ` +
            `guard-on-guard OK (${KNOWN.resource} reports ${known.days} skipped day(s), ${iso(known.oldest)}..${iso(known.newest)}).`)

if (skipped.length) {
  findings.push(`${totalDays} owed day(s) sit ABOVE the walk's own frontier across ${skipped.length} surface(s) — asked for, held by nothing, attested by nobody, and below no future window because the anchor only moves DOWN.`)
  console.error(`[no-owed-day-left-behind] FAIL — ${findings[0]}`)
  for (const s of skipped) {
    console.error(`  - ${s.resource}${s.segment ? ' / ' + s.segment : ''} — ${s.days} day(s), ${iso(s.oldest)}..${iso(s.newest)}`)
  }
  console.error(`  ⇒ THIS IS A FLOOR, NOT A TOTAL: covered is read LOOSELY and the ASKED band is built from RECORDED bounds, which are RANGE bounds for a multi-range window.`)
  console.error(`  ⇒ SPEC: docs/LORAMER_WALK_REBUILD_ARCHITECTURE.md § PROGRESS-TRUTH. ⛔ The parent_window_* design closes the RANGE-AS-WINDOW hole; it does NOT close G1 (the ungated hold branch, universe-resumer.ts:316-321) or G2 (mis-sized upper half dropped at google-ads-universe-v2/route.ts:286). This guard goes green only when NO owed day is left above the frontier.`)
  process.exitCode = 1
} else {
  console.log(`[no-owed-day-left-behind] PASS — no asked-but-unheld day sits above any surface's frontier.`)
}
