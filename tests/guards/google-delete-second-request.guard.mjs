#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_SECOND_REQUEST_V1 — A SECOND DELETE REQUEST IS A SECOND REQUEST.
//
// ⛔ THE DEFECT, MEASURED 2026-09-25. Tri-Copy's Google data was deleted 2026-09-21 (code 5ff2f7d8…, status
// complete). The client reconnected Google on 2026-09-23 and captured again. A press on 2026-09-25 returned
// HTTP 200, the 2026-09-21 confirmation code and the 2026-09-21 counts, and DELETED NOTHING — because
// `google_delete_open` matched on client_id alone and stopped at the first row whose status was in
// ('processing','partial','complete'), so `gen_random_uuid()` was unreachable for any client that had ever
// finished one. platform_compliance_log held exactly one row, from 09-21, while live rows sat in the warehouse.
//
// ⛔ WHY THIS IS A POLICY PROBLEM AND NOT ONLY A BUG. Google's API Services User Data Policy:
// "Do not misrepresent what data is collected or what you do with Google user data." Answering a deletion
// request with an older request's receipt while the data is still held is exactly that misrepresentation, and
// the stated consequence is not theoretical: "Google may revoke or suspend your access to Google API Services
// and other Google products and services if you are found in violation of other product policies, terms of
// service, or other guidelines."
//
// ⛔ AND THE DOUBLE-PRESS PROTECTION MUST SURVIVE THE FIX. The reuse set exists because of a real incident
// (2026-09-21, round 6): a phone dropped an 82-second request and re-sent it, two runs overlapped, and the log
// under-recorded 307,153 deleted rows. So `processing` and `partial` KEEP reusing; only `complete` leaves the
// set, and even then a completed row is reused inside a published window so two tabs in one second cannot open
// two jobs. That window is the request-scoped key we have no client to supply — the shape Stripe's idempotency
// keys and draft-ietf-httpapi-idempotency-key-header both assume, where a key outside its published lifetime
// "generates a new request".
//
// LEGS
//  (a) a COMPLETE job outside the window is NOT reused — the reuse set is exactly ('processing','partial')
//  (b) a PROCESSING or PARTIAL job IS still reused — the 307,153-row protection is intact
//  (c) the route never answers a new request with an older request's code
//  (d) the double-press window is a NAMED, published constant, not an implied one
//  (e) two concurrent opens for one client cannot both insert — a lock precedes the read
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const ROUTE = 'src/app/api/clients/google/delete-data/route.ts'

// THE FUNCTION OF RECORD is the newest migration that defines google_delete_open — the same "last definition
// wins" the database applies. Reading migration 100 alone would grade a superseded body.
const mig = readdirSync(resolve(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
const defining = mig.filter((f) => /create or replace function public\.google_delete_open/.test(read(`migrations/${f}`)))
check(defining.length > 0, '(a) no migration defines google_delete_open — the open path has no function of record.')
const latest = defining[defining.length - 1]
const src = latest ? read(`migrations/${latest}`) : ''
const body = src.slice(src.indexOf('create or replace function public.google_delete_open'))
const fn = body.slice(0, body.indexOf('end $$;') + 7)

// (a) complete leaves the reuse set
const reuse = fn.match(/r\.status in \(([^)]*)\)/)
check(!!reuse, `(a) ${latest}: google_delete_open has no \`r.status in (…)\` reuse set this guard can read.`)
if (reuse) {
  const states = [...reuse[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  check(JSON.stringify(states) === JSON.stringify(['partial', 'processing']),
    `(a) ${latest}: the reuse set is (${states.join(', ')}). It must be exactly (processing, partial). With 'complete' in it, a client that has ever finished a deletion can never open another one — gen_random_uuid() is unreachable — and a later erasure request is answered with an older request's receipt while the data is still held.`)
}
// (b) the double-press protection survives
check(/r\.status in \([^)]*'processing'[^)]*\)/.test(fn) && /r\.status in \([^)]*'partial'[^)]*\)/.test(fn),
  `(b) ${latest}: 'processing' and 'partial' must REMAIN in the reuse set. They are the row-as-lock that ended the 2026-09-21 double-press, where two overlapping runs cost the log 307,153 rows.`)
// (d) a named, published window for a completed row
check(/c_double_press_window\s+constant\s+interval/.test(fn),
  `(d) ${latest}: the completed-job reuse window must be a NAMED constant in the function (c_double_press_window), so its length is published rather than implied. Without it, dropping 'complete' lets two tabs in the same second open two jobs.`)
check(/r\.status = 'complete' and r\.updated_at > now\(\) - c_double_press_window/.test(fn),
  `(d) ${latest}: a COMPLETE row must be reused only inside that window — outside it, the press is a new request.`)
// (e) the lock precedes the read
const lockIdx = fn.indexOf('pg_advisory_xact_lock')
const readIdx = fn.indexOf('select * into r')
check(lockIdx > 0 && readIdx > lockIdx,
  `(e) ${latest}: google_delete_open must take pg_advisory_xact_lock on this client BEFORE it reads the newest row. There is no unique index on (platform, kind, client_id) — the only unique indexes are on id and confirmation_code — so without the lock two concurrent presses both read "no reusable row" and both insert, and two deletion jobs run for one client. Transaction-scoped is required, not session-scoped: PostgREST multiplexes its pool, so a session lock is not ours to hold.`)

// (c) the route answers for THIS request
const route = read(ROUTE)
check(/confirmation_code !== openedCode|openedCode !== row\?\.confirmation_code/.test(route),
  `(c) ${ROUTE}: the route must compare the code returned by google_delete_open with the code it reads back from google_delete_status before it answers, and refuse (409) if they differ. Today it throws the opened row away and narrates whatever the status read returns — which is how a 2026-09-21 code reached a 2026-09-25 press.`)
check(!/original confirmation code returned/.test(route),
  `(c) ${ROUTE}: the note "already complete — original confirmation code returned" must go. It is the sentence that made a stale receipt read as intentional; after the fix the only honest meaning is "the same press, twice".`)

if (findings.length) {
  console.error(`✗ google-delete-second-request FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ google-delete-second-request OK — ${latest} reuses only a live job (processing/partial) or a completed one inside its published double-press window, takes the client lock before it reads, and the route answers only for the request it just opened.`)
