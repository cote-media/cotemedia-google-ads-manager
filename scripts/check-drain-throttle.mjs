#!/usr/bin/env node
// LORAMER_GOOGLE_DRAIN_THROTTLE_V1 — DOES THE THROTTLE STILL HAVE A REASON?
//
// ── THE REMOVAL CONDITION, VERBATIM. THIS IS THE COMMENT THAT COULD NOT LIVE IN vercel.json ──────────────────────
// ⛔ vercel.json IS STRICT JSON AND CANNOT CARRY A COMMENT. The instruction was to annotate the cron entry inline;
// JSON has no comment syntax and Vercel parses the file strictly, so an inline note would have broken the deploy on
// a commit whose entire purpose is to stop a bleed. The text therefore lives HERE, in the thing that ENFORCES it —
// which is where RULE-HOME LAW says it belongs anyway: a rule that lives where it is read cannot bind; a rule that
// lives where it EXECUTES can. Prose in a doc is not a guard. This file is the guard.
//
//   THROTTLED 2026-08-01 — 288 fires/day, all 800s timeouts, zero rows. Only incomplete google
//   steps are google_geo + google_user_geo on Foam OH, Inside, Veterinary mastermind, all failing
//   on the chunked-upsert statement timeout. RESTORE TO */5 WHEN ★GOOGLE-GEO-STATEMENT-TIMEOUTS
//   IS FIXED — this schedule is a bleed stop, not a capacity decision.
//
// ── WHAT WAS MEASURED, 2026-08-01 ───────────────────────────────────────────────────────────────────────────────
// `/api/cron/drain?platform=google` ran `*/5 * * * *` = 288 fires/day. Sampled 14:31Z-17:00Z: 31 consecutive fires,
// EVERY ONE a 504 "Vercel Runtime Timeout Error: Task timed out after 800 seconds". cron_runs agreed — 107 rows for
// the day, 97 with no finished_at, and the 10 that did finish reported connections_succeeded=0 and rows_written=0.
// 288 x 800s = 230,400 function-seconds/day = 64 function-hours, buying nothing. The six geo cursors had not moved
// in 29-34 days. Every OTHER google drain step is complete on every one of the 18 google connections, so the */5
// cadence existed solely to service two steps that cannot currently succeed.
//
// ── THE ASSERTION, AND WHY IT IS SHAPED THIS WAY ────────────────────────────────────────────────────────────────
//   FAIL if the google drain schedule is NOT `*/5 * * * *` AND ZERO google drain steps are incomplete.
// i.e. the moment the throttle outlives its reason, this goes red. It does NOT assert the throttle is present, and
// it does NOT assert the geo defect is fixed — either of those would fire on the wrong day. It asserts exactly one
// thing: we are not still throttled after the work that justified throttling has finished. A throttle that quietly
// becomes permanent is the failure mode this exists to prevent, and silence is how that happens.
//
// ⛔ THE REQUIRED-STEP SET IS DERIVED FROM DRAIN_REGISTRY, NEVER HARDCODED. FIX-WITH-GUARD says guard the CLASS, not
// today's instance: a hardcoded ten-step list would still read green after an eleventh google step was added and
// left incomplete. The set is parsed out of src/lib/backfill/drain-registry.ts, so a new step is covered the day it
// lands. If the parse finds nothing, that is a BROKEN INSTRUMENT and exits 2 — never a pass.
//
// ── WIRING: check:data, NEVER the build path ────────────────────────────────────────────────────────────────────
// Runs ONLY via `npm run check:data`. ⛔ NEVER add it to `npm run guard` / `npm run build`: guard is hermetic and
// sits in the Vercel deploy chain, and this reads the live DB. That code-gate / data-gate split is settled and is
// not re-derived here — same posture and same reason as check-frozen-cursors.mjs, which this file mirrors.
//
// ── HONEST LIMIT — READ BEFORE TRUSTING A GREEN ─────────────────────────────────────────────────────────────────
// A green here means "the throttle still has a reason", NOT "the throttle is working" and NOT "the geo lap is fine".
// It cannot see whether the 4x/day cadence is the right number, and it cannot see rows. It answers one question.
//
// USAGE: node scripts/check-drain-throttle.mjs [--guard] [--inject-complete]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }

export const FULL_SPEED = '*/5 * * * *'
const GOOGLE_DRAIN_PATH = '/api/cron/drain?platform=google'

// --guard           : blocking mode — exit 1 when the throttle has outlived its reason.
// --inject-complete : mutation proof. Forces the incomplete-step count to ZERO in the check's INPUT (in memory, no
//                     DB write), which is the exact state that must go RED while throttled. Same house pattern as
//                     check-frozen-cursors.mjs --inject-frozen: prove the assertion fires without faking the world.
const GUARD = process.argv.includes('--guard')
const INJECT_COMPLETE = process.argv.includes('--inject-complete')

