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
//
// ⚠ v1 IS A VERDICT LINE, DELIBERATELY NOT A UI — the full daily-alert surface is its own queued 9/30 item.
//
// USAGE: node scripts/check-walk-liveness.mjs [--guard]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// ── PURE CORE — driven by the guard with no DB ──────────────────────────────────────────────────────────
export function decideWalkLiveness(a) {
  const { fires, publishedTotal, rowsWritten24h, advancedTotal, latestCompletedRefusals, scannedLatest } = a
  if (fires === 0) {
    return { ok: false, state: 'NO-FIRES', reason: 'ZERO resumer fires recorded in the trailing 24h while the cron entry exists — the scheduler lane itself is dead (or the heartbeat write is failing on every fire, which is the same emergency).' }
  }
  if (publishedTotal > 0 || rowsWritten24h > 0) {
    return { ok: true, state: 'ALIVE', reason: `walk alive — ${publishedTotal} message(s) published, ${rowsWritten24h} row(s) written in 24h across ${fires} fire(s).` }
  }
  const floorReached = latestCompletedRefusals?.['floor-reached'] ?? 0
  if (scannedLatest > 0 && floorReached === scannedLatest) {
    return { ok: true, state: 'DONE', reason: `walk at its TERMINAL state — the latest completed fire refused all ${scannedLatest} scanned surface(s) with 'floor-reached': every one has walked to its resolved stop. This is completion, not a wedge.` }
  }
  if (advancedTotal > 0) {
    return { ok: true, state: 'ADVANCING', reason: `walk crossing covered ground — ${advancedTotal} covered-skip advance(s) in 24h (0 vendor ops each), nothing published yet. Descent resumes when a surface reaches owed ground.` }
  }
  return {
    ok: false, state: 'WEDGED',
    reason: `WEDGE SIGNAL — ${fires} fire(s) in 24h, published=0, rows_written=0, advanced=0, and the latest fire's refusals are NOT all 'floor-reached' (${JSON.stringify(latestCompletedRefusals ?? {})}). Fires that decide nothing, hourly, is ★WALK-WEDGES-AT-COVERED-GROUND's shape — investigate the refusal histogram before the walk loses another day.`,
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
  const fires = await get(`universe_fire_log?select=fired_at,fire_outcome,scanned,published,advanced,refusals,dry_run&fired_at=gte.${encodeURIComponent(since)}&order=fired_at.desc&limit=200`)
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

  const verdict = decideWalkLiveness({
    fires: wet.length,
    publishedTotal: wet.reduce((s, f) => s + Number(f.published ?? 0), 0),
    rowsWritten24h,
    advancedTotal: wet.reduce((s, f) => s + Number(f.advanced ?? 0), 0),
    latestCompletedRefusals: latestCompleted?.refusals ?? null,
    scannedLatest: Number(latestCompleted?.scanned ?? 0),
  })
  console.log(`[walk-liveness] 24h: fires=${wet.length} published=${verdict.state === 'ALIVE' ? 'yes' : wet.reduce((s, f) => s + Number(f.published ?? 0), 0)} rows=${rowsWritten24h} advanced=${wet.reduce((s, f) => s + Number(f.advanced ?? 0), 0)} · state=${verdict.state}`)
  if (!verdict.ok) { console.error(`✗ WALK-LIVENESS FAILED — ${verdict.reason}`); process.exitCode = 1; return }
  console.log(`✓ walk-liveness OK — ${verdict.reason}`)
}

// Import-safe: the guard imports decideWalkLiveness without running the live read.
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) await main()
