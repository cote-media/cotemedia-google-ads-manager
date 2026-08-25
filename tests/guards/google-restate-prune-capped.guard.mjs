#!/usr/bin/env node
// LORAMER_GOOGLE_RESTATE_PRUNE_V1 — THE STATIC HALF: the prune exists, and it cannot reach outside its scope.
//
// ⛔ WHAT THIS PAIRS WITH. `scripts/check-restate-prune-live.mjs` proves the BEHAVIOUR — it drives the real
// writer and the real prune against live Postgres and asserts a re-pulled day equals the fresh payload. It
// lives in check:data because IT WRITES TO THE DATABASE and `npm run guard` runs on Vercel during the build.
// This file is the half that is safe in a build: it reads SOURCE ONLY and holds the shape of the delete.
// Neither replaces the other — the live check would pass on a prune whose scope is dangerously wide as long
// as this particular fixture survived, and this one cannot prove a single row was ever removed.
//
// ⛔ WHY A SCOPE GUARD AT ALL, AND WHY EVERY PREDICATE IS ITS OWN LEG. This is the only DESTRUCTIVE write in
// the Google capture path. A delete that loses one predicate does not fail loudly — it silently widens, and
// the blast radius of a missing `date` filter is every search term this warehouse holds for that client. The
// house rule for destructive work is a manifest first, children-first, scope proven before the delete runs
// (DECISIONS LORAMER_CLEANUP_DELETE_RENEE_JASON_V1); at writer scale the equivalent is that the predicates
// are STRUCTURALLY PRESENT and a build fails without them.
//
// FIVE LEGS:
//   (a) the module exists and exports the one prune function
//   (b) the delete carries ALL FIVE scope predicates — client_id, platform, entity_level, breakdown_type, date
//   (c) the capped set is EXACTLY search_term + keyword — never an uncapped grain (device/hour/geo/
//       demographic, which fetch every value and cannot have a top-N boundary) and never a fixed-key grain
//       (account/campaign/ad_group base/ad, whose key set is the entity list and does not churn)
//   (d) the writer actually calls it — an unwired prune is the ★SHOPIFY-TIER2 gap with extra steps
//   (e) a day with NO fresh rows is never pruned — the false-zero direction. A day the vendor answered with
//       nothing must keep what it has; DECISIONS:2094 chose an extra stale row over a transient false zero,
//       and a prune that treats "no rows returned" as "delete everything" inverts exactly that ruling.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const PRUNE = 'src/lib/intelligence/google-dimensional-prune.ts'
const SYNC = 'src/app/api/cron/sync/route.ts'
const findings = []

// ⛔ STRIP COMMENTS BEFORE MATCHING — this guard's own prose names every string it hunts for, and so does the
// subject's header. A guard that reads comments is not reading the code.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const readCode = (f) => { try { return stripComments(readFileSync(resolve(ROOT, f), 'utf8')) } catch { return null } }

const prune = readCode(PRUNE)

