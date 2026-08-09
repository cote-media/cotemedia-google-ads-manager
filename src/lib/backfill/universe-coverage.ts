// LORAMER_UNIVERSE_COVERAGE_IS_THE_WAREHOUSE_V1 — WHAT IS CAPTURED, ANSWERED FROM THE CAPTURED DATA.
//
// ⛔ WHY THE BOOKKEEPING TABLE IS NOT THE AUTHORITY, measured 2026-08-08 and it is what forced the teardown:
// `metrics_daily_p_2025_12`, Foam OH, `entity_level='campaign_search_term_view'` — the BASE entry holds
// 458,512 rows across ALL 25 days of 2025-12-01..25, and twelve of seventeen breakdown families match it
// day-for-day. **The range the walk's own log reported as OWED was in fact CAPTURED.** The owed list built
// from `universe_window_log` was wrong in BOTH directions. The warehouse is the coverage authority; the
// bookkeeping table never was.
//
// ⛔ WHAT THIS MODULE MAY READ, AND THE ONE THING THAT LOOKS LIKE AN EXCEPTION BUT IS NOT (plan §3):
//   · `metrics_daily` — POSITIVE coverage. The authority.
//   · `universe_attempt_log`'s TERMINAL-ZERO records — NEGATIVE coverage, and it is unavoidable. Absence of
//     rows is AMBIGUOUS: it means *never asked* OR *asked and the vendor legitimately named nothing*. Only
//     an attempt record can tell those apart, and without it a dormant day is re-walked forever — which is
//     `LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1` turned into an infinite loop.
// ⛔ IT MAY NOT IMPORT `universe-attempt-log.ts`. The MODULE boundary is what the import-graph guard binds,
// and that is the point: the spend-and-failure API must never become reachable from a coverage decision.
// This file issues its own narrow read of the negative-coverage subset and nothing else.
//
// ⛔ AND THE ASYMMETRY THAT DECIDES EVERY AMBIGUOUS CASE (plan §23): claiming COVERED when it is not is
// catastrophic — it means never walking a real gap, silently, forever. Claiming OWED when it is covered
// costs ONE vendor request. **So every uncertainty in this file resolves to OWED.**
import { supabaseAdmin } from '@/lib/supabase'

export interface CoverageKey {
  clientId: string
  platform: string
  /** The GAQL `FROM` resource — a pure function of the catalog entry, so no caller can ask an unanswerable question. */
  entityLevel: string
  breakdownType: string
}

