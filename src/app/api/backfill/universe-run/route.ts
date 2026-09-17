// LORAMER_CONTINUOUS_RUN_V1 — THE ORCHESTRATOR. A run for ONE (client, vendor) that steps until the floor.
//
// ⛔ IT ORCHESTRATES; IT DOES NOT CAPTURE. Every step is the EXISTING fire (`/api/cron/universe-resume`
// ?clientId=&dryRun=0), unchanged, called server-side with the same CRON_SECRET kick this repo already uses in
// `kickoffWalk`. Re-implementing the fire here would fork the engine and orphan ~193 guards written against
// its shape. This file owns exactly three things the fire cannot: whether a RUN is in progress, whether the
// next step follows immediately, and why it stopped.
//
// ⛔ WHAT MAKES IT CONTINUOUS: the next step is invoked the moment the last one returns, with no cron wait and
// no rotation turn. Round 8 measured the cost of the old regime — 17 fires per client per day, average gap
// 85.3 minutes, each fire ~90 s of a 300 s ceiling, so the lane sat idle for most of every slot.
//
// ⛔ PROGRESS IS DAYS NO LONGER OWED, COUNTED FROM `universe_attempt_log` (day_committed rows + attesting-lane
// zero|nongrain terminals), NOT FROM THE STEP'S OWN REPORT. That is the CONSUMER-side fact — ground actually gained
// — and choosing it is LORAMER_ADJACENT_NUMBER_V1 applied on purpose: `published` is the producer's count and is
// exactly the number `check-walk-liveness` read while the consumer had been dead for eleven hours. A run must never
// chain on "I sent something". And it is read under the LEDGER's spelling of the vendor (ledgerVendorFor), never
// the run's — LORAMER_RUN_PROGRESS_SIGNAL_V1, the Tri-Copy false stop.
//
// ⛔ ONE RUN PER LANE, ENFORCED TWICE. The fire lease (migration 085) already stops two FIRES of a lane
// overlapping; this route adds a compare-and-set on the run's own step counter, so two chains that somehow
// both believe they are the run cannot both advance it — the loser exits without chaining rather than racing.
//
// ⛔ NOTHING HERE NAMES A PLATFORM. The lane is (clientId, vendor) and the vendor arrives as a parameter;
// `continuous-run-neutral.guard.mjs` fails the build if a platform literal appears. Google is the only vendor
// wired to it today because it is the only one with an adapter, which is Round 1's finding, not a rule here.
import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase'
import { decideChain, applyStep, heldFromFireBody, NO_PROGRESS_WINDOW_MS, RUN_CEILING_MS, type StepOutcome, type RunState } from '@/lib/backfill/continuous-run'
import { daysNoLongerOwedSince, askingWithoutProgressSince } from '@/lib/backfill/universe-coverage'
import { ledgerVendorFor } from '@/lib/backfill/universe-vendor-spelling'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⛔ DERIVED, NOT CHOSEN. This route AWAITS a step, and a step is the fire, whose own ceiling is
// CONSUMER_MAX_DURATION_S = 300 s. The orchestrator must outlive the thing it waits on or it would be killed
// holding a finished step's result and the chain would break at exactly the moment it did the most work.
// 800 s is the GENERALLY AVAILABLE Pro maximum (Vercel's duration table: Pro default 300, maximum 800,
// extended 1800 in beta) — deliberately NOT the 1800 beta, because the chain needs headroom over 300, not a
// beta surface. Measured this session: a fire runs 27-213 s, so 800 is ~3.8x the worst observed step.
export const maxDuration = 800

type RunRow = {
  status: 'running' | 'stopping' | 'done' | 'failed'
  started_at: string
  steps: number
  requests_opened: number
  days_committed: number
  steps_without_progress: number
}

const auth = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  return !!secret && got === secret
}

/**
 * Count the ground this step actually gained: DAYS NO LONGER OWED, from the consumer's own ledger, read under the
 * ledger's own spelling (LORAMER_RUN_PROGRESS_SIGNAL_V1 — the rule and the reader live in universe-coverage.ts, beside
 * the owed-set derivation they must agree with). -1 means UNREADABLE, and an unreadable read is not zero progress.
 */
