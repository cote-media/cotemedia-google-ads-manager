// LORAMER_RETENTION_WALL_CANARY_V1 — EXPIRY MUST NOT BE MISTAKEN FOR IDLE, AND THE DAY ENFORCEMENT BEGINS MUST BE KNOWN.
//
// ⛔ THE HOLE THIS CLOSES (round 14, 2026-09-18). Google publishes a 37-month wall for hourly/daily/weekly data,
// effective 2026-06-01 (support.google.com/google-ads/answer/15188209: "After that period, the data will not be
// accessible via the Google Ads interface or APIs"), and says the API answers a request past it with a
// DateRangeError (developers.google.com/google-ads/api/docs/reporting/segmentation). MEASURED the same day: the API
// served DAILY and HOURLY rows at 48 and 125 months back on Tri-Copy — the wall is real on paper and not enforced.
// The engine retires a success-empty day as NO_DATA_OBSERVED ('zero'). Past the wall, an aged-out day and an idle
// day would come back IDENTICAL if Google ever answers with silence instead of the documented error — and the
// walk would seal history as "empty" that had simply expired. Silently. Forever.
//
// ⛔ THE DISTINCTION RESTS ON AN ANSWER FROM GOOGLE, NEVER ON A CLOCK ALONE. A CANARY asks, once a day, for a week
// PAST the wall on an account whose rows past the wall are KNOWN (measured 7 daily rows, 797 impressions, round-14
// probe C4). While the canary proves the vendor still SERVES rows past the wall, a success-empty past the wall is
// what it has always been: this query returned nothing. The moment the canary reads anything else — a
// DateRangeError (enforcement began, the documented shape), zero rows (enforcement began SILENTLY, the dangerous
// shape), or no fresh answer at all — a success-empty past the wall is UNRESOLVED: it is recorded under outcome
// 'error' with the UNRESOLVED_PAST_WALL marker, it retires nothing, and the fire refuses to spend more requests past
// the wall until the canary is green again. That is how we know within a day, and why a silent wall cannot
// destroy history: it can only stall the walk below the line, loudly.
//
// ⛔ NO NEW TABLE, NO MIGRATION. The canary's answer lives in capture_pass_log (pass_marker RETENTION_CANARY_MARKER,
// outcome ok = served, error = refused | silent | failed, detail = JSON), the same store the daily name refresh
// uses for its once-a-day gate. The wall line is retentionWarningLine() — 37 CALENDAR months, the vendor's own unit,
// reporting-only until now and still never a stop: it decides only which empties need the canary's proof.
import { retentionWarningLine } from '@/lib/backfill/google-ads-universe-writer'

export const RETENTION_CANARY_MARKER = 'retention_canary'
/** A canary answer older than this is stale: the day enforcement begins must be known within a day. */
export const RETENTION_CANARY_FRESH_MS = 30 * 60 * 60 * 1000
/** The marker on an attempt_finished 'error' row whose empty answer fell past the wall without a green canary. */
export const UNRESOLVED_PAST_WALL_MARKER = 'UNRESOLVED_PAST_WALL'

/**
 * The account and week the canary asks. ⛔ MEASURED, NOT CHOSEN: Tri-Copy 8289851425, 2022-09-10..16 served 7 daily
 * campaign rows / 797 impressions on 2026-09-18 (round-14 probe C4), 48 months back — past the wall on the day it was
 * measured and past it forever after (the line only moves forward). If this account is ever deleted or re-connected
 * under another client, the canary reads 'failed' and the walk past the wall holds — loudly, never silently.
 */
export const RETENTION_CANARY = {
  clientId: '8bb0cd08-7a97-42f3-86ba-3556f0ad585c',
  customerId: '8289851425',
  probeStart: '2022-09-10',
  probeEnd: '2022-09-16',
  expectedRowsAtLeast: 1,
  measured: '2026-09-18 round-14 probe C4: 7 rows, 7 dates, 797 impressions',
} as const

export type CanaryState = 'served' | 'refused' | 'silent' | 'failed' | 'unknown'
export interface CanaryReading { state: CanaryState; at: string | null; ageMs: number | null; detail: string }

/** The wall line for a given day: 37 calendar months back. Pure; the caller supplies today. */
export function wallLineFor(todayIso: string): string {
  return retentionWarningLine(todayIso)
}

/** A range is PAST the wall when its newest day is older than the line. Pure. */
export function isPastWall(rangeEnd: string, wallLine: string): boolean {
  return rangeEnd < wallLine
}

/**
 * ⛔ THE ONE DECIDER FOR AN EMPTY ANSWER. Pure. 'zero' = retire as NO_DATA_OBSERVED; 'unresolved' = record under
 * 'error' with the marker and retire nothing. An empty answer ABOVE the wall is always 'zero' (the vendor serves
 * that ground and a zero there is the zero-metrics rule at work).
 * ⛔ PAST THE WALL IT IS ALWAYS 'unresolved' — LORAMER_WALL_HOLD_NEVER_RETIRE_V1, Russ's Q6 ruling (2026-09-18):
 * "silence past the wall is not evidence"; the walk stops when Google says this is the first day of anything
 * (inception) or refuses the range (a DateRangeError wall). Until 2026-09-18 a SERVED canary licensed retirement
 * here; the canary keeps running as the day-enforcement-begins detector, and its state is carried for the record,
 * but it no longer decides. An unresolved day stays owed and the missed lane re-asks it.
 */
