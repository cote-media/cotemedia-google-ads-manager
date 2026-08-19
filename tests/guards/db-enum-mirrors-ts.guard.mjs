#!/usr/bin/env node
// LORAMER_DB_ENUM_MIRRORS_TS_V1 — A TS UNION AND THE CHECK CONSTRAINT BEHIND IT MUST NOT DIVERGE.
//
// ⛔ THE INCIDENT THIS EXISTS TO CATCH, AND IT IS TWENTY-ONE MINUTES OLD. On 2026-08-17 the `AttemptOutcome`
// union was widened to admit 'nongrain' and `universe_attempt_log_outcome_ck` was NOT. Postgres rejected every
// nongrain write with 23514, `appendAttemptFinished` threw, and the pass recorded outcome='error' — so the fix
// was INERT and it DEGRADED the record on every pass over the 14 affected surfaces.
// ⛔ **`npm run build`, 124/124 GUARDS AND A FULL check:data WERE ALL GREEN THE WHOLE TIME.** Not one of them
// writes such a row, so not one of them could see it. Only production could, and it took 21 minutes. That is
// LORAMER_SEAMS_PROOF_V1 in one sentence: a value another system already constrains, changed without walking
// that reader.
//
// ⛔ IT READS THE MIGRATIONS, NOT THE DATABASE, AND THAT IS DELIBERATE. This runs inside `npm run build`, which
// also runs on Vercel with no database — so a DB-reading check could not be the build gate, and a build gate is
// exactly what was missing. Reading `migrations/` also catches the OTHER half of the drift: a constraint
// changed by hand in the SQL editor and never committed leaves the tree behind the database, and the applied
// migration is what makes the two agree. (The live-ACL half of that question already has a home in
// check-rpc-grant-posture; this is the schema-value half.)
//
// ⛔ IT FAILS IN BOTH DIRECTIONS. A union value with no constraint value is the incident above. A constraint
// value with no union value is a row shape the code can never produce and no reader is typed for — dead
// vocabulary that the next person will reasonably assume is reachable.
//
// SCOPE, NAMED RATHER THAN IMPLIED: exactly ONE pair today, below. There are 24 value-list CHECK constraints
// in this database and several more are mirrored in TypeScript; widening this guard to all of them is queued
// as ★DB-ENUM-MIRRORS-TS-ONLY-COVERS-ONE-PAIR rather than done silently here, because each pair needs its own
// locator and a wrong locator is worse than no leg.
//
// USAGE: node tests/guards/db-enum-mirrors-ts.guard.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

// ── THE PAIRS. Each names its constraint, its migrations, and how to find the union. ────────────────────
const PAIRS = [
  {
    label: 'universe_attempt_log.outcome ↔ AttemptOutcome',
    constraint: 'universe_attempt_log_outcome_ck',
    tsFile: 'src/lib/backfill/universe-attempt-log.ts',
    tsAnchor: 'export type AttemptOutcome',
  },
  // ⛔ REGISTERED IN THE SAME COMMIT AS THE WIDENING IT COVERS — LORAMER_COMPLETION_SIGNAL_V1, migrations/083.
  // The 2026-08-17 incident was a union widened without its CHECK; this pair is a CHECK widened alongside its
  // union, registered immediately rather than "queued", because ★DB-ENUM-MIRRORS-TS-ONLY-COVERS-ONE-PAIR
  // exists precisely because registration is the step that gets deferred.
  {
    label: 'universe_attempt_log.phase ↔ AttemptPhase',
    constraint: 'universe_attempt_log_phase_ck',
    tsFile: 'src/lib/backfill/universe-attempt-log.ts',
    tsAnchor: 'export type AttemptPhase',
  },
]

