// LORAMER_UNIVERSE_SIZING_IS_ASYMMETRIC_V1 — HOW MANY DAYS TO ASK FOR AT ONCE.
//
// ⛔ THERE IS NO DENSITY MODEL, AND THAT IS A RESULT RATHER THAN AN OMISSION. The two-factor model
// (`base_rows_per_day × days × activity_ratio × distinctValues`) was validated against all 16,810 usable
// windows on 2026-08-08 and **FALSIFIED ON EVERY ONE OF 35 RESOURCES** — MdAPE 87.2% against a >50%
// falsifier. The ablation is what makes that a finding rather than a bad fit: **every covariate made the
// model WORSE than the constant it was meant to improve on.** `activity_ratio` cost 10 points on a time
// split and 21 on a random one (impressions measure what the account SPENT; rows measure how many ENTITIES
// EXISTED — a dormant month still has campaigns, ad groups, assets and landing pages). `distinctValues` was
// noise-level and is separately unusable (queue ★DISTINCTVALUES-MEASURED-ON-ONE-MONTH). `days` was
// unidentifiable because 17,874 of 17,892 windows were exactly 30 days.
//
// ⛔ AND THE LOSS FUNCTION WAS WRONG, WHICH MATTERS MORE THAN THE MODEL BEING WRONG (plan §23 — Russ, and
// his own words: "MdAPE was the wrong loss and I specified it"):
//   over-predicting  → a window that finishes early. Free.
//   under-predicting → one re-streamed vendor request. Cheap, and with `day_committed` it does not lose the
//                      days already written.
// Those are not the same price, so the estimator with the best AVERAGE error is not the estimator for the
// job. Measured, strictly causally, over 10,198 predictions:
//   PREV   (last walked window)  MdAPE  42.7%  — BEST accuracy — under-predicts **30%** of the time
//   MAXALL (max of prior)        MdAPE 292.9%  — WORST accuracy — under-predicts  **3%** of the time
// **The metric ranked them exactly backwards.** ⇒ SIZE ON MAX. REPORT PREV.
import { supabaseAdmin } from '@/lib/supabase'

/**
 * ⛔ THE ROW BUDGET FOR ONE INVOCATION. Measured, not assumed: ~2,300 rows/sec through the write path and a
 * 300 s `maxDuration` ⇒ ~690k rows is the ceiling. This is deliberately under half of it, because the
 * ceiling is a throughput measurement on a good day and the budget has to survive a bad one.
 */
export const ROW_BUDGET = 300_000

/**
 * ⛔ COLD START — RUN ONE, WHEN THERE IS NO HISTORY AT ALL. The value comes from OUR ceiling rather than any
 * account's data, which is the point: **it must not be a number derived from Foam OH.** The densest month
 * ever measured is ~40,900 rows/day ⇒ 7 days ≈ 286k rows ≈ 124 s, under half the budget. With
 * `day_committed` in place a wrong guess costs ONE re-streamed request, not the window.
 */
export const COLD_START_DAYS = 7

/** The floor. Below this there is nothing left to narrow, so a failure here is BROKEN, not MIS-SIZED. */
export const MIN_WINDOW_DAYS = 1
export const MAX_WINDOW_DAYS = 30

export interface SizingVerdict {
  days: number
  /** What the estimate WAS, reported alongside the size actually chosen. PREV is the accurate one. */
  estimateRowsPerDay: number | null
  /** What the size was computed FROM. MAX is the safe one. */
  sizedOnRowsPerDay: number | null
  basis: 'cold-start-no-history' | 'max-of-prior-windows' | 'intermittent-fixed'
  priorWindows: number
  reason: string
}

/**
 * ⛔ AN INTERMITTENT ENTRY GETS THE FIXED SIZE AND IS NOT MODELLED. Named because it is a DIFFERENT failure
 * from "inaccurate", and reading it as inaccuracy is how it would get a wrong fix: an APE of exactly 100%
 * is the predictor saying ZERO when the window delivered something. `video` and `video_enhancement` predict
 * zero on 60% of their scored windows, `ad_group_asset` 45%, `ad_group_audience_view` 40%. **These series
 * are mostly empty with occasional bursts, and the median of an intermittent series is zero by
 * construction.** (Croston's method exists for exactly this class.) Falling back costs nothing.
 */
