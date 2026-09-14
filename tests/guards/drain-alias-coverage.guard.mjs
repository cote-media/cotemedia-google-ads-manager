#!/usr/bin/env node
// LORAMER_DRAIN_ALIAS_COVERAGE_V1 — A SURFACE THE DRAIN ALREADY STORES IS NOT OWED, EVEN UNDER ANOTHER KEY.
//
// ⛔ THE ASYMMETRY THIS FILE IS BUILT AROUND, quoted from the module it guards (universe-coverage.ts:20-22):
// "claiming COVERED when it is not is catastrophic — it means never walking a real gap, silently, forever.
// Claiming OWED when it is covered costs ONE vendor request." **AN ALIAS POINTS AT ANOTHER KEY AND SAYS "THAT
// COUNTS". A WRONG ONE IS THEREFORE THE CATASTROPHIC DIRECTION, BY CONSTRUCTION.** Leg (v) exists because of
// that sentence: every alias must be DEMONSTRABLE FROM LIVE ROWS, never reasoned about and never inferred
// from naming.
//
// ⛔ WHAT IT IS FOR. Measured 2026-08-09 over the 08-04..08-08 walk: 1,220 of 17,878 vendor requests (6.8%)
// were spent on ground the drain had already covered, and **898 of those — 73% — were geo**. The colliding
// surfaces (device, hour, …) are already prevented, because after LORAMER_CANONICAL_KEY_SPELLING_V1 the walk
// and the drain share a key there and `windowCoverage` sees the drain's own rows. Geo is different: the walk
// stores it at entity_level `geographic_view` / `user_location_view` while the drain stores the same vendor
// data at `campaign`/`ad_group` with `geo_*` / `user_geo_*`. Same fetch, different key, invisible to coverage.
//
// LEGS
//  (t) every walk surface whose vendor data the drain also stores declares an ALIAS or an explicit WALK-ONLY
//  (u) rangesStillOwed / windowCoverage actually PROBES the alias when one exists
//  (v) --db: every declared alias is DEMONSTRATED against live rows — same fact, same or finer grain
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const WITH_DB = process.argv.includes('--db')
const findings = []
// ⛔ LORAMER_CANNOT_RUN_IS_NOT_FAILED_V1 — evidence this machine could not GATHER, kept apart from evidence
// of a defect. Both refuse to pass; conflating them is how a standing environmental red becomes background noise.
const blockers = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const body = (s) => strip(s).split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n')

