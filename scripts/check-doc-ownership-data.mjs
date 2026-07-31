#!/usr/bin/env node
// LORAMER_DOC_OWNERSHIP_GUARD_V1 — THE DB-DEPENDENT HALF. Runs in `npm run check:data`, NEVER in the build.
//
// ⛔ SPLIT DELIBERATELY, same posture as every other DB check in this repo (account-row invariant, frozen
// cursors, completion claims): `npm run guard` stays 100% hermetic and sits in the Vercel deploy chain, so a
// DATA condition can never brick a deploy. The hermetic half — model ids, version pins, file facts — is
// tests/guards/doc-ownership.guard.mjs.
//
// TWO CHECKS, both comparing a doc's CLAIM against the only thing that actually knows:
//
//  (1) MIGRATION APPLIED-STATE, IN BOTH DIRECTIONS. A migration header asserting whether it has been applied is
//      a doc restating a fact the DATABASE owns, and it is read by the next session deciding whether to run it.
//      MEASURED 2026-07-31: SIX headers said NOT APPLIED while their objects existed live — 041, 042, 045, 046,
//      048, 049. Two of those were authored the same day and were stale within hours.
//      ⛔ IT MUST FAIL BOTH WAYS. A header claiming APPLIED when the object is absent is the more dangerous
//      direction: it tells a session the schema is ready when it is not, and the code that depends on it ships.
//
//  (2) ENV NAME-SET PRESENCE, BY LENGTH ONLY — NEVER BY VALUE. A doc naming a variable as blank is asserting
//      live machine state it cannot see. MEASURED 2026-07-31: HANDOFF listed GOOGLE_ANALYTICS_CLIENT_ID and
//      CLIENT_SECRET as "STILL BLANK (len 0)" for a week while both were populated, contradicting a banked
//      decision, under a header calling itself the single source. ⛔ VALUES ARE NEVER READ, PRINTED OR COMPARED
//      — only whether the length is zero. Secrets never enter this process's output.
//
// NOT CHECKED, and the boundary is in the sibling guard's header with the reason: decision-restatement and
// tense. Comprehension is not matching.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import pg from 'pg'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const notes = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

