#!/usr/bin/env node
// LORAMER_FORWARD_OBSERVATION_LOG_V1 — forward_observation_log IS APPEND-ONLY, ITS OWN STORE, AND NEVER AN ATTEST.
//
// Mirror of universe-attempt-append-only.guard.mjs for the forward lane's observation ledger. Forward's
// per-surface records are OBSERVATIONS (what was asked, what came back), not attests: they live in their own
// table so no walk reader — rotation, windowCoverage/attestedEmptyDays/resolveTerminalLane, the resumer, the
// lane-spend RPC, the walk's check:data legs — can ever see them (the boundary guard holds that half). This
// guard holds the STORE: append-only as a PRIVILEGE (revoked, not promised), no unique arbiter (061's law —
// an ON CONFLICT is the clobber class), observed_at from clock_timestamp() (084's now()-is-transaction-start
// lesson), RLS on, grants locked to service_role, and no mutation of the table anywhere in src/.
//
// LEGS
//  (a) src/: no .update/.upsert/.delete chain against the table   (b) src/: no raw SQL mutation of it
//  (c) the migration never mutates it, carries no ON CONFLICT and creates no UNIQUE INDEX
//  (d) the migration REVOKEs ALL from public/anon/authenticated/service_role, then GRANTs exactly SELECT, INSERT
//      to service_role (+ sequence usage)                        (e) the one module exports the three helpers
//  (f) the migration touches no existing table                   (g) NO-STAGING-DATABASE · REVERT PATH · lock_timeout
//  (h) observed_at defaults to clock_timestamp(), never now()   (i) RLS enabled
//  (j) the two CHECKs are NAMED constraints spelled `ADD CONSTRAINT … = ANY (ARRAY[...])` (db-enum-mirrors-ts reads that form)
//  (k) registered in scripts/run-guards.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const walk = (dir, out = []) => {
  let entries = []
  try { entries = readdirSync(resolve(ROOT, dir)) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e), s = statSync(resolve(ROOT, p))
    if (s.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p)
  }
  return out
}

const TABLE = 'forward_observation_log'
const MIG = 'migrations/087_forward_observation_log.sql'
const HELPERS = 'src/lib/backfill/forward-observation-log.ts'

// (a) + (b) — nothing in src/ mutates the table
for (const f of walk('src')) {
  const src = readFileSync(resolve(ROOT, f), 'utf8')
  if (!src.includes(TABLE)) continue
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|--)/.test(line)) return
    const chain = new RegExp(`from\\(\\s*['"\`]${TABLE}['"\`]\\s*\\)[\\s\\S]{0,400}?\\.(update|upsert|delete)\\s*\\(`)
    const window = lines.slice(i, i + 8).join('\n')
    if (chain.test(window) && new RegExp(`from\\(\\s*['"\`]${TABLE}`).test(line)) {
      findings.push(`(a) ${f}:${i + 1} — .${chain.exec(window)[1]}() against ${TABLE}. THE TABLE IS APPEND-ONLY. A correction is another observation, never a mutation of what was already recorded.`)
    }
    if (new RegExp(`\\b(update|delete\\s+from|truncate)\\b[^\\n;]{0,120}\\b${TABLE}\\b`, 'i').test(line)) {
      findings.push(`(b) ${f}:${i + 1} — raw SQL mutation of ${TABLE}: ${line.trim().slice(0, 120)}`)
    }
  })
}

