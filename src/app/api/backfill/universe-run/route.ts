// LORAMER_CONTINUOUS_RUN_V1 — THE RUN ROUTE: start, stop, status, and one operator step. A run for ONE (client, vendor).
//
// ⛔ IT ORCHESTRATES; IT DOES NOT CAPTURE. Every step is the EXISTING fire (`/api/cron/universe-resume`
// ?clientId=&dryRun=0), unchanged, reached server-side with the CRON_SECRET kick (universe-run-step.ts). This file
// owns exactly three things the fire cannot: whether a RUN is in progress, its counters, and why it stopped.
//
// ⛔ WHAT MAKES IT CONTINUOUS — LORAMER_RUN_PUMP_V1. Steps are chained by the PUMP (`/api/cron/universe-run-pump`,
// invoked by Vercel's cron every minute), which runs step after step inside ONE invocation with no delay between
// them. This route never kicks itself: the first cut chained through waitUntil(fetch(own route)) and Vercel's loop
// detector refused the fourth hop with HTTP 508 INFINITE_LOOP_DETECTED (measured 2026-09-17). `action=start` only
// writes the run row; the next minute's pump picks it up.
//
// ⛔ PROGRESS IS DAYS NO LONGER OWED under the ledger's own spelling (LORAMER_RUN_PROGRESS_SIGNAL_V1); the stop limits
// are time (LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1); both live in universe-run-step.ts beside the step that uses them.
// ⛔ ONE RUN PER LANE, ENFORCED TWICE: the fire lease and the step's compare-and-set on the run's step counter.
// ⛔ NOTHING HERE NAMES A PLATFORM. The lane is (clientId, vendor) and the vendor arrives as a parameter;
// `continuous-run.guard.mjs` fails the build if a platform literal appears.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { NO_PROGRESS_WINDOW_MS, RUN_CEILING_MS } from '@/lib/backfill/continuous-run'
import { runOneStep } from '@/lib/backfill/universe-run-step'
import { inProcessFire } from '@/lib/backfill/universe-run-fire'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store' // the in-process fire reads google_tokens; a cached read of a credential is the 2026-07-30 class

// ⛔ DERIVED, NOT CHOSEN. This route AWAITS a step, and a step is the fire, whose own ceiling is
// CONSUMER_MAX_DURATION_S = 300 s. The orchestrator must outlive the thing it waits on or it would be killed
// holding a finished step's result and the chain would break at exactly the moment it did the most work.
// 800 s is the GENERALLY AVAILABLE Pro maximum (Vercel's duration table: Pro default 300, maximum 800,
// extended 1800 in beta) — deliberately NOT the 1800 beta, because the chain needs headroom over 300, not a
// beta surface. Measured this session: a fire runs 27-213 s, so 800 is ~3.8x the worst observed step.
export const maxDuration = 800

const auth = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  return !!secret && got === secret
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
      last_invocation: null, // no claim: the next minute's pump may take the lane at once
    }, { onConflict: 'client_id,vendor' })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    // ⛔ NO KICK. The pump (cron, every minute) picks this run up; a request from here to our own deployment is the
    // chain Vercel refuses at the fourth hop.
    return NextResponse.json({ ok: true, started: true, clientId, vendor, pumpedBy: '/api/cron/universe-run-pump (next minute)' })
  }

  if (action !== 'step') return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 })

  // ── STEP — ONE step, for an operator. The pump is what chains steps; this never kicks anything. ───────
  const secret = process.env.CRON_SECRET!
  const rep = await runOneStep({ clientId, vendor, fire: () => inProcessFire(clientId, secret) })
  if (rep.noRun) return NextResponse.json({ ok: false, reason: 'no run for this lane' }, { status: 404 })
  return NextResponse.json({
    ok: true, clientId, vendor, step: rep.step, stepMs: rep.stepMs, scanMs: rep.scanMs,
    daysNoLongerOwed: rep.daysNoLongerOwed, requestsOpened: rep.requestsOpened, atFloor: rep.atFloor,
    chained: rep.chained, status: rep.status, reason: rep.reason, casLost: rep.casLost,
    bounds: { noProgressWindowMs: NO_PROGRESS_WINDOW_MS, runCeilingMs: RUN_CEILING_MS },
  })
}
