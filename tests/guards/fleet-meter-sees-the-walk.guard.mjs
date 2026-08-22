#!/usr/bin/env node
// LORAMER_FLEET_METER_SEES_THE_WALK_V1 — GUARD. A FLEET-SPEND READER MAY NOT SUM A LEDGER THE WALK DOES NOT
// WRITE TO.
//
// ⛔ THE DEFECT THIS EXISTS TO CATCH, AND IT RAN BLIND FOR THREE DAYS BEFORE A LIVENESS CHECK TRIPPED OVER IT
// BY ACCIDENT (2026-08-15). `readGoogleSpendToday` sourced its backfill lane from `universe_lane_spend_today`,
// which sums `universe_window_log`. The walk rebuild (migrations/061) moved the walk's billing to
// `universe_attempt_log` and gave the WALK'S OWN meter both aggregates (google-ads.adapter.ts:142,
// LORAMER_V2_METER_CHARGES_THE_PROGRAM_V1) — and left the FLEET reader on the old one. From
// 2026-08-12 18:16:46Z, the last row universe_window_log ever received, the fleet total read the walk's spend
// as ZERO while the walk spent 960 requests/day.
//
// ⛔ WHY NO EXISTING DEFENCE FIRED, WHICH IS THE ONLY PART WORTH REMEMBERING:
//   1. `readLaneSpendToday` THROWS on an unreadable counter, and every comment in google-op-budget.ts is
//      built around that throw. But the ledger was not unreadable — it was EMPTY. `sum()` over zero rows is
//      `0`: finite, non-negative, perfectly plausible. Fail-closed defences do not fire on a clean zero.
//   2. `google-op-budget.guard.mjs` leg (k) DOES compare the backfill lane against a ledger — against
//      universe_window_log, the dead one. It prints "VACUOUS today" and passes. A guard whose witness is the
//      same silent source as the reader it checks cannot see this class at all.
//   3. The file's own comment ASSERTED the invariant ("via the SAME aggregate the walk's own governor reads,
//      so the two cannot drift") — which is why nobody looked. Prose in a file is not a guard (banked law);
//      this time the prose was actively load-bearing misinformation.
// ⇒ THE LESSON THIS GUARD ENCODES: a spend reader must be checked against a WITNESS IT DOES NOT SHARE.
// The static legs below pin the shape; the number is proven by `check-fleet-meter-visibility` in check:data,
// which witnesses the walk through `universe_fire_log` — a table neither aggregate reads.
//
// HERMETIC: filesystem only, no DB, no network — safe inside `npm run guard`, which Vercel runs.
// LORAMER_GUARD_ROOT overrides the tree so it can be proven RED against an earlier checkout.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const check = (ok, msg) => { if (!ok) findings.push(msg) }
// Comments are where the FALSE claim lived, so several legs must read code only.
const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const OPB = 'src/lib/backfill/google-op-budget.ts'
const ADAPTER = 'src/lib/backfill/capture-adapters/google-ads.adapter.ts'
const MIG = 'migrations/061_universe_attempt_log.sql'

const opb = read(OPB)
const adapter = read(ADAPTER)
const mig = read(MIG)
if (!opb || !adapter || !mig) {
  console.error(`[fleet-meter-sees-the-walk] FAIL — cannot read the spend chain (${OPB} / ${ADAPTER} / ${MIG}). A guard that cannot read its subject is not a pass.`)
  process.exit(1)
}

