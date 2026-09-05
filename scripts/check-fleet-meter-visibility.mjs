#!/usr/bin/env node
// LORAMER_FLEET_METER_SEES_THE_WALK_V1 — check:data. THE NUMBER, WITNESSED BY A TABLE THE METER DOES NOT READ.
//
// ⛔ WHY THIS EXISTS AND WHY IT IS NOT THE GUARD. `fleet-meter-sees-the-walk.guard.mjs` pins the SHAPE: that
// readGoogleSpendToday sums both walk ledgers. Shape is not enough, and the 2026-08-15 defect proves it — the
// pre-fix expression was perfectly well-shaped and returned a clean, finite, plausible 0 for three days
// because the ledger it summed had gone quiet. A sum over zero rows cannot be distinguished from "spent
// nothing" by any amount of static reading.
//
// ⛔ THE DESIGN RULE, AND IT IS THE WHOLE POINT: THE WITNESS MUST NOT BE THE SUBJECT. `universe_fire_log`
// records what each fire SELECTED, and neither spend aggregate reads it. So if the fires say 680 requests
// were selected and the meter says the walk spent 0, exactly one of them is lying and this check says which.
// google-op-budget.guard.mjs leg (k) had the right idea and the wrong witness: it compared the meter against
// universe_window_log — the same silent source — and printed "VACUOUS today" while the fleet ran blind.
//
// USAGE: node scripts/check-fleet-meter-visibility.mjs [--guard]
// READ-ONLY. No writes, no vendor requests.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const WINDOW_HOURS = 24

// ── PURE CORE — driven without a DB so the shape can be proven both ways ─────────────────────────────
// `selected` — universe_fire_log.requests_selected, the independent witness.
// `meterBackfill` — what the fleet reader reports for the backfill lane.
// `attemptStarted` / `windowLog` — the two ledger terms, for attribution when they disagree.
export function decideFleetMeterVisibility(a) {
  const { selected, meterBackfill, attemptStarted, windowLog, fires } = a

  if (fires === 0) {
    return { ok: true, state: 'NO-FIRES', reason: `no wet walk fire in the trailing ${WINDOW_HOURS}h — there is no spend to be blind to. This check asserts nothing today and says so rather than printing a pass.` }
  }
  // ⛔ THE DEFECT ITSELF. Fires selected requests; the fleet meter reports the walk spent nothing.
  if (selected > 0 && meterBackfill === 0) {
    return {
      ok: false, state: 'BLIND',
      reason: `FLEET METER IS BLIND TO THE WALK — universe_fire_log records ${selected} request(s) selected across ${fires} fire(s) in the trailing ${WINDOW_HOURS}h, and the fleet reader's backfill lane reports 0. ` +
        `Ledger terms: universe_attempt_log(attempt_started)=${attemptStarted}, universe_window_log=${windowLog}. ` +
        `Every other google lane is measuring against a denominator missing its largest single spender — the 2026-08-06 quota-crisis shape, one ledger further along.`,
    }
  }
  // ⛔ THE OPPOSITE FAILURE, AND THE ONE THAT STARVES RATHER THAN OVERSPENDS. universe_attempt_log logs each
  // request TWICE (attempt_started + attempt_finished), so a reader that forgets `phase = 'attempt_started'`
  // reports ~2× the truth — and an over-counting governor refuses the product lanes on spend that never
  // happened. MEASURED 2026-08-15: all-phase 1,382 against 691 real requests, exactly 2.00×.
  // ⛔ THE WITNESS FOR THIS IS THE FIRE LOG, NOT A SECOND SUM OF THE SUBJECT TABLE — and that is a correction
  // made DURING this flight, not a first draft. The obvious implementation (read the all-phase sum and
  // compare) needs a PostgREST aggregate, and THIS PROJECT HAS AGGREGATES DISABLED: `select=col.sum()`
  // returns HTTP 400 PGRST123, the body is an object rather than an array, and `Number(body[0]?.sum ?? 0)`
  // quietly yields 0 — a leg that can never fire, wearing a passing green. Caught by running it.
  // ⇒ 1.5× the fires' own `requests_selected` is the threshold: far above in-flight noise, far below 2×.
  const DOUBLE_COUNT_RATIO = 1.5
  if (selected > 0 && meterBackfill >= selected * DOUBLE_COUNT_RATIO) {
    return {
      ok: false, state: 'DOUBLE-COUNTED',
      reason: `FLEET METER IS OVER-COUNTING THE WALK — backfill lane reports ${meterBackfill} against ${selected} request(s) the fires actually selected (${(meterBackfill / selected).toFixed(2)}×, threshold ${DOUBLE_COUNT_RATIO}×). ` +
        `Ledger terms: attempt_started=${attemptStarted}, window_log=${windowLog}. The classic cause is a reader summing universe_attempt_log without \`phase = 'attempt_started'\`, which counts every request twice. An over-counting governor STARVES the lanes it exists to protect.`,
    }
  }
  // ⛔ TOLERANCE, STATED RATHER THAN FUDGED. A fire selects, then attempts, so a fire IN FLIGHT at read time
  // shows selected > attempt_started for its lifetime (~90s). One full fire is 40 requests; anything beyond
  // that is drift, not timing.
  const IN_FLIGHT_TOLERANCE = 40
  const drift = selected - meterBackfill
  if (Math.abs(drift) > IN_FLIGHT_TOLERANCE) {
    return {
      ok: false, state: 'DRIFT',
      reason: `FLEET METER DISAGREES WITH THE FIRE LOG BY ${drift} request(s) — fires selected ${selected}, the backfill lane reports ${meterBackfill} (attempt_started ${attemptStarted} + window_log ${windowLog}). Beyond the ${IN_FLIGHT_TOLERANCE}-request in-flight allowance this is a real divergence: a day-boundary mismatch between the two aggregates, or a third ledger nobody is summing.`,
    }
  }
  return {
    ok: true, state: 'VISIBLE',
    reason: `fleet meter sees the walk — ${fires} fire(s) selected ${selected} request(s) in the trailing ${WINDOW_HOURS}h and the backfill lane reports ${meterBackfill} (attempt_started ${attemptStarted} + window_log ${windowLog}), within the ${IN_FLIGHT_TOLERANCE}-request in-flight allowance.`,
  }
}

