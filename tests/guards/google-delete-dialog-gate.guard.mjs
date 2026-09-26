#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_DIALOG_GATE_V1 — A FINISHED DELETION IS HISTORY ON THE PAGE, NEVER A GATE ON THE FORM.
//
// ⛔ THE DEFECT, MEASURED 2026-09-25 23:58Z, AND IT MADE A SHIPPED SERVER FIX UNREACHABLE. Round 347 removed
// 'complete' from the DATABASE's reuse set so a reconnected client's later erasure request opens a new job with
// a new code. The screen still had the same status in its own gate: the dialog hid the name box and the red
// button whenever `gdelJob.status` was 'processing' OR 'partial' OR 'complete', and `gdelJob` is loaded on page
// open by the GET and never cleared. Tri-Copy's 2026-09-21 finished job therefore replaced the confirm form,
// `deleteGoogleData()` could not fire, and NO POST EVER LEFT THE BROWSER — proven by platform_compliance_log
// still holding exactly one row, from 09-21, after the press.
//
// ⛔ WHY IT MATTERS BEYOND THE BUG. This route deletes Google user data, so Google's API Services User Data
// Policy governs it: "Do not misrepresent what data is collected or what you do with Google user data", with
// the stated consequence that "Google may revoke or suspend your access to Google API Services and other Google
// products and services if you are found in violation of other product policies, terms of service, or other
// guidelines." A screen that shows a four-day-old receipt in answer to a fresh deletion request is that
// misrepresentation, whatever the server would have done.
//
// ⛔ AND A RECEIPT WITHOUT A DATE CANNOT BE TOLD FROM AN OLDER ONE. Once a client can have several deletions,
// "Google data deleted." with no timestamp is the same sentence for today's job and for one from last month.
//
// LEGS
//  (a) the dialog's FORM gate hides the form for 'processing' or 'partial' only — never for 'complete'
//  (b) the dialog's PROGRESS block shows for 'processing' or 'partial' only
//  (c) the PAGE receipt names its date, and the dialog carries no completed copy at all (it is unreachable)
//  (d) the open handler does not depend on clearing the job — the form shows because of the gate, not because
//      something reset state on the way in
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const PAGE = 'src/components/redesign/ClientPage.tsx'
const src = read(PAGE)

// The two render conditions, found by the testids they guard rather than by line number.
const formGate = src.match(/\{!\(gdelJob && \(([^)]*)\)\) && \(<>/)
const progGate = src.match(/\{gdelJob && \(([^)]*)\) && \(<div data-testid="delete-google-result">/)

const statesIn = (m) => m ? [...m[1].matchAll(/gdelJob\.status === '([a-z_]+)'/g)].map((x) => x[1]).sort() : null
const LIVE_ONLY = JSON.stringify(['partial', 'processing'])

check(!!formGate, `(a) ${PAGE}: could not find the dialog's form gate \`{!(gdelJob && (…)) && (<>\`. If it moved, re-point this guard rather than deleting it — the form must stay reachable.`)
if (formGate) {
  const s = statesIn(formGate)
  check(JSON.stringify(s) === LIVE_ONLY,
    `(a) ${PAGE}: the form gate hides the confirm form for (${s.join(', ')}). It must hide it for processing and partial ONLY. With 'complete' in it, any client that has ever deleted can never reach the name box again — the button opens a dialog with no way to confirm, and the server's new-request path (migration 108) is unreachable from the product.`)
}
check(!!progGate, `(b) ${PAGE}: could not find the dialog's progress block gate on data-testid="delete-google-result".`)
if (progGate) {
  const s = statesIn(progGate)
  check(JSON.stringify(s) === LIVE_ONLY,
    `(b) ${PAGE}: the progress block shows for (${s.join(', ')}). It must show for processing and partial ONLY — a finished job belongs on the page as history, not inside the dialog where it stands in for the form.`)
}

// (c) the dated receipt lives on the page
const pageReceipt = src.match(/Google data deleted\{[^}]*completed_at[^}]*\}/)
check(!!pageReceipt,
  `(c) ${PAGE}: the PAGE receipt must render the completion date beside "Google data deleted" (it reads gdelJob.completed_at today — keep it).`)
// ⛔ AND THE DIALOG MUST CARRY NO COMPLETED COPY AT ALL. Once the progress block is narrowed to
// processing|partial, a `status === 'complete'` branch inside it is unreachable — TypeScript says so
// ("types '\"processing\" | \"partial\"' and '\"complete\"' have no overlap"). A dead branch there is how an
// undated receipt would creep back into the one place it must never appear: standing in for the form.
const progBlock = progGate ? src.slice(src.indexOf(progGate[0]), src.indexOf(progGate[0]) + 2000) : ''
check(!/gdelJob\.status === 'complete'/.test(progBlock),
  `(c) ${PAGE}: the dialog's progress block still branches on 'complete'. With the gate narrowed to processing|partial that branch is unreachable, and an unreachable receipt inside the dialog is exactly the shape that hid the form. The dated receipt belongs on the PAGE.`)

// (d) the form's reachability must not depend on resetting state
const opener = src.match(/data-testid="delete-google-data" onClick=\{\(\) => \{([^}]*)\}\}/)
check(!!opener, `(d) ${PAGE}: could not find the "Delete Google data" button's open handler.`)
if (opener) {
  check(!/setGdelJob\(null\)/.test(opener[1]),
    `(d) ${PAGE}: the open handler clears gdelJob. That would hide the finished receipt from the page and make the form's reachability depend on a state reset instead of the gate — and the page receipt is the history a deletion record should leave behind. Fix the gate, not the state.`)
}

if (findings.length) {
  console.error(`✗ google-delete-dialog-gate FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ google-delete-dialog-gate OK — the confirm form is hidden only while a deletion is actually running, the progress block shows only then, the dated receipt lives on the page while the dialog carries no completed copy, and the form is reachable by the gate rather than by clearing state.')
