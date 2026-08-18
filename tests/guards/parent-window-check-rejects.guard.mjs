#!/usr/bin/env node
// LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — THE DATABASE MUST REFUSE A PARENT PAIR IT CANNOT VOUCH FOR.
//
// ⛔ WHY A GUARD THAT WRITES TO THE DATABASE TO PROVE A CONSTRAINT, RATHER THAN READING THE MIGRATION TEXT.
// On 2026-08-17 `AttemptOutcome` gained 'nongrain', `universe_attempt_log_outcome_ck` did not, and
// `npm run build`, 124/124 guards and a full check:data were ALL GREEN while Postgres rejected every write
// with 23514 in production. **NOT ONE OF THEM WROTE SUCH A ROW.** A constraint asserted in a migration file
// is a claim; a constraint that refuses an actual INSERT is a fact. This guard writes the bad rows.
//
// ⛔ AND IT WRITES THEM INSIDE A TRANSACTION THAT IS **ALWAYS ROLLED BACK**. Nothing durable is created. The
// table is append-only by PRIVILEGE (migrations/061 revokes UPDATE/DELETE/TRUNCATE from every application
// role), so a committed test row could not be removed afterwards even by the code that wrote it — which is
// exactly why the rollback is structural here and not merely tidy. It connects as the migration owner via
// SUPABASE_DB_URL, not as service_role.
//
// THE THREE LEGS, one per clause of `universe_attempt_log_parent_ck`, each with the failure it prevents:
//   1. FRANKENSTEIN — parent_window_start set, parent_window_end NULL. `universe_surface_rotation` COALESCEs
//      the two columns INDEPENDENTLY, so a half-set pair returns a window's bottom with a range's top,
//      straight into `deriveAnchorEnd`. Nothing else in the schema forbids it.
//   2. REVERSED — parent_window_end < parent_window_start. The mirror of `universe_attempt_log_range_ck`.
//   3. NOT CONTAINED — a range that lies outside the parent it claims. ⛔ THIS IS THE LEG THAT MATTERS MOST:
//      it turns "the range lies inside the window it was asked under" from a convention five writers each
//      have to remember into a fact Postgres refuses to store otherwise.
// Plus a POSITIVE control: a well-formed row must be ACCEPTED. Without it, a constraint that rejects
// everything would pass all three negative legs and look like protection.
//
// ⛔ RED UNTIL migrations/082 IS APPLIED, AND THAT IS THE POINT — it is the mechanical proof that the apply
// happened and did what it said. It lives in check:data, not `npm run guard`: a red in the BUILD would block
// every unrelated push while the migration is still held.
//
// USAGE: node tests/guards/parent-window-check-rejects.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const TABLE = 'universe_attempt_log'
const CONSTRAINT = 'universe_attempt_log_parent_ck'
const findings = []

// check:data invokes guards as bare `node <path>` with nothing preloaded — same idiom as the sibling --db guards.
try {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* the check below is the real gate */ }
if (!process.env.SUPABASE_DB_URL) {
  console.error(`[parent-window-check-rejects] CANNOT RUN — SUPABASE_DB_URL is missing. REFUSING TO PASS QUIETLY: a skipped catalog check reads exactly like a passing one.`)
  process.exitCode = 2
  process.exit()
}

const pg = (await import('pg')).default
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
const BASE = {
  client_id: '00000000-0000-0000-0000-000000000000',
  vendor: '__guard__', resource: '__guard_parent_ck__', segment: '',
}
// ⛔ EVERY PROBE IS AN INSERT THAT SHOULD BE REFUSED WITH 23514 (check_violation). A probe that succeeds is
// the finding; a probe that fails with a DIFFERENT SQLSTATE is ALSO a finding, because it means the row was
// rejected for a reason that has nothing to do with the constraint under test — which would read as proof.
const PROBES = [
  { name: 'FRANKENSTEIN (parent_start set, parent_end NULL)',
    ws: '2026-03-09', we: '2026-03-09', ps: '2026-03-09', pe: null,
    why: 'the rotation COALESCEs the two columns independently, so a half-set pair yields a window bottom with a range top' },
  { name: 'FRANKENSTEIN (parent_end set, parent_start NULL)',
    ws: '2026-03-09', we: '2026-03-09', ps: null, pe: '2026-04-07',
    why: 'the mirror of the above; parent_known would read false while the end is used' },
  { name: 'REVERSED (parent_end < parent_start)',
    ws: '2026-03-09', we: '2026-03-09', ps: '2026-04-07', pe: '2026-03-09',
    why: 'a reversed pair reaches deriveAnchorEnd and recedes to a start above its own end' },
  { name: 'NOT CONTAINED (range above the parent window)',
    ws: '2026-05-01', we: '2026-05-02', ps: '2026-03-09', pe: '2026-04-07',
    why: 'a range outside the window it claims is the original defect wearing the new columns' },
  { name: 'NOT CONTAINED (range below the parent window)',
    ws: '2026-01-01', we: '2026-01-02', ps: '2026-03-09', pe: '2026-04-07',
    why: 'same class, the other direction' },
]

