// LORAMER_RUN_PUMP_V1 — THE PUMP. Vercel's cron invokes this every minute (platform → function, depth 0). It claims
// ONE active run and steps it inside this invocation until the run ends, another pump wins the lane, or the deadline
// reserve is reached; the next minute's invocation resumes. NOTHING here makes an HTTP request: the fire is the existing
// `/api/cron/universe-resume` handler, called IN-PROCESS (universe-run-fire.ts) — a fetch of this deployment's own URL
// from a cron-invoked function is answered by Vercel Authentication's login page, not by the fire
// (LORAMER_NO_HTTP_TO_SELF_V1, measured 2026-09-17). universe-run-pump.ts holds the loop and the reason a self-kicked chain cannot exist on Vercel (508 at
// the fourth hop, measured 2026-09-17).
//
// ⛔ QUIET WHEN THERE IS NOTHING TO PUMP. With no run in `running`/`stopping`, this returns in one read — 1,440 such
// invocations a day cost one small query each and nothing else. A run started by `?action=start` on the run route is
// picked up by the next minute.
// ⛔ ONE LANE PER INVOCATION. Several active runs are served by several invocations: each minute's pump takes the run
// with the oldest last_step_at that is not being advanced by another pump; two pumps on one lane are settled by the
// step's compare-and-set (the loser exits). "Many customers pressing Backfill at once is a future concern. Build for
// one now." (LORAMER_MAP §7.)
// ⛔ AUTH IS THE CRON SECRET, like every cron route here: `Bearer $CRON_SECRET` or 401.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { pumpLane } from '@/lib/backfill/universe-run-pump'
import { runOneStep } from '@/lib/backfill/universe-run-step'
import { inProcessFire } from '@/lib/backfill/universe-run-fire'
import { CONSUMER_MAX_DURATION_S } from '@/lib/backfill/universe-v2-contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store' // the in-process fire reads google_tokens; a cached read of a credential is the 2026-07-30 class

// ⛔ DERIVED, NOT CHOSEN. A step awaits a fire whose own ceiling is CONSUMER_MAX_DURATION_S (300 s); 800 s is the
// generally available Pro maximum, the same headroom the run route used (~3.8× the worst observed step).
export const maxDuration = 800
/** No step starts unless this much of the invocation remains: the fire's ceiling plus the step's own bookkeeping. */
const STEP_RESERVE_MS = (CONSUMER_MAX_DURATION_S + 20) * 1000

const auth = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  return !!secret && got === secret
}

export async function GET(request: Request) {
  if (!auth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const startedAt = Date.now()
  const deadlineMs = startedAt + maxDuration * 1000
  const secret = process.env.CRON_SECRET!

  // The lane with the oldest last step wins the minute; a lane another pump is advancing loses the CAS on its
  // first step here and this invocation exits — cheap, and never two pumps on one lane.
  // A lane stepped inside the last reserve window is being advanced by another pump and is SKIPPED here rather than
  // raced: the first cut picked it anyway and lost the CAS after wasting a fire (measured 20:32Z: "step 26: another
  // pump owns this lane"). The CAS stays as the second lock.
  // Busy = TOUCHED inside the reserve window: a step claims the lane by writing updated_at at its START (a lane whose
  // first step is in flight has no last_step_at yet — that is how the second minute's pump fired into the lease).
  const busyAfter = new Date(startedAt - STEP_RESERVE_MS).toISOString()
  const { data: runs, error } = await supabaseAdmin.from('universe_run')
    .select('client_id, vendor, status, steps, last_step_at, updated_at')
    .in('status', ['running', 'stopping'])
    .lt('updated_at', busyAfter)
    .order('last_step_at', { ascending: true, nullsFirst: true })
    .limit(1)
  if (error) return NextResponse.json({ ok: false, error: `active-run read failed: ${error.message}` }, { status: 500 })
  const lane = (runs ?? [])[0] as { client_id: string; vendor: string; status: string; steps: number } | undefined
  if (!lane) return NextResponse.json({ ok: true, pumped: false, reason: 'no active run (or every active lane is being stepped by another pump) — nothing to pump' })

  const outcome = await pumpLane({
    step: () => runOneStep({ clientId: lane.client_id, vendor: lane.vendor, fire: () => inProcessFire(lane.client_id, secret) }),
    now: () => Date.now(),
    deadlineMs,
    reserveMs: STEP_RESERVE_MS,
    log: (l) => console.log(l),
  })
  return NextResponse.json({
    ok: true, pumped: true, clientId: lane.client_id, vendor: lane.vendor,
    stepsThisInvocation: outcome.steps, stoppedBecause: outcome.stoppedBecause, status: outcome.status, reason: outcome.reason,
    elapsedMs: Date.now() - startedAt, reserveMs: STEP_RESERVE_MS,
  })
}