// ⛔ LORAMER_GUARD_LOADS_ENV_LOCAL_V1 (★CANNOT-RUN-LEGS-NEVER-LOAD-ENV-LOCAL), 2026-08-11. LEG (v) REPORTED
// "SUPABASE_DB_URL is missing (.env.local)" WHILE IT SAT IN .env.local, POPULATED, THE WHOLE TIME — node does
// not auto-load env files (Next.js does; `npm run check:data` runs bare `node`), and this guard read
// `process.env` directly. So the ONLY thing standing between a wrong alias and permanently skipped history had
// never actually run on this machine, and its own message blamed the machine rather than the missing loader.
//
// ⛔ CALLED LAZILY, INSIDE THE --db BRANCH. This guard ALSO runs in the HERMETIC `npm run guard`
// (scripts/run-guards.mjs:214) inside `next build` ON VERCEL, where there is no .env.local — a module-top
// `readFileSync` would throw there and break the deploy.
//
// ⛔ SHAPE CHOSEN AFTER SURVEYING ALL 18 HAND-ROLLED LOADERS, not copied from the one the queue entry named.
// `scripts/check-parent-analyze.mjs:27` belongs to a three-file family that builds a LOCAL `env` object and
// lets `readFileSync` THROW; both properties are wrong for a file on the hermetic path. The process.env /
// soft / quote-stripping family used by the four sibling guards is canonical FOR GUARDS, and this matches it —
// plus `indexOf('=')` and the '#' skip taken from the other family, because splitting on '=' would truncate a
// DSN carrying `?sslmode=require` into a silently-broken connection string.
// ⛔ READS FROM process.cwd(), NEVER `ROOT`: the env file belongs to THE MACHINE, not to the tree under audit.
// SCOPE: this flight fixes THE TWO guards that had no loader; the other 18 are NOT unified here.
function loadEnvLocal() {
  let txt = ''
  try { txt = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8') } catch { return }
  for (const line of txt.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    // ⛔ NEVER CLOBBER A REAL ENVIRONMENT VARIABLE — a shell export or CI injection outranks a file on disk.
    if (process.env[k]) continue
    process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const COVERAGE = 'src/lib/backfill/universe-coverage.ts'

// ⛔ THE RESOURCES WHOSE VENDOR DATA THE DRAIN ALSO STORES UNDER A DIFFERENT KEY. Read from the drain's own
// builder: `google-geo.ts:70-80` declares GEOGRAPHIC_GRAINS as `geo_<short>` and USER_GRAINS as
// `user_geo_<short>`, and `:94-97` GEO_ENTITIES fixes the entity axis at campaign + ad_group.
const DUAL_STORED_RESOURCES = ['geographic_view', 'user_location_view']

const surfaces = read(SURFACES)
const coverage = read(COVERAGE)

// ── (t) EVERY DUAL-STORED SURFACE IS EITHER ALIASED OR EXPLICITLY WALK-ONLY ───────────────────────────────
{
  if (!/DRAIN_ALIAS/.test(strip(surfaces))) {
    findings.push(
      `(t) ${SURFACES} declares no DRAIN_ALIAS map. The walk re-fetches geo the drain already holds —\n` +
      `      measured 898 of 17,878 requests on the 08-04..08-08 walk — because coverage probes\n` +
      `      entity_level='geographic_view' while the drain wrote entity_level='campaign', breakdown_type='geo_*'.`)
  }
  if (!/WALK_ONLY/.test(strip(surfaces))) {
    findings.push(
      `(t) ${SURFACES} declares no WALK_ONLY marking. A surface with NO alias must say so DELIBERATELY —\n` +
      `      geo_target_airport and geo_target_canton have no drain grain at all (google-geo.ts:55-68 lists\n` +
      `      city/metro/region/state/province/county/district/postal/most_specific), and silence would read as\n` +
      `      "nobody looked" rather than "checked, and the drain does not hold it".`)
  }
  for (const r of DUAL_STORED_RESOURCES) {
    if (!new RegExp(r).test(strip(surfaces))) {
      findings.push(`(t) '${r}' is stored by BOTH engines under different keys and appears in neither the alias map nor the walk-only list in ${SURFACES}.`)
    }
  }
}

// ── (t) BY KEY, FOR THE FOUR BASE SPELLINGS — LORAMER_WALK_BASE_DEALIAS_V1 (2026-09-12) ─────────────────
// The resource-name test above cannot see a base twin: 'campaign' appears in the file whatever the map says. The
// four base surfaces forward writes at '' (its own manifest: forward-observation-log.ts FORWARD_PRODUCER_SURFACES,
// producers google-account-row · google-campaign-backfill · google-adgroup-ad-backfill) must each be EITHER an
// alias entry OR a WALK_ONLY_SURFACES key at the walk spelling `<resource>|<resource>` — never neither. Seen RED
// 2026-09-12 with the four alias entries deleted and the walk-only keys not yet written.
{
  const OBS = 'src/lib/backfill/forward-observation-log.ts'
  const obs = strip(read(OBS))
  const baseProducers = ['google-account-row', 'google-campaign-backfill', 'google-adgroup-ad-backfill']
  const dualBase = []
  for (const prod of baseProducers) {
    const m = obs.match(new RegExp(`'${prod}'\\s*:\\s*\\[([^\\]]*)\\]`))
    if (!m) { findings.push(`(t) ${OBS} no longer declares producer '${prod}' in FORWARD_PRODUCER_SURFACES — the base-twin set cannot be read from the legacy manifest`); continue }
    for (const e of m[1].matchAll(/resource:\s*'([a-z_]+)'\s*,\s*segment:\s*''/g)) dualBase.push(e[1])
  }
  if (dualBase.length !== 4) findings.push(`(t) expected 4 base producers' surfaces in ${OBS}, read ${dualBase.length} (${dualBase.join(', ')})`)
  const aliasBlock = strip(surfaces).match(/DRAIN_ALIAS[^=]*=\s*\{([\s\S]*?)\n\}/)
  const aliasKeys = new Set(aliasBlock ? [...aliasBlock[1].matchAll(/'([^']+)'\s*:\s*\{\s*entityLevel/g)].map((x) => x[1]) : [])
  const walkOnlyBlock = strip(surfaces).match(/WALK_ONLY_SURFACES\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
  const walkOnly = new Set(walkOnlyBlock ? [...walkOnlyBlock[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [])
  for (const r of dualBase) {
    const key = `${r}|${r}`
    if (!aliasKeys.has(key) && !walkOnly.has(key)) {
      findings.push(`(t) '${key}' is stored by BOTH engines under different keys (forward writes ${r} at breakdown_type '' — ${OBS} FORWARD_PRODUCER_SURFACES) and appears in neither DRAIN_ALIAS nor WALK_ONLY_SURFACES in ${SURFACES}. A base twin in neither list is a silent third state: not aliased, not declared walk-only, re-bought or skipped on nobody's decision.`)
    }
  }
}

// ── (u) THE PROBE ACTUALLY ASKS THE ALIAS ─────────────────────────────────────────────────────────────────
{
  if (!/drainAliasFor|DRAIN_ALIAS/.test(body(coverage))) {
    findings.push(
      `(u) ${COVERAGE} never consults the alias. A map nothing reads is a comment — windowCoverage still asks\n` +
      `      one key per day, so every aliased day still reads UNCOVERED and is still published and re-fetched.`)
  }
}

// ── (v) THE ALIAS IS DEMONSTRATED FROM LIVE ROWS ──────────────────────────────────────────────────────────
// ⛔ THIS IS THE LEG THAT STOPS A WRONG ALIAS SKIPPING REAL HISTORY, AND IT IS THE REASON THE MAP MAY NOT BE
// TRUSTED ON ANYONE'S READING. For each declared alias it finds a day where BOTH keys hold rows and compares
// the vendor's own additive counters. Impressions and clicks must match EXACTLY; spend is allowed a cent of
// per-row rounding because the two keys aggregate different row counts at 2dp.
//
// ⛔ RE-SPEC 2026-09-14 — LORAMER_CHECKDATA_RESPEC_BATCH_A_V1 (DECISIONS LORAMER_RESTATEMENT_WINDOW_LAW_V1):
// EXACT EQUALITY IS ONLY A VALID PROXY FOR "SAME FACT" ON GROUND THE VENDOR HAS STOPPED RESTATING. The walk key
// and the drain key are written by different fetches at different hours, and inside the restatement boundary
// the vendor's own counters move between them (Escential 2026-09-09: impressions 6514 vs 6513, clicks equal —
// a day-old restatement, not a wrong alias). So this leg compares ONLY days at or past the lane's boundary:
// T−B, where T is today and B is the account's restatement boundary — `boundaryDaysFor` (lookback-boundary.ts,
// read from entity_state_history, per account) and `addDaysISO` (universe-resumer.ts), tsc-compiled and
// IMPORTED here, never re-derived. ⛔ THIS IS A BOUNDARY, NOT A TOLERANCE BAND: a 1-impression delta on a day
// past T−B is still a wrong alias and still RED. An account whose boundary is UNKNOWN is skipped and named —
// unknown refuses (the inception posture), it does not default. The boundary and the day compared are printed.
// The rule `day ≤ T−B` is the lane's own (deriveBoundaryStrip: a window ending ≤ T−B is askable).

/** The lane's rule for "past the boundary": the day is at or before T−B. */
export function pastBoundary(dayISO, boundaryEndISO) { return String(dayISO) <= String(boundaryEndISO) }
/** Exact equality on the vendor's additive counters — the same-fact test. null = holds. */
export function countersMismatch(r) {
  return (String(r.wi) !== String(r.di) || String(r.wc) !== String(r.dc)) ? `impressions ${r.wi} vs ${r.di}, clicks ${r.wc} vs ${r.dc}` : null
}
/**
 * Walk the candidate days (newest first): skip any inside the boundary, compare the first past-boundary day
 * where either key holds rows. readRow(cand) → { wi, wc, di, dc }. Pure over its inputs; the DB is behind readRow.
 */
export async function demonstrateAlias(cands, readRow) {
  const skipped = []
  for (const c of cands) {
    if (!pastBoundary(c.d, c.boundaryEnd)) { skipped.push(c); continue }
    const r = await readRow(c)
    if (Number(r.wi) === 0 && Number(r.di) === 0) continue   // neither key present on this day
    return { compared: c, mismatch: countersMismatch(r), row: r, skipped }
  }
  return { compared: null, mismatch: null, row: null, skipped }
}

// ⛔ THE LANE'S OWN DAY ARITHMETIC AND BOUNDARY READ, COMPILED FROM THE TS — never re-rolled here (Lesson 19).
function compileLane() {
  const out = mkdtempSync(join(tmpdir(), 'loramer-alias-'))
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/universe-resumer.ts'), resolve(ROOT, 'src/lib/backfill/lookback-boundary.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const resumerJs = join(out, 'src/lib/backfill/universe-resumer.js')
  const boundaryJs = join(out, 'src/lib/backfill/lookback-boundary.js')
  if (!existsSync(resumerJs) || !existsSync(boundaryJs)) throw new Error(`tsc produced no output (${(r.stdout || '').slice(0, 300)})`)
  return { out, resumerJs, boundaryJs }
}

// ── (v-fixture) THE BOUNDARY FILTER IS PROVEN BEFORE ANY LIVE ROW IS READ — runs hermetically too ──────────
{
  let lane = null
  try {
    lane = compileLane()
    const resumer = createRequire(import.meta.url)(lane.resumerJs)
    const T = new Date().toISOString().slice(0, 10)
    const B = resumer.LOOKBACK_FLEET_FLOOR_DAYS   // the fleet floor, imported — the fixture's B; live uses the account's own
    const boundaryEnd = resumer.addDaysISO(T, -B)
    const young = { d: resumer.addDaysISO(T, -1), boundaryEnd, name: 'fixture' }
    const old = { d: resumer.addDaysISO(boundaryEnd, -1), boundaryEnd, name: 'fixture' }
    const rowsByDay = {
      [young.d]: { wi: 6514, wc: 84, di: 6513, dc: 84 },   // the 1-impression restatement delta, inside the boundary
      [old.d]: { wi: 100, wc: 10, di: 90, dc: 10 },        // a real mismatch, past the boundary
    }
    const readRow = async (c) => rowsByDay[c.d] || { wi: 0, wc: 0, di: 0, dc: 0 }
    const a = await demonstrateAlias([young], readRow)
    const b = await demonstrateAlias([young, old], readRow)
    const c = await demonstrateAlias([{ ...old, d: resumer.addDaysISO(old.d, -1) }], async () => ({ wi: 5, wc: 1, di: 5, dc: 1 }))
    const cases = [
      { name: `young day ${young.d} (1-impression delta) inside T−B=${boundaryEnd} → NOT compared`, ok: a.compared === null && a.skipped.length === 1 },
      { name: `old day ${old.d} (real mismatch) past T−B → compared and RED`, ok: b.compared?.d === old.d && b.mismatch !== null && b.skipped.length === 1 },
      { name: 'old day with equal counters → compared and HOLDS', ok: c.compared !== null && c.mismatch === null },
    ]
    for (const k of cases) {
      if (!k.ok) findings.push(`(v-fixture) ${k.name} — the boundary filter does not behave; the live leg may not be trusted.`)
      else console.log(`  ✓ (v-fixture) ${k.name}`)
    }
    console.log(`  (v-fixture) T=${T} B=${B} (LOOKBACK_FLEET_FLOOR_DAYS, imported) → T−B=${boundaryEnd}`)
  } catch (e) {
    blockers.push(`(v-fixture) could not compile the lane's boundary arithmetic (${e.message}); the filter is unproven on this machine.`)
  } finally {
    if (lane) rmSync(lane.out, { recursive: true, force: true })
  }
}

if (WITH_DB) {
  const pg = await import('pg')
  loadEnvLocal()
  if (!process.env.SUPABASE_DB_URL) {
    // ⛔ LORAMER_CANNOT_RUN_IS_NOT_FAILED_V1, 2026-08-10 — A BLOCKER, NOT A FINDING. The refusal is UNCHANGED
    // and still exits non-zero; it simply no longer RENDERS like a wrong alias.
    blockers.push('(v) SUPABASE_DB_URL is missing (.env.local), so no alias could be demonstrated against live rows on this machine. STILL REFUSING TO PASS: an unproven alias reads exactly like a proven one, and this leg is the only thing standing between a wrong alias and permanently skipped history. This is an ENVIRONMENT blocker, NOT evidence that an alias is wrong.')
  } else {
    let ALIASES = []
    let declaredCount = 0
    try {
      const m = strip(surfaces).match(/DRAIN_ALIAS[^=]*=\s*\{([\s\S]*?)\n\}/)
      if (m) {
        // Every declared entry, counted independently of parseability — the denominator for the check below.
        declaredCount = (m[1].match(/entityLevel:/g) || []).length
        for (const line of m[1].split('\n')) {
          // ⛔ breakdownType is `([^']*)` — ZERO OR MORE — as of 2026-08-12 (★WALK-BASE-SPELLING-SPLIT). The
          // base twins alias to breakdown_type '' (forward's base spelling), and the old `+` regex silently
          // FAILED TO PARSE any such entry: the alias would have shipped TRUSTED WITHOUT DEMONSTRATION,
          // invisible to this leg — the exact "quotation is not assertion" class, in the demonstrator itself.
          const e = line.match(/'([^']+)'\s*:\s*\{\s*entityLevel:\s*'([^']+)'\s*,\s*breakdownType:\s*'([^']*)'/)
          if (e) ALIASES.push({ key: e[1], entityLevel: e[2], breakdownType: e[3] })
        }
      }
    } catch { /* reported below */ }
    // ⛔ THE DEMONSTRATOR MUST SEE EVERY DECLARED ENTRY. A declared alias the parser cannot read is an alias
    // nothing re-proves — trusted on nobody's reading, which this leg exists to forbid. Seen RED with the
    // four base entries declared and the old `+` regex in place (parsed 12 of 16).
    if (declaredCount !== ALIASES.length) {
      findings.push(`(v) DRAIN_ALIAS declares ${declaredCount} entr(ies) but the demonstrator parsed ${ALIASES.length} — ${declaredCount - ALIASES.length} alias(es) would ship WITHOUT live-row demonstration. An alias the demonstrator cannot see is a claim nobody re-proves.`)
    }
    if (!ALIASES.length) {
      findings.push('(v) no parseable alias entries found — the leg cannot demonstrate what is not declared.')
    } else {
      const db = new pg.default.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
      await db.connect()
      // ── the boundary, per account, IMPORTED from the lane ──
      let lane = null, cand = []
      const origResolve = Module._resolveFilename
      try {
        lane = compileLane()
        const resumer = createRequire(import.meta.url)(lane.resumerJs)
        const { createClient } = createRequire(import.meta.url)('@supabase/supabase-js')
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — boundaryDaysFor reads through supabaseAdmin')
        if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = class { constructor() { throw new Error('Realtime unused') } }
        global.__LORAMER_ALIAS_SB__ = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
        const shim = join(lane.out, '__supabase.js')
        writeFileSync(shim, 'module.exports = { supabaseAdmin: global.__LORAMER_ALIAS_SB__, supabase: global.__LORAMER_ALIAS_SB__ }')
        Module._resolveFilename = function (request, ...rest) {
          if (/@\/lib\/supabase$/.test(request)) return shim
          if (/universe-resumer$/.test(request)) return lane.resumerJs
          return origResolve.call(this, request, ...rest)
        }
        const { boundaryDaysFor } = createRequire(import.meta.url)(lane.boundaryJs)
        const T = new Date().toISOString().slice(0, 10)
        const { rows: walked } = await db.query(
          `select distinct w.client_id, c.name, pc.account_id
             from universe_window_log w
             join clients c on c.id = w.client_id
             join platform_connections pc on pc.client_id = w.client_id and pc.platform = 'google' and pc.account_id is not null
            where w.vendor = 'google_ads' order by c.name`)
        let known = 0
        for (const w of walked) {
          const v = await boundaryDaysFor(w.client_id, w.account_id)
          if (!v.known) { console.log(`  (v) ${w.name}: boundary UNKNOWN — skipped, not defaulted (${v.reason})`); continue }
          known++
          const boundaryEnd = resumer.addDaysISO(T, -v.days)
          const { rows: days } = await db.query(
            `select distinct window_end::date::text as d from universe_window_log
              where vendor='google_ads' and client_id=$1 and window_end::date <= $2::date order by d desc limit 6`,
            [w.client_id, boundaryEnd])
          console.log(`  (v) ${w.name}: T=${T} B=${v.days} ⇐ ${v.basis} → boundary day T−B=${boundaryEnd}; ${days.length} walked day(s) at or past it${days.length ? ` (newest ${days[0].d})` : ''}`)
          for (const r of days) cand.push({ client_id: w.client_id, name: w.name, d: r.d, boundaryEnd })
        }
        if (walked.length && !known) blockers.push('(v) no walked google account has a KNOWN restatement boundary, so no alias could be compared on past-boundary ground. STILL REFUSING TO PASS.')
      } catch (e) {
        blockers.push(`(v) the lane's boundary could not be imported (${e.message}); without it the leg cannot tell a restatement from a wrong alias. STILL REFUSING TO PASS.`)
      } finally {
        Module._resolveFilename = origResolve
        if (lane) rmSync(lane.out, { recursive: true, force: true })
      }
      if (!blockers.some((b) => b.startsWith('(v)')) && !cand.length) {
        findings.push('(v) universe_window_log holds no walked window at or past any account\'s restatement boundary, so no alias can be demonstrated on settled ground. An undemonstrated alias may not be trusted.')
      }
      const readRow = async (c) => (await db.query(
        `select
           (select coalesce(sum(impressions),0) from metrics_daily where client_id=$1 and platform='google'
              and entity_level=$2 and breakdown_type=$3 and date=$4) as wi,
           (select coalesce(sum(clicks),0) from metrics_daily where client_id=$1 and platform='google'
              and entity_level=$2 and breakdown_type=$3 and date=$4) as wc,
           (select coalesce(sum(impressions),0) from metrics_daily where client_id=$1 and platform='google'
              and entity_level=$5 and breakdown_type=$6 and date=$4) as di,
           (select coalesce(sum(clicks),0) from metrics_daily where client_id=$1 and platform='google'
              and entity_level=$5 and breakdown_type=$6 and date=$4) as dc`,
        [c.client_id, c.walkLevel, c.walkBt, c.d, c.entityLevel, c.breakdownType])).rows[0]
      for (const a of (cand.length ? ALIASES : [])) {
        const [walkLevel, walkBt] = a.key.split('|')
        const res = await demonstrateAlias(cand.map((c) => ({ ...c, walkLevel, walkBt, entityLevel: a.entityLevel, breakdownType: a.breakdownType })), readRow)
        if (!res.compared) {
          findings.push(`(v) alias ${a.key} → ${a.entityLevel}/${a.breakdownType}: NO past-boundary day where either key holds rows (${cand.length} candidate(s)). It cannot be demonstrated, so it may not be trusted — an undemonstrated alias is exactly a wrong alias with better luck.`)
        } else if (res.mismatch) {
          findings.push(`(v) alias ${a.key} → ${a.entityLevel}/${a.breakdownType} DOES NOT HOLD: ${res.mismatch} on ${res.compared.name} ${res.compared.d} (past the boundary T−B=${res.compared.boundaryEnd} — not a restatement). THESE ARE NOT THE SAME FACT — claiming coverage from it would skip real history permanently.`)
        } else {
          console.log(`  ✓ (v) alias ${a.key} → ${a.entityLevel}/${a.breakdownType} HOLDS on ${res.compared.name} ${res.compared.d}: impressions ${res.row.wi}=${res.row.di}, clicks ${res.row.wc}=${res.row.dc} (compared past T−B=${res.compared.boundaryEnd})`)
        }
      }
      await db.end()
    }
  }
}

// ⛔ TWO NON-ZERO STATES, AND THEY MUST NOT LOOK ALIKE. `FAILED` is a claim about an ALIAS. `CANNOT-RUN` is a
// claim about THIS MACHINE. Both refuse to pass; only one is a defect. The difference lives in the BANNER, not in the exit
// code: `check:data` takes the MAX exit of its legs, so a special code would outrank and mask a real failure.
if (findings.length) {
  console.error(`\n❌ LORAMER_DRAIN_ALIAS_COVERAGE_V1 FAILED — ${findings.length} finding(s) ABOUT AN ALIAS\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  if (blockers.length) {
    console.error(`  ⚠ AND ${blockers.length} leg(s) COULD NOT RUN — listed below; they are not part of the count above.\n`)
    blockers.forEach((b) => console.error('  ⚠ ' + b + '\n'))
  }
  console.error('  ⛔ CLAIMING COVERED WHEN IT IS NOT IS THE CATASTROPHIC DIRECTION. An alias is a claim; prove it.\n')
  process.exit(1)
}
if (blockers.length) {
  console.error(`\n⚠ LORAMER_DRAIN_ALIAS_COVERAGE_V1 CANNOT-RUN — ${blockers.length} leg(s) blocked by the ENVIRONMENT, 0 findings about an alias\n`)
  blockers.forEach((b) => console.error('  ⚠ ' + b + '\n'))
  console.error('  ⛔ THIS IS NOT A PASS. No alias was demonstrated; the machine could not ask.\n')
  // ⛔ EXIT 1, NOT A DISTINCT CODE — see the note in canonical-key-spelling.guard.mjs. `check:data` takes the
  // MAX exit of its legs, so a dedicated CANNOT-RUN code would outrank and therefore MASK a real data failure.
  process.exit(1)
}
console.log(
  `drain-alias-coverage.guard: PASS — dual-stored resources are aliased or explicitly walk-only, the coverage ` +
  `probe consults the alias${WITH_DB ? ', and every declared alias is demonstrated against live rows' : ' (the live demonstration runs under --db in check:data)'}. ` +
  `LIMIT: it proves the alias holds where BOTH keys have rows; it cannot prove the drain's own day was complete.`
)
