#!/usr/bin/env node
// LORAMER_FIRE_CEILING_600_V1 — leg (e): THE RE-ASK LANE AND THE DEFERRALS GET A DURABLE ROW.
//
// ⛔ WHAT THIS COST, measured: rounds 3 to 5 of 2026-09-25 spent four rounds proving why 234 re-ask rows sat
// untouched for 19 hours across 289 wet fires. The answer was unobtainable from any durable row, because every
// re-ask counter lived ONLY in the HTTP response body (`reaskQueued, reaskSelected, reaskDone, reaskErrored,
// reaskSettledByLedger, reaskSkipped`) and `deferredUnits` was a console.warn that Vercel expires in an hour.
// universe_fire_log had no reask column and cron_runs stores no body, so "was a unit planned and then deferred?"
// — the entire question — had no witness. The fix for the defect was one line; finding it was four rounds.
//
// ⛔ THIS IS THE ENFORCER HALF OF THAT LESSON. A lane whose only instrument is a response body is a lane that
// will stall silently again.
//
// LEGS
//  (e1) migration 107 adds the nine columns, nullable and additive
//  (e2) the heartbeat WRITES them — one writer, the same function that writes every other fire fact
//  (e3) the slot outcome is recorded on a refusal too, not only on a grant
//  (e4) universe_fire_slot is NOT a google-delete table: it has no client_id, so the class rule cannot list it
//       and check-google-delete-tables stays green. Asserted rather than assumed.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const MIG = 'migrations/107_universe_fire_slot_and_witness.sql'
const RESUME = 'src/app/api/cron/universe-resume/route.ts'
const TABLES = 'src/lib/google-delete/tables.ts'

const COLUMNS = ['slot_no', 'slot_outcome', 'deferred_units', 'reask_queued', 'reask_selected', 'reask_done', 'reask_errored', 'reask_settled_by_ledger', 'reask_skipped']
const mig = read(MIG)
for (const c of COLUMNS) {
  check(new RegExp(`add column if not exists ${c}\\b`).test(mig),
    `(e1) ${MIG} does not add \`${c}\` to universe_fire_log. Every one of these is a fact a fire already computes and then throws away.`)
}
check(/alter table public\.universe_fire_log/.test(mig) && !/not null/.test(mig.slice(mig.indexOf('alter table public.universe_fire_log'))),
  `(e1) ${MIG}: the new columns must be nullable — NULL means "this exit never reached that stage", the convention migrations/092 set for the missed columns. A NOT NULL default of 0 would make "never ran" indistinguishable from "ran and found none", which is the ADJACENT NUMBER class.`)

// (e2) the heartbeat writes them
const resume = read(RESUME)
const hb = resume.slice(resume.indexOf('const fireHeartbeat'), resume.indexOf('const fireHeartbeat') + 3000)
for (const c of COLUMNS) {
  check(hb.includes(c),
    `(e2) ${RESUME}: fireHeartbeat's insert does not carry \`${c}\`. The heartbeat is the ONE writer of a fire's durable row and runs on every return path; a counter the route computes but the heartbeat omits is a counter that still only exists in the response body.`)
}
// (e3) a refusal is recorded, not only a grant
check(/slot_outcome[\s\S]{0,120}refused|slotOutcome[\s\S]{0,160}'refused'/.test(resume),
  `(e3) ${RESUME}: a slot REFUSAL must write slot_outcome='refused'. A witness that only records successes cannot tell a bounded fleet from a broken one.`)

// (e4) the slot table is outside the google-delete class rule
const tables = read(TABLES)
check(!/universe_fire_slot/.test(tables),
  `(e4) ${TABLES} lists universe_fire_slot. It has no client_id — it is a fleet-wide resource, not one client's data — so deleting it on a per-client wipe would drop the fleet's bound for everyone. It must NOT be in the delete list.`)
check(!/client_id/.test(mig.slice(mig.indexOf('create table if not exists public.universe_fire_slot'), mig.indexOf('alter table public.universe_fire_slot'))),
  `(e4) ${MIG}: universe_fire_slot must not carry a client_id, or check-google-delete-tables' class rule will demand it be deleted per client.`)

if (findings.length) {
  console.error(`✗ fire-log-witness-is-durable FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ fire-log-witness-is-durable OK — the nine witness columns are additive and nullable, the heartbeat writes every one of them on every exit, a slot refusal is recorded as such, and the fleet-wide slot table stays outside the per-client delete list.')
