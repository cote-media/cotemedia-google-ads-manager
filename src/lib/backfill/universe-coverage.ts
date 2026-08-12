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
// ⛔ THE ALIAS IS DATA, IN THE MODULE THAT OWNS SURFACE VOCABULARY — LORAMER_DRAIN_ALIAS_COVERAGE_V1.
// breakdownTypeForSurface — LORAMER_ATTESTED_EMPTY_SEGMENT_SCOPE_V1: the negative-coverage read must
// scope a zero attestation to its OWN surface, and the segment→breakdown_type mapping is owned there.
import { drainAliasFor, breakdownTypeForSurface } from '@/lib/backfill/universe-surfaces'

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

  // ⛔ THE SAME FETCH CAN ALREADY BE STORED UNDER ANOTHER KEY — LORAMER_DRAIN_ALIAS_COVERAGE_V1. The drain
  // writes geo at `campaign`/`geo_*` where the walk writes `geographic_view`/`geo_target_*`; measured
  // 2026-08-09, 898 of one walk's 17,878 requests were re-fetches of exactly that. The alias is DATA in
  // `universe-surfaces.ts`, PROVEN against live rows before it was written, and re-proven from data by
  // `drain-alias-coverage.guard.mjs` leg (v) on every check:data run — because claiming COVERED when it is not
  // is the catastrophic direction named at the top of this file.
  const alias = drainAliasFor(k.entityLevel, k.breakdownType)

  const hits = await Promise.all(days.map(async (day) => {
    const probe = (entityLevel: string, breakdownType: string) => supabaseAdmin
      .from('metrics_daily')
      .select('date')
      .eq('client_id', k.clientId).eq('platform', k.platform)
      .eq('entity_level', entityLevel).eq('breakdown_type', breakdownType)
      .eq('date', day).limit(1)
    const { data, error } = await probe(k.entityLevel, k.breakdownType)
    // ⛔ AN ERROR IS NOT AN ABSENCE. Returning `false` here would say "not covered" — the SAFE direction for
    // walking, but a LIE about the data, and the difference matters the moment this feeds a customer-facing
    // completeness claim. Throw rather than synthesise an answer from a failed read.
    if (error) throw new Error(
      `[universe-coverage] probe failed for ${k.entityLevel}/${k.breakdownType || '(base)'} on ${day}: ${error.message}. ` +
      `⛔ A COVERAGE ANSWER MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
    if ((data?.length ?? 0) > 0) return { day, has: true }
    // ⛔ ONE EXTRA INDEXED PROBE, AND ONLY WHEN THE FIRST FOUND NOTHING. A day already covered under the walk's
    // own key never pays for it, so the cost lands exactly where the saving is. An alias read that FAILS is
    // treated the same as the primary — thrown, never synthesised into an answer.
    if (!alias) return { day, has: false }
    const { data: aData, error: aErr } = await probe(alias.entityLevel, alias.breakdownType)
    if (aErr) throw new Error(
      `[universe-coverage] ALIAS probe failed for ${k.entityLevel}/${k.breakdownType || '(base)'} → ` +
      `${alias.entityLevel}/${alias.breakdownType} on ${day}: ${aErr.message}. ` +
      `⛔ A COVERAGE ANSWER MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
    return { day, has: (aData?.length ?? 0) > 0 }
  }))

  const covered = coveredDaysStrict(hits.filter((h) => h.has).map((h) => h.day))
  // ⛔ THE THREE SETS MUST PARTITION THE WINDOW — DISJOINT BY CONSTRUCTION, NOT BY LUCK.
  // LORAMER_COVERAGE_SETS_PARTITION_V1, 2026-08-12: before the base aliases, a day was either covered or
  // attested-empty, never both, and nothing enforced that — it was true by accident. The aliases ended the
  // accident ON THE FIRST FIRE THEY WERE LIVE FOR: ad_group base days were COVERED via forward's '' rows AND
  // attested by the previous night's paid-for zeros, the plausibility gate summed 28 + 30 + 0 = 58 over a
  // 30-day window, and BOTH surfaces were refused — durably, for zero requests, exactly as fail-closed
  // should, but forever. A day with rows is COVERED; an attestation is the NEGATIVE half and yields to the
  // positive fact. The invariant the gate checks is right — this makes the sets actually satisfy it.
  const coveredSet = new Set(covered)
  const attestedEmpty = (await attestedEmptyDays(k, windowStart, windowEnd)).filter((d) => !coveredSet.has(d))
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
  // ⛔ LORAMER_ATTESTED_EMPTY_SEGMENT_SCOPE_V1 — A ZERO ATTESTS EXACTLY ITS OWN SURFACE, NOTHING ELSE.
  //
  // FOUND BY THE FIRST WET RUN (2026-08-10 23:52Z), not by review: this read filtered by RESOURCE ONLY,
  // so a `zero` on `ad_group / segments.ad_destination_type` attested EVERY ad_group segment empty — 17 of
  // 20 published surfaces were declared complete on a SIBLING'S evidence and never asked the vendor. That
  // is claiming COVERED when it is not — the catastrophic direction this file's own header names — arriving
  // through the negative-coverage door on the engine's first execution.
  //
  // THE SCOPE FILTER: the log's identity is (client, vendor, resource, segment, window); the coverage grain
  // is (entityLevel, breakdownType). `segment` is selected and each row is kept only when ITS OWN surface
  // maps to the asked grain — the same forward mapping the writer uses (`breakdownTypeForSurface`, one
  // owner, universe-surfaces.ts). The mapping is lossy in reverse, so it is applied FORWARD over returned
  // rows, never inverted into the query. Rows are already narrowed by resource + phase + outcome + window
  // overlap, so the set this filters is small by construction.
  // `segment` is `''` for the base entry (migrations/061:95, NOT NULL — `.eq` semantics are safe; nothing
  // here needs `.is()`); `?? null` is defence against a relaxed column, and maps to the BASE surface only.
  const { data, error } = await supabaseAdmin
    .from('universe_attempt_log')
    .select('window_start, window_end, segment')
    .eq('client_id', k.clientId).eq('vendor', k.platform)
    .eq('resource', k.entityLevel)
    .eq('phase', 'attempt_finished').eq('outcome', 'zero')
    .lte('window_start', windowEnd).gte('window_end', windowStart)
  if (error) throw new Error(
    `[universe-coverage] negative-coverage read failed for ${k.entityLevel}: ${error.message}. ` +
    `⛔ A COVERAGE ANSWER MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
  const attested = new Set<string>()
  for (const r of data ?? []) {
    if (breakdownTypeForSurface(k.entityLevel, (r as { segment?: string | null }).segment ?? null) !== k.breakdownType) continue
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