async function daysNoLongerOwedThisStep(clientId: string, vendor: string, sinceIso: string): Promise<number> {
  try {
    return await daysNoLongerOwedSince({ clientId, vendor: ledgerVendorFor(vendor) }, sinceIso)
  } catch (e: any) {
    // ⚠ UNREADABLE PROGRESS IS NOT ZERO PROGRESS. Returning 0 would let a broken read end a healthy run
    // through the no-progress bound; returning -1 tells the caller it does not know, and the caller chains.
    console.error(`[universe-run] progress unreadable for ${clientId}: ${e?.message ?? e}`)
    return -1
  }
}

export async function GET(request: Request) {
  if (!auth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId') || ''
  // ⛔ THE VENDOR IS THE CAPTURE UNIVERSE'S NAME, NOT THE COMPANY'S
  // (LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1). It arrives as a parameter and is never defaulted to a
  // literal here — a default would be this file knowing which vendor it serves.
  const vendor = url.searchParams.get('vendor') || ''
  const action = url.searchParams.get('action') || 'status'
  if (!clientId || !vendor) return NextResponse.json({ error: 'clientId and vendor are required' }, { status: 400 })

  const origin = new URL(request.url).origin
  const secret = process.env.CRON_SECRET!

  // ── STATUS — what build 3b's per-platform button reads ────────────────────────────────────────────
  if (action === 'status') {
    const { data } = await supabaseAdmin.from('universe_run').select('*').eq('client_id', clientId).eq('vendor', vendor).maybeSingle()
    return NextResponse.json({ ok: true, run: data ?? null })
  }

  // ── STOP — cooperative. The step already running finishes; nothing is killed mid-work. ─────────────
  if (action === 'stop') {
    const { error } = await supabaseAdmin.from('universe_run')
      .update({ status: 'stopping', updated_at: new Date().toISOString() })
      .eq('client_id', clientId).eq('vendor', vendor).eq('status', 'running')
    return NextResponse.json({ ok: !error, error: error?.message ?? null })
  }

  // ── START — reset the lane's run and kick the first step ──────────────────────────────────────────
  if (action === 'start') {
    const nowIso = new Date().toISOString()
    const { error } = await supabaseAdmin.from('universe_run').upsert({
      client_id: clientId, vendor, status: 'running', started_at: nowIso, updated_at: nowIso,
      finished_at: null, steps: 0, requests_opened: 0, days_committed: 0, steps_without_progress: 0,
      stop_reason: null, last_step_at: null,
    }, { onConflict: 'client_id,vendor' })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    waitUntil(fetch(`${origin}/api/backfill/universe-run?action=step&clientId=${encodeURIComponent(clientId)}&vendor=${encodeURIComponent(vendor)}`,
      { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) }).catch(() => {}))
    return NextResponse.json({ ok: true, started: true, clientId, vendor })
  }

  if (action !== 'step') return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 })

  // ── STEP ──────────────────────────────────────────────────────────────────────────────────────────
  const { data: row } = await supabaseAdmin.from('universe_run')
    .select('status, started_at, steps, requests_opened, days_committed, steps_without_progress')
    .eq('client_id', clientId).eq('vendor', vendor).maybeSingle()
  const run = row as RunRow | null
  if (!run) return NextResponse.json({ ok: false, reason: 'no run for this lane' }, { status: 404 })
  if (run.status === 'done' || run.status === 'failed') {
    return NextResponse.json({ ok: true, chained: false, reason: `run is already ${run.status}` })
  }

  const stepStartedAt = new Date().toISOString()
  const t0 = Date.now()
  const invocation = `${t0}-${Math.random().toString(36).slice(2, 8)}`

  // THE STEP IS THE EXISTING FIRE, UNCHANGED.
  let body: any = null
  let fatal: string | null = null
  try {
    const r = await fetch(`${origin}/api/cron/universe-resume?clientId=${encodeURIComponent(clientId)}&dryRun=0`,
      { headers: { Authorization: `Bearer ${secret}` } })
    body = await r.json().catch(() => null)
    if (!r.ok) fatal = `step returned HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`
  } catch (e: any) {
    fatal = `step threw: ${e?.message ?? e}`
  }
  const stepMs = Date.now() - t0

  const committed = fatal ? 0 : await daysNoLongerOwedThisStep(clientId, vendor, stepStartedAt)
  const inst = body?.instrument ?? {}
  // ⛔ AT FLOOR = NOTHING OWED ON ANY LANE. All three slots must be empty; one empty slot is a lane that had
  // nothing this step, which is not the same as a lane with nothing left.
  const atFloor = !fatal && body?.ok === true
    && (inst.candidates ?? 0) === 0 && (inst.lookbackCandidates ?? 0) === 0 && (inst.missedCandidates ?? 0) === 0
  const out: StepOutcome = {
    requestsOpened: Number(inst.requestsSelected ?? 0),
    // -1 means UNREADABLE, and an unreadable progress read must not be counted as no progress.
    daysNoLongerOwed: committed < 0 ? 1 : committed,
    atFloor,
    held: heldFromFireBody(body),
    fatal,
  }

  // LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1 — both clocks are wall time: the ceiling from the run row's started_at,
  // the asking clock from the ledger (first unanswered ask after the last progress). An unreadable asking clock
  // reads as null (no clock), which chains — a broken read must not end a healthy run.
  let askingWithoutProgressMs: number | null = null
  try {
    const clock = await askingWithoutProgressSince({ clientId, vendor: ledgerVendorFor(vendor) }, run.started_at)
    askingWithoutProgressMs = clock.askingSince ? Math.max(0, Date.now() - Date.parse(clock.askingSince)) : null
  } catch (e: any) {
    console.error(`[universe-run] asking clock unreadable for ${clientId}: ${e?.message ?? e} — treating as no clock`)
  }
  const state: RunState = {
    status: run.status, steps: run.steps, stepsWithoutProgress: run.steps_without_progress,
    runElapsedMs: Math.max(0, Date.now() - Date.parse(run.started_at)),
    askingWithoutProgressMs,
  }
  const next = applyStep(state, out)
  const verdict = decideChain(state, out)

  // ⛔ COMPARE-AND-SET ON `steps`. If another chain advanced this run while we were stepping, our update
  // matches zero rows and we exit WITHOUT chaining — two chains cannot both drive one lane.
  const { data: updated, error: updErr } = await supabaseAdmin.from('universe_run')
    .update({
      status: verdict.chain ? run.status : verdict.status,
      steps: next.steps,
      steps_without_progress: next.stepsWithoutProgress,
      requests_opened: run.requests_opened + out.requestsOpened,
      // ⚠ COLUMN NAME OUTLIVES ITS MEANING: `days_committed` now holds DAYS NO LONGER OWED (migration 096 predates
      // LORAMER_RUN_PROGRESS_SIGNAL_V1). Renaming it is a migration and is not this round's; the JSON below is honest.
      days_committed: run.days_committed + Math.max(0, committed),
      updated_at: new Date().toISOString(),
      last_step_at: new Date().toISOString(),
      last_invocation: invocation,
      ...(verdict.chain ? {} : { finished_at: new Date().toISOString(), stop_reason: verdict.reason }),
    })
    .eq('client_id', clientId).eq('vendor', vendor).eq('steps', run.steps)
    .select('steps')
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: true, chained: false, reason: 'another chain advanced this run — exiting rather than racing it' })
  }

  if (verdict.chain) {
    // ⛔ NO DELAY. This is the whole point: the next step starts now, not on the next cron tick.
    waitUntil(fetch(`${origin}/api/backfill/universe-run?action=step&clientId=${encodeURIComponent(clientId)}&vendor=${encodeURIComponent(vendor)}`,
      { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) }).catch(() => {}))
  }

  console.log(`[universe-run] ${clientId}/${vendor} step ${next.steps}: ${stepMs}ms · scan ${inst.scanMs ?? '?'}ms · retired ${committed} owed day(s) · opened ${out.requestsOpened} · ${verdict.chain ? 'CHAINING' : `ENDED (${verdict.status})`} — ${verdict.reason}`)
  return NextResponse.json({
    ok: true, clientId, vendor, step: next.steps, stepMs,
    scanMs: inst.scanMs ?? null, fireElapsedMs: inst.elapsedMs ?? null,
    daysNoLongerOwed: committed, requestsOpened: out.requestsOpened, atFloor,
    chained: verdict.chain, status: verdict.chain ? run.status : verdict.status, reason: verdict.reason,
    bounds: { noProgressWindowMs: NO_PROGRESS_WINDOW_MS, runCeilingMs: RUN_CEILING_MS, runElapsedMs: state.runElapsedMs, askingWithoutProgressMs },
  })
}
