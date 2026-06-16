// LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1)
// Write helpers for the cron_runs completion sentinel (migration 011). Used by the forward
// (/api/cron/sync) and catchup (/api/cron/catchup) routes at INVOCATION grain — one started
// row per platform, finished_at stamped on clean exit. ALL writes here are best-effort and
// NEVER throw into the capture path (observability must not break data capture).

import { supabaseAdmin } from '@/lib/supabase'

export type CronMode = 'forward' | 'catchup'
export type CronTrigger = 'cron' | 'manual'

// Canonical platform order (matches the section order in both cron routes).
export const CRON_PLATFORMS = ['shopify', 'meta', 'google', 'woocommerce', 'ga'] as const
export type CronPlatform = (typeof CRON_PLATFORMS)[number]

// Vercel scheduled cron invocations always send user-agent 'vercel-cron/1.0' (confirmed in
// Vercel docs, /docs/cron-jobs). A manual curl with the CRON_SECRET does NOT, so this keeps a
// manual re-invoke from masquerading as the nightly signal.
export function detectTrigger(request: Request): CronTrigger {
  const ua = (request.headers.get('user-agent') ?? '').toLowerCase()
  return ua.includes('vercel-cron') ? 'cron' : 'manual'
}

// Resolve the ?platform= gate to the platforms this invocation will actually run.
// 'all' / no param → all five; a single known platform → just that one; anything else → none.
export function cronRunPlatforms(param: string): CronPlatform[] {
  if (param === 'all') return [...CRON_PLATFORMS]
  return (CRON_PLATFORMS as readonly string[]).includes(param) ? [param as CronPlatform] : []
}

// Insert a started row per platform BEFORE heavy work. Returns platform -> row id (null on
// failure, so finishCronRun can no-op). Never throws.
export async function startCronRuns(opts: {
  mode: CronMode
  platforms: CronPlatform[]
  trigger: CronTrigger
  targetDate?: string | null
  windowStart?: string | null
  windowEnd?: string | null
}): Promise<Record<string, number | null>> {
  const ids: Record<string, number | null> = {}
  for (const platform of opts.platforms) {
    try {
      const { data, error } = await supabaseAdmin
        .from('cron_runs')
        .insert({
          mode: opts.mode,
          platform,
          trigger_source: opts.trigger,
          target_date: opts.targetDate ?? null,
          window_start: opts.windowStart ?? null,
          window_end: opts.windowEnd ?? null,
        })
        .select('id')
        .single()
      ids[platform] = error ? null : (data?.id ?? null)
      if (error) {
        console.error(`[cron-runs] start insert FAILED mode=${opts.mode} platform=${platform}:`, error.message)
      }
    } catch (e) {
      ids[platform] = null
      console.error(`[cron-runs] start insert THREW mode=${opts.mode} platform=${platform}:`, e)
    }
  }
  return ids
}

// Stamp finished_at + tallies on a started row (clean-exit only). No-op on a null id. Never throws.
export async function finishCronRun(
  id: number | null,
  fields: {
    connectionsAttempted?: number
    connectionsSucceeded?: number
    connectionsErrored?: number
    accountsWithGaps?: number | null
    daysFilled?: number | null
    rowsWritten?: number
    errorCount?: number
  }
): Promise<void> {
  if (id == null) return
  try {
    const { error } = await supabaseAdmin
      .from('cron_runs')
      .update({
        finished_at: new Date().toISOString(),
        connections_attempted: fields.connectionsAttempted ?? 0,
        connections_succeeded: fields.connectionsSucceeded ?? 0,
        connections_errored: fields.connectionsErrored ?? 0,
        accounts_with_gaps: fields.accountsWithGaps ?? null,
        days_filled: fields.daysFilled ?? null,
        rows_written: fields.rowsWritten ?? 0,
        error_count: fields.errorCount ?? 0,
      })
      .eq('id', id)
    if (error) console.error(`[cron-runs] finish update FAILED id=${id}:`, error.message)
  } catch (e) {
    console.error(`[cron-runs] finish update THREW id=${id}:`, e)
  }
}
