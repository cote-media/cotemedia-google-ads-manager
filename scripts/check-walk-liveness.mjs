#!/usr/bin/env node
// LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — THE WALK LIVENESS INVARIANT, as a check:data owned check.
//
// ⛔ THE INCIDENT THIS EXISTS TO CATCH SAME-DAY: 2026-08-13 23:30Z → 2026-08-14 ~20:00Z, the walk WEDGED —
// every hourly fire completed, scanned 60 surfaces, refused all of them 'nothing-owed', published nothing,
// and left NO durable trace. 21+ hours of silence indistinguishable from health, found only because a human
// went looking. The heartbeat table (universe_fire_log, migrations/068) makes fires durable; THIS check
// makes their silence LOUD: a RED in check:data, which every push report must quote by name.
//
// THE INVARIANT, exactly as decided:
//   WEDGE (RED):   trailing 24h shows fires happening AND published=0 AND rows_written=0 AND the refusals
//                  are NOT dominated by 'floor-reached'. Fires-with-no-output and no floor to blame = wedged.
//   DONE (GREEN):  fires happening, nothing published, and the latest completed fire's refusals are ALL
//                  'floor-reached' — every scanned surface has walked to its resolved stop. That is the
//                  walk's TERMINAL SUCCESS state, not a wedge, and crying wolf at completion would teach
//                  everyone to ignore this check the week it matters most.
//   ALIVE (GREEN): anything published or any rows written in the window.
//   NO FIRES (RED): zero fires in 24h while the cron entry exists — the scheduler itself is dead.
//   NOT-MIGRATED (CANNOT-RUN, exit 2): universe_fire_log absent — the instrument is not installed; that is
//                  a broken instrument, never a pass (and never a silent skip).
//   ⇒ RECUT 2026-09-10 (LORAMER_WALK_LIVENESS_RECUT_V1): the six-state predicate below supersedes this list —
//      ALIVE now requires CONSUMPTION, and a fully SEALED idle walk reads SEALED-IDLE, never WEDGED.
//
// ⚠ v1 IS A VERDICT LINE, DELIBERATELY NOT A UI — the full daily-alert surface is its own queued 9/30 item.
//
// USAGE: node scripts/check-walk-liveness.mjs [--guard]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// ── PURE CORE — driven by the guard with no DB ──────────────────────────────────────────────────────────
// LORAMER_WALK_LIVENESS_RECUT_V1 (2026-09-10) — SIX STATES ON THE SUBJECT'S OWN ROWS. The 2026-08-14 predicate read
// ALIVE on PUBLISHING (14 top-edge units on 2026-09-09) and WEDGED on a walk that was legitimately IDLE (349/349
// floor-sealed, lookback observe-only, candidates 0 — the seal path records scanned 0 and refusals 'floor-sealed',
// which the old DONE branch, keyed on 'floor-reached' with scanned > 0, could not see). ESSENCE C6: liveness tests
// CONSUMPTION, not publishing; idle-by-design must read differently from wedged (Kubernetes: "liveness probes could
// catch a deadlock, where an application is running, but unable to make progress" — a process with no work is not
// deadlocked). Every threshold here is DERIVED from the rows themselves; no typed number.
//   NO-FIRES (red)              — zero wet fires in the window while the cron entry exists.
//   CONSUMPTION-UNMEASURED (red)— units published but the attempt log was not read: no claim of life without it.
//   EXECUTION-DARK (red)        — published units minus the latest fire's own published (the in-flight tolerance IS the
//                                 latest fire's count) exceed the attempts the ledger opened.
//   ALIVE (green)               — published AND consumed (attempts/published printed with its denominator), or rows written.
//   DONE (green)                — the legacy terminal: every scanned surface refused 'floor-reached'.
//   SEALED-IDLE (green)         — the latest fire had candidates 0, published 0, floor-sealed + floor-reached ==
//                                 catalog_size, and no refusal outside the seal/lookback vocabulary — printed as the seal
//                                 arithmetic plus the lookback reason, so idle reads as a sentence, not as a zero.
//   ADVANCING (green)           — covered-ground advances only.
//   WEDGED (red)                — fires that decide nothing and are not explained by seals.
const LOOKBACK_REFUSALS = new Set(['lookback-boundary-unknown', 'lookback-waiting'])
const SEAL_REFUSALS = new Set(['floor-sealed', 'floor-reached'])
export function decideWalkLiveness(a) {
  const { fires, publishedTotal, rowsWritten24h, advancedTotal, latestCompletedRefusals, scannedLatest, attemptsStarted24h, latestCompleted } = a
  if (fires === 0) {
    return { ok: false, state: 'NO-FIRES', reason: 'ZERO resumer fires recorded in the trailing 24h while the cron entry exists — the scheduler lane itself is dead (or the heartbeat write is failing on every fire, which is the same emergency).' }
  }
  if (publishedTotal > 0) {
    if (!Number.isFinite(Number(attemptsStarted24h))) {
      return { ok: false, state: 'CONSUMPTION-UNMEASURED', reason: `${publishedTotal} unit(s) published in 24h but the attempt log was not read — an instrument that cannot read consumption may not claim life.` }
    }
    const inFlight = Number(latestCompleted?.published ?? 0)
    const expected = Math.max(0, publishedTotal - inFlight)
    const attempts = Number(attemptsStarted24h)
    if (attempts < expected) {
      return { ok: false, state: 'EXECUTION-DARK', reason: `EXECUTION DARK — ${publishedTotal} unit(s) published in 24h across ${fires} fire(s) but only ${attempts} attempt(s) opened (${attempts}/${publishedTotal}; the latest fire's ${inFlight} may still be in flight). Publishing is not consumption.` }
    }
    return { ok: true, state: 'ALIVE', reason: `walk alive — ${publishedTotal} unit(s) published and ${attempts}/${publishedTotal} consumed in 24h across ${fires} fire(s) (latest fire's ${inFlight} in flight); ${rowsWritten24h} row(s) written.` }
  }
  if (rowsWritten24h > 0) {
    return { ok: true, state: 'ALIVE', reason: `walk alive — ${rowsWritten24h} row(s) written in 24h across ${fires} fire(s) with nothing newly published.` }
  }
  const refusals = latestCompletedRefusals ?? {}
  const floorReached = Number(refusals['floor-reached'] ?? 0)
  if (scannedLatest > 0 && floorReached === scannedLatest) {
    return { ok: true, state: 'DONE', reason: `walk at its TERMINAL state — the latest completed fire refused all ${scannedLatest} scanned surface(s) with 'floor-reached': every one has walked to its resolved stop. This is completion, not a wedge.` }
  }
  const catalogSize = Number(latestCompleted?.catalog_size ?? 0)
  const candidates = Number(latestCompleted?.candidates ?? 0)
  const sealed = Number(refusals['floor-sealed'] ?? 0) + floorReached
  const foreign = Object.keys(refusals).filter((k) => !SEAL_REFUSALS.has(k) && !LOOKBACK_REFUSALS.has(k) && k !== 'advanced-covered')
  const lookback = Object.keys(refusals).filter((k) => LOOKBACK_REFUSALS.has(k)).map((k) => `${k}×${refusals[k]}`)
  if (catalogSize > 0 && candidates === 0 && Number(latestCompleted?.published ?? 0) === 0 && sealed === catalogSize && foreign.length === 0) {
    return { ok: true, state: 'SEALED-IDLE', reason: `walk IDLE BY DESIGN — ${sealed}/${catalogSize} surfaces sealed (floor-sealed ${refusals['floor-sealed'] ?? 0} · floor-reached ${floorReached}), candidates 0, nothing published; lookback slot: ${lookback.length ? lookback.join(', ') : 'no refusal'}. Nothing is owed to the descent; the lookback lane holds its own owed set (the fire's LOOKBACK line; top-edge-is-held). Not a wedge.` }
  }
  if (advancedTotal > 0) {
    return { ok: true, state: 'ADVANCING', reason: `walk crossing covered ground — ${advancedTotal} covered-skip advance(s) in 24h (0 vendor ops each), nothing published yet. Descent resumes when a surface reaches owed ground.` }
  }
  return {
    ok: false, state: 'WEDGED',
    reason: `WEDGE SIGNAL — ${fires} fire(s) in 24h, published=0, rows_written=0, advanced=0, and the latest fire's refusals are neither all 'floor-reached' nor a full seal (${sealed}/${catalogSize || '?'} sealed${foreign.length ? `; unexplained: ${foreign.map((k) => `${k}×${refusals[k]}`).join(', ')}` : ''}). Fires that decide nothing, hourly, is ★WALK-WEDGES-AT-COVERED-GROUND's shape — investigate the refusal histogram before the walk loses another day.`,
  }
}

