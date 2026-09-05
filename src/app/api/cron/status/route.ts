// LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1)
// Read-side verdicts over cron_runs. CRON_SECRET-authed (like the other cron routes).
// For each (mode, platform) it reads the TRAILING WINDOW of fires and classifies it. This is the durable
// answer to "did each platform's cron complete its most recent expected run?" — the inference
// the maxDuration kill forces (the dying function can't self-report; we read started-vs-finished).
// WS1b-2 (deferred) turns these verdicts into a real alert channel + optional monitor cron.
//
// LORAMER_FORWARD_LANE_HYGIENE_V1 — THE LATEST FIRE IS AN ADJACENT NUMBER. This route used to read ONE row per
// (mode, platform) — the newest — and on 2026-09-05 the newest google forward fire was a 10:58Z no-op that ran
// 110 minutes after three earlier fires had been killed at maxDuration while writing 11 of 18 account rows. The
// route read 'healthy'. A killed fire can only ever be seen by looking at EVERY fire in the window, and it is
// its own verdict — 'killed' — distinct from 'running' (unfinished, inside the ceiling) and from a fire that
// finished with errors ('degraded'). 'healthy' is reserved for a window with no kill in it.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { CRON_PLATFORMS } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

const MODES = ['forward', 'catchup'] as const
const FRESH_WINDOW_HOURS = 26 // expected nightly cadence; no fire inside this window = "didn't fire this window"
// The ceiling each route runs under — the value each route EXPORTS as maxDuration (cron/sync/route.ts and
// cron/catchup/route.ts). Pinned equal by tests/guards/cron-runs-progress-on-kill.guard.mjs leg (e), so a
// maxDuration change that leaves this map behind fails the build instead of mis-classifying kills.
const ROUTE_MAX_DURATION_S: Record<(typeof MODES)[number], number> = { forward: 800, catchup: 800 }
const KILL_GRACE_S = 60 // an unfinished fire older than maxDuration + this is a kill, not a run in flight

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowMs = Date.now()
  const sinceIso = new Date(nowMs - FRESH_WINDOW_HOURS * 3_600_000).toISOString()
  const runs: Record<string, unknown>[] = []

  for (const mode of MODES) {
    for (const platform of CRON_PLATFORMS) {
      const { data, error } = await supabaseAdmin
        .from('cron_runs')
        .select(
          'started_at, finished_at, error_count, connections_attempted, connections_succeeded, connections_errored, rows_written, accounts_with_gaps, days_filled, trigger_source, target_date, window_start, window_end'
        )
        .eq('mode', mode)
        .eq('platform', platform)
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
        .limit(200)

      if (error) {
        runs.push({ mode, platform, verdict: 'error', detail: error.message })
        continue
      }
      const fires = data ?? []
      if (fires.length === 0) {
        runs.push({ mode, platform, verdict: 'never-fired', startedAt: null, firesInWindow: 0 })
        continue
      }

      const latest = fires[0]
      const ageMs = nowMs - new Date(latest.started_at as string).getTime()
      const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10
      const ceilingMs = (ROUTE_MAX_DURATION_S[mode] + KILL_GRACE_S) * 1000
      // A fire that never stamped finished_at and is older than its ceiling was killed by the platform. Its
      // progress row (LORAMER_FORWARD_LANE_HYGIENE_V1, progressCronRun) carries the work it did before the kill.
      const killed = fires.filter(
        (f) => f.finished_at == null && nowMs - new Date(f.started_at as string).getTime() > ceilingMs
      )
      const errorCount = (latest.error_count as number) ?? 0

      let verdict: string
      if (killed.length > 0) {
        verdict = 'killed'
      } else if (latest.finished_at == null) {
        verdict = 'running' // unfinished and inside its ceiling — transient by construction
      } else if (errorCount > 0) {
        verdict = 'degraded'
      } else {
        verdict = 'healthy'
      }

      runs.push({
        mode,
        platform,
        verdict,
        ageHours,
        firesInWindow: fires.length,
        killedFires: killed.map((f) => ({
          startedAt: f.started_at,
          connectionsAttempted: f.connections_attempted,
          rowsWritten: f.rows_written,
          errorCount: f.error_count,
        })),
        startedAt: latest.started_at,
        finishedAt: latest.finished_at,
        trigger: latest.trigger_source,
        errorCount,
        connectionsAttempted: latest.connections_attempted,
        connectionsSucceeded: latest.connections_succeeded,
        connectionsErrored: latest.connections_errored,
        rowsWritten: latest.rows_written,
        ...(mode === 'catchup'
          ? { accountsWithGaps: latest.accounts_with_gaps, daysFilled: latest.days_filled }
          : { targetDate: latest.target_date }),
        ...(mode === 'catchup' ? { windowStart: latest.window_start, windowEnd: latest.window_end } : {}),
      })
    }
  }

  // "running" is transient/expected; everything else off-healthy is actionable — a 'killed' most of all.
  const unhealthy = runs.filter(r => r.verdict !== 'healthy' && r.verdict !== 'running')

  return NextResponse.json({
    checkedAt: new Date(nowMs).toISOString(),
    freshWindowHours: FRESH_WINDOW_HOURS,
    routeMaxDurationS: ROUTE_MAX_DURATION_S,
    allHealthy: unhealthy.length === 0,
    unhealthy: unhealthy.map(r => `${r.mode}:${r.platform}=${r.verdict}`),
    runs,
  })
}
