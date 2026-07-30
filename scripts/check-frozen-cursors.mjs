#!/usr/bin/env node
// LORAMER_FROZEN_CURSOR_DETECTOR_V1 — has any backfill cursor STOPPED ADVANCING?
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────────────────
// THE RATCHET, banked twice in one day from two unrelated root causes: every family that rides `rangeLap` walks
// BACKWARD from a cursor and advances it only on success. One failing day therefore does not cost one day — the
// cursor never moves, the same window is retried on every drain fire, and EVERY OLDER DAY BEHIND IT IS SEALED OFF.
// The loss is never proportional to the defect.
//   · 2026-07-29, Google geo: a 15,587-row single upsert hit the live 8s statement_timeout → three golden clients
//     lost geo history for ~4 weeks (and Foam OH is ~975 days x 2 families behind the ~37-month wall).
//   · 2026-07-29, Meta product_id: Postgres REJECTED a multi-row ON CONFLICT holding a duplicate key → The
//     Escential Group's cursor sat at 2026-05-06 since 2026-07-22, sealing seven CONTIGUOUS days.
// BOTH WERE FOUND BY ACCIDENT, chasing something else. Nothing in this repo asked the one cheap question that would
// have caught either: "is any cursor not moving?" This script asks it.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
// For every sync_state row where  platform is not a pseudo-row  AND  backfill_complete = false  AND  the client is
// not soft-deleted  AND  a platform_connection EXISTS for that family's platform  →  FAIL if the cursor has not been
// updated in >= 7 days.
//
// ── THE THRESHOLD IS 7 DAYS, AND HERE IS WHY IT IS NOT A ROUND NUMBER ───────────────────────────────────────────
// The drain fires 4x/day, so a HEALTHY cursor moves within hours — never days. 7 days is therefore ~28 consecutive
// missed opportunities, which no transient condition explains. It also sits comfortably past the longest transient
// pause this project has actually observed: the Google developer-scope quota block, ~21 hours (sync_state's
// __google_quota sentinel arms a window of that order). A TIGHTER threshold would fire on an ordinary quota-blocked
// day and teach the reader to ignore the check, which is strictly worse than not having one. A LOOSER threshold buys
// nothing — after a week the diagnosis window has already closed (see the honest limit below).
//
// ⛔ QUOTA STATE IS DELIBERATELY NOT CONSULTED. The sentinel could be read here and used to excuse Google freezes,
// and that would be a mistake: 7 days is already ~8x the longest observed block, so at this threshold "quota" is
// never the explanation — it is only ever an excuse. Consulting it would let a 31-day freeze hide behind a 21-hour
// pause.
//
// ── THE HONEST LIMIT — READ THIS BEFORE TRUSTING A GREEN RESULT ─────────────────────────────────────────────────
// THIS DETECTS THAT A CURSOR STOPPED. IT CANNOT SAY WHY. It cannot distinguish frozen-by-failure from
// reached-a-floor-the-code-failed-to-mark-complete: both look identical in sync_state, because the only recorded
// facts are a date and a timestamp. CAUSE requires the Vercel error clusters — and those EXPIRE AT 7 DAYS while a
// frozen cursor persists indefinitely. Veterinary mastermind is the proof: frozen 29 days, ZERO surviving clusters,
// and the loss is real (geo_city/campaign 2026-03-15 = 0 rows). Read the other way, the clusters could not have
// found it either — by the time it mattered, the evidence was gone.
// THE TWO INSTRUMENTS ARE COMPLEMENTARY AND NEITHER IS SUFFICIENT: clusters give cause but forget after a week; this
// gives persistence but never cause. A green run here means "everything is moving", NOT "everything is complete" and
// NOT "nothing is failing" — a cursor that advances one day per lap while failing nine looks perfectly healthy to
// this check.
//
// ── WIRING: check:data, NEVER the build path ────────────────────────────────────────────────────────────────────
// Runs ONLY via `npm run check:data`. ⛔ NEVER add it to `npm run guard` / `npm run build`: guard is 100% hermetic and
// sits in the Vercel deploy chain (vercel.json has no buildCommand → Vercel runs `npm run build`), and this is a
// live-DB check that would couple deploys to data state. That code-gate / data-gate split is already settled and is
// NOT re-derived here — DECISIONS LORAMER_ACCOUNT_ROW_INVARIANT_V1 (the account-row invariant, same posture, same
// reason) and QUEUE ★SCHEDULED-DATA-CHECK / ★DECLARED-VS-LANDED-CHECK (which own the open question of where a
// scheduled data check's findings durably land). Same posture as check-capture-landing.mjs, which this file mirrors.
//
// ⚠ check:data IS CHAINED WITHOUT `&&`, ON PURPOSE. package.json runs the two data checks as
//   `node A; A=$?; node B; B=$?; exit $(( A > B ? A : B ))` — BOTH always run, and the worst exit code wins (so a
//   config error's exit 2 is not flattened to a guard failure's 1). An `&&` chain would mean an account-row failure
//   silently prevents this check from running at all, and you would read "one failure" as "one problem". That is
//   exactly the short-circuit defect found in `npm run guard` today, which is why scripts/run-guards.mjs exists
//   (LORAMER_GUARD_RUNALL_V1) — the same mistake is not being re-introduced two scripts later.
//
// USAGE: node scripts/check-frozen-cursors.mjs [--guard] [--inject-frozen] [--inject-stale-baseline]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
import { KNOWN_FROZEN_CURSORS, EXCLUDED_FIXTURE_CLIENTS } from './frozen-cursors.baseline.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }

export const FROZEN_DAYS = 7

// --guard                  : blocking mode — exit 1 on any NEW frozen cursor or any STALE baseline entry.
// --inject-frozen          : Gate-A (b). Inject a synthetic frozen cursor that is NOT baselined into the check's
//                            INPUT (in memory, no DB write) and confirm --guard fails naming it. Same house pattern
//                            as check-capture-landing.mjs --prove-exact.
// --inject-stale-baseline  : Gate-A (d). Inject a synthetic baseline entry for a cursor that is NOT frozen and
//                            confirm --guard fails on the stale entry. Proves the anti-rot property without editing
//                            (and therefore without needing to restore) the baseline file.
const GUARD = process.argv.includes('--guard')
const INJECT_FROZEN = process.argv.includes('--inject-frozen')
const INJECT_STALE = process.argv.includes('--inject-stale-baseline')

for (const line of (read('.env.local') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.SUPABASE_DB_URL) {
  // FAIL LOUD, NEVER SKIP — identical reasoning to check-capture-landing.mjs: this runs ONLY at the pre-push data
  // gate, so a missing DB URL means the pre-push environment is misconfigured, and that must STOP the push rather
  // than pass quietly. A silent no-op here is worse than no check at all.
  console.error('✗ SUPABASE_DB_URL missing (.env.local) — required for the frozen-cursor check; refusing to pass quietly.')
  process.exit(2)
}

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
// Both --inject-* proofs drive THIS function with real-shaped inputs, so a real catch is proven with zero DB writes
// and zero edits to the baseline. Keeping the classification pure is what makes that possible.
//
// THREE OUTCOMES, and the ORPHANED/FROZEN split is the load-bearing one:
//   hasConn === false  → ORPHANED. The family's platform has NO connection row, so the drain cannot even SELECT it.
//                        This is debris from a removed connection, and the fix is DELETING the cursor row — not a
//                        re-drain. Reported, NEVER failed: nothing is being lost, and failing here would block
//                        pushes on a condition only a DB write can clear.
//   days >= threshold  → FROZEN. Split into baselined (known) vs NEW (fails).
//   otherwise          → moving. Not reported.
export function classifyCursors(cursors, baseline, thresholdDays = FROZEN_DAYS) {
  const orphaned = cursors.filter((c) => !c.hasConn)
  const frozen = cursors.filter((c) => c.hasConn && c.days >= thresholdDays)
  const isKnown = (c) => baseline.some((b) => b.clientId === c.clientId && b.platform === c.platform)
  const known = frozen.filter(isKnown)
  const novel = frozen.filter((c) => !isKnown(c))
  // ANTI-ROT: a baseline entry whose (clientId, platform) is not in the CURRENT frozen set has outlived its
  // justification — either the cursor was fixed, or it left scope. Either way the entry must be deleted, and until
  // it is, the guard FAILS. Deliberately stricter than the account-row baseline's stale-warns posture, because a
  // frozen cursor is a growing loss whereas a missing account row is a fixed historical hole.
  const stale = baseline.filter((b) => !frozen.some((c) => c.clientId === b.clientId && c.platform === b.platform))
  return { orphaned, frozen, known, novel, stale }
}

// ── LIVE READ ───────────────────────────────────────────────────────────────────────────────────────────────────
// sync_state / clients / platform_connections are all small (hundreds of rows), so this is one bounded query — no
// unbounded metrics_daily scan, nothing that can approach the 8s live statement_timeout.
//
// DAY ARITHMETIC IS PINNED TO UTC ON BOTH SIDES. `updated_at` is timestamptz and `::date` would otherwise resolve in
// whatever timezone the pg session happens to carry, which would make the day count depend on where the check ran.
// FAMILY → PLATFORM is split_part(platform,'_',1): google_geo→google, ga_dimensional→ga, woocommerce_money→
// woocommerce, and a bare 'google' maps to itself. Verified against the live distinct sets — every sync_state family
// prefix resolves to one of the five platform_connections platforms (ga, google, meta, shopify, woocommerce).
// PSEUDO-ROWS are excluded with left(platform,2) <> '__' rather than a LIKE pattern: '__%' needs backslash escaping
// that JS string literals silently eat, and an unescaped '__%' matches ANY two-or-more-character platform — it would
// mute the entire table. left() cannot be got wrong.
const CURSOR_SQL = `
  select s.client_id::text                                             as "clientId",
         c.name                                                        as client,
         s.platform,
         split_part(s.platform, '_', 1)                                as base,
         s.backfill_earliest_date::text                                as "cursorAt",
         s.backfill_blocked                                            as blocked,
         s.backfill_block_reason                                       as "blockReason",
         (now() at time zone 'UTC')::date - (s.updated_at at time zone 'UTC')::date as days,
         (s.updated_at at time zone 'UTC')::date::text                 as "updatedAt",
         exists (select 1 from platform_connections p
                  where p.client_id = s.client_id
                    and p.platform = split_part(s.platform, '_', 1))   as "hasConn",
         (select string_agg(distinct p.health, '/') from platform_connections p
           where p.client_id = s.client_id
             and p.platform = split_part(s.platform, '_', 1))          as health
    from sync_state s
    join clients c on c.id = s.client_id and c.deleted_at is null
   where left(s.platform, 2) <> '__'
     and s.backfill_complete = false
   order by days desc, c.name, s.platform`

const pool = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await pool.connect()
const q = async (sql, params) => (await pool.query(sql, params)).rows

const EXCLUDED_IDS = new Set(EXCLUDED_FIXTURE_CLIENTS.map((f) => f.clientId))
const allIncomplete = await q(CURSOR_SQL)
const cursors = allIncomplete.filter((c) => !EXCLUDED_IDS.has(c.clientId))
const excludedHits = allIncomplete.filter((c) => EXCLUDED_IDS.has(c.clientId))

// SYNTHETIC INPUT (Gate-A b) — in memory only, nothing written. A fabricated client id that cannot collide with a
// real one, so it can never be accidentally baselined.
if (INJECT_FROZEN) {
  cursors.push({
    clientId: '00000000-dead-beef-0000-000000000001', client: 'SYNTHETIC Gate-A client', platform: 'shopify_money',
    base: 'shopify', cursorAt: '2025-01-01', blocked: false, blockReason: null, days: 41,
    updatedAt: '2026-06-18', hasConn: true, health: 'healthy',
  })
  console.log('  [--inject-frozen] injected ONE synthetic non-baselined frozen cursor (41 days) into the input. No DB write.')
}

const baseline = INJECT_STALE
  ? [...KNOWN_FROZEN_CURSORS, {
      clientId: 'f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2', client: 'Veterinary mastermind (SYNTHETIC)',
      platform: 'google_device', cursorAt: '2020-01-01', daysWhenBaselined: 99,
      note: 'SYNTHETIC stale entry — google_device is NOT frozen for this client',
    }]
  : KNOWN_FROZEN_CURSORS
if (INJECT_STALE) console.log('  [--inject-stale-baseline] appended ONE synthetic baseline entry for a cursor that is NOT frozen. Baseline FILE untouched.')

const { orphaned, frozen, known, novel, stale } = classifyCursors(cursors, baseline)

// ORPHANED: prove "debris" rather than assume it. Bounded existence probe on (client_id, platform) — rides
// idx_metrics_daily_client_platform_date, so it is an index seek, not a count over 34M rows.
for (const o of orphaned) {
  const [row] = await q('select exists (select 1 from metrics_daily where client_id = $1 and platform = $2) as any_rows',
    [o.clientId, o.base])
  o.anyRows = row.any_rows
}
await pool.end()

// ── REPORT ──────────────────────────────────────────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s ?? '').padEnd(n)
const label = (c) => `${c.client} (${String(c.clientId).slice(0, 8)})`

console.log('LORAMER_FROZEN_CURSOR_DETECTOR_V1 (live DB, read-only)')
console.log(`  rule       : incomplete cursor + connection exists + not advanced in >= ${FROZEN_DAYS} days = FROZEN`)
console.log(`  in scope   : ${cursors.length} incomplete real cursors across ${new Set(cursors.map((c) => c.clientId)).size} clients`)
console.log(`  excluded   : ${EXCLUDED_FIXTURE_CLIENTS.length} non-production fixture client(s) — ${excludedHits.length} incomplete cursor(s) skipped`)
for (const f of EXCLUDED_FIXTURE_CLIENTS) {
  const n = excludedHits.filter((c) => c.clientId === f.clientId).length
  console.log(`               ${pad(`${f.name} (${f.clientId.slice(0, 8)})`, 38)} ${n} cursor(s) — ${f.why.slice(0, 96)}`)
}

console.log(`\nFROZEN — ${frozen.length} (known ${known.length} · NEW ${novel.length}):`)
if (!frozen.length) console.log('  (none — every in-scope cursor advanced within the threshold)')
for (const c of frozen) {
  const b = baseline.find((x) => x.clientId === c.clientId && x.platform === c.platform)
  const marks = []
  if (b && b.cursorAt !== c.cursorAt) marks.push(`⚠ MOVED (baselined at ${b.cursorAt})`)
  if (b && c.days > b.daysWhenBaselined) marks.push(`⚠ WORSE (+${c.days - b.daysWhenBaselined}d since baselined)`)
  if (c.blocked) marks.push(`⚠ backfill_blocked: ${c.blockReason || 'no reason recorded'}`)
  if (c.health && c.health !== 'healthy') marks.push(`⚠ connection health=${c.health} — a human re-auth may be the actual fix`)
  console.log(`  ${b ? 'known' : ' NEW '}  ${pad(label(c), 40)} ${pad(c.platform, 26)} cursor=${c.cursorAt}  stalled ${String(c.days).padStart(3)}d (last moved ${c.updatedAt})`)
  for (const m of marks) console.log(`         ${m}`)
}

console.log(`\nORPHANED — ${orphaned.length} (reported, never failed; the fix is DELETING the cursor row, not a re-drain):`)
if (!orphaned.length) console.log('  (none)')
for (const o of orphaned) {
  console.log(`  ${pad(label(o), 40)} ${pad(o.platform, 26)} cursor=${o.cursorAt}  stalled ${String(o.days).padStart(3)}d  no '${o.base}' connection row`)
  console.log(`         metrics_daily rows for ${o.base}: ${o.anyRows ? 'SOME EXIST — investigate before deleting, this may be a removed connection with real history' : 'NONE EVER — pure debris'}`)
}

let exitCode = 0
if (GUARD) {
  console.log('\nGUARD — baseline classification:')
  console.log(`  frozen ${frozen.length} · baselined ${known.length} · NEW ${novel.length} · stale-baseline ${stale.length}`)
  if (novel.length) {
    console.error(`\n✗ FROZEN-CURSOR GUARD FAILED — ${novel.length} cursor(s) frozen >= ${FROZEN_DAYS} days and NOT baselined:`)
    for (const c of novel)
      console.error(`     ${label(c)} ${c.platform} cursor=${c.cursorAt} stalled ${c.days}d (last moved ${c.updatedAt})${c.health && c.health !== 'healthy' ? ` health=${c.health}` : ''}`)
    console.error('  A cursor that stops does not lose one day — rangeLap seals EVERY older day behind it, so the loss')
    console.error('  grows one day per day and converts to permanent at the vendor retention wall.')
    console.error('  FIX the cause, or (deliberately) add an entry to scripts/frozen-cursors.baseline.mjs with its reason.')
    exitCode = 1
  }
  if (stale.length) {
    console.error(`\n✗ FROZEN-CURSOR GUARD FAILED — ${stale.length} STALE baseline entr(ies) no longer match a frozen cursor:`)
    for (const b of stale)
      console.error(`     ${b.client} (${b.clientId.slice(0, 8)}) ${b.platform} — baselined at ${b.cursorAt}, ${b.daysWhenBaselined}d`)
    console.error('  This is the ANTI-ROT rule: the cursor is moving again (or left scope), so the entry has outlived its')
    console.error('  justification. DELETE it from scripts/frozen-cursors.baseline.mjs — a baseline that survives its own')
    console.error('  reason is how "known issue" becomes "nobody looks any more".')
    exitCode = 1
  }
  if (!exitCode) console.log(`  ✓ FROZEN-CURSOR GUARD PASSED — every frozen cursor is baselined, and every baseline entry still matches a real freeze.`)
}
process.exit(exitCode)