// ── LIVE READ ───────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  // env loader — process.env-soft shape (the guard family's; never throws on a missing file, Vercel-safe).
  try {
    for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* no .env.local — rely on ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) { console.error('✗ walk-liveness CANNOT RUN — Supabase env missing. A broken instrument is not a pass.'); process.exitCode = 2; return }
  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    return { status: r.status, body: await r.json().catch(() => null) }
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const fires = await get(`universe_fire_log?select=fired_at,fire_outcome,scanned,catalog_size,candidates,published,requests_selected,advanced,refusals,dry_run&fired_at=gte.${encodeURIComponent(since)}&order=fired_at.desc&limit=200`)
  if (fires.status === 404 || (fires.body && fires.body.code === '42P01')) {
    console.error('✗ walk-liveness CANNOT RUN — universe_fire_log does not exist (migrations/068 not applied). The heartbeat instrument is not installed; this is a broken instrument, never a pass.')
    process.exitCode = 2; return
  }
  if (fires.status !== 200 || !Array.isArray(fires.body)) {
    console.error(`✗ walk-liveness CANNOT RUN — fire-log read failed (HTTP ${fires.status}): ${JSON.stringify(fires.body).slice(0, 200)}`)
    process.exitCode = 2; return
  }
  // Wet fires only — a dry diagnostic run must not count as liveness.
  const wet = fires.body.filter((f) => !f.dry_run)
  const latestCompleted = wet.find((f) => f.fire_outcome === 'completed') ?? null

  // ⛔ LORAMER_WALK_LIVENESS_ROWS_RPC_V1 — THIS READ WAS STRUCTURALLY ZERO FROM THE DAY IT SHIPPED
  // (★WALK-LIVENESS-ROWS-COUNTER-IS-STRUCTURALLY-ZERO, measured 2026-08-15). It was
  // `select=rows_written.sum()` — a PostgREST aggregate, and AGGREGATES ARE DISABLED ON THIS PROJECT: the
  // live response was HTTP 400 PGRST123, the body an error object, and `Array.isArray(body) ? … : 0`
  // turned that failure into a silent 0 on every run. This is the Deploy 2 gate's own instrument
  // (`rows_written > 0`), so on the day the walk wrote rows it would still have said zero.
  // Now a scalar RPC (migrations/070) — summed in Postgres because the attempt log outruns the 1,000-row
  // page cap — and a read that cannot answer is CANNOT RUN, exit 2, NEVER a number. An unreadable counter
  // reading as zero is the most permissive answer an instrument can give (house law, learned twice).
  const rowsRes = await fetch(`${SB}/rest/v1/rpc/universe_walk_rows_written`, {
    method: 'POST',
    headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_since: since }),
  })
  const rowsBody = await rowsRes.json().catch(() => null)
  const rowsWritten24h = Number(rowsBody)
  if (rowsRes.status !== 200 || !Number.isFinite(rowsWritten24h) || rowsWritten24h < 0) {
    console.error(`✗ walk-liveness CANNOT RUN — rows-written read UNREADABLE (HTTP ${rowsRes.status}: ${JSON.stringify(rowsBody).slice(0, 200)}). migrations/070_walk_rows_written_fn.sql creates universe_walk_rows_written(); a counter that cannot answer must never pass as zero — that silent zero is the exact defect this read replaces.`)
    process.exitCode = 2; return
  }

  // LORAMER_WALK_LIVENESS_RECUT_V1 — CONSUMPTION is read from the subject's own ledger (attempt_started rows in the
  // same window), counted in Postgres (Prefer: count=exact on a HEAD) so the 1,000-row page cap cannot under-count.
  // An unreadable count is CANNOT RUN, never a number (the structurally-zero lesson, LORAMER_WALK_LIVENESS_ROWS_RPC_V1).
  const attemptsHead = await fetch(`${SB}/rest/v1/universe_attempt_log?select=id&phase=eq.attempt_started&recorded_at=gte.${encodeURIComponent(since)}`, { method: 'HEAD', headers: { apikey: K, Authorization: `Bearer ${K}`, Prefer: 'count=exact' } })
  const attemptsStarted24h = Number((attemptsHead.headers.get('content-range') || '').split('/')[1])
  if (attemptsHead.status >= 400 || !Number.isFinite(attemptsStarted24h)) {
    console.error(`✗ walk-liveness CANNOT RUN — attempt-log count UNREADABLE (HTTP ${attemptsHead.status}, content-range ${attemptsHead.headers.get('content-range')}). Consumption cannot be judged; a broken instrument is not a pass.`)
    process.exitCode = 2; return
  }

  const publishedTotal = wet.reduce((s, f) => s + Number(f.published ?? 0), 0)
  const verdict = decideWalkLiveness({
    fires: wet.length,
    publishedTotal,
    rowsWritten24h,
    advancedTotal: wet.reduce((s, f) => s + Number(f.advanced ?? 0), 0),
    attemptsStarted24h,
    latestCompleted,
    latestCompletedRefusals: latestCompleted?.refusals ?? null,
    scannedLatest: Number(latestCompleted?.scanned ?? 0),
  })
  // OWED SET — INFORMATION, never a wedge signal (ESSENCE C6: no-progress tests whether the OWED SET SHRANK). The
  // heartbeat persists no owed count; the lookback lane's owed days are on the fire's LOOKBACK line (runtime log) and
  // the top strip's owed days are the top-edge-is-held leg's number. Named here so the reader knows where to look.
  console.log(`[walk-liveness] owed-set (info): lookback owed days → the fire's LOOKBACK line; top-strip owed days → check:data top-edge-is-held. Neither is a liveness signal.`)
  console.log(`[walk-liveness] 24h: fires=${wet.length} published=${publishedTotal} attempts=${attemptsStarted24h} rows=${rowsWritten24h} advanced=${wet.reduce((s, f) => s + Number(f.advanced ?? 0), 0)} sealed=${Number(latestCompleted?.refusals?.['floor-sealed'] ?? 0) + Number(latestCompleted?.refusals?.['floor-reached'] ?? 0)}/${latestCompleted?.catalog_size ?? '?'} · state=${verdict.state}`)
  if (!verdict.ok) { console.error(`✗ WALK-LIVENESS FAILED — ${verdict.reason}`); process.exitCode = 1; return }
  console.log(`✓ walk-liveness OK — ${verdict.reason}`)
}

// Import-safe: the guard imports decideWalkLiveness without running the live read.
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) await main()