// ── LIVE READ ────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  try {
    for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* no .env.local — rely on ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) { console.error('✗ fleet-meter-visibility CANNOT RUN — Supabase env missing. A broken instrument is not a pass.'); process.exitCode = 2; return }
  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const rpc = async (fn, args) => {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }

  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString()
  const enc = encodeURIComponent(sinceIso)

  // ⛔ THE WITNESS. Neither spend aggregate reads universe_fire_log; that independence is the entire value.
  const fires = await get(`universe_fire_log?select=fired_at,dry_run,requests_selected&fired_at=gte.${enc}&order=fired_at.desc&limit=500`)
  if (fires.status !== 200 || !Array.isArray(fires.body)) {
    console.error(`✗ fleet-meter-visibility CANNOT RUN — fire-log read failed (HTTP ${fires.status}): ${JSON.stringify(fires.body).slice(0, 200)}`)
    process.exitCode = 2; return
  }
  const wet = fires.body.filter((f) => !f.dry_run)
  // ⛔ THE WITNESS IS SUMMED IN NODE OVER REAL ROWS, DELIBERATELY. It is the one number this check cannot
  // afford to have arrive as a silent zero, and a PostgREST aggregate would do exactly that here
  // (PGRST123 — aggregates are disabled on this project; see the DOUBLE-COUNTED comment above).
  // The row cap is not a risk at this grain: the walk fires hourly, so 24h is ~24 rows against a 500 limit.
  if (wet.length >= 500) {
    console.error('✗ fleet-meter-visibility CANNOT RUN — the fire-log read hit its 500-row limit, so `selected` is truncated and the comparison below would understate the witness. Raise the limit rather than trusting a capped sum.')
    process.exitCode = 2; return
  }
  const selected = wet.reduce((s, f) => s + Number(f.requests_selected ?? 0), 0)

  // The two ledger terms, read through the SAME server-side aggregates the fleet reader calls — so this
  // measures the reader's inputs, not a re-implementation of them.
  const v2 = await rpc('universe_attempt_lane_spend_today', { p_vendor: 'google', p_since: sinceIso })
  const v1 = await rpc('universe_lane_spend_today', { p_vendor: 'google_ads', p_since: sinceIso })
  for (const [name, r] of [['universe_attempt_lane_spend_today', v2], ['universe_lane_spend_today', v1]]) {
    if (r.status !== 200 || typeof Number(r.body) !== 'number' || !Number.isFinite(Number(r.body))) {
      console.error(`✗ fleet-meter-visibility CANNOT RUN — ${name} unreadable (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 160)}. An unreadable spend aggregate is a broken instrument, never a pass.`)
      process.exitCode = 2; return
    }
  }
  const attemptStarted = Number(v2.body)
  const windowLog = Number(v1.body)
  const meterBackfill = attemptStarted + windowLog

  const verdict = decideFleetMeterVisibility({
    selected, meterBackfill, attemptStarted, windowLog, fires: wet.length,
  })

  console.log(`[fleet-meter-visibility] ${WINDOW_HOURS}h: fires=${wet.length} selected=${selected} · meter backfill=${meterBackfill} (attempt_started ${attemptStarted} + window_log ${windowLog}) · state=${verdict.state}`)
  // ⛔ EMPTY CARRIES ITS DENOMINATOR. When window_log reads 0 that is now EXPECTED — the v1 consumer retired —
  // and saying so out loud is what stops the next reader from treating a quiet ledger as a broken one.
  if (windowLog === 0) {
    console.log(`[fleet-meter-visibility] universe_window_log contributes 0 — EXPECTED, not a fault: the v1 consumer is retired (last row 2026-08-12 18:16:46Z). Its term stays in the sum because a retired consumer that comes back must not be invisible.`)
  }
  let failed = false
  if (!verdict.ok) { console.error(`✗ FLEET-METER-VISIBILITY FAILED — ${verdict.reason}`); failed = true }
  else console.log(`✓ fleet-meter-visibility OK — ${verdict.reason}`)

  // LORAMER_FORWARD_OBSERVATION_LOG_V1 — THE FORWARD WITNESS. The fleet meter now reads forward's requests from
  // forward_observation_log instead of deriving connections × 67. A ledger that goes quiet reads as "nothing
  // spent" — the exact defect this check exists for, one lane over — so the ledger is compared against a SECOND
  // witness: cron_runs.connections_attempted on forward google fires (progress-stamped per client since
  // LORAMER_FORWARD_LANE_HYGIENE_V1). Expected observations ≈ attempted × SURFACES_PER_CONNECTION (35 catalogue
  // surfaces across the ten producers; a killed connection may leave fewer). Pre-ledger fires are exempt by date.
  // ⚠ This script reads the ledger over REST (row count) because it cannot import the TS module; src/ code reads it
  // only through src/lib/backfill/forward-observation-log.ts (forward-observation-boundary.guard).
  const OBSERVATION_LEDGER_LIVE_FROM = '2026-09-06T00:00:00Z' // first forward fire after the 087 deploy is 2026-09-06 08:08Z
  const fwdSince = sinceIso > OBSERVATION_LEDGER_LIVE_FROM ? sinceIso : OBSERVATION_LEDGER_LIVE_FROM
  const fwdEnc = encodeURIComponent(fwdSince)
  const fwdFires = await get(`cron_runs?select=connections_attempted,finished_at&mode=eq.forward&platform=eq.google&started_at=gte.${fwdEnc}&limit=500`)
  const obsHead = await fetch(`${SB}/rest/v1/forward_observation_log?select=id&vendor=eq.google&observed_at=gte.${fwdEnc}`, { method: 'HEAD', headers: { apikey: K, Authorization: `Bearer ${K}`, Prefer: 'count=exact' } })
  const obsCount = Number((obsHead.headers.get('content-range') || '').split('/')[1])
  if (fwdFires.status !== 200 || !Array.isArray(fwdFires.body) || obsHead.status >= 400 || !Number.isFinite(obsCount)) {
    console.error(`✗ fleet-meter-visibility CANNOT RUN — forward witness unreadable (cron_runs HTTP ${fwdFires.status}, ledger HTTP ${obsHead.status}, content-range ${obsHead.headers.get('content-range')}). A broken instrument is not a pass.`)
    process.exitCode = 2; return
  }
  const attempted = fwdFires.body.reduce((s, f) => s + Number(f.connections_attempted ?? 0), 0)
  const unfinished = fwdFires.body.filter((f) => f.finished_at == null).length
  const fwd = decideForwardLedgerVisibility({ attempted, observations: obsCount, unfinished, fires: fwdFires.body.length })
  console.log(`[fleet-meter-visibility] forward since ${fwdSince}: fires=${fwdFires.body.length} attempted=${attempted} (unfinished ${unfinished}) · observations=${obsCount} · state=${fwd.state}`)
  if (!fwd.ok) { console.error(`✗ FLEET-METER-VISIBILITY FAILED — ${fwd.reason}`); failed = true }
  else console.log(`✓ fleet-meter-visibility forward OK — ${fwd.reason}`)
  if (failed) process.exitCode = 1
}