// ── (a) THE FLEET READER READS BOTH LEDGERS ───────────────────────────────────────────────────────────
// Sliced to the function, not the file: an import at the top proves nothing about what the reader calls.
{
  const reader = (opb.match(/export async function readGoogleSpendToday[\s\S]*?\n}\n/) || [''])[0]
  check(reader.length > 0, `(a) readGoogleSpendToday could not be sliced out of ${OPB} — the function was renamed or reshaped, and every leg below is now asserting nothing. Fix the slice before trusting this guard.`)
  check(/readLaneSpendToday\s*\(/.test(reader),
    `(a) readGoogleSpendToday does not call readLaneSpendToday — the v1 walk ledger (universe_window_log) is missing from the fleet total.`)
  check(/readAttemptLaneSpendToday\s*\(/.test(reader),
    `(a) readGoogleSpendToday does not call readAttemptLaneSpendToday — THIS IS THE 2026-08-15 DEFECT EXACTLY. The v2 walk bills into universe_attempt_log; a fleet total without it reads the walk's entire spend as zero the moment the v1 consumer goes quiet, and a sum over zero rows is a clean 0 that no fail-closed check can catch.`)
  // Both terms, ONE window. Two independently-computed midnights measure one fleet over two days.
  check(/readLaneSpendToday\(\s*since\s*\)/.test(reader) && /readAttemptLaneSpendToday\(\s*[A-Za-z_.]+\s*,\s*since\s*\)/.test(reader),
    `(a) the two walk-ledger reads do not both take the cron_runs \`since\`. The fleet total must be assembled over ONE window; independently-computed boundaries make it a sum across two different periods.`)
  // Fail closed: both reads inside the try whose catch returns null → 'unknown' → every lane holds.
  check(!/readAttemptLaneSpendToday\([\s\S]{0,160}?\.catch\(/.test(reader) && !/catch\s*\{\s*return\s*0/.test(reader),
    `(a) a walk-ledger read swallows its own failure and yields a number. It must THROW to readGoogleSpendToday's catch, which returns null → 'unknown' → every lane holds. A broken gauge is not permission.`)
}

// ── (b) THE BACKFILL LANE IS THE SUM, AND NEITHER TERM IS MULTIPLIED ──────────────────────────────────
// ⛔ THE UNIT TRAP IS THE ADVERSARY'S BEST MOVE HERE. The three cron_runs lanes store WORK UNITS and multiply
// by 67. Both walk ledgers store REQUESTS. A ×67 on either term over-states the walk by two orders of
// magnitude and REFUSES EVERY LANE on a ceiling that does not exist — an over-counting governor starves the
// product lanes it was built to protect, which is worse than the blindness it replaces.
{
  const code = codeOnly(opb)
  check(/backfill:\s*backfillRequests/.test(code),
    `(b) the backfill lane is not assigned from the walk-ledger read.`)
  check(/const\s+backfillRequests\s*=\s*[A-Za-z_$][\w$]*\s*\+\s*[A-Za-z_$][\w$]*/.test(code),
    `(b) backfillRequests is not the SUM of two terms. v1 bills into universe_window_log and v2 into universe_attempt_log; reading either alone under-counts the lane by exactly the other's spend.`)
  check(!/backfill:\s*[A-Za-z_.]*\s*\*\s*GAQL_REQUESTS_PER_CONNECTION_DAY/.test(code) &&
        !/backfillRequests\s*=\s*[^\n]*GAQL_REQUESTS_PER_CONNECTION_DAY/.test(code),
    `(b) a walk-ledger term is multiplied by GAQL_REQUESTS_PER_CONNECTION_DAY. Both ledgers are ALREADY in requests — multiplying over-states the walk by 67× and refuses every lane on a fabricated ceiling.`)
}

// ── (c) THE CLASS LEG — NO FLEET-SPEND READER MAY NAME ONE WALK LEDGER AND NOT THE OTHER ──────────────
// ⛔ THIS IS THE LEG THAT MAKES THE FIX OUTLIVE THE FLIGHT. Legs (a)/(b) pin today's expression in today's
// function; this one refuses the SHAPE anywhere it appears. Any module that consults a walk ledger to build a
// FLEET total must consult both — and a new blind reader added next month fails the build rather than being
// found by accident like this one was.
//
// ⛔ THE ALLOWLIST IS NOT AN EXEMPTION MECHANISM, IT IS A CLASSIFICATION. Each entry states WHY that caller is
// lane-local rather than fleet-wide. Adding a file here without that reasoning re-opens the class in one line.
{
  const FLEET_READERS = [OPB, ADAPTER]
  const LANE_LOCAL = new Map([
    // The v1 STARTER feeding the v1 governor its OWN lane's spend. Correct-by-construction for what it
    // publishes (v1 windows bill into v1's ledger); its FLEET term comes from readGoogleSpendToday, which
    // leg (a) now repairs. Banked as ★V1-STARTER-LANE-METER-READS-A-DEAD-LEDGER — a different mechanism,
    // deliberately NOT bundled into this flight.
    ['src/app/api/backfill/universe-start/route.ts', 'v1 lane-local starter, not a fleet total'],
    // The v1 CONSUMER's republish gate, `route.ts:112` — same shape as the starter and FOUND BY THIS LEG
    // rather than by inventory, which is exactly what it is for. `spentRequestsToday: readLaneSpendToday()`
    // is its OWN lane's meter (v1 windows bill into v1's ledger); its `fleet:` term comes from
    // readGoogleSpendToday, which leg (a) repairs. Same bank: ★V1-STARTER-LANE-METER-READS-A-DEAD-LEDGER.
    ['src/app/api/queues/google-ads-universe/route.ts', 'v1 lane-local consumer republish gate, not a fleet total'],
    // The definition site of readLaneSpendToday itself.
    ['src/lib/backfill/universe-window-log.ts', 'the v1 aggregate’s own module'],
  ])
  for (const rel of FLEET_READERS) {
    const src = read(rel)
    if (src === null) { findings.push(`(c) fleet-spend reader ${rel} is unreadable.`); continue }
    const names = /readLaneSpendToday|universe_lane_spend_today|universe_window_log/.test(src)
    const both = /readAttemptLaneSpendToday|universe_attempt_lane_spend_today|universe_attempt_log/.test(src)
    check(!names || both,
      `(c) ${rel} builds a FLEET total from the v1 walk ledger alone. Every fleet-spend reader must consult BOTH universe_window_log and universe_attempt_log — the walk's billing moved between them and the fleet number silently followed the wrong one.`)
  }
  // Discovery: anything ELSE in the tree touching the v1 spend aggregate must be classified, not assumed.
  const SCAN = [
    'src/app/api/backfill/universe-start/route.ts',
    'src/app/api/queues/google-ads-universe/route.ts',
    'src/lib/backfill/universe-v2-worker.ts',
    'src/lib/backfill/universe-governor.ts',
    'src/lib/backfill/universe-resumer.ts',
    'src/lib/backfill/universe-window-log.ts',
  ]
  for (const rel of SCAN) {
    const src = read(rel)
    if (src === null) continue
    if (!/readLaneSpendToday\s*\(|universe_lane_spend_today/.test(codeOnly(src))) continue
    check(LANE_LOCAL.has(rel) || FLEET_READERS.includes(rel),
      `(c) ${rel} calls the v1 spend aggregate and is neither a declared fleet reader nor a classified lane-local caller. Classify it — a spend reader nobody has reasoned about is how this class survives a fix.`)
  }
}

// ── (d) THE DOUBLE-COUNT SEAM — THE ATTEMPT AGGREGATE MUST FILTER ONE PHASE ───────────────────────────
// ⛔ THE ADVERSARY'S STRONGEST ATTACK ON THIS FIX, AND IT IS NOT HYPOTHETICAL: universe_attempt_log records
// the SAME vendor request TWICE — `attempt_started` and `attempt_finished`. MEASURED 2026-08-15: 1,484 rows
// summing to 1,360 requests where the true spend was 680, exactly 2×. A governor that over-counts starves
// the lanes it protects, so this filter is load-bearing, not hygiene.
// ⛔ AND `attempt_started` IS THE CORRECT HALF, NOT AN ARBITRARY PICK: the charge happens BEFORE the call, so
// spend burned by an invocation killed mid-flight is still counted. Summing `attempt_finished` would make a
// poison loop invisible to the governor.
{
  const fn = (mig.match(/create or replace function public\.universe_attempt_lane_spend_today[\s\S]*?\$\$;/i) || [''])[0]
  check(fn.length > 0, `(d) ${MIG} no longer defines universe_attempt_lane_spend_today — the fleet reader's second term would throw on every call.`)
  check(/phase\s*=\s*'attempt_started'/.test(fn),
    `(d) universe_attempt_lane_spend_today does not filter phase = 'attempt_started'. universe_attempt_log logs the SAME request as both attempt_started and attempt_finished, so an unfiltered sum DOUBLE-COUNTS the walk (measured: 1,360 for 680 real requests) and a governor that over-counts refuses the product lanes on spend that never happened.`)
  check(/sum\(requests_spent\)/.test(fn),
    `(d) universe_attempt_lane_spend_today no longer sums requests_spent.`)
}

// ── (e) THE VENDOR SPELLING IS PINNED TO ITS OWNER ────────────────────────────────────────────────────
// ⛔ THE TWO LEDGERS SPELL THE VENDOR DIFFERENTLY — universe_window_log uses 'google_ads', universe_attempt_log
// stores `adapter.platform` = 'google'. Passing the wrong one returns a clean 0: the SAME silent-zero failure
// this whole fix exists to close, re-entering through a typo. The literal cannot be imported (google-ads.adapter
// imports LANE_ALLOCATIONS from google-op-budget — a cycle), so it is COMPARED instead.
{
  const declared = (opb.match(/export const WALK_ATTEMPT_LOG_VENDOR\s*=\s*'([^']+)'/) || [])[1]
  const platform = (adapter.match(/\n\s*platform:\s*'([^']+)'/) || [])[1]
  check(!!declared, `(e) ${OPB} does not export WALK_ATTEMPT_LOG_VENDOR — the attempt-ledger vendor is an unpinned literal, and the wrong spelling reads as zero spend rather than as an error.`)
  check(!!platform, `(e) could not read \`platform:\` from ${ADAPTER} — the owner of the attempt-log vendor value (capture-adapter.ts:192-193) is unreadable, so the pin below cannot be trusted.`)
  check(!declared || !platform || declared === platform,
    `(e) WALK_ATTEMPT_LOG_VENDOR is '${declared}' but the Google adapter's platform is '${platform}'. universe_attempt_log stores adapter.platform, so the fleet reader is querying a vendor that does not exist in the ledger — which returns 0, not an error.`)
}

// ── (f) THE FALSE COMMENT MUST NOT COME BACK ──────────────────────────────────────────────────────────
// ⛔ NOT PEDANTRY. The claim "so the two cannot drift" is the reason three days passed with the fleet blind:
// a reader who checked would have stopped at the comment. The invariant it asserted is now TRUE again — and
// it is true only while both reads are present, which legs (a)-(c) enforce. What is banned is re-asserting it
// on a SINGLE-ledger basis.
{
  const stale = /sourced from `universe_window_log`[^\n]*\n[^\n]*SAME\n?[^\n]*aggregate the walk's own governor reads, so the two cannot drift/s
  check(!stale.test(opb),
    `(f) ${OPB} still carries the FALSE single-ledger drift claim. It asserted an invariant that stopped holding on 2026-08-12 and it is why the blindness went unexamined for three days.`)
  check(/LORAMER_FLEET_METER_SEES_THE_WALK_V1/.test(opb),
    `(f) ${OPB} does not carry the LORAMER_FLEET_METER_SEES_THE_WALK_V1 marker at the change site — the repo's traceability convention, and the only thing pointing a future reader at why the second ledger is here.`)
}

if (findings.length) {
  console.error('\n❌ LORAMER_FLEET_METER_SEES_THE_WALK_V1 FAILED — a fleet-spend reader is blind to a ledger the walk bills into\n')
  findings.forEach((f) => console.error('  • ' + f))
  console.error('\n  The number is proven separately by `check-fleet-meter-visibility` in check:data, which witnesses the walk through universe_fire_log — a table neither spend aggregate reads.\n')
  process.exit(1)
}
console.log('fleet-meter-sees-the-walk.guard: PASS — the fleet reader sums BOTH walk ledgers over one window, neither term is unit-multiplied, the attempt aggregate filters attempt_started (no double count), the vendor literal matches the adapter, and the false drift claim is gone.')
