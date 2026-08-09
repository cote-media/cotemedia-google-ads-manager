#!/usr/bin/env node
// LORAMER_UNIVERSE_ATTEMPT_LOG_V1 — APPEND-ONLY, MECHANICALLY.
//
// ⛔ THIS IS THE SINGLE MOST IMPORTANT GUARD IN THE REBUILD, and the reason is one sentence: the ENTIRE
// teardown exists because `universe_window_log` mutates one row per window, and every write destroys the
// state the previous write recorded. That one property produced three 300-second poison loops, a clobbered
// `abandoned_owed` record, a 15× overspend and a false coverage claim. If a single UPDATE ever lands on the
// replacement, the rebuild has bought nothing.
//
// ⛔ THE HONEST STATEMENT OF WHAT EACH MECHANISM CAN DO, so nobody mistakes the guard for the enforcer:
//   · migrations/061 REVOKES update/delete/truncate from every application role. THAT is the enforcer —
//     Postgres refuses at runtime and cannot be talked out of it.
//   · THIS GUARD catches the same mistake AT BUILD TIME, in the diff, before it ever reaches the database,
//     and it names the class rather than the instance.
// Neither replaces the other. A revoked privilege fails loudly in production; a guard fails cheaply in CI.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const WANT_DB = process.argv.includes('--db')
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const walk = (dir, out = []) => {
  for (const e of readdirSync(resolve(ROOT, dir))) {
    const p = join(dir, e), s = statSync(resolve(ROOT, p))
    if (s.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p)
  }
  return out
}

const TABLE = 'universe_attempt_log'
const MIG = 'migrations/061_universe_attempt_log.sql'
const HELPERS = 'src/lib/backfill/universe-attempt-log.ts'

// ── (a) NO MUTATION OF THE TABLE ANYWHERE IN src/ ─────────────────────────────────────────────────────
// Two shapes, because there are two ways to reach the table: the PostgREST client chain, and raw SQL in a
// template literal. Both are checked; neither is assumed absent.
const files = walk('src')
for (const f of files) {
  const src = readFileSync(resolve(ROOT, f), 'utf8')
  if (!src.includes(TABLE)) continue
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|--)/.test(line)) return                       // a comment ABOUT the rule is not a violation
    // PostgREST chain: .from('universe_attempt_log') ... .update( / .upsert( / .delete(
    const chain = new RegExp(`from\\(\\s*['"\`]${TABLE}['"\`]\\s*\\)[\\s\\S]{0,400}?\\.(update|upsert|delete)\\s*\\(`)
    const window = lines.slice(i, i + 8).join('\n')
    if (chain.test(window) && new RegExp(`from\\(\\s*['"\`]${TABLE}`).test(line)) {
      const verb = chain.exec(window)[1]
      findings.push(`(a) ${f}:${i + 1} — .${verb}() against ${TABLE}. THE TABLE IS APPEND-ONLY. A correction is another append, never a mutation of what was already recorded. (migrations/061 also revokes this at the database, so this would fail in production too.)`)
    }
    // raw SQL in a template literal or string
    if (new RegExp(`\\b(update|delete\\s+from|truncate)\\b[^\\n;]{0,120}\\b${TABLE}\\b`, 'i').test(line)) {
      findings.push(`(b) ${f}:${i + 1} — raw SQL mutation of ${TABLE}: ${line.trim().slice(0, 120)}`)
    }
  })
}

