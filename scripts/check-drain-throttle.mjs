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
// ── RE-SPEC 2026-09-14 — LORAMER_CHECKDATA_RESPEC_BATCH_A_V1: THE THROTTLE'S REASON IS NOW THE LANE ─────────────
// The 2026-08-01 contract above read the throttle as a BLEED STOP whose only reason was incomplete geo steps, and it
// went RED the day those steps completed (2026-08-10) and stayed red for five weeks. The design moved underneath it:
// DECISIONS LORAMER_WALK_TAKES_THE_LANE_V1 gives the drain a daily lane of ZERO ops (google-op-budget.ts
// `LANE_ALLOCATIONS.drain: 0 // ZERO BY DECISION`) — cron/drain declines cleanly at the lane, HTTP 200, and the
// walk holds the whole backfill lane. A drain cron at 4×/day over a lane that spends NOTHING is not a throttle
// that has outlived its reason; it is the cron-side expression of a lane that is zero by decision. So:
//   · throttled ∧ lane == 0                       → CONSISTENT (green): the schedule agrees with the lane table.
//   · throttled ∧ lane  > 0 ∧ zero incomplete     → RESTORE (red): the lane grants ops and nothing needs the brake.
//   · throttled ∧ lane  > 0 ∧ incomplete > 0      → justified (green): the original 2026-08-01 reason.
//   · full speed                                  → nothing to assert.
// ⛔ THE LANE IS READ FROM THE CODE, NEVER TYPED HERE: `readDrainLane()` parses `LANE_ALLOCATIONS`'s `drain:` term
// out of src/lib/backfill/google-op-budget.ts (the readPerFireCeiling precedent — an .mjs cannot import a TS
// constant). An identifier there is resolved to its `export const NAME = <number>` in the same file. A parse miss
// is a BROKEN INSTRUMENT (exit 2), never a pass. The day the lane table grants the drain ops again, this leg
// reverts to the 2026-08-01 question on its own — no edit here.
//
// USAGE: node scripts/check-drain-throttle.mjs [--guard] [--inject-complete] [--inject-lane] [--self]
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
// --inject-lane     : mutation proof for the RE-SPEC. Forces the drain lane input to the cap read from the SAME file
//                     (GOOGLE_DAILY_OP_CAP — no number is typed here), so `--inject-complete --inject-lane` is the
//                     exact state that must go RED: lane > 0, nothing incomplete, still throttled.
// --self            : drives the pure core on both branches with no DB and exits — the fixture.
const GUARD = process.argv.includes('--guard')
const INJECT_COMPLETE = process.argv.includes('--inject-complete')
const INJECT_LANE = process.argv.includes('--inject-lane')
const SELF = process.argv.includes('--self')