// (c) … (j) — the migration
const mig = read(MIG)
if (mig) {
  const body = mig.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
  const ddl = body.replace(/do \$\$[\s\S]*?end \$\$;/gi, '').replace(/comment\s+on\s+[\s\S]*?;\s*$/gim, '')
  if (new RegExp(`\\b(update|delete\\s+from|truncate)\\s+(only\\s+)?(public\\.)?${TABLE}\\b`, 'i').test(ddl)) findings.push(`(c) ${MIG} mutates ${TABLE}.`)
  if (/on\s+conflict/i.test(ddl)) findings.push(`(c) ${MIG} contains an ON CONFLICT clause — there is deliberately no unique index over the identity columns; an ON CONFLICT is the clobber class returning.`)
  if (/create\s+unique\s+index/i.test(ddl)) findings.push(`(c) ${MIG} creates a UNIQUE INDEX — 061's law: no ON CONFLICT arbiter over an append-only identity. The PK on id is the only unique index.`)
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    if (!new RegExp(`revoke\\s+all\\s+on\\s+public\\.${TABLE}\\s+from\\s+${role}\\b`, 'i').test(ddl)) findings.push(`(d) ${MIG} does not REVOKE ALL on ${TABLE} from ${role}. Append-only has to be a PRIVILEGE.`)
  }
  if (!new RegExp(`grant\\s+select\\s*,\\s*insert\\s+on\\s+public\\.${TABLE}\\s+to\\s+service_role`, 'i').test(ddl)) findings.push(`(d) ${MIG} does not re-grant exactly SELECT, INSERT to service_role after the revoke.`)
  if (!new RegExp(`grant\\s+usage\\s*,\\s*select\\s+on\\s+sequence\\s+public\\.${TABLE}_id_seq\\s+to\\s+service_role`, 'i').test(ddl)) findings.push(`(d) ${MIG} does not grant usage on the identity sequence to service_role — INSERT would fail on the sequence.`)
  for (const old of ['universe_attempt_log', 'universe_window_log', 'metrics_daily', 'cron_runs', 'sync_state', 'universe_fire_log']) {
    if (new RegExp(`\\b(insert\\s+into|update|delete\\s+from|truncate|alter\\s+table|drop\\s+table)\\s+(only\\s+)?(public\\.)?${old}\\b`, 'i').test(ddl)) findings.push(`(f) ${MIG} writes to or alters ${old}. This migration creates NEW objects and touches nothing that exists — that is what makes it backend-writer rather than live-path.`)
  }
  if (!/no staging database/i.test(mig)) findings.push(`(g) ${MIG} does not state the NO-STAGING-DATABASE condition.`)
  if (!/REVERT PATH/i.test(mig)) findings.push(`(g) ${MIG} states no REVERT PATH.`)
  if (!/lock_timeout/i.test(mig)) findings.push(`(g) ${MIG} sets no lock_timeout.`)
  if (!/observed_at\s+timestamptz\s+not\s+null\s+default\s+clock_timestamp\(\)/i.test(ddl)) findings.push(`(h) ${MIG}: observed_at must default to clock_timestamp() — now() is TRANSACTION START (the 2026-08-04 158-second-job bug, 084's lesson).`)
  if (/observed_at[^\n]*default\s+now\(\)/i.test(ddl)) findings.push(`(h) ${MIG}: observed_at defaults to now().`)
  if (!new RegExp(`alter\\s+table\\s+public\\.${TABLE}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(ddl)) findings.push(`(i) ${MIG} does not enable row level security on ${TABLE}.`)
  for (const c of [`${TABLE}_lane_chk`, `${TABLE}_outcome_chk`]) {
    const m = ddl.match(new RegExp(`ADD\\s+CONSTRAINT\\s+${c}\\b[\\s\\S]{0,200}?ARRAY\\s*\\[`, 'i'))
    if (!m) findings.push(`(j) ${MIG} does not add the NAMED constraint ${c} spelled \`= ANY (ARRAY[...])\` — db-enum-mirrors-ts reads exactly that form (084's lesson: an inline or lowercase check applies in Postgres and is invisible to the mirror).`)
    else if (!/ARRAY\s*\[/.test(m[0])) findings.push(`(j) ${MIG}: ${c} must spell ARRAY in uppercase.`)
  }
}

// (e) the one module's helpers
const help = read(HELPERS)
if (help) {
  for (const fn of ['appendForwardObservation', 'readForwardObservations', 'readForwardObservationSpendToday']) {
    if (!new RegExp(`export async function ${fn}\\b`).test(help)) findings.push(`(e) ${HELPERS} does not export ${fn}.`)
  }
}

// (k) registered
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/forward-observation-append-only.guard.mjs')) findings.push('(k) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length === 0) {
  console.log(`forward-observation-append-only: PASSED — ${TABLE} is append-only by privilege (four revokes, SELECT+INSERT to service_role), has no unique arbiter, stamps observed_at from clock_timestamp(), carries RLS and two NAMED enum checks, the migration touches no existing table, and the one module exports the three helpers.`)
  process.exit(0)
}
console.error(`forward-observation-append-only: FAILED — ${findings.length} finding(s)`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
