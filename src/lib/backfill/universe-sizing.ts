// LORAMER_CAPTURE_ADAPTER_CONTRACT_V1 — SIZING, RETROFITTED. The POLICY reads history; the NUMBERS are the
// adapter's.
//
// ⛔ WHAT THIS FILE USED TO CONTAIN AND NO LONGER DOES: `ROW_BUDGET = 300_000` and `COLD_START_DAYS = 7`,
// both derived from OUR write throughput **and from Google's cost curve, where a query is one operation at
// any span.** A module named `universe-sizing` had no business knowing either. They now live in
// `capture-adapters/google-ads.adapter.ts` as `SizingPolicy`, and the decision itself is
// `sizeFromPolicy()` in `capture-adapter.ts`, which is platform-free and obeys `costDirection`.
//
// ⛔ THE DEFECT THAT MOVE PREVENTS, STATED SO THE DELETION IS NOT UNDONE: under `'rises-with-range'` — GA4,
// where token cost grows with date-range length — "size up to the row budget" is ACTIVELY WRONG. A constant
// in a neutral-sounding module is exactly how that would have shipped to the third adapter.
//
// ⛔ AND WHY SIZING MAY READ THE ATTEMPT LOG AT ALL: it asks "how many rows did this surface return last
// time", which is a fact about US and about the vendor's answer — never about whether a range is captured.
// Coverage is answered from `metrics_daily` by `universe-coverage.ts`, which may not import the attempt-log
// module. Sizing is an OPTIMISATION: with `day_committed`, a wrong guess costs one re-fetch.
import { supabaseAdmin } from '@/lib/supabase'
import { sizeFromPolicy, unitReserveMs, timeCappedDays, type CaptureAdapter, type SizeVerdict } from '@/lib/backfill/capture-adapter'

export type { SizeVerdict }

export const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)

/**
 * SIZE THE NEXT WINDOW FOR ONE SURFACE, using THIS ADAPTER's policy and cost direction.
 *
 * ⛔ THERE IS NO DENSITY MODEL, AND THAT IS A RESULT RATHER THAN AN OMISSION. The two-factor model
 * (`base_rows_per_day × days × activity_ratio × distinctValues`) was validated against all 16,810 usable
 * windows on 2026-08-08 and **FALSIFIED ON EVERY ONE OF 35 RESOURCES** — MdAPE 87.2% against a >50%
 * falsifier — and the ablation showed **every covariate made it WORSE than the constant it was meant to
 * improve on**. `activity_ratio` cost 10 points on a time split and 21 on a random one, because impressions
 * measure what the account SPENT while rows measure how many ENTITIES EXISTED.
 */
export async function sizeNextWindow(
  adapter: CaptureAdapter,
  // LORAMER_DESCEND_WINDOW_360_V1 — `consumerMaxS` is the fire ceiling the unit must fit (the contract's
  // CONSUMER_MAX_DURATION_S), handed in by the caller: every caller is a contract importer already, and this module
  // may not reach the v2 contract (the stream-consumer guard's (e) leg keeps the topic's reach to the route, the
  // contract, the resumer and the drive).
  k: { clientId: string; resource: string; segment: string; consumerMaxS: number },
): Promise<SizeVerdict> {
  const { data, error } = await supabaseAdmin
    .from('universe_attempt_log')
    .select('window_start, window_end, rows_written, duration_ms')
    .eq('client_id', k.clientId).eq('vendor', adapter.platform)
    .eq('resource', k.resource).eq('segment', k.segment)
    .eq('phase', 'attempt_finished')
    .not('rows_written', 'is', null)
    .order('window_start', { ascending: false })
    .limit(12)
  if (error) {
    // ⛔ AN UNREADABLE HISTORY FALLS BACK TO THE COLD-START SIZE, IT DOES NOT GUESS BIG. Same posture as the
    // meter: an instrument that cannot answer must not be read as permission.
    return {
      days: adapter.sizing.coldStartDays, basis: 'cold-start-no-history',
      estimateRowsPerDay: null, sizedOnRowsPerDay: null,
      maxSecPerDay: null, reserveMs: unitReserveMs({ maxSecPerDay: null, days: adapter.sizing.coldStartDays }),
      reason: `sizing history unreadable (${error.message}) — falling back to the cold-start ${adapter.sizing.coldStartDays}-day window rather than assuming capacity`,
    }
  }
  const rowsPerDay: number[] = [], totals: number[] = []
  // LORAMER_UNIT_RESERVE_PER_SURFACE_V1 — the same read carries duration_ms (098), so the reserve costs no extra round trip.
  let maxSecPerDay: number | null = null
  for (const r of data ?? []) {
    const days = Math.max(1, dayDiff(String(r.window_start), String(r.window_end)) + 1)
    const rows = Number(r.rows_written ?? 0)
    rowsPerDay.push(rows / days); totals.push(rows)
    const dur = r.duration_ms == null ? null : Number(r.duration_ms)
    if (dur !== null && Number.isFinite(dur) && dur >= 0) {
      const spd = dur / 1000 / days
      maxSecPerDay = maxSecPerDay === null ? spd : Math.max(maxSecPerDay, spd)
    }
  }
  const verdict = sizeFromPolicy(adapter.sizing, adapter.meter.costDirection, rowsPerDay, totals)
  // LORAMER_DESCEND_WINDOW_360_V1 — the TIME cap beside the row cap: the unit's reserve must fit the consumer's fire.
  const cap = timeCappedDays({ maxSecPerDay, days: verdict.days, minDays: adapter.sizing.minDays, consumerMaxS: k.consumerMaxS })
  if (cap.capped) {
    const days = cap.days
    return {
      ...verdict, days, basis: 'time-capped', maxSecPerDay, reserveMs: unitReserveMs({ maxSecPerDay, days }),
      reason: `${verdict.reason} → TIME-CAPPED to ${days} day(s): worst ${maxSecPerDay!.toFixed(3)} s/day over the last ${data?.length ?? 0} attempt(s) × ${verdict.days} × 1.48 + 18 s would exceed the ${k.consumerMaxS} s consumer; floor((${k.consumerMaxS} − 18) ÷ (${maxSecPerDay!.toFixed(3)} × 1.48)) = ${cap.capDays}`,
    }
  }
  return { ...verdict, maxSecPerDay, reserveMs: unitReserveMs({ maxSecPerDay, days: verdict.days }) }
}