// ── (c) THE MIGRATION ITSELF MAY NOT MUTATE THE TABLE, AND MAY NOT CREATE A SECOND UNIQUE INDEX ───────
const mig = read(MIG)
if (mig) {
  const body = mig.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
  // ⛔ STRIP WHAT IS NOT EXECUTABLE DDL BEFORE CHECKING IT, or the guard fires on its own evidence:
  //   · the DO $$ … $$ assertion block states the forbidden words inside its error strings and regexes;
  //   · `comment on … is '…'` bodies DESCRIBE the property ("no ON CONFLICT can arbitrate an overwrite")
  //     and that description is the documentation working, not a violation.
  // Caught by seeing this guard go red on its own migration — a check that reads prose as code is a broken
  // instrument, and a broken instrument is worse than no instrument because it looks like evidence.
  const ddl = body
    .replace(/do \$\$[\s\S]*?end \$\$;/gi, '')
    .replace(/comment\s+on\s+[\s\S]*?;\s*$/gim, '')
  if (new RegExp(`\\b(update|delete\\s+from|truncate)\\s+(only\\s+)?(public\\.)?${TABLE}\\b`, 'i').test(ddl)) {
    findings.push(`(c) ${MIG} mutates ${TABLE}. The migration creates the table; it must never write over it.`)
  }
  if (/on\s+conflict/i.test(ddl)) {
    findings.push(`(c) ${MIG} contains an ON CONFLICT clause. There is deliberately no unique index over the identity columns — an ON CONFLICT here is either dead code or the clobber class returning.`)
  }
  if (/create\s+unique\s+index/i.test(ddl)) {
    findings.push(`(c) ${MIG} creates a UNIQUE INDEX. THAT IS THE DEFECT THAT STARTED THE TEARDOWN — migrations/054's unique(client, vendor, resource, segment, window_start) let a re-walk UPSERT INTO row 2871 itself and destroy an abandoned_owed record. Identity must have NO arbiter.`)
  }
  // ── (d) THE REVOKE IS THE ENFORCER AND MUST BE PRESENT ───────────────────────────────────────────────
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    if (!new RegExp(`revoke\\s+all\\s+on\\s+public\\.${TABLE}\\s+from\\s+${role}\\b`, 'i').test(ddl)) {
      findings.push(`(d) ${MIG} does not REVOKE ALL on ${TABLE} from ${role}. Append-only has to be a PRIVILEGE — a guard can be deleted, a revoked grant cannot be argued with.`)
    }
  }
  if (!new RegExp(`grant\\s+select\\s*,\\s*insert\\s+on\\s+public\\.${TABLE}\\s+to\\s+service_role`, 'i').test(ddl)) {
    findings.push(`(d) ${MIG} does not re-grant exactly SELECT, INSERT to service_role after the revoke. Too little and the walk cannot write; too much and append-only is a suggestion.`)
  }
  // ── (f) RUSS'S CONDITION: THIS STEP TOUCHES NEITHER OLD TABLE ───────────────────────────────────────
  // The old tables hold the only record of the walk's history and the negative-coverage subset. They are
  // read at seed time and NEVER written. `metrics_daily` must not appear at all — not one captured row is
  // in scope for this migration.
  for (const old of ['universe_window_log', 'universe_run_state', 'universe_run_notice', 'metrics_daily']) {
    const re = new RegExp(`\\b(insert\\s+into|update|delete\\s+from|truncate|alter\\s+table|drop\\s+table)\\s+(only\\s+)?(public\\.)?${old}\\b`, 'i')
    if (re.test(ddl)) {
      findings.push(`(f) ${MIG} writes to or alters ${old}. STEP 5 CREATES A NEW TABLE AND TOUCHES NOTHING ELSE. The old tables stay in place, read-only and historical; rollback is "stop publishing to the new consumer", which only holds if there is no data motion to undo.`)
    }
  }
  if (!/no staging database/i.test(mig)) {
    findings.push(`(g) ${MIG} does not state the NO-STAGING-DATABASE condition. An RPC can only be proven where it is applied; a migration that does not say so invites the reader to assume it was rehearsed.`)
  }
  if (!/REVERT PATH/i.test(mig)) findings.push(`(g) ${MIG} states no REVERT PATH.`)
  if (!/lock_timeout/i.test(mig)) findings.push(`(g) ${MIG} sets no lock_timeout.`)
}

// ── (e) THE HELPERS APPEND, AND RETURN NOTHING THAT COULD BE MISTAKEN FOR COVERAGE ────────────────────
const help = read(HELPERS)
if (help) {
  for (const fn of ['appendAttemptStarted', 'appendDayCommitted', 'appendAttemptFinished']) {
    if (!new RegExp(`export async function ${fn}\\b`).test(help)) {
      findings.push(`(e) ${HELPERS} does not export ${fn}. The three phases are the contract: started BEFORE the vendor call, day_committed after each durable day, finished after.`)
    }
  }
  // ⛔ plan §3: the attempt-log module must export nothing whose NAME could be read as a coverage answer.
  // Naming discipline is not enough on its own, but a name like `isCovered` in this module is how the
  // separation gets breached in one careless import.
  for (const m of help.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) {
    if (/(covered|coverage|owed|complete|gaps?)/i.test(m[1])) {
      findings.push(`(e) ${HELPERS} exports '${m[1]}'. THE ATTEMPT LOG IS A SPEND AND FAILURE RECORD, NEVER A COVERAGE SOURCE (plan §3). Coverage is derived from metrics_daily; a coverage-shaped name here is how that separation gets breached by one careless import.`)
    }
  }
}