// ── LEG (a): the module exists and exports the one prune ────────────────────────────────────────────────
if (prune === null) {
  findings.push({ leg: 'a', what: `${PRUNE} does not exist`, snippet: 'a capped writer that re-pulls a day without a prune leaves old ∪ new — QUEUE ★SHOPIFY-TIER2 gap (1), arriving on Google via the 30-day restate window' })
} else if (!/export\s+async\s+function\s+pruneCappedDimensionalRows\s*\(/.test(prune)) {
  findings.push({ leg: 'a', what: `${PRUNE} does not export pruneCappedDimensionalRows`, snippet: 'ONE owner for the destructive path, named so the guard and the writer cannot drift' })
}

if (prune !== null) {
  // ── LEG (b): every scope predicate is structurally present on the delete ───────────────────────────────
  // The delete is located by its own `.delete()` and read to the end of its chain, so a predicate applied to
  // some OTHER query in the file cannot satisfy this leg on its behalf.
  const dm = /\.delete\s*\(/.exec(prune)
  const di = dm ? dm.index : -1
  if (di < 0) {
    findings.push({ leg: 'b', what: `${PRUNE} contains no .delete() — nothing is pruned`, snippet: 'the whole point of the module' })
  } else {
    const chain = prune.slice(di, di + 1400)
    // ⛔ THE PREDICATE IS THE PROPERTY, THE SPELLING IS NOT. entity_level may be pinned by the literal or by a
    // module constant, but the constant must itself RESOLVE to 'ad_group' in this same file — otherwise a
    // rename could widen the scope while the guard kept reading a matching identifier. Checked, not assumed.
    const levelPinnedByLiteral = /\.eq\(\s*'entity_level'\s*,\s*'ad_group'\s*\)/.test(chain)
    const levelConst = /\.eq\(\s*'entity_level'\s*,\s*([A-Z_][A-Z0-9_]*)\s*\)/.exec(chain)
    const levelPinnedByConst = levelConst !== null
      && new RegExp(`const\\s+${levelConst[1]}\\s*=\\s*'ad_group'`).test(prune)
    const REQUIRED = [
      ['client_id', /\.(eq|in)\(\s*'client_id'/],
      ['platform', /\.eq\(\s*'platform'\s*,\s*'google'/],
      ['breakdown_type', /\.in\(\s*'breakdown_type'/],
      ['date', /\.in\(\s*'date'/],
    ]
    for (const [col, re] of REQUIRED) {
      if (!re.test(chain)) findings.push({ leg: 'b', what: `the delete does not pin ${col}`, snippet: `a delete missing ${col} widens silently; its blast radius is every capped row outside the intended scope` })
    }
    if (!levelPinnedByLiteral && !levelPinnedByConst) {
      findings.push({ leg: 'b', what: 'the delete does not pin entity_level to ad_group', snippet: `a delete missing entity_level widens silently${levelConst ? ` — it pins ${levelConst[1]}, which this file does not define as 'ad_group'` : ''}` })
    }
  }

  // ── LEG (c): the capped set is exactly search_term + keyword ───────────────────────────────────────────
  const CAPPED_OK = /\[\s*'search_term'\s*,\s*'keyword'\s*\]|\[\s*'keyword'\s*,\s*'search_term'\s*\]/
  if (!CAPPED_OK.test(prune)) {
    findings.push({ leg: 'c', what: 'the capped breakdown-type set is not the literal ["search_term","keyword"]', snippet: 'only the two per-day top-N families may be pruned — everything else either fetches every value or has a stable key set' })
  }
  const FORBIDDEN = ['device', 'hour', 'geo_city', 'geo_region', 'age', 'gender', 'conversion_action', 'impression_share']
  for (const bt of FORBIDDEN) {
    if (new RegExp(`'${bt}'`).test(prune)) {
      findings.push({ leg: 'c', what: `${PRUNE} names the UNCAPPED breakdown_type '${bt}'`, snippet: 'uncapped families return every value, so an absent key means the vendor withdrew the fact — not that a cap moved. Pruning them is a different decision and Russ has not made it.' })
    }
  }
  for (const lvl of ["'account'", "'campaign'", "'ad'"]) {
    if (new RegExp(`entity_level[^\\n]*${lvl}`).test(prune)) {
      findings.push({ leg: 'c', what: `${PRUNE} references the fixed-key grain entity_level ${lvl}`, snippet: 'account/campaign/ad key sets are entity lists, not top-N selections; they do not churn and must never be pruned' })
    }
  }

  // ── LEG (e): a day with no fresh rows is never pruned ──────────────────────────────────────────────────
  // The contract is that `dates` carries ONLY days that produced at least one fresh row. The module must say
  // so on its own face and the writer must honour it — leg (d) checks the caller.
  if (!/dates\.length\s*===\s*0|!dates\.length|dates\.length\s*<\s*1/.test(prune)) {
    findings.push({ leg: 'e', what: `${PRUNE} does not early-return on an empty date set`, snippet: 'an empty `dates` must be a no-op, never a delete with no date predicate' })
  }
}

// ── LEG (d): the writer calls it ──────────────────────────────────────────────────────────────────────────
const sync = readCode(SYNC)
if (sync === null) {
  findings.push({ leg: 'd', what: `cannot read ${SYNC}`, snippet: 'refusing to pass on a file I could not parse' })
} else {
  if (!/pruneCappedDimensionalRows\s*\(/.test(sync)) {
    findings.push({ leg: 'd', what: `${SYNC} never calls pruneCappedDimensionalRows`, snippet: 'an unwired prune is the defect with extra steps — the 30-day re-pull still leaves old ∪ new' })
  }
  // The dates handed to the prune must be derived from days that produced rows, not from the requested range.
  if (/pruneCappedDimensionalRows\s*\(/.test(sync) && /dates:\s*\[?\s*googleRestateStart/.test(sync)) {
    findings.push({ leg: 'd', what: `${SYNC} hands the prune the REQUESTED range instead of the days that returned rows`, snippet: 'pruning a day the vendor answered with nothing is the false-zero direction DECISIONS:2094 ruled against' })
  }
}

if (findings.length === 0) {
  console.log('google-restate-prune-capped: PASSED — the capped-grain prune exists, pins all five scope predicates, covers only search_term + keyword, is wired into the writer, and no-ops on an empty date set.')
  process.exit(0)
}
console.error(`google-restate-prune-capped: FAILED — ${findings.length} finding(s)\n`)
for (const f of findings) {
  console.error(`  [leg ${f.leg}] ${f.what}`)
  console.error(`      ${f.snippet}\n`)
}
process.exit(1)