const SURFACES_PER_CONNECTION = 35 // customer 1 · campaign 1 · ad_group + ad_group_ad 2 · dim 2 · device 4 · conv-action 1 · IS 1 · geo 19 · hour 2 · demo 2
export function decideForwardLedgerVisibility(a) {
  const { attempted, observations, unfinished, fires } = a
  if (fires === 0) return { ok: true, state: 'NO-FORWARD-FIRES', reason: 'no google forward fire since the observation ledger went live — nothing to witness yet; asserted nothing and said so.' }
  if (attempted > 0 && observations === 0) {
    return { ok: false, state: 'QUIET', reason: `FORWARD LEDGER IS QUIET — ${fires} forward fire(s) attempted ${attempted} connection(s) and forward_observation_log recorded 0 observations. The producers ran and recorded nothing; the fleet meter is billing forward as if it spent nothing.` }
  }
  const expected = attempted * SURFACES_PER_CONNECTION
  const ratio = expected > 0 ? observations / expected : 1
  if (expected > 0 && ratio < 0.5) {
    return { ok: false, state: 'DRIFT', reason: `FORWARD LEDGER UNDER-RECORDS — ${observations} observation(s) against ~${expected} expected (${attempted} connections × ${SURFACES_PER_CONNECTION} surfaces; ${unfinished} unfinished fire(s) may account for a partial set, not for ${(ratio * 100).toFixed(0)}%).` }
  }
  return { ok: true, state: 'VISIBLE', reason: `forward ledger sees its producers — ${observations} observation(s) for ${attempted} attempted connection(s) (~${expected} expected, ${(ratio * 100).toFixed(0)}%).` }
}

// Import-safe: a guard may import decideFleetMeterVisibility without running the live read.
if (process.argv[1] && process.argv[1].endsWith('check-fleet-meter-visibility.mjs')) await main()