// ── DB LEGS — the catalog is the authority, not this file's opinion of it ─────────────────────────────
if (WANT_DB) {
  // `check:data` invokes the guards as bare `node <path>` with no env preloaded, so each --db guard loads
  // .env.local itself. Same idiom as universe-failure-is-durable.guard.mjs:228 and google-op-budget:363 —
  // found by this leg reporting "SUPABASE_DB_URL is missing" inside a check:data run where the guard beside
  // it read the database fine.
  try {
    for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* absent .env.local is caught by the SUPABASE_DB_URL check immediately below */ }
  if (!process.env.SUPABASE_DB_URL) {
    findings.push(`--db requested but SUPABASE_DB_URL is missing. REFUSING TO PASS QUIETLY: a skipped catalog check reads exactly like a passing one.`)
  } else {
    const pg = (await import('pg')).default
    const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
    await db.connect()
    const q = async (s, p = []) => (await db.query(s, p)).rows
    const exists = (await q(`select count(*)::int n from pg_class where relname=$1 and relnamespace='public'::regnamespace`, [TABLE]))[0].n
    if (!exists) {
      findings.push(`(h) ${TABLE} does not exist in the database. migrations/061 has not been applied.`)
    } else {
      const uq = await q(`select c.relname, array_agg(a.attname::text order by a.attnum) cols
                          from pg_index i join pg_class c on c.oid=i.indexrelid
                          join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
                          where i.indrelid=$1::regclass and i.indisunique group by c.relname`, [`public.${TABLE}`])
      // node-pg hands back `name[]` unparsed unless it is cast to text[]; normalise either shape so a
      // formatting difference can never be mistaken for a second unique index.
      const cols = (Array.isArray(uq[0]?.cols) ? uq[0].cols.join(',') : String(uq[0]?.cols ?? '')).replace(/[{}"]/g, '')
      if (uq.length !== 1 || cols !== 'id') {
        findings.push(`(h) unique indexes on ${TABLE} are ${JSON.stringify(uq)} — expected exactly one, the PK on (id). ANY OTHER UNIQUE INDEX IS AN ON CONFLICT ARBITER and reintroduces the clobber that destroyed row 2871.`)
      }
      const grants = await q(`select grantee, privilege_type from information_schema.role_table_grants
                              where table_schema='public' and table_name=$1
                                and privilege_type in ('UPDATE','DELETE','TRUNCATE')
                                and grantee in ('anon','authenticated','service_role','PUBLIC')`, [TABLE])
      if (grants.length) {
        findings.push(`(h) mutation grants survive on ${TABLE}: ${JSON.stringify(grants)}. Append-only must be enforced by the database, not only by this guard.`)
      }
      const fns = await q(`select proname from pg_proc where pronamespace='public'::regnamespace
                           and proname in ('universe_attempt_open','universe_attempt_lane_spend_today')`)
      if (fns.length !== 2) findings.push(`(h) expected both helper functions in the catalog, found ${JSON.stringify(fns.map((r) => r.proname))}.`)
      const wl = (await q(`select count(*)::int n from public.universe_window_log`))[0].n
      if (wl < 17892) findings.push(`(h) universe_window_log holds ${wl} rows, was 17,892. The old log must be untouched by this step.`)
    }
    await db.end()
  }
}

if (findings.length) {
  console.error(`[universe-attempt-append-only] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-attempt-append-only] PASS — no mutation of ${TABLE} in src/ or in its migration, identity carries no unique arbiter, UPDATE/DELETE/TRUNCATE are revoked from every application role, the three append helpers exist and export no coverage-shaped name, and this step writes to neither old table${WANT_DB ? ' (catalog verified live)' : ' (static only — pass --db to verify the catalog)'}.`)