// ⛔ THE LAST MIGRATION THAT DEFINES THE CONSTRAINT WINS — migrations are applied in filename order and a
// later one supersedes an earlier one. Taking the FIRST match would pin the constraint to its original shape
// and go red on every legitimate widening, which is a guard that teaches people to delete it.
function constraintValuesFromMigrations(name) {
  const dir = resolve(ROOT, 'migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  let found = null
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8')
    // Strip SQL line comments — a revert block quoted in a comment must not be mistaken for the definition.
    const code = src.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    // ⛔ ANCHOR ON `ADD CONSTRAINT <name>`, NOT ON THE NAME. A widening migration DROPs before it ADDs, so the
    // first occurrence of the name is the DROP and reading forward from it finds the wrong ARRAY (or none).
    // That mistake made the guard's own first run report "no migration ADDs this constraint" for a file that
    // plainly did — caught by red-proofing the guard against the state it was supposed to pass.
    const adds = [...code.matchAll(new RegExp('ADD\\s+CONSTRAINT\\s+' + name + '\\b', 'gi'))]
    if (!adds.length) continue
    const after = code.slice(adds[adds.length - 1].index)
    const m = after.match(/ARRAY\s*\[([^\]]*)\]/)
    if (!m) continue
    found = {
      file: f,
      values: m[1].split(',').map((s) => s.trim().replace(/::text$/, '').replace(/^'|'$/g, '')).filter(Boolean),
    }
  }
  return found
}

function unionValues(src, anchor) {
  const at = src.indexOf(anchor)
  if (at === -1) return null
  // From the anchor to the first line that is not a continuation of the union.
  const tail = src.slice(at)
  const end = tail.search(/\n\s*\n|\n(?:export|interface|function|const|\/\*\*)/)
  const block = end === -1 ? tail : tail.slice(0, end)
  const code = block.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  return [...code.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

for (const pair of PAIRS) {
  const db = constraintValuesFromMigrations(pair.constraint)
  if (!db) {
    findings.push(`${pair.label}: no migration in migrations/ ADDs constraint ${pair.constraint}. Either it was applied by hand and never committed — the database is ahead of the tree, which is the drift this guard exists to close — or the name moved.`)
    continue
  }
  let tsSrc
  try { tsSrc = read(pair.tsFile) } catch (e) { findings.push(`${pair.label}: ${pair.tsFile} unreadable — ${e?.message}`); continue }
  const ts = unionValues(tsSrc, pair.tsAnchor)
  if (!ts || ts.length === 0) {
    findings.push(`${pair.label}: could not read the union at "${pair.tsAnchor}" in ${pair.tsFile}. A locator that finds nothing is not a pass.`)
    continue
  }
  const inTsOnly = ts.filter((v) => !db.values.includes(v))
  const inDbOnly = db.values.filter((v) => !ts.includes(v))
  if (inTsOnly.length) {
    findings.push(
      `${pair.label}: ${inTsOnly.map((v) => `'${v}'`).join(', ')} ${inTsOnly.length === 1 ? 'is' : 'are'} in the TypeScript union and NOT in ${pair.constraint} (last defined in migrations/${db.file}). ` +
      `⛔ THIS IS THE 2026-08-17 INCIDENT EXACTLY: Postgres rejects the write with 23514, the append throws, and the caller records a DIFFERENT outcome — the change is inert AND it degrades the record. Write the migration in the SAME commit as the union.`)
  }
  if (inDbOnly.length) {
    findings.push(
      `${pair.label}: ${inDbOnly.map((v) => `'${v}'`).join(', ')} ${inDbOnly.length === 1 ? 'is' : 'are'} legal in ${pair.constraint} (migrations/${db.file}) and absent from the TypeScript union. ` +
      `That is dead vocabulary: a row shape the code can never produce and no reader is typed for, which the next person will reasonably assume is reachable. Remove it from the constraint or add it to the union.`)
  }
  if (!inTsOnly.length && !inDbOnly.length) {
    console.log(`[db-enum-mirrors-ts] ${pair.label}: ${ts.length} value(s) agree — ${ts.map((v) => `'${v}'`).join(', ')} (constraint from migrations/${db.file}).`)
  }
}

if (findings.length) {
  console.error(`[db-enum-mirrors-ts] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exitCode = 1
} else {
  console.log(`[db-enum-mirrors-ts] PASS — ${PAIRS.length} pair(s) agree. ⛔ SCOPE: this covers the pairs listed in PAIRS and nothing else; the other value-list CHECK constraints are queued, not covered.`)
}
