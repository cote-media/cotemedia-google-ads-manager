#!/usr/bin/env node
// LORAMER_COMPLETION_CLAIM_GATE_V1 — THE ONE COMPARISON: a completion claim against the rows it claims to cover.
//
// ═══ WHY THIS EXISTS: FOUR INSTANCES OF ONE MISSING INVARIANT ════════════════════════════════════════════════════
// Nothing in this repo ever compared a completion CLAIM to the DATA it asserts coverage of, and the same class has
// now been found four times:
//   (1) 2026-07-15 — sealed Meta breadth cursors reading 13/13 over a permanent hole.
//   (2) 2026-07-30 — ga_dimensional's `done` expression measured WALK DISTANCE, not writes (fixed 94a627d).
//   (3) 2026-07-30 — ga_dimensional line 220 sealed on ZERO work (fixed LORAMER_GA_DIM_ZERO_WORK_RESTART_V1).
//   (4) run-backfill.ts:~268 — `backfill_complete: windowStart <= targetDate`, the SHARED engine for google, meta,
//       shopify, woocommerce and the GA account cursor. UNTOUCHED. This gate is what looks at it.
// Four occurrences of one shape is not a series of bugs, it is a missing invariant. A completion flag is a claim the
// code makes about ITSELF; this is the only thing that checks the claim against a row.
//
// ═══ THE ASSERTION ══════════════════════════════════════════════════════════════════════════════════════════════
// For every sync_state cursor with backfill_complete = true, mapped to the metrics_daily signature it claims:
//   FALSE_COMPLETE_EMPTY — complete=true but ZERO persisted rows matching the signature, on a platform that HAS
//                          delivered. (reconcile.ts already words this verdict exactly; see the reuse note below.)
//   CLAIM_EXCEEDS_ROWS   — complete=true and rows exist, but their min(date) is LATER than the claim. The cursor
//                          says it covered ground the rows do not occupy. This is the half nothing checked.
//
// ═══ WHAT WAS REUSED, AND WHAT WAS DELIBERATELY NOT ═════════════════════════════════════════════════════════════
// REUSED: src/lib/completeness/required-steps.ts — REQUIRED_STEPS (28 steps × 5 platforms) is the step → sync_state
// cursor key → metrics_daily RealSpec mapping, verified from code by its own author, and `realPresent()` is the
// predicate. Re-deriving that mapping here would have been a second copy of the one fact this gate depends on.
// NOT REUSED: src/lib/completeness/reconcile.ts, and the reason is not laziness —
//   · it compares PRESENCE (a boolean via realPresent), never min(date) against the claimed floor, so the primary
//     assertion above is simply absent from it;
//   · its two live callers are src/lib/next/coverage.ts and the client-profile page, which RENDER user-facing
//     readiness, and coverage.ts calls it with account-grain presence only. Widening it means changing a live read
//     path to serve a gate;
//   · it needs floors + connections + cursors + realAgg + delivery, and the floor-of-record machinery is
//     coverage-rendering scope this comparison does not need.
// So: the mapping is reused, the comparison is standalone. reconcile.ts remains the right owner of the RENDERED
// verdict; this file is the GATE.
//
// ═══ ⚠ THE HONEST LIMIT, AND HOW IT IS HANDLED ══════════════════════════════════════════════════════════════════
// THIS COMPARES A CLAIM TO PERSISTED ROWS. IT CANNOT TELL "the vendor served nothing" FROM "we never asked."
// A genuinely TRUE-ZERO family — a dormant ad account, a store with no orders, a property with no ecommerce —
// looks identical to a false complete. Two mechanical handles, and one thing that stays unhandleable:
//   HANDLED 1 — ACTIVITY DENOMINATOR (the idea from the 2026-07-30 fleet measurement, applied here): a platform
//     that has NEVER delivered cannot have breakdown rows, so complete=true with zero rows is HONEST_EMPTY, not a
//     violation. Activity = any account-grain row with spend>0, impressions>0, revenue>0, or extra->>'sessions'>0.
//   HANDLED 2 — CLAIM COMPARED TO FIRST ACTIVITY, NOT TO THE CLAIMED FLOOR ALONE: rows cannot exist before the
//     platform's first active day, so CLAIM_EXCEEDS_ROWS fires only when min(rows) is later than
//     max(claimed floor, first active day). Comparing to the bare floor would flag every client whose account is
//     younger than the retention wall — thousands of false positives.
//   NOT HANDLED, STATED PLAINLY — first-active-day is itself derived from CAPTURED account rows. If the account
//     grain is ALSO short, the denominator is truncated and this gate UNDER-REPORTS by exactly that much. It cannot
//     bootstrap its own ground truth from the store; only a vendor probe can. That is why the gate is deliberately
//     one-sided: it reports what it can prove and never guesses the rest.
//   ALSO EXCLUDED, never failed: `ridesAccount` steps (shopify_money, woocommerce_money) whose data lives in the
//     account row's `extra` and produce no distinct rows — realPresent() returns null for them by design, so the
//     cursor is the only signal and there is nothing to compare.
//
// ⛔ DB-READING → `npm run check:data`, NEVER the build. Settled split, cited not re-derived: DECISIONS
// LORAMER_ACCOUNT_ROW_INVARIANT_V1; same posture as check-frozen-cursors.mjs and check-capture-landing.mjs.
//
// USAGE: node scripts/check-completion-claims.mjs [--guard] [--inject-claim-exceeds] [--inject-stale-baseline]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import pg from 'pg'
import { KNOWN_COMPLETION_CLAIM_VIOLATIONS } from './completion-claims.baseline.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const GUARD = process.argv.includes('--guard')
const INJECT_CLAIM = process.argv.includes('--inject-claim-exceeds')
const INJECT_STALE = process.argv.includes('--inject-stale-baseline')

