// LORAMER_RUN_PUMP_V1 — THE PUMP. Vercel's cron invokes this every minute (platform → function, depth 0). It claims
// ONE active run and steps it inside this invocation until the run ends, another pump wins the lane, or the deadline
// reserve is reached; the next minute's invocation resumes. Nothing here requests our own deployment except the fire,
// which is the existing `/api/cron/universe-resume` and is reached at depth 1 by every step — the shape the driver has
// always used. universe-run-pump.ts holds the loop and the reason a self-kicked chain cannot exist on Vercel (508 at
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
import { CONSUMER_MAX_DURATION_S } from '@/lib/backfill/universe-v2-contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const origin = new URL(request.url).origin
  const secret = process.env.CRON_SECRET!

  // The lane with the oldest last step wins the minute; a lane another pump is advancing loses the CAS on its
  // first step here and this invocation exits — cheap, and never two pumps on one lane.
  const { data: runs, error } = await supabaseAdmin.from('universe_run')
    .select('client_id, vendor, status, steps, last_step_at')
    .in('status', ['running', 'stopping'])
    .order('last_step_at', { ascending: true, nullsFirst: true })
    .limit(1)
  if (error) return NextResponse.json({ ok: false, error: `active-run read failed: ${error.message}` }, { status: 500 })
  const lane = (runs ?? [])[0] as { client_id: string; vendor: string; status: string; steps: number } | undefined
  if (!lane) return NextResponse.json({ ok: true, pumped: false, reason: 'no active run — nothing to pump' })

  const outcome = await pumpLane({
    step: () => runOneStep({ clientId: lane.client_id, vendor: lane.vendor, origin, secret }),
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