for (const line of (read('.env.local') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('✗ SUPABASE_DB_URL missing (.env.local) — required for the drain-throttle check; refusing to pass quietly.')
  process.exit(2)
}

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
// The decision, extracted so --inject-complete drives the REAL logic rather than a copy of it.
export function decideThrottle({ schedule, incompleteCount }) {
  const throttled = schedule !== FULL_SPEED
  const reasonGone = incompleteCount === 0
  return {
    throttled,
    reasonGone,
    failed: throttled && reasonGone,
    why: throttled
      ? (reasonGone
        ? `google drain is THROTTLED to "${schedule}" but ZERO google drain steps are incomplete — the throttle has outlived its reason. RESTORE TO ${FULL_SPEED}.`
        : `google drain is THROTTLED to "${schedule}" and ${incompleteCount} google drain step(s) are still incomplete — throttle still justified.`)
      : `google drain is at FULL SPEED ("${schedule}") — nothing to assert.`,
  }
}

// ── SCHEDULE, FROM vercel.json ──────────────────────────────────────────────────────────────────────────────────
const vercelRaw = read('vercel.json')
if (!vercelRaw) { console.error('✗ vercel.json unreadable — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }
let crons
try { crons = JSON.parse(vercelRaw).crons } catch (e) {
  console.error(`✗ vercel.json is not valid JSON (${e.message}) — BROKEN INSTRUMENT, not a pass.`); process.exit(2)
}
const entry = (crons || []).find((c) => c.path === GOOGLE_DRAIN_PATH)
if (!entry) {
  console.error(`✗ no cron entry for "${GOOGLE_DRAIN_PATH}" in vercel.json — BROKEN INSTRUMENT, not a pass.`); process.exit(2)
}
const schedule = String(entry.schedule || '')

// ── REQUIRED GOOGLE STEPS, DERIVED FROM THE REGISTRY SOURCE ─────────────────────────────────────────────────────
const registrySrc = read('src/lib/backfill/drain-registry.ts')
if (!registrySrc) { console.error('✗ drain-registry.ts unreadable — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }
const registryBody = registrySrc.slice(registrySrc.indexOf('export const DRAIN_REGISTRY'))
const googleSteps = []
for (const block of registryBody.split(/\n {2}\{\n/).slice(1)) {
  const k = block.match(/key:\s*'([^']+)'/)
  const p = block.match(/platforms:\s*\[([^\]]*)\]/)
  if (k && p && /'google'/.test(p[1])) googleSteps.push(k[1])
}
if (googleSteps.length === 0) {
  console.error('✗ parsed ZERO google steps out of DRAIN_REGISTRY — BROKEN INSTRUMENT, not a pass.'); process.exit(2)
}

// ── LIVE READ ───────────────────────────────────────────────────────────────────────────────────────────────────
// platform_connections is small (tens of rows) — one bounded query, nothing near the live statement_timeout.
const CONN_SQL = `
  select c.name                              as client,
         pc.onboard_steps_done               as done
    from platform_connections pc
    join clients c on c.id = pc.client_id and c.deleted_at is null
   where pc.platform = 'google'
     and pc.account_id is not null`

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const conns = (await client.query(CONN_SQL)).rows
await client.end()

const pending = []
for (const row of conns) {
  const done = Array.isArray(row.done) ? row.done : []
  const missing = googleSteps.filter((s) => !done.includes(s))
  if (missing.length) pending.push({ client: row.client, missing })
}
let incompleteCount = pending.reduce((n, p) => n + p.missing.length, 0)

if (INJECT_COMPLETE) {
  // Clear the LIST as well as the count. A report that prints "incomplete = 0" above a list of incomplete steps
  // contradicts itself, and a self-contradicting proof is not a proof.
  incompleteCount = 0
  pending.length = 0
  console.log('  [--inject-complete] forced the incomplete-step input to EMPTY (no DB write) — this is the state that must go RED while throttled.')
}

// ── REPORT — ALWAYS WITH ITS DENOMINATOR (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1) ──────────────────────────────
const verdict = decideThrottle({ schedule, incompleteCount })
console.log(`[drain-throttle] google drain schedule = "${schedule}"  (full speed = "${FULL_SPEED}")`)
console.log(`[drain-throttle] examined ${conns.length} live google connection(s) against ${googleSteps.length} registry step(s): ${googleSteps.join(', ')}`)
console.log(`[drain-throttle] incomplete google drain steps = ${incompleteCount}`)
for (const p of pending) console.log(`  · ${p.client} — missing: ${p.missing.join(', ')}`)
console.log(`[drain-throttle] ${verdict.why}`)

if (verdict.failed) {
  console.error('✗ THROTTLE HAS OUTLIVED ITS REASON — see LORAMER_GOOGLE_DRAIN_THROTTLE_V1 in this file and QUEUE ★GOOGLE-DRAIN-THROTTLE-RESTORE.')
  process.exit(GUARD ? 1 : 0)
}
console.log('✓ drain-throttle OK')
process.exit(0)
