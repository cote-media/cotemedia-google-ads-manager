#!/usr/bin/env node
// LORAMER_SINGLE_SURFACE_DRIVE_V1 — THE OPERATOR'S LOOP. One surface, pass by pass, to its floor.
//
// ⛔ THE DRIVER OWNS THE LOOP (June, BackfillControl.tsx:64-86). This script publishes ONE window via
// /api/backfill/universe-drive, WAITS for the consumer to record a finished attempt, RE-READS the frontier
// from the append-only log, and only then decides whether to go again. The route has no loop; the walk has
// no idea it is being driven. Nothing here is a shortcut past the real path.
//
// ⛔ THE HALT PREDICATE IS THE DIRECTION OF THE FRONTIER, NEVER ROWS OR STEP SIZE. An empty window recedes on
// ONE clean pass — outcome 'zero'/'nongrain' attests the days, the window owes nothing, the anchor drops a
// full sizing span. A BIG JUMP WITH ZERO ROWS IS CORRECT PROGRESS. What is a stall is a COMPLETED pass after
// which the deepest window asked did not move.
//
// USAGE: DRIVE_URL=https://app.loramer.com/api/backfill/universe-drive node scripts/drive-one-surface.mjs
// READ-ONLY LOCALLY; the WORK is real — the consumer writes real rows through the real writer.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CLIENT_ID = '957d484e-d0c4-4dd0-b382-d8499d556252'
const VENDOR = 'google'
const RESOURCE = 'campaign_search_term_view'
const SEGMENT = 'segments.device'
const FLOOR = '2022-03-04'

const PASS_CAP = Number(process.env.DRIVE_PASS_CAP ?? 120)
const REQUEST_CAP = Number(process.env.DRIVE_REQUEST_CAP ?? 400)
const PASS_TIMEOUT_MS = 180_000
const RUN_ID = process.env.DRIVE_RUN_ID || `drive-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`

try {
  for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
  }
} catch {}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRIVE_URL = process.env.DRIVE_URL, SECRET = (process.env.CRON_SECRET ?? '').trim()
if (!SB || !K || !DRIVE_URL || !SECRET) {
  console.error('[drive] CANNOT RUN — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRIVE_URL, CRON_SECRET.')
  process.exitCode = 2
}

const q = async (p) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
  if (r.status !== 200) throw new Error(`read HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return r.json()
}
const enc = encodeURIComponent
const SURF = `client_id=eq.${CLIENT_ID}&vendor=eq.${VENDOR}&resource=eq.${RESOURCE}&segment=eq.${enc(SEGMENT)}`

// THE FRONTIER = the deepest window this surface has ever been ASKED for. It lives in the append-only log,
// it only ever decreases, and it is the number Russ watches march.
const frontier = async () => {
  const rows = await q(`universe_attempt_log?select=window_start&${SURF}&phase=eq.attempt_started&window_start=gt.2000-01-01&order=window_start.asc&limit=1`)
  return rows[0]?.window_start ?? null
}
const lastFinishedAt = async () => {
  const rows = await q(`universe_attempt_log?select=recorded_at&${SURF}&phase=eq.attempt_finished&order=recorded_at.desc&limit=1`)
  return rows[0]?.recorded_at ?? '1970-01-01T00:00:00Z'
}

let requests = 0, pass = 0
let prev = await frontier()
console.log(`[drive] START ${RESOURCE}/${SEGMENT} · frontier=${prev} · floor=${FLOOR} · runId=${RUN_ID}`)
console.log(`[drive] caps: ${PASS_CAP} passes · ${REQUEST_CAP} requests · pass timeout ${PASS_TIMEOUT_MS / 1000}s · halt on the first non-receding completed pass`)

for (pass = 1; pass <= PASS_CAP; pass++) {
  if (requests >= REQUEST_CAP) { console.log(`[drive] HALT — request cap ${REQUEST_CAP} reached.`); break }
  if (prev && prev <= FLOOR) { console.log(`[drive] ✅ PROVEN — frontier ${prev} reached the floor ${FLOOR} in ${pass - 1} pass(es), ${requests} request(s).`); break }

  const since = await lastFinishedAt()
  let pub
  try {
    const r = await fetch(`${DRIVE_URL}?clientId=${CLIENT_ID}&resource=${RESOURCE}&segment=${enc(SEGMENT)}&runId=${RUN_ID}-${pass}&dryRun=0`,
      { headers: { Authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(PASS_TIMEOUT_MS) })
    pub = await r.json().catch(() => ({}))
    if (!r.ok) { console.log(`[drive] HALT — publish HTTP ${r.status}: ${JSON.stringify(pub).slice(0, 200)}`); break }
  } catch (e) {
    console.log(`[drive] HALT — publish threw: ${String(e?.message ?? e)}`); break
  }
  if (pub.floorReached) { console.log(`[drive] ✅ PROVEN — the route reports the floor: ${pub.reason}`); break }
  if (pub.nothingOwed) { console.log(`[drive] pass ${pass}: window ${pub.window} owes nothing — no publish; the anchor recedes on the next derivation.`); prev = await frontier(); continue }
  if (!pub.published) { console.log(`[drive] HALT — route published nothing and gave no reason: ${JSON.stringify(pub).slice(0, 240)}`); break }

  // WAIT FOR THE PASS TO LAND — a NEW attempt_finished for this surface, or timeout.
  const deadline = Date.now() + PASS_TIMEOUT_MS
  let finished = null
  while (Date.now() < deadline) {
    const rows = await q(`universe_attempt_log?select=recorded_at,outcome,rows_written,window_start,window_end&${SURF}&phase=eq.attempt_finished&recorded_at=gt.${enc(since)}&order=recorded_at.desc&limit=1`)
    if (rows[0]) { finished = rows[0]; break }
    await new Promise((r) => setTimeout(r, 4000))
  }
  if (!finished) { console.log(`[drive] HALT — pass ${pass} (window ${pub.window}) did not land within ${PASS_TIMEOUT_MS / 1000}s. A pass that never finishes is a halt, not a hang.`); break }
  requests += 1

  const now = await frontier()
  const receded = prev && now && now < prev
  console.log(`[drive] pass ${pass}: ${pub.window} · range ${finished.window_start}..${finished.window_end} · outcome=${finished.outcome} · rows=${finished.rows_written} · frontier ${prev} → ${now} ${receded ? '↓' : '= HELD'} · requests=${requests}`)

  if (String(finished.outcome) === 'error') {
    console.log(`[drive] ⛔ WALL/ERROR — pass ${pass} finished 'error' on ${finished.window_start}..${finished.window_end}. Halting rather than spending into it.`)
    break
  }
  if (!receded) {
    console.log(`[drive] ⛔ STALL — a COMPLETED pass (outcome=${finished.outcome}, rows=${finished.rows_written}) over ${finished.window_start}..${finished.window_end} left the frontier at ${now}. THIS IS THE NEXT DEFECT. Halting for diagnosis.`)
    break
  }
  prev = now
  if (pass % 10 === 0) console.log(`[drive] ── progress: frontier ${now} · ${pass} passes · ${requests} requests · ${REQUEST_CAP - requests} left in budget`)
}
console.log(`[drive] END — frontier ${await frontier()} · ${requests} vendor request(s) spent.`)