try {
  await db.connect()
  const has = (await db.query(
    `select count(*)::int n from pg_constraint where conrelid = $1::regclass and conname = $2 and convalidated`,
    [`public.${TABLE}`, CONSTRAINT])).rows[0].n
  if (!has) {
    findings.push(`${CONSTRAINT} does not exist (or is NOT VALIDATED) on public.${TABLE}. migrations/082_universe_parent_window.sql has not been applied, so NOTHING stops a frankenstein or non-contained parent pair from being stored. ⛔ THIS IS THE EXPECTED STATE UNTIL THE APPLY — it is red on purpose, and it is the mechanical proof that the apply happened.`)
  } else {
    await db.query('BEGIN')
    try {
      for (const p of PROBES) {
        let sqlstate = null
        // ⛔ ONE SAVEPOINT PER PROBE, AND IT IS NOT TIDINESS — IT IS THE ONLY WAY THIS GUARD CAN SEE MORE THAN
        // ONE FINDING. Postgres ABORTS the whole transaction on the first constraint violation, so every
        // statement after it returns 25P02 ("current transaction is aborted"). MEASURED on the first live run
        // (2026-08-18, immediately after applying 082): probe 1 got its correct 23514, and the other four
        // probes AND BOTH acceptance controls came back 25P02 — six findings that were all one poisoned
        // transaction wearing six hats. A guard that reports the wrong reason is a broken instrument, and a
        // broken instrument is worse than none because it looks like evidence.
        await db.query('SAVEPOINT probe')
        try {
          await db.query(
            `insert into public.${TABLE}
               (client_id, vendor, resource, segment, window_start, window_end, attempt_no, phase,
                parent_window_start, parent_window_end)
             values ($1,$2,$3,$4,$5,$6,1,'attempt_started',$7,$8)`,
            [BASE.client_id, BASE.vendor, BASE.resource, BASE.segment, p.ws, p.we, p.ps, p.pe])
        } catch (e) { sqlstate = e?.code ?? 'unknown' }
        await db.query('ROLLBACK TO SAVEPOINT probe')
        if (sqlstate === null) {
          findings.push(`${p.name} was ACCEPTED by the database. ${p.why}. The CHECK does not cover this leg.`)
        } else if (sqlstate !== '23514') {
          findings.push(`${p.name} was rejected with SQLSTATE ${sqlstate}, not 23514 (check_violation). It was refused for the WRONG REASON, so this leg proves nothing about ${CONSTRAINT}.`)
        }
      }
      // POSITIVE CONTROL — a well-formed row must be accepted, or the three rejections above are meaningless.
      let okState = null
      await db.query('SAVEPOINT ctl')
      try {
        await db.query(
          `insert into public.${TABLE}
             (client_id, vendor, resource, segment, window_start, window_end, attempt_no, phase,
              parent_window_start, parent_window_end)
           values ($1,$2,$3,$4,'2026-03-24','2026-04-07',1,'attempt_started','2026-03-09','2026-04-07')`,
          [BASE.client_id, BASE.vendor, BASE.resource, BASE.segment])
      } catch (e) { okState = e?.code ?? 'unknown' }
      await db.query('ROLLBACK TO SAVEPOINT ctl')
      if (okState !== null) {
        findings.push(`the POSITIVE CONTROL was REJECTED with SQLSTATE ${okState} — a well-formed row (range 2026-03-24..2026-04-07 inside parent 2026-03-09..2026-04-07, which is the live mis-sized upper half) must be storable. A constraint that refuses everything passes every negative leg and protects nothing.`)
      }
      // …and a legacy row: both parent columns NULL must still be accepted, or 5,967 existing rows and every
      // pre-082 writer would start failing on apply.
      let legacyState = null
      await db.query('SAVEPOINT ctl2')
      try {
        await db.query(
          `insert into public.${TABLE}
             (client_id, vendor, resource, segment, window_start, window_end, attempt_no, phase)
           values ($1,$2,$3,$4,'2026-03-09','2026-04-07',1,'attempt_started')`,
          [BASE.client_id, BASE.vendor, BASE.resource, BASE.segment])
      } catch (e) { legacyState = e?.code ?? 'unknown' }
      await db.query('ROLLBACK TO SAVEPOINT ctl2')
      if (legacyState !== null) {
        findings.push(`a LEGACY row (both parent columns NULL) was REJECTED with SQLSTATE ${legacyState}. Every one of the existing rows and the __account_inception pseudo-row carries NULLs; a constraint that refuses them would have failed the ALTER itself and would break the walk on apply.`)
      }
      console.log(`[parent-window-check-rejects] drove ${PROBES.length} rejection probe(s) + 2 acceptance control(s) against the LIVE constraint, inside a transaction that is always rolled back.`)
    } finally {
      // ⛔ ALWAYS. The table is append-only BY PRIVILEGE — a committed probe row could not be deleted
      // afterwards by anything the application runs.
      await db.query('ROLLBACK')
    }
  }
} catch (e) {
  try { await db.end() } catch { /* the report below is the outcome */ }
  console.error(`[parent-window-check-rejects] CANNOT RUN — ${e.message}. A guard that cannot drive its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}
await db.end()

if (findings.length) {
  console.error(`[parent-window-check-rejects] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ migrations/082_universe_parent_window.sql owns ${CONSTRAINT}. The DATABASE is a reader (LORAMER_SEAMS_PROOF_INCLUDES_THE_DATABASE_V1) — a CHECK is not proven by the migration text that declares it.`)
  process.exitCode = 1
} else {
  console.log(`[parent-window-check-rejects] PASS — the database REFUSES a half-set, a reversed and a non-contained parent pair with 23514, and ACCEPTS both a well-formed pair and a legacy all-NULL row.`)
}