for (const line of (read('.env.local') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!SELF && !process.env.SUPABASE_DB_URL) {
  console.error('✗ SUPABASE_DB_URL missing (.env.local) — required for the drain-throttle check; refusing to pass quietly.')
  process.exit(2)
}

// ── THE LANE, READ FROM THE CODE ────────────────────────────────────────────────────────────────────────────────
const OP_BUDGET_PATH = 'src/lib/backfill/google-op-budget.ts'
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
/** `export const NAME = <number>` in the op-budget file (underscore separators allowed), or null. */
function readNumericConst(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*([0-9][0-9_]*)`))
  return m ? Number(m[1].replace(/_/g, '')) : null
}
/** LANE_ALLOCATIONS.drain as the code declares it. Returns { drain, cap, source } or throws (broken instrument). */
export function readDrainLane(root = ROOT) {
  const raw = readFileSync(resolve(root, OP_BUDGET_PATH), 'utf8')
  const src = stripComments(raw)
  const block = src.match(/export const LANE_ALLOCATIONS[^{]*\{([\s\S]*?)\n\}/)
  if (!block) throw new Error(`LANE_ALLOCATIONS not found in ${OP_BUDGET_PATH}`)
  const term = block[1].match(/^\s*drain:\s*([A-Za-z0-9_]+)/m)
  if (!term) throw new Error(`LANE_ALLOCATIONS has no drain: term in ${OP_BUDGET_PATH}`)
  let drain
  if (/^[0-9][0-9_]*$/.test(term[1])) drain = Number(term[1].replace(/_/g, ''))
  else {
    drain = readNumericConst(src, term[1])
    if (drain === null) throw new Error(`LANE_ALLOCATIONS.drain = ${term[1]} but no numeric export const ${term[1]} in ${OP_BUDGET_PATH}`)
  }
  const cap = readNumericConst(src, 'GOOGLE_DAILY_OP_CAP')
  if (cap === null || !(cap > 0)) throw new Error(`GOOGLE_DAILY_OP_CAP unreadable in ${OP_BUDGET_PATH}`)
  return { drain, cap, source: `${OP_BUDGET_PATH} LANE_ALLOCATIONS.drain = ${term[1]}` }
}

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
// The decision, extracted so --inject-complete drives the REAL logic rather than a copy of it.
export function decideThrottle({ schedule, incompleteCount, drainLane }) {
  const throttled = schedule !== FULL_SPEED
  const reasonGone = incompleteCount === 0
  const laneZero = drainLane === 0
  const consistent = throttled && laneZero
  const failed = throttled && !laneZero && reasonGone
  let why
  if (!throttled) why = `google drain is at FULL SPEED ("${schedule}") — nothing to assert.`
  else if (laneZero) why = `google drain is THROTTLED to "${schedule}" and LANE_ALLOCATIONS.drain = 0 (zero by decision — the walk holds the lane; cron/drain declines at the lane, HTTP 200). ` +
    `A slow cron over a lane that spends nothing is CONSISTENT with the design, not a throttle that outlived its reason. ${incompleteCount} incomplete step(s) are the lane's to serve when it is granted ops again.`
  else if (reasonGone) why = `google drain is THROTTLED to "${schedule}" while the lane grants it ${drainLane} op(s)/day and ZERO google drain steps are incomplete — the throttle has outlived its reason. RESTORE TO ${FULL_SPEED}.`
  else why = `google drain is THROTTLED to "${schedule}", the lane grants ${drainLane} op(s)/day, and ${incompleteCount} google drain step(s) are still incomplete — throttle still justified.`
  return { throttled, reasonGone, laneZero, consistent, failed, why }
}

// ── THE FIXTURE (--self): both branches of the re-spec, driven through the REAL core, no DB ─────────────────────
if (SELF) {
  let lane
  try { lane = readDrainLane() } catch (e) { console.error(`✗ --self: ${e.message} — BROKEN INSTRUMENT.`); process.exit(2) }
  const T = '20 0,6,12,18 * * *'
  const cases = [
    { name: 'throttled · lane 0 · zero incomplete → CONSISTENT (green)', in: { schedule: T, incompleteCount: 0, drainLane: 0 }, want: { consistent: true, failed: false } },
    { name: 'throttled · lane 0 · steps incomplete → CONSISTENT (green)', in: { schedule: T, incompleteCount: 3, drainLane: 0 }, want: { consistent: true, failed: false } },
    { name: `throttled · lane ${lane.cap} (the cap, read from the file) · zero incomplete → RESTORE (red)`, in: { schedule: T, incompleteCount: 0, drainLane: lane.cap }, want: { consistent: false, failed: true } },
    { name: `throttled · lane ${lane.cap} · steps incomplete → justified (green)`, in: { schedule: T, incompleteCount: 2, drainLane: lane.cap }, want: { consistent: false, failed: false } },
    { name: 'full speed → nothing to assert (green)', in: { schedule: FULL_SPEED, incompleteCount: 0, drainLane: 0 }, want: { consistent: false, failed: false } },
  ]
  let bad = 0
  console.log(`[drain-throttle --self] lane as declared: drain=${lane.drain} cap=${lane.cap} ⇐ ${lane.source}`)
  for (const c of cases) {
    const v = decideThrottle(c.in)
    const ok = v.consistent === c.want.consistent && v.failed === c.want.failed
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}${ok ? '' : ` — got consistent=${v.consistent} failed=${v.failed}`}`)
  }
  console.log(bad ? `✗ drain-throttle --self: ${bad} fixture(s) FAILED` : '✓ drain-throttle --self: 5/5 fixtures hold')
  process.exit(bad ? 1 : 0)
}

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
let lane
try { lane = readDrainLane() } catch (e) {
  console.error(`✗ ${e.message} — BROKEN INSTRUMENT, not a pass.`); process.exit(2)
}
let drainLane = lane.drain
if (INJECT_LANE) {
  drainLane = lane.cap
  console.log(`  [--inject-lane] forced the drain-lane input to ${drainLane} (GOOGLE_DAILY_OP_CAP, read from the same file; no edit) — with --inject-complete this is the state that must go RED.`)
}
const verdict = decideThrottle({ schedule, incompleteCount, drainLane })
console.log(`[drain-throttle] google drain schedule = "${schedule}"  (full speed = "${FULL_SPEED}")`)
console.log(`[drain-throttle] drain lane = ${lane.drain} op(s)/day ⇐ ${lane.source}${INJECT_LANE ? ` (injected → ${drainLane})` : ''}`)
console.log(`[drain-throttle] examined ${conns.length} live google connection(s) against ${googleSteps.length} registry step(s): ${googleSteps.join(', ')}`)
console.log(`[drain-throttle] incomplete google drain steps = ${incompleteCount}`)
for (const p of pending) console.log(`  · ${p.client} — missing: ${p.missing.join(', ')}`)
console.log(`[drain-throttle] ${verdict.why}`)

if (verdict.failed) {
  console.error('✗ THROTTLE HAS OUTLIVED ITS REASON — see LORAMER_GOOGLE_DRAIN_THROTTLE_V1 in this file and QUEUE ★GOOGLE-DRAIN-THROTTLE-RESTORE.')
  process.exit(GUARD ? 1 : 0)
}
console.log(verdict.consistent ? '✓ drain-throttle OK — schedule CONSISTENT with a zero drain lane' : '✓ drain-throttle OK')
process.exit(0)
