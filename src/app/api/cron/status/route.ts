// LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1)
// Read-side verdicts over cron_runs. CRON_SECRET-authed (like the other cron routes).
// For each (mode, platform) it reads the latest row and classifies it. This is the durable
// answer to "did each platform's cron complete its most recent expected run?" — the inference
// the maxDuration kill forces (the dying function can't self-report; we read started-vs-finished).
// WS1b-2 (deferred) turns these verdicts into a real alert channel + optional monitor cron.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { CRON_PLATFORMS } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

const MODES = ['forward', 'catchup'] as const
const FRESH_WINDOW_HOURS = 26 // expected nightly cadence; older latest run = "didn't fire this window"
const RUNNING_GRACE_MIN = 6 // > maxDuration (300s); finished_at NULL within this = likely still running

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
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        runs.push({ mode, platform, verdict: 'error', detail: error.message })
        continue
      }
      if (!data) {
        runs.push({ mode, platform, verdict: 'never-fired', startedAt: null })
        continue
      }

      const ageMs = nowMs - new Date(data.started_at as string).getTime()
      const ageMinutes = ageMs / 60_000
      const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10
      const finished = data.finished_at != null
      const errorCount = (data.error_count as number) ?? 0

      let verdict: string
      if (ageHours > FRESH_WINDOW_HOURS) {
        verdict = 'never-fired' // no run within the expected window — last seen older than 26h
      } else if (!finished) {
        verdict = ageMinutes <= RUNNING_GRACE_MIN ? 'running' : 'crashed-or-timed-out'
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
        startedAt: data.started_at,
        finishedAt: data.finished_at,
        trigger: data.trigger_source,
        errorCount,
        connectionsAttempted: data.connections_attempted,
        connectionsSucceeded: data.connections_succeeded,
        connectionsErrored: data.connections_errored,
        rowsWritten: data.rows_written,
        ...(mode === 'catchup'
          ? { accountsWithGaps: data.accounts_with_gaps, daysFilled: data.days_filled }
          : { targetDate: data.target_date }),
        ...(mode === 'catchup' ? { windowStart: data.window_start, windowEnd: data.window_end } : {}),
      })
    }
  }

  // "running" is transient/expected; everything else off-healthy is actionable.
  const unhealthy = runs.filter(r => r.verdict !== 'healthy' && r.verdict !== 'running')

  return NextResponse.json({
    checkedAt: new Date(nowMs).toISOString(),
    freshWindowHours: FRESH_WINDOW_HOURS,
    allHealthy: unhealthy.length === 0,
    unhealthy: unhealthy.map(r => `${r.mode}:${r.platform}=${r.verdict}`),
    runs,
  })
}