const INTERMITTENT_ZERO_SHARE = 0.4

/**
 * SIZE THE NEXT WINDOW FOR ONE ENTRY.
 *
 * ⛔ THIS READS THE ATTEMPT LOG, AND THAT IS ALLOWED — it asks "how many rows did this entry return last
 * time", which is a fact about US and about the vendor's answer, never about whether a range is captured.
 * Coverage is answered from `metrics_daily` by `universe-coverage.ts`, which may not import the attempt-log
 * module at all. **Sizing is an OPTIMISATION: with `day_committed`, a wrong guess costs one request.**
 */
export async function sizeNextWindow(k: {
  clientId: string; vendor: string; resource: string; segment: string
}): Promise<SizingVerdict> {
  const { data, error } = await supabaseAdmin
    .from('universe_attempt_log')
    .select('window_start, window_end, rows_written')
    .eq('client_id', k.clientId).eq('vendor', k.vendor)
    .eq('resource', k.resource).eq('segment', k.segment)
    .eq('phase', 'attempt_finished')
    .not('rows_written', 'is', null)
    .order('window_start', { ascending: false })
    .limit(12)
  if (error) {
    // ⛔ AN UNREADABLE HISTORY FALLS BACK TO THE COLD-START SIZE, IT DOES NOT GUESS BIG. Same posture as the
    // governor: an instrument that cannot answer must not be read as permission.
    return { days: COLD_START_DAYS, estimateRowsPerDay: null, sizedOnRowsPerDay: null,
      basis: 'cold-start-no-history', priorWindows: 0,
      reason: `sizing history unreadable (${error.message}) — falling back to the cold-start ${COLD_START_DAYS}-day window rather than assuming capacity` }
  }

  const prior = (data ?? []).map((r) => {
    const days = Math.max(1, dayDiff(String(r.window_start), String(r.window_end)) + 1)
    return { perDay: Number(r.rows_written ?? 0) / days, rows: Number(r.rows_written ?? 0) }
  })
  if (!prior.length) {
    return { days: COLD_START_DAYS, estimateRowsPerDay: null, sizedOnRowsPerDay: null,
      basis: 'cold-start-no-history', priorWindows: 0,
      reason: `no finished attempt for this entry — cold start at ${COLD_START_DAYS} days (~286k rows at the densest month ever measured, under half the ${ROW_BUDGET.toLocaleString()}-row budget)` }
  }

  const zeroShare = prior.filter((p) => p.rows === 0).length / prior.length
  if (zeroShare >= INTERMITTENT_ZERO_SHARE) {
    return { days: COLD_START_DAYS, estimateRowsPerDay: prior[0].perDay, sizedOnRowsPerDay: null,
      basis: 'intermittent-fixed', priorWindows: prior.length,
      reason: `${(zeroShare * 100).toFixed(0)}% of the last ${prior.length} windows returned ZERO rows — an intermittent series, whose median is zero by construction. Not modelled; fixed ${COLD_START_DAYS}-day window.` }
  }

  const maxPerDay = Math.max(...prior.map((p) => p.perDay))
  const prevPerDay = prior[0].perDay
  const days = maxPerDay > 0
    ? Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.floor(ROW_BUDGET / maxPerDay)))
    : MAX_WINDOW_DAYS
  return {
    days, estimateRowsPerDay: Math.round(prevPerDay), sizedOnRowsPerDay: Math.round(maxPerDay),
    basis: 'max-of-prior-windows', priorWindows: prior.length,
    reason: `sized on MAX(${Math.round(maxPerDay)} rows/day over ${prior.length} prior window(s)) → ${days} day(s) at the ${ROW_BUDGET.toLocaleString()}-row budget. ESTIMATE was PREV=${Math.round(prevPerDay)} rows/day (MdAPE 42.7% vs MAX's 292.9%) — reported, not used, because MAX under-predicts 3% of the time against PREV's 30% and under-prediction is the direction that costs.`,
  }
}

export const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
