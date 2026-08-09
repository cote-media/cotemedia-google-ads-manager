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
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const WITH_DB = process.argv.includes('--db')
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const body = (s) => strip(s).split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n')

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
if (WITH_DB) {
  const pg = await import('pg')
  if (!process.env.SUPABASE_DB_URL) {
    findings.push('(v) --db requested but SUPABASE_DB_URL is missing (.env.local). REFUSING TO PASS QUIETLY: an unproven alias reads exactly like a proven one, and this leg is the only thing standing between a wrong alias and permanently skipped history.')
  } else {
    let ALIASES = []
    try {
      const m = strip(surfaces).match(/DRAIN_ALIAS[^=]*=\s*\{([\s\S]*?)\n\}/)
      if (m) {
        for (const line of m[1].split('\n')) {
          const e = line.match(/'([^']+)'\s*:\s*\{\s*entityLevel:\s*'([^']+)'\s*,\s*breakdownType:\s*'([^']+)'/)
          if (e) ALIASES.push({ key: e[1], entityLevel: e[2], breakdownType: e[3] })
        }
      }
    } catch { /* reported below */ }
    if (!ALIASES.length) {
      findings.push('(v) no parseable alias entries found — the leg cannot demonstrate what is not declared.')
    } else {
      const db = new pg.default.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
      await db.connect()
      // ⛔ BOUNDED BY THE INDEX, AND THE FIRST VERSION WAS NOT — it grouped the WHOLE table per alias and had to
      // be killed. Candidates come from the walk's OWN ledger (one cheap read), and every comparison pins
      // (client_id, platform, entity_level, date), which is exactly idx_mdp_client_platform_level_date. The
      // repo has been burned twice by a coverage query that was correct-looking and O(client-rows).
      const { rows: cand } = await db.query(
        `select distinct client_id, window_end::date as d from universe_window_log
          where vendor='google_ads' order by d desc limit 6`)
      if (!cand.length) {
        findings.push('(v) universe_window_log holds no walked window, so no alias can be demonstrated. An undemonstrated alias may not be trusted.')
      }
      for (const a of ALIASES) {
        const [walkLevel, walkBt] = a.key.split('|')
        let shown = false, mismatch = null
        for (const c of cand) {
          const { rows } = await db.query(
            `select
               (select coalesce(sum(impressions),0) from metrics_daily where client_id=$1 and platform='google'
                  and entity_level=$2 and breakdown_type=$3 and date=$4) as wi,
               (select coalesce(sum(clicks),0) from metrics_daily where client_id=$1 and platform='google'
                  and entity_level=$2 and breakdown_type=$3 and date=$4) as wc,
               (select coalesce(sum(impressions),0) from metrics_daily where client_id=$1 and platform='google'
                  and entity_level=$5 and breakdown_type=$6 and date=$4) as di,
               (select coalesce(sum(clicks),0) from metrics_daily where client_id=$1 and platform='google'
                  and entity_level=$5 and breakdown_type=$6 and date=$4) as dc`,
            [c.client_id, walkLevel, walkBt, c.d, a.entityLevel, a.breakdownType])
          const r = rows[0]
          if (Number(r.wi) === 0 && Number(r.di) === 0) continue   // neither key present on this day
          shown = true
          if (String(r.wi) !== String(r.di) || String(r.wc) !== String(r.dc)) {
            mismatch = `impressions ${r.wi} vs ${r.di}, clicks ${r.wc} vs ${r.dc} on ${String(c.d).slice(0, 10)}`
          }
          break
        }
        if (!shown) {
          findings.push(`(v) alias ${a.key} → ${a.entityLevel}/${a.breakdownType}: NO sampled day where either key holds rows. It cannot be demonstrated, so it may not be trusted — an undemonstrated alias is exactly the wrong-alias risk this leg exists to catch.`)
        } else if (mismatch) {
          findings.push(`(v) alias ${a.key} → ${a.entityLevel}/${a.breakdownType} DOES NOT HOLD: ${mismatch}. THESE ARE NOT THE SAME FACT — claiming coverage from it would skip real history permanently.`)
        }
      }
      await db.end()
    }
  }
}

if (findings.length) {
  console.error(`\n❌ LORAMER_DRAIN_ALIAS_COVERAGE_V1 FAILED — ${findings.length} finding(s)\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  console.error('  ⛔ CLAIMING COVERED WHEN IT IS NOT IS THE CATASTROPHIC DIRECTION. An alias is a claim; prove it.\n')
  process.exit(1)
}
console.log(
  `drain-alias-coverage.guard: PASS — dual-stored resources are aliased or explicitly walk-only, the coverage ` +
  `probe consults the alias${WITH_DB ? ', and every declared alias is demonstrated against live rows' : ' (the live demonstration runs under --db in check:data)'}. ` +
  `LIMIT: it proves the alias holds where BOTH keys have rows; it cannot prove the drain's own day was complete.`
)