for (const line of (read('.env.local') || '').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('✗ SUPABASE_DB_URL missing (.env.local) — required for the completion-claim gate; refusing to pass quietly.')
  process.exit(2)
}

// ── load REQUIRED_STEPS + realPresent from the REAL module (transpiled; it has no imports beyond types) ──────────
const out = mkdtempSync(join(tmpdir(), 'loramer-claims-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const SRC = 'src/lib/completeness/required-steps.ts'
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); console.error(`✗ could not run tsc — ${r.error.message}`); process.exit(2) }
let steps
try { steps = createRequire(import.meta.url)(join(out, 'src/lib/completeness/required-steps.js')) }
catch (e) { rmSync(out, { recursive: true, force: true }); console.error(`✗ required-steps did not load — ${e.message}`); process.exit(2) }
rmSync(out, { recursive: true, force: true })
const { REQUIRED_STEPS, realPresent } = steps
if (!REQUIRED_STEPS || typeof realPresent !== 'function') { console.error('✗ required-steps.ts does not export REQUIRED_STEPS + realPresent'); process.exit(2) }

// ═══ LORAMER_COMPLETION_CLAIM_DENOMINATOR_V1 — THE POPULATION COMES FROM THE DRAIN, NOT FROM required-steps.ts ═══
//
// ⛔ THE DEFECT THIS FIXES, MEASURED 2026-08-01. This gate iterated REQUIRED_STEPS (27 cursor keys) while
// DRAIN_REGISTRY runs 34 steps. TWELVE steps were in the drain and invisible here, covering 119 live cursors of
// which **60 claimed backfill_complete=true and had never been compared to a single row**. The gate reported
// "247 completion claims" and "51 known · 0 NEW" as though that were the whole population; the real population is
// ~307. It was checking ~80% and reporting like it checked everything.
// FOUND BY: a claim of mine failing against ground truth — I asserted Foam OH google_age was CLAIM_EXCEEDS_ROWS
// (cursor 2023-07-19, rows begin 2023-10-17, verified in metrics_daily: 8,944 age rows / 4,017 gender rows) and
// this gate reported no violation. Two instruments disagreeing; the data settled it. google_age simply does not
// exist in required-steps.ts, so the gate could never see it.
// ⛔ THIS IS THE SAME CLASS AS LORAMER_VERIFIED_PLATFORM_SCOPE_V1 — a check whose DENOMINATOR came from a
// convenient second source rather than from the thing it audits. Deriving from DRAIN_REGISTRY is the fix: the
// drain is what actually runs, so it cannot silently outgrow its own audit.
//
// ⚠ SIGNATURES ARE A SEPARATE PROBLEM FROM POPULATION, AND ONLY ONE OF THEM IS FIXED HERE. Enumerating a step is
// not the same as being able to row-check it — that needs a `real` signature (which metrics_daily rows the step
// claims). required-steps.ts owns those, and this flight is guard/script-only by instruction, so src/ is untouched.
// Steps with no signature are reported as UNMAPPED_NO_SIGNATURE — counted, named, and visible on every run —
// never silently dropped, which is exactly what happened before.
const DRAIN_SRC = read('src/lib/backfill/drain-registry.ts')
if (!DRAIN_SRC) { console.error('✗ drain-registry.ts unreadable — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }
const drainSteps = []
{
  const body = DRAIN_SRC.slice(DRAIN_SRC.indexOf('export const DRAIN_REGISTRY'))
  for (const blk of body.split(/\n {2}\{\n/).slice(1)) {
    const k = blk.match(/key:\s*'([^']+)'/)
    const p = blk.match(/platforms:\s*\[([^\]]*)\]/)
    if (!k || !p) continue
    const plats = [...p[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    for (const plat of plats) drainSteps.push({ key: k[1], platform: plat })
  }
}
if (!drainSteps.length) { console.error('✗ parsed ZERO steps out of DRAIN_REGISTRY — BROKEN INSTRUMENT, not a pass.'); process.exit(2) }

// ── THE FIVE ACCOUNT-CURSOR ALIASES, RESOLVED EXPLICITLY AND PRINTED, NEVER MAPPED SILENTLY ──────────────────────
// DRAIN_REGISTRY's single `account` step (platforms google/meta/ga) writes a PER-PLATFORM cursor named after the
// platform, and required-steps.ts records it under that platform name. Same fact, two naming conventions. The woo
// pair is the same shape under the legacy 'woocommerce_*' cursor names. Resolved here so a reader sees the mapping
// rather than trusting that one happened.
const ALIASES = {
  'account|google': 'google', 'account|meta': 'meta', 'account|ga': 'ga',
  'woo|woocommerce': 'woocommerce_backfill', 'woo_variant|woocommerce': 'woocommerce_variant',
}

// ── SUPPLEMENTARY SIGNATURES — ONLY WHERE VERIFIED AGAINST LIVE ROWS ON 2026-08-01, NEVER GUESSED ────────────────
// A wrong signature produces a CONFIDENT WRONG VERDICT on a completion claim, which is worse than reporting the
// claim unexamined. Each entry below was confirmed by reading the distinct breakdown_type set out of metrics_daily
// (skip-scan on The Escential Group / Foam OH) — not from a comment, not from a writer's variable name.
const SUPPLEMENTARY_REAL = {
  google_age: { breakdownTypes: ['age'] },
  google_gender: { breakdownTypes: ['gender'] },
  meta_attribution_window: { breakdownTypes: ['attribution_window'] },
  meta_product_id: { breakdownTypes: ['product_id'] },
  meta_placement_adset_ad: { breakdownTypes: ['placement'], entityLevels: ['ad_set', 'ad'] },
}
// ── COVERAGE DEBT LEDGER — steps that still have NO signature, each with the reason it was not invented ──────────
// ⛔ THIS IS AN INSTRUMENT-COVERAGE LEDGER, NOT A VIOLATION BASELINE. Nothing here is excused as "fine"; each entry
// says why a signature could not be established today. The guard fails on drift in BOTH directions.
const UNMAPPED_LEDGER = {
  meta_asset: 'the live *_asset set is ELEVEN types (ad_format/body/call_to_action/creative_relaxation/description/flexible_format/gen_ai/image/link_url/title/video), while the writer comment names SEVEN. Which of the four extras this step owns vs a sibling writer is not established — guessing would mis-verdict 13 cursors.',
  meta_comscore_market: 'comScore-only and forward-only from ~2026-06; ZERO rows on every client read, so no live row could confirm the breakdown_type value. Empty is the expected answer here by design.',
  shopify_order_time: 'ONE cursor lands TWO families in a single re-walk (order_time AND the discount_code history unseal). A single-family signature would under-claim; the pair is not stated anywhere authoritative.',
  ga_dimensional: 'families A-I, many breakdown_types, and ★GA-DIMENSIONAL-FALSE-COMPLETE is an open item against these very cursors. Establishing the signature is part of that item, not a side effect of this one.',
}

// Merge: DRAIN_REGISTRY is the population; required-steps supplies signatures where it has them.
const stepDefsFor = (platform) => {
  const out = []
  for (const ds of drainSteps.filter((s) => s.platform === platform)) {
    const alias = ALIASES[`${ds.key}|${ds.platform}`]
    const cursorKey = alias || ds.key
    const fromRequired = (REQUIRED_STEPS[platform] || []).find((d) => d.cursor === cursorKey || d.key === ds.key)
    const real = fromRequired?.real ?? SUPPLEMENTARY_REAL[ds.key] ?? null
    out.push({ key: ds.key, cursor: cursorKey, real, aliasedFrom: alias ? ds.key : null,
      signatureSource: fromRequired ? 'required-steps' : (SUPPLEMENTARY_REAL[ds.key] ? 'supplementary(verified)' : null) })
  }
  return out
}

// ── PURE CORE — both --inject proofs drive THIS with real-shaped input, so a catch is proven with no DB write ─────
// A claim is a violation iff:
//   zero matching rows AND the platform has delivered            -> FALSE_COMPLETE_EMPTY
//   rows exist AND min(rows) > max(claimedFloor, firstActiveDay)  -> CLAIM_EXCEEDS_ROWS
// Everything else is reported and never failed (see the honest limit in the header).
export function classifyClaim(c) {
  // LORAMER_COMPLETION_CLAIM_DENOMINATOR_V1 — a step the drain runs but nothing can row-check. Counted and named
  // on every run so the gate's own blind spot is part of its output rather than absent from it.
  if (c.noSignature) return { verdict: 'UNMAPPED_NO_SIGNATURE', why: `the drain runs this step but no metrics_daily signature is established for it — ${c.noSignatureReason}` }
  // ⛔ THE OTHER DIRECTION, WHICH THIS GATE COULD NOT REACH BEFORE. It filtered on backfill_complete=true, so rows
  // sitting BELOW an INCOMPLETE cursor were outside every verdict it had. Measured 2026-08-01: all SIX incomplete
  // google geo cursors carry rows 17-40 days deeper than they claim — 195 client-days. That is the partial-write
  // signature of a lap that times out mid-window: chunks 1..N-1 land, the writer 500s, rangeLap never advances the
  // cursor. It is NOT a lie about coverage (we hold MORE than we claim), so it is reported, never failed — but it
  // means the cursor is a stalled resume point, not a floor, and anything reading it as a floor is wrong.
  if (c.rowsExceedClaim) {
    return { verdict: 'ROWS_EXCEED_CLAIM', why: `cursor is INCOMPLETE at ${c.claimedFloor} but rows already reach ${c.minRowDate} — ${daysBetween(c.minRowDate, c.claimedFloor)} day(s) of rows sit below a stalled cursor (partial writes from a failing lap)` }
  }
  if (c.notRowCheckable) return { verdict: 'NOT_ROW_CHECKABLE', why: 'data rides the account row extra (ridesAccount); no distinct rows exist to compare' }
  if (!c.rowsPresent) {
    if (!c.everDelivered) return { verdict: 'HONEST_EMPTY', why: 'platform has never delivered (no active account day) — an empty breakdown is honest, not a defect' }
    return { verdict: 'FALSE_COMPLETE_EMPTY', why: `complete=true but ZERO persisted rows for the step signature, and the platform HAS delivered (first active ${c.firstActive})` }
  }
  // ⚠ NO ACTIVITY SIGNAL, NO COMPARISON. Caught as a false positive of this gate's own first run: Thought Streams
  // holds meta ACCOUNT rows (all $0) with a cursor claiming 2023-06-25, and with firstActive null the bound fell
  // back to the bare claim and flagged 1,078 days that could never have carried data. A platform that never
  // delivered gives no denominator, so the claim is UNCHECKABLE here — reported, never failed.
  if (!c.everDelivered) return { verdict: 'UNCHECKABLE_NO_ACTIVITY', why: `rows exist but the platform has NO active account day, so there is no activity denominator to compare the claim (${c.claimedFloor}) against` }
  const bound = [c.claimedFloor, c.firstActive].filter(Boolean).sort().pop() // the LATER of the two
  if (bound && c.minRowDate && c.minRowDate > bound) {
    return { verdict: 'CLAIM_EXCEEDS_ROWS', why: `claim covers ${c.claimedFloor} but rows begin ${c.minRowDate}; first activity ${c.firstActive} — ${daysBetween(bound, c.minRowDate)} day(s) claimed with no rows` }
  }
  return { verdict: 'OK', why: `rows from ${c.minRowDate} cover the claim (bound ${bound})` }
}
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) }

// ── LIVE READ. Bounded per (client, platform): one grouped min(date) grid, the shape measured at 363ms on the
// heaviest client 2026-07-30. Never a fleet-wide aggregate — those time out unconditionally on ~39M rows. ─────────
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
// ⚠ QUERY DISCIPLINE, and the first shape here FAILED: a `group by entity_level, breakdown_type` with min(date)
// over a whole client×platform grain range EXCEEDS THE LIVE 8s statement_timeout ("canceling statement due to
// statement timeout", measured 2026-07-30 on the first run of this file). The MCP session that measured the fleet
// tonight ran at 120s and did not see it — which is exactly why every number taken there was labelled as such.
// THE FIX IS THE QUERY, NOT THE CEILING: distinct (entity_level, breakdown_type) pairs come from the recursive
// LOOSE INDEX SCAN (one index seek per pair, cost O(pairs) not O(rows) — the same skip-scan
// breakdown-reachability-check.mjs uses), then min(date) is a limit-1 index-only seek on the full 4-col prefix of
// idx_metrics_daily_client_platform_bt_level_date. The generous timeout below is a safety net for a slow link, not
// a substitute for the shape — precedent: breakdown-reachability-check.mjs sets 115s for the same reason.
await db.query("SET statement_timeout='60s'")
const q = async (sql, params) => (await db.query(sql, params)).rows

const conns = await q(`select p.client_id::text as client_id, c.name, p.platform
   from platform_connections p join clients c on c.id = p.client_id and c.deleted_at is null
  order by c.name, p.platform`)
// ⛔ NO LONGER FILTERED ON backfill_complete = true. That filter is precisely what made ROWS_EXCEED_CLAIM
// unreachable: an INCOMPLETE cursor with rows below it never entered the population at all.
const cursors = await q(`select client_id::text as client_id, platform, backfill_earliest_date::text as earliest, backfill_complete
   from sync_state`)
const cursorByKey = new Map(cursors.map((r) => [`${r.client_id}|${r.platform}`, r]))

const claims = []
for (const conn of conns) {
  const defs = stepDefsFor(conn.platform)
  if (!defs.length) continue
  // The grid: every (entity_level, breakdown_type) this client×platform holds, with its min(date).
  // Step 1 — distinct pairs by loose index scan (skip-scan; O(pairs) seeks, clears 8s where GROUP BY does not).
  const pairRows = await q(
    `with recursive loose as (
        (select breakdown_type, entity_level from metrics_daily
          where client_id = $1 and platform = $2 order by breakdown_type, entity_level limit 1)
      union all
        select n.breakdown_type, n.entity_level from loose l
        cross join lateral (
          select m.breakdown_type, m.entity_level from metrics_daily m
           where m.client_id = $1 and m.platform = $2
             and (m.breakdown_type, m.entity_level) > (l.breakdown_type, l.entity_level)
           order by m.breakdown_type, m.entity_level limit 1) n)
      select breakdown_type, entity_level from loose where breakdown_type is not null`,
    [conn.client_id, conn.platform])
  // Step 2 — min(date) per pair: limit-1 index-only seek on the full 4-col prefix.
  const grid = []
  for (const pr of pairRows) {
    const [mn] = await q(
      `select date::text as mn from metrics_daily
        where client_id = $1 and platform = $2 and breakdown_type = $3 and entity_level = $4
        order by date asc limit 1`,
      [conn.client_id, conn.platform, pr.breakdown_type, pr.entity_level])
    grid.push({ entity_level: pr.entity_level, breakdown_type: pr.breakdown_type, mn: mn?.mn ?? null })
  }
  const [act] = await q(
    `select min(date)::text as first_active
       from metrics_daily
      where client_id = $1 and platform = $2 and entity_level = 'account' and breakdown_type = '' and breakdown_value = ''
        and (coalesce(spend,0) > 0 or coalesce(impressions,0) > 0 or coalesce(revenue,0) > 0
             or coalesce((extra->>'sessions')::numeric, 0) > 0)`,
    [conn.client_id, conn.platform])
  const pairs = grid.map((g) => ({ entity_level: g.entity_level, breakdown_type: g.breakdown_type }))
  for (const sd of defs) {
    const cur = cursorByKey.get(`${conn.client_id}|${sd.cursor}`)
    if (!cur) continue // no cursor row at all → nothing to compare (the frozen-cursor detector owns absent cursors)
    const base = {
      client: conn.name, clientId: conn.client_id, platform: conn.platform, step: sd.key, cursorKey: sd.cursor,
      claimedFloor: cur.earliest, complete: !!cur.backfill_complete, signatureSource: sd.signatureSource,
      firstActive: act?.first_active ?? null, everDelivered: !!act?.first_active,
    }
    if (!sd.real) { claims.push({ ...base, noSignature: true, noSignatureReason: UNMAPPED_LEDGER[sd.key] || 'no reason recorded in UNMAPPED_LEDGER' }); continue }
    const rp = realPresent(sd.real, pairs)
    const matching = grid.filter((g) => realPresent(sd.real, [{ entity_level: g.entity_level, breakdown_type: g.breakdown_type }]) === true)
    const minRowDate = matching.map((m) => m.mn).filter(Boolean).sort()[0] ?? null
    // An INCOMPLETE cursor is only interesting in one direction: rows already deeper than the resume point.
    if (!cur.backfill_complete) {
      if (minRowDate && cur.earliest && minRowDate < cur.earliest) claims.push({ ...base, minRowDate, rowsExceedClaim: true })
      continue // an incomplete cursor makes no completion CLAIM, so the other verdicts do not apply to it
    }
    claims.push({ ...base, notRowCheckable: rp === null, rowsPresent: rp === true, minRowDate })
  }
}
await db.end()

if (INJECT_CLAIM) {
  claims.push({
    client: 'SYNTHETIC Gate-A client', clientId: '00000000-dead-beef-0000-000000000002', platform: 'google',
    step: 'google_geo', cursorKey: 'google_geo', claimedFloor: '2019-01-01', notRowCheckable: false,
    rowsPresent: true, minRowDate: '2025-06-01', firstActive: '2019-01-01', everDelivered: true, synthetic: true,
  })
  console.log('  [--inject-claim-exceeds] injected ONE synthetic claim: floor 2019-01-01, rows begin 2025-06-01, first activity 2019-01-01. No DB write.')
}

for (const c of claims) Object.assign(c, classifyClaim(c))

const baseline = INJECT_STALE
  ? [...KNOWN_COMPLETION_CLAIM_VIOLATIONS, { clientId: '00000000-0000-0000-0000-000000000009', client: 'SYNTHETIC', platform: 'google', step: 'google_hour', note: 'SYNTHETIC stale entry — not a real violation' }]
  : KNOWN_COMPLETION_CLAIM_VIOLATIONS
if (INJECT_STALE) console.log('  [--inject-stale-baseline] appended ONE synthetic baseline entry that matches no live violation. Baseline FILE untouched.')

const violations = claims.filter((c) => c.verdict === 'FALSE_COMPLETE_EMPTY' || c.verdict === 'CLAIM_EXCEEDS_ROWS')
const isKnown = (v) => baseline.some((b) => b.clientId === v.clientId && b.platform === v.platform && b.step === v.step)
const known = violations.filter(isKnown)
const novel = violations.filter((v) => !isKnown(v))
const stale = baseline.filter((b) => !violations.some((v) => v.clientId === b.clientId && v.platform === b.platform && v.step === b.step))

// ── REPORT ──────────────────────────────────────────────────────────────────────────────────────────────────────
const tally = claims.reduce((a, c) => { a[c.verdict] = (a[c.verdict] || 0) + 1; return a }, {})
const completionClaims = claims.filter((c) => c.complete && !c.noSignature)
console.log('LORAMER_COMPLETION_CLAIM_GATE_V1 (live DB, read-only)')
console.log('  rule       : backfill_complete=true must be covered by rows — non-empty, and beginning no later than the claim')
console.log(`  population : ${drainSteps.length} DRAIN_REGISTRY step×platform entries (the denominator now comes from the DRAIN, not required-steps.ts)`)
console.log(`  examined   : ${claims.length} cursor(s) across ${conns.length} connections — ${completionClaims.length} completion claims row-checked`)
console.log(`  verdicts   : ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
// ⛔ THE ALIASES, PRINTED. Five DRAIN_REGISTRY keys write a cursor under a different name; resolved, not assumed.
console.log(`  aliases    : ${Object.entries(ALIASES).map(([k, v]) => `${k.replace('|', ' on ')} → cursor '${v}'`).join(' · ')}`)

const byPlatform = {}
for (const v of violations) (byPlatform[v.platform] ||= []).push(v)
console.log(`\nVIOLATIONS — ${violations.length} (known ${known.length} · NEW ${novel.length}):`)
if (!violations.length) console.log('  (none — every completion claim is covered by rows)')
for (const [plat, vs] of Object.entries(byPlatform).sort()) {
  console.log(`\n  ${plat.toUpperCase()} — ${vs.length}`)
  for (const v of vs.sort((a, b) => a.client.localeCompare(b.client))) {
    console.log(`    ${isKnown(v) ? 'known' : ' NEW '}  ${v.client} (${v.clientId.slice(0, 8)}) ${v.step} [cursor ${v.cursorKey}]`)
    console.log(`           ${v.verdict}: ${v.why}`)
  }
}
// ── ROWS_EXCEED_CLAIM — reported, never failed. We hold MORE than the cursor claims, so it is not a false claim of
// coverage; it means the cursor is a STALLED RESUME POINT and anything reading it as a floor is reading it wrong.
const deeper = claims.filter((c) => c.verdict === 'ROWS_EXCEED_CLAIM')
console.log(`\nROWS_EXCEED_CLAIM — ${deeper.length} (reported, never failed): rows sit BELOW an INCOMPLETE cursor`)
for (const d of deeper.sort((a, b) => daysBetween(b.minRowDate, b.claimedFloor) - daysBetween(a.minRowDate, a.claimedFloor))) {
  console.log(`  ${d.client} (${d.clientId.slice(0, 8)}) ${d.platform}.${d.step} — ${d.why}`)
}
if (deeper.length) {
  const totalDays = deeper.reduce((n, d) => n + daysBetween(d.minRowDate, d.claimedFloor), 0)
  console.log(`  TOTAL ${totalDays} client-day(s) of rows below a stalled cursor. Any figure computed from these cursors OVERSTATES the remaining gap by that much.`)
}

// ── UNMAPPED — the gate's own blind spot, printed every run so it cannot become invisible again.
const unmapped = claims.filter((c) => c.verdict === 'UNMAPPED_NO_SIGNATURE')
const unmappedSteps = [...new Set(unmapped.map((c) => `${c.platform}.${c.step}`))].sort()
console.log(`\nUNMAPPED_NO_SIGNATURE — ${unmapped.length} cursor(s) across ${unmappedSteps.length} step(s) the drain runs but this gate cannot row-check:`)
for (const s of unmappedSteps) {
  const n = unmapped.filter((c) => `${c.platform}.${c.step}` === s).length
  const sealed = unmapped.filter((c) => `${c.platform}.${c.step}` === s && c.complete).length
  console.log(`  ${s} — ${n} cursor(s), ${sealed} claiming complete=true · ${UNMAPPED_LEDGER[s.split('.')[1]] || '(no reason recorded)'}`)
}

const notCheckable = claims.filter((c) => c.verdict === 'NOT_ROW_CHECKABLE')
const honest = claims.filter((c) => c.verdict === 'HONEST_EMPTY')
const noAct = claims.filter((c) => c.verdict === 'UNCHECKABLE_NO_ACTIVITY')
console.log(`\nREPORTED, NEVER FAILED: ${notCheckable.length} NOT_ROW_CHECKABLE (ridesAccount) · ${honest.length} HONEST_EMPTY (platform never delivered) · ${noAct.length} UNCHECKABLE_NO_ACTIVITY (rows exist but no active day = no denominator)`)
for (const c of honest.slice(0, 12)) console.log(`  HONEST_EMPTY  ${c.client} (${c.clientId.slice(0, 8)}) ${c.platform}.${c.step} — no active account day`)
if (honest.length > 12) console.log(`  … and ${honest.length - 12} more`)

let exitCode = 0
if (GUARD) {
  console.log('\nGUARD — baseline classification:')
  console.log(`  violations ${violations.length} · baselined ${known.length} · NEW ${novel.length} · stale-baseline ${stale.length}`)
  if (novel.length) {
    console.error(`\n✗ COMPLETION-CLAIM GATE FAILED — ${novel.length} claim(s) NOT covered by rows and NOT baselined:`)
    for (const v of novel) console.error(`     ${v.client} (${v.clientId.slice(0, 8)}) ${v.platform}.${v.step} — ${v.verdict}: ${v.why}`)
    console.error('  A completion flag is a claim the code makes about ITSELF. Fix the writer, or (deliberately) add an')
    console.error('  entry to scripts/completion-claims.baseline.mjs with its reason.')
    exitCode = 1
  }
  if (stale.length) {
    console.error(`\n✗ COMPLETION-CLAIM GATE FAILED — ${stale.length} STALE baseline entr(ies) matching no live violation:`)
    for (const b of stale) console.error(`     ${b.client} (${String(b.clientId).slice(0, 8)}) ${b.platform}.${b.step}`)
    console.error('  ANTI-ROT: the claim is covered now, so the entry has outlived its justification. Delete it.')
    exitCode = 1
  }
  if (!exitCode) console.log('  ✓ COMPLETION-CLAIM GATE PASSED — every violation is baselined, and every baseline entry still matches a real one.')
}
process.exit(exitCode)