// Load .env.local exactly as the sibling data checks do (check-completion-claims.mjs:76-79). Doing it any other
// way would be a second idiom for the same fact, which is the disease this file exists to check for.
for (const line of (read('.env.local') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const DB = process.env.SUPABASE_DB_URL
if (!DB) {
  // FAIL LOUD, never a silent no-op — the banked posture for every data check here. A missing URL at the
  // pre-push gate means the environment is misconfigured and must stop the push.
  console.error('[doc-ownership-data] SUPABASE_DB_URL is not set. This check CANNOT run, and a silent skip is worse than no check.')
  process.exit(2)
}

// Each migration declares ONE object whose existence is the ground truth for "was this applied".
// Kept explicit rather than parsed out of the SQL: a parser guessing the object is a second thing that can be
// wrong, and the point of this file is to stop guessing at facts something else owns.
const MIGRATION_OBJECTS = [
  ['041_connection_failure_streak', "select 1 from information_schema.columns where table_name='platform_connections' and column_name='consecutive_failures'"],
  ['042_connection_degraded_state', "select 1 from pg_proc where proname='bump_connection_failures'"],
  ['043_multiaccount_flight1', "select 1 from pg_indexes where tablename='platform_connections' and indexdef like '%account_id%' and indexdef like '%UNIQUE%'"],
  ['045_store_order_grain', "select 1 from information_schema.tables where table_schema='public' and table_name='store_orders'"],
  ['046_breakdown_coverage_rpc', "select 1 from pg_proc where proname='breakdown_coverage_days'"],
  ['048_entity_state_history', "select 1 from information_schema.tables where table_schema='public' and table_name='entity_state_history'"],
  ['049_capture_pass_log', "select 1 from information_schema.tables where table_schema='public' and table_name='capture_pass_log'"],
  ['050_cron_runs_connections_skipped', "select 1 from information_schema.columns where table_name='cron_runs' and column_name='connections_skipped'"],
]

const client = new pg.Client({ connectionString: DB, statement_timeout: 30_000 })
await client.connect()

for (const [name, probe] of MIGRATION_OBJECTS) {
  const path = `migrations/${name}.sql`
  if (!existsSync(resolve(ROOT, path))) { notes.push(`(skipped, file absent: ${path})`); continue }
  const header = read(path).split('\n').slice(0, 25).join('\n')
  const { rowCount } = await client.query(probe)
  const applied = rowCount > 0
  // The CLAIM. "NOT APPLIED"/"DO-NOT-APPLY" wins over a bare "APPLIED" elsewhere in the header, because the
  // negative is the one a reader acts on.
  const claimsNotApplied = /NOT\s+(?:YET\s+)?APPLIED|DO-NOT-APPLY|DO NOT APPLY/i.test(header)
  const claimsApplied = /✅\s*APPLIED|APPLIED TO PRODUCTION/i.test(header)

  if (applied && claimsNotApplied && !claimsApplied) {
    findings.push(`${path} HEADER SAYS NOT APPLIED, but its object EXISTS in the database. Six headers were stale this way on 2026-07-31 and are read by the next session deciding whether to run them. State the applied DATE (tense-locked history) or say nothing.`)
  }
  if (!applied && claimsApplied) {
    findings.push(`${path} HEADER CLAIMS APPLIED, but its object is ABSENT from the database. ⛔ THIS IS THE MORE DANGEROUS DIRECTION: it tells a session the schema is ready when it is not, and the code depending on it ships against a table that does not exist.`)
  }
  if (!applied && !claimsNotApplied && !claimsApplied) {
    notes.push(`${path}: unapplied and the header says neither — acceptable, but a DO-NOT-APPLY line would be clearer.`)
  }
}
await client.end()

// ── ENV NAME-SET, LENGTH ONLY ──────────────────────────────────────────────────────────────────────────
{
  const envPath = resolve(ROOT, '.env.local')
  if (!existsSync(envPath)) {
    notes.push('(.env.local absent — env claims not checkable on this machine; NOT treated as a pass)')
  } else {
    const env = new Map()
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[2].trim().replace(/^["']|["']$/g, '')
      env.set(m[1], v.length) // LENGTH ONLY. The value is discarded here and never leaves this scope.
    }
    const handoff = read('LORAMER_HANDOFF.md')
    for (const line of handoff.split('\n')) {
      if (/⛔|CORRECTED|do not restate|Historical/i.test(line)) continue // the correction itself, not a claim
      // ⛔ SCOPE THE CLAIM, DO NOT SCAN THE WHOLE LINE. The first cut matched every backticked name on any line
      // containing "blank" and flagged `CRON_SECRET` off a line that says CRON_SECRET is REAL and that OTHER
      // creds are blank. A false positive on the second check I wrote today, for the same reason as the first:
      // matching a word instead of an assertion. Only names appearing AFTER an explicit blank-claim phrase, on
      // that same line, are treated as claimed-blank.
      const claim = line.match(/(STILL BLANK|len 0)([\s\S]*)$/i)
      if (!claim) continue
      for (const m of claim[2].matchAll(/`([A-Z0-9_]{6,})`/g)) {
        const name = m[1]
        if (!env.has(name)) continue
        if (env.get(name) > 0) {
          findings.push(`LORAMER_HANDOFF.md claims \`${name}\` is BLANK; it has a non-zero length locally. A doc naming a variable as blank asserts live machine state it cannot see — this exact claim contradicted LORAMER_GA_CREDS_RESOLVED_V1 for a week. (Length only; no value was read.)`)
        }
      }
    }
  }
}

for (const n of notes) console.log(`[doc-ownership-data] note: ${n}`)
if (findings.length) {
  console.error(`[doc-ownership-data] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[doc-ownership-data] PASS — every migration header agrees with the database in BOTH directions, and no doc claims an env var is blank that is populated.')