export function classifyEmptyAnswer(a: { rangeEnd: string; wallLine: string; canary: CanaryState }): 'zero' | 'unresolved' {
  // ⛔ LORAMER_PAST_LINE_EMPTY_V1 (Russ, 2026-09-23: "If there's data go get it"). An empty answer is recorded empty
  // wherever the day sits. MEASURED before this flip (rounds 39–40): 716 daily asks 39 and 75 months back on two
  // accounts — all served or empty, zero DateRangeErrors; Tri-Copy's 2016 daily rows reproduced; 2,481 month-grain
  // witness asks over 12,790 held windows fleet-wide found ZERO months with monthly rows where every daily answer was
  // empty. Google's daily silence past the line is emptiness. The line stays as the instrument's label and the canary
  // keeps running as the enforcement detector; neither classifies an answer. 'unresolved' remains in the type for the
  // ledger's history (12,790 rows carry the marker) and is never returned.
  void a.rangeEnd; void a.wallLine; void a.canary
  return 'zero'
}

/**
 * ⛔ THE CANARY'S VERDICT IS TAKEN FROM WHAT THE VENDOR SAID, NEVER FROM WHAT WE EXPECTED. Pure.
 * rows ≥ expected → 'served' · a DateRangeError refusal → 'refused' (the documented enforcement shape) ·
 * a success with fewer rows than the account is known to hold → 'silent' (the dangerous shape) · any other error → 'failed'.
 */
export function canaryVerdict(a: { ok: boolean; rows: number; error: string | null }): Exclude<CanaryState, 'unknown'> {
  if (!a.ok) return /date_?range_?error/i.test(a.error ?? '') ? 'refused' : 'failed'
  return a.rows >= RETENTION_CANARY.expectedRowsAtLeast ? 'served' : 'silent'
}

/** Pure reading of a stored canary row. Stale or absent → 'unknown'. */
export function readingFromRow(row: { outcome: string; detail: string | null; ran_at: string } | null, nowMs: number): CanaryReading {
  if (!row) return { state: 'unknown', at: null, ageMs: null, detail: 'no canary row — the retention canary has never run (or its store is unreadable)' }
  const ageMs = Math.max(0, nowMs - Date.parse(row.ran_at))
  let parsed: any = null
  try { parsed = row.detail ? JSON.parse(row.detail) : null } catch { parsed = null }
  const state: CanaryState = row.outcome === 'ok' ? 'served'
    : (['refused', 'silent', 'failed'] as const).includes(parsed?.state) ? parsed.state : 'failed'
  if (ageMs > RETENTION_CANARY_FRESH_MS) {
    return { state: 'unknown', at: row.ran_at, ageMs, detail: `canary answer is ${Math.round(ageMs / 3600000)} h old (fresh ≤ ${RETENTION_CANARY_FRESH_MS / 3600000} h) — last state ${state}` }
  }
  return { state, at: row.ran_at, ageMs, detail: parsed?.summary ?? `${state} at ${row.ran_at}` }
}

/** The newest canary row, read as a CanaryReading. An unreadable store reads 'unknown' — the safe direction. */
export async function readRetentionCanary(nowMs = Date.now()): Promise<CanaryReading> {
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data, error } = await supabaseAdmin.from('capture_pass_log')
    .select('outcome, detail, ran_at')
    .eq('pass_marker', RETENTION_CANARY_MARKER).eq('platform', 'google')
    .order('ran_at', { ascending: false }).limit(1)
  if (error) return { state: 'unknown', at: null, ageMs: null, detail: `canary store unreadable: ${error.message}` }
  return readingFromRow((data?.[0] as any) ?? null, nowMs)
}

/** Record one canary answer. outcome ok = served; everything else is 'error' with the state in the detail JSON. */
export async function recordRetentionCanary(a: {
  state: Exclude<CanaryState, 'unknown'>; rows: number; dates: string[]; error: string | null; wallLine: string; elapsedMs: number
}): Promise<{ error: string | null }> {
  const { supabaseAdmin } = await import('@/lib/supabase')
  const summary = a.state === 'served'
    ? `SERVED: ${a.rows} daily row(s) past the wall (${RETENTION_CANARY.probeStart}..${RETENTION_CANARY.probeEnd}; wall line ${a.wallLine}) — the vendor still serves data past 37 months`
    : a.state === 'refused'
      ? `REFUSED: the vendor answered a DateRangeError past the wall — retention enforcement has begun in the documented shape: ${a.error}`
      : a.state === 'silent'
        ? `SILENT: ${a.rows} row(s) where ${RETENTION_CANARY.expectedRowsAtLeast}+ were served on ${RETENTION_CANARY.measured} — enforcement may have begun WITHOUT an error; nothing past the wall retires on silence until this clears`
        : `FAILED: the canary could not ask: ${a.error}`
  const { error } = await supabaseAdmin.from('capture_pass_log').insert({
    pass_marker: RETENTION_CANARY_MARKER, mode: 'canary', platform: 'google',
    client_id: RETENTION_CANARY.clientId, account_id: RETENTION_CANARY.customerId,
    observation_date: RETENTION_CANARY.probeStart,
    entities_examined: 1, facts_examined: 1, rows_opened: 0, rows_closed: 0, rows_touched: a.rows,
    outcome: a.state === 'served' ? 'ok' : 'error',
    detail: JSON.stringify({ state: a.state, rows: a.rows, dates: a.dates, error: a.error, wallLine: a.wallLine, elapsedMs: a.elapsedMs, summary }),
  })
  return { error: error?.message ?? null }
}

/** The GAQL the canary sends — the walk's own daily shape on the campaign resource, the week that is known to hold rows. */
export const RETENTION_CANARY_GAQL =
  `SELECT segments.date, campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign ` +
  `WHERE segments.date BETWEEN '${RETENTION_CANARY.probeStart}' AND '${RETENTION_CANARY.probeEnd}'`