export const dayList = (from: string, to: string): string[] => {
  const out: string[] = []
  const d = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z')
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

/**
 * ⛔⛔ THE PURE PREDICATE. A DAY WITH ROWS IS NOT AUTOMATICALLY A COVERED DAY.
 *
 * Streaming writes rows as they arrive, so **a kill mid-day leaves a PARTIALLY-WRITTEN DAY** — and a naive
 * "has rows ⇒ covered" would count it complete. That is partial-coverage-reads-as-complete, one grain below
 * the defect that started this teardown, and streaming would make the system LESS safe than buffering
 * without this rule.
 *
 * A day D counts as covered when it has rows AND either:
 *   (a) some LATER day also has rows — the stream is ordered by `segments.date`, so a later day having
 *       arrived proves D was finished before it started; or
 *   (b) D carries an explicit `day_committed` record.
 *
 * ⛔ (a) IS WHY THE DECISION PATH DOES NOT NEED THE ATTEMPT LOG, AND THAT IS AN IMPROVEMENT ON THE PLAN.
 * The plan's rule made `day_committed` a coverage INPUT, which would have pulled the attempt log into the
 * decision path it is explicitly barred from. Rule (a) is computable from `metrics_daily` alone. `dayCommitted`
 * stays an OPTIONAL argument — the reporting path may pass it to sharpen the answer; the walk never does.
 *
 * ⛔ THE COST OF (a), STATED: the NEWEST day of a walked range is always ambiguous and is re-asked once. It
 * costs at most one day per window, and it is resolved for free by the adjacent newer window — the walk runs
 * newest → oldest, so that window has already been walked and its days sit above this one.
 *
 * PURE. No I/O. This is the function the guard drives with a synthetic mid-day kill.
 */
export function coveredDaysStrict(
  daysWithRows: string[],
  opts: { dayCommitted?: string[] } = {},
): string[] {
  const rows = [...new Set(daysWithRows)].sort()
  if (!rows.length) return []
  const committed = new Set(opts.dayCommitted ?? [])
  const newest = rows[rows.length - 1]
  return rows.filter((d) => d !== newest || committed.has(d))
}

export interface WindowCoverage {
  /** Days proven captured — rows present AND closed by a later day (or an explicit commit). */
  covered: string[]
  /** Days a FINISHED attempt attests the vendor answered nothing for. Empty is a FACT here, not an absence. */
  attestedEmpty: string[]
  /** Neither. **This is what gets walked.** */
  uncovered: string[]
  probes: number
  ms: number
}

/**
 * ⛔ ONE `limit 1` PROBE PER DAY, IN PARALLEL — AND THE SHAPE IS NOT A STYLE CHOICE. Two failure modes are
 * designed around at once, and each has already bitten this repo:
 *
 *   1. **NEVER COUNT WHAT YOU ONLY NEED TO EXIST.** The first attempt at this derivation used
 *      `count(distinct date) GROUP BY breakdown_type` and took **51,430 ms** against a 2,000 ms bar — an
 *      Index Only Scan over **4,343,460 rows to return 17**. That is banked finding A6 wearing a different
 *      hat (`SELECT DISTINCT` is O(client-rows); PG has no skip-scan), and it was walked into anyway because
 *      it is the correct-LOOKING query. A `limit 1` stops at the first hit.
 *   2. **A PAGE-CAPPED READ CANNOT ANSWER A COVERAGE QUESTION.** `select date … between X and Y` looks
 *      cheaper — one round trip instead of thirty — but PostgREST caps the response at 1,000 rows and a
 *      30-day window of `campaign_search_term_view` holds hundreds of thousands. Those 1,000 rows could all
 *      be day one. **A `limit 1` per day cannot be truncated: one row IS the whole answer.** Precedent: the
 *      Node-side spend sum that truncated at the same cap (10,788 rows, sum read as 997) and blinded the
 *      rate governor.
 *
 * ⛔ PARTITION PRUNING IS WHY IT IS FAST. `metrics_daily` is partitioned by month and each probe pins `date`
 * to a single value, so exactly one partition is touched. Two unpruned queries timed out on 2026-08-08; the
 * pruned equivalent returned instantly.
 */
export async function windowCoverage(k: CoverageKey, windowStart: string, windowEnd: string): Promise<WindowCoverage> {
  const days = dayList(windowStart, windowEnd)
  const t0 = Date.now()

  const hits = await Promise.all(days.map(async (day) => {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('date')
      .eq('client_id', k.clientId).eq('platform', k.platform)
      .eq('entity_level', k.entityLevel).eq('breakdown_type', k.breakdownType)
      .eq('date', day).limit(1)
    // ⛔ AN ERROR IS NOT AN ABSENCE. Returning `false` here would say "not covered" — the SAFE direction for
    // walking, but a LIE about the data, and the difference matters the moment this feeds a customer-facing
    // completeness claim. Throw rather than synthesise an answer from a failed read.
    if (error) throw new Error(
      `[universe-coverage] probe failed for ${k.entityLevel}/${k.breakdownType || '(base)'} on ${day}: ${error.message}. ` +
      `⛔ A COVERAGE ANSWER MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
    return { day, has: (data?.length ?? 0) > 0 }
  }))

  const covered = coveredDaysStrict(hits.filter((h) => h.has).map((h) => h.day))
  const attestedEmpty = await attestedEmptyDays(k, windowStart, windowEnd)
  const known = new Set([...covered, ...attestedEmpty])
  return {
    covered, attestedEmpty,
    uncovered: days.filter((d) => !known.has(d)),
    probes: days.length, ms: Date.now() - t0,
  }
}

/**
 * NEGATIVE COVERAGE — days a FINISHED attempt attests the vendor answered nothing for.
 *
 * ⛔ ONLY `attempt_finished` COUNTS, AND THE WORD "FINISHED" IS DOING ALL THE WORK. An honest zero is
 * trustworthy only if recorded by an attempt that DEMONSTRABLY COMPLETED. A `zero` inferred from a missing
 * row, or from an attempt that died, is a statement about US, not about the data.
 *
 * ⛔ `skipped` IS NOT NEGATIVE COVERAGE AND IS DELIBERATELY EXCLUDED. It means a capability limit or an
 * unmet structural requirement — **the vendor was never asked.** It must be re-evaluated whenever the
 * requirement changes, so treating it as coverage would freeze a gap permanently.
 *
 * ⛔ IT READS THE NEW LOG ONLY. `universe_window_log`'s zeros cannot be trusted: its upsert clobbered its own
 * evidence, so a `zero` row whose `window_end` was overwritten by a different-length window is undetectable
 * from the log — the overwrite left no trace. Separately, 556 rows there carry `outcome='ok'` with
 * `rows_written=0`, which is what `zero` means (queue ★WALK-OK-MEANS-ZERO). The old log is history, not
 * evidence.
 */
export async function attestedEmptyDays(k: CoverageKey, windowStart: string, windowEnd: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('universe_attempt_log')
    .select('window_start, window_end')
    .eq('client_id', k.clientId).eq('vendor', k.platform)
    .eq('resource', k.entityLevel)
    .eq('phase', 'attempt_finished').eq('outcome', 'zero')
    .lte('window_start', windowEnd).gte('window_end', windowStart)
  if (error) throw new Error(
    `[universe-coverage] negative-coverage read failed for ${k.entityLevel}: ${error.message}. ` +
    `⛔ A COVERAGE ANSWER MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
  const attested = new Set<string>()
  for (const r of data ?? []) {
    for (const d of dayList(String(r.window_start), String(r.window_end))) {
      if (d >= windowStart && d <= windowEnd) attested.add(d)
    }
  }
  return [...attested].sort()
}

/**
 * ⛔ CONTIGUOUS RUNS, because GAQL bills `segments.date BETWEEN a AND b` as ONE operation regardless of span.
 * Three contiguous runs cost three requests; asking day-by-day costs thirty. Google's rate sheet: a query is
 * ONE operation whether streamed or paged, and paginated requests carrying a valid next_page_token are not
 * counted at all.
 */
export function toRanges(days: string[]): Array<{ start: string; end: string }> {
  if (!days.length) return []
  const sorted = [...new Set(days)].sort()
  const next = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
  const out: Array<{ start: string; end: string }> = []
  let start = sorted[0], prev = sorted[0]
  for (const d of sorted.slice(1)) {
    if (d === next(prev)) { prev = d; continue }
    out.push({ start, end: prev }); start = d; prev = d
  }
  out.push({ start, end: prev })
  return out
}

/**
 * ⛔ THE ONLY FUNCTION THE WALK DECISION PATH CALLS. It answers "which contiguous ranges of this window still
 * need to be ASKED FOR", from captured data plus attested emptiness, and nothing else.
 *
 * ⛔ DAY-GRANULAR BECAUSE THE RESUMABLE UNIT IS THE DAY. A stream CANNOT be resumed across invocations —
 * there is no cursor to hand the next one — so "checkpoint per page" would not make an over-large window
 * completable. GAQL filters `segments.date BETWEEN`, so a partially-completed window resumes by narrowing to
 * exactly this set. That is the dbt-microbatch shape ("commit 1-16, retry from 17") and it needs no vendor
 * feature at all.
 */
export async function rangesStillOwed(
  k: CoverageKey, windowStart: string, windowEnd: string,
): Promise<{ ranges: Array<{ start: string; end: string }>; coverage: WindowCoverage }> {
  const coverage = await windowCoverage(k, windowStart, windowEnd)
  return { ranges: toRanges(coverage.uncovered), coverage }
}

/**
 * ⛔ A DERIVED-TIME FAMILY'S COVERAGE IS A **FUNCTION OF** THE BASE FAMILY'S DAILY COVERAGE, NOT AN
 * INDEPENDENT FACT — and stating that is what stops the streaming rewrite from creating a new lie.
 *
 * `month`, `quarter`, `year`, `week`, `day_of_week`, `month_of_year` are COMPUTED from `segments.date` rows
 * already paid for (`buildDerivedTimeRows`, zero vendor requests). They aggregate ACROSS days, so they
 * cannot be flushed day-by-day and are written only when an attempt completes its window. **That makes them
 * look owed after a mid-window kill even though every constituent day is captured.**
 *
 * They are not owed. If the base days are covered, the family is RECOMPUTABLE for zero vendor requests.
 * ⇒ Never publish a walk for a derived-time family. Ask this, and recompute.
 */
export async function derivedTimeIsRecomputable(
  k: Omit<CoverageKey, 'breakdownType'>, from: string, to: string,
): Promise<{ recomputable: boolean; missingBaseDays: string[] }> {
  const base = await windowCoverage({ ...k, breakdownType: '' }, from, to)
  return { recomputable: base.uncovered.length === 0, missingBaseDays: base.uncovered }
}
