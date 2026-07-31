// LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1)
// Write helpers for the cron_runs completion sentinel (migration 011). Used by the forward
// (/api/cron/sync) and catchup (/api/cron/catchup) routes at INVOCATION grain — one started
// row per platform, finished_at stamped on clean exit. ALL writes here are best-effort and
// NEVER throw into the capture path (observability must not break data capture).

import { supabaseAdmin } from '@/lib/supabase'

// LORAMER_GOOGLE_OP_BUDGET_LANE_ACCOUNTING_V2 — 'drain' added 2026-07-31.
// ⛔ A LANE THAT CAN REQUEST BUDGET BUT CANNOT RECORD SPEND MUST NOT EXIST. The drain calls
// getGoogleOpBudget('drain') and, until this change, wrote NO cron_runs rows — so its own spend was invisible
// to the counter and it was charged entirely for forward's and catchup's work (measured 2026-07-31: ~44,120
// estimated ops billed to a lane that had spent none of them).
// NO MIGRATION REQUIRED, verified against the live schema 2026-07-31: cron_runs.mode is plain `text` and the
// ONLY constraint on the table is cron_runs_pkey. The banked "avoid ... an enum migration" reason for skipping
// this wiring was FALSE. The one mode-filtered reader (/api/cron/status) iterates its own MODES list, so drain
// rows are additive and invisible to it until that list opts in.
export type CronMode = 'forward' | 'catchup' | 'drain'
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
    // LORAMER_CONNECTION_OUTCOME_LEDGER_V1 — the THIRD outcome. A connection that was attempted but neither
    // completed work nor recorded an error is SKIPPED. It used to be absorbed into succeeded, because
    // succeeded was `attempted - errored` and that arithmetic has no room for a third state.
    connectionsSkipped?: number
    accountsWithGaps?: number | null
    daysFilled?: number | null
    rowsWritten?: number
    errorCount?: number
  }
): Promise<void> {
  if (id == null) return
  try {
    const base = {
      finished_at: new Date().toISOString(),
      connections_attempted: fields.connectionsAttempted ?? 0,
      connections_succeeded: fields.connectionsSucceeded ?? 0,
      connections_errored: fields.connectionsErrored ?? 0,
      accounts_with_gaps: fields.accountsWithGaps ?? null,
      days_filled: fields.daysFilled ?? null,
      rows_written: fields.rowsWritten ?? 0,
      error_count: fields.errorCount ?? 0,
    }
    let { error } = await supabaseAdmin
      .from('cron_runs')
      .update({ ...base, connections_skipped: fields.connectionsSkipped ?? 0 })
      .eq('id', id)
    // ⛔ ORDERING SEATBELT (migration 050). Every push to main auto-deploys, and migrations are applied by
    // hand — so this code can be live for a window before the column exists. PostgREST rejects the WHOLE
    // update on an unknown column, which would stop finished_at being stamped, and an unstamped row is the
    // silent-hole signal. A monitoring fix must not be able to cause a monitoring outage. Retry without the
    // column, and say so at error volume: the skip count is being LOST, not defaulted to zero.
    if (error && /connections_skipped/i.test(error.message)) {
      console.error(
        `[cron-runs] connections_skipped column MISSING (migration 050 not applied) — the skip count for id=${id} ` +
        `is NOT being recorded. Stamping the rest so finished_at is not lost. skipped=${fields.connectionsSkipped ?? 0}`
      )
      ;({ error } = await supabaseAdmin.from('cron_runs').update(base).eq('id', id))
    }
    if (error) console.error(`[cron-runs] finish update FAILED id=${id}:`, error.message)
  } catch (e) {
    console.error(`[cron-runs] finish update THREW id=${id}:`, e)
  }
}
