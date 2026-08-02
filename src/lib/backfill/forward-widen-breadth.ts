// LORAMER_RESTATEMENT_SWEEP_FLEET_V1 (Google breadth Tier-1) — forward-capture restatement helper.
// Takes ONE wide-window breadth fetch (a single `segments.date BETWEEN start AND end` GAQL call — NOT a per-day loop,
// so the per-client GAQL request count stays FLAT as the window widens), buckets the returned rows by their own
// segments.date, and builds + upserts PER DAY on the 7-col conflict key so each (client,platform,entity_level,
// entity_id,date,breakdown_type,breakdown_value) is REPLACED, never additively drifted. This is the exact bucket-by-
// date the bounded backfill already does (google-device-backfill.ts:76-105), minus its monthChunks (a 30-day forward
// window is small — one Window call keeps the count flat) and its per-day campaign-anchor reconcile (a backfill-only
// concern). Rides LORAMER_GOOGLE_FWD_QUOTA_RESERVE_V1's reserved window.
//
// dryRun=true builds everything but SKIPS the upsert — so the cron's forward dry-run exercises this exact code path
// (bucketing, per-day build, conflict key) against live Google data without writing a single row.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'

const METRICS_DAILY_CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

export interface WidenResult {
  written: number                       // rows built (and upserted unless dryRun)
  days: number                          // distinct segments.date buckets seen in the window
  dates: string[]                       // sorted distinct dates (dry-run visibility)
  sample: Record<string, unknown> | null // first built row (dry-run visibility)
}

// Bucket one wide-window breadth fetch by segments.date; build + (unless dryRun) upsert PER DAY with conflict-key REPLACE.
export async function widenForwardBreadth<T extends { date: string }>(
  windowRows: T[],
  buildDay: (date: string, dayRows: T[]) => Record<string, unknown>[],
  opts: { dryRun?: boolean } = {},
): Promise<WidenResult> {
  const byDate = new Map<string, T[]>()
  for (const r of windowRows) {
    const arr = byDate.get(r.date)
    if (arr) arr.push(r)
    else byDate.set(r.date, [r])
  }
  let written = 0
  let sample: Record<string, unknown> | null = null
  for (const [date, dayRows] of byDate) {
    const built = buildDay(date, dayRows)
    if (built.length === 0) continue
    if (!sample) sample = built[0]
    if (!opts.dryRun) {
      const { error } = await supabaseAdmin
        .from('metrics_daily')
        .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
      if (error) throw error
    }
    written += built.length
  }
  return { written, days: byDate.size, dates: [...byDate.keys()].sort(), sample }
}
