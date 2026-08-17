// LORAMER_UNIVERSE_ATTEMPT_LOG_V1 — the three append helpers. WALK REBUILD, STEP 5.
//
// ⛔ THERE IS NO UPDATE PATH IN THIS FILE AND THERE NEVER WILL BE. Every function here writes exactly one
// row and mutates nothing. **A CORRECTION IS ANOTHER APPEND**, not an edit of what was already recorded —
// because the thing this replaces (`universe-window-log.ts`, migrations/054) mutated one row per window and
// therefore destroyed the evidence of its own failures. Three 300-second poison loops, a clobbered
// `abandoned_owed` record, a 15× overspend and a false coverage claim all came from that one property.
//
// ⛔ THREE INDEPENDENT MECHANISMS HOLD THIS, AND THEY ARE NOT REDUNDANT — they fail at different times:
//   1. migrations/061 REVOKES update/delete/truncate from every application role → POSTGRES refuses, at
//      runtime, and cannot be argued with. This is the enforcer.
//   2. `universe-attempt-append-only.guard.mjs` fails the BUILD → the mistake never reaches the database.
//   3. There is no unique index over the identity columns, so no `ON CONFLICT` can even arbitrate an
//      overwrite; `.upsert()` here raises rather than clobbering.
// Prose in a file is not a guard (banked law) — which is precisely why the comment is the least of the three.
//
// ⛔ THIS MODULE IS A SPEND AND FAILURE RECORD. IT IS NOT A COVERAGE SOURCE (plan §3). Coverage is derived
// from `metrics_daily`; nothing exported here may be consulted to decide WHAT TO WALK. The guard refuses any
// export whose name contains covered/coverage/owed/complete/gaps, because that separation gets breached by
// one careless import long before anyone notices it in review.
import { supabaseAdmin } from '@/lib/supabase'

export type AttemptOutcome =
  // ⛔ 'nongrain' ADDED 2026-08-17 — LORAMER_NONGRAIN_ATTESTS_V1. THE VENDOR ANSWERED AND NOTHING IT RETURNED
  // WAS A GRAIN AT THIS SURFACE (the segment does not apply here, or every metric was zero). It ATTESTS like
  // 'zero' and READS APART from it: folding it into 'ok' left 32 windows across 14 surfaces re-asked forever
  // for 65 wasted requests, and folding it into 'zero' would destroy the very distinction that made the class
  // findable. ⛔ IT IS NOT 'skipped' — that is US declining to ask, and it must never attest.
  | 'ok' | 'zero' | 'nongrain' | 'skipped' | 'error' | 'quota_stop' | 'floor_stop' | 'abandoned_owed'

/** The RANGE. This identifies WHAT WAS ATTEMPTED; `attempt_no` is a column and never part of it. */
export interface AttemptKey {
  clientId: string
  vendor: string
  resource: string
  /** '' for the base entry — matching migrations/054's convention exactly, so the two logs stay comparable. */
  segment: string
  windowStart: string
  windowEnd: string
}

export interface AttemptOpened {
  attemptNo: number
  /**
   * ⛔ HOW MANY TIMES THIS RANGE HAS BEEN OPENED **AT THIS SPAN**. The bound that separates BROKEN from
   * MIS-SIZED counts attempts at the MINIMUM window size (plan §16.3): three failures at 30 days means we
   * asked for too much at once; three at 1 day means one day of one entry cannot complete in 300 seconds.
   * `MAX_OPEN_ATTEMPTS = 3` as shipped conflates the two and would tell a customer "broken" when the truth
   * is "mis-sized" — which is the product lying about itself.
   */
  attemptsAtThisSpan: number
}

const fail = (what: string, detail: unknown): never => {
  throw new Error(
    `[universe-attempt-log] ${what} failed: ${detail instanceof Error ? detail.message : JSON.stringify(detail)}. ` +
    `⛔ THIS MUST NOT BE SWALLOWED. An append that silently fails is exactly the invisible-failure class this ` +
    `table exists to end — a vendor call would proceed uncharged and unrecorded, which is how three poison ` +
    `loops stayed invisible to the rate governor.`
  )
}

/**
 * PHASE 1 — written **BEFORE the vendor call**, and it is where SPEND IS CHARGED.
 *
 * ⛔ THE ORDERING IS THE WHOLE POINT. migrations/054 wrote `requests_spent` only in `closeWindow`, so an
 * invocation killed mid-flight left 0 and burned quota invisibly. Charging at open means a hard kill —
 * which reaches no catch block, no finally, no callback — still leaves a durable, counted record.
 *
 * Returns the attempt number and the count at this span. **Neither is a coverage answer**: both describe
 * how many times WE have tried, which is a fact about us, not about the data.
 */
export async function appendAttemptStarted(k: AttemptKey, requests = 1): Promise<AttemptOpened> {
  const { data, error } = await supabaseAdmin.rpc('universe_attempt_open', {
    p_client_id: k.clientId,
    p_vendor: k.vendor,
    p_resource: k.resource,
    p_segment: k.segment,
    p_window_start: k.windowStart,
    p_window_end: k.windowEnd,
    p_requests: requests,
  })
  if (error) fail('attempt_started', error)
  // ⛔ THE RPC DERIVES `attempt_no` UNDER AN ADVISORY LOCK because `maxConcurrency: 2` lets two invocations
  // read the same max. A missing count here is not a zero — it is an instrument that did not answer, and the
  // shipped `universe_window_open` had exactly this bug (returned 0, crashed one invocation, wasted a request).
  const row = Array.isArray(data) ? data[0] : data
  const attemptNo = Number(row?.attempt_no)
  const attemptsAtThisSpan = Number(row?.attempts_at_this_span)
  if (!Number.isFinite(attemptNo) || attemptNo < 1) {
    fail('attempt_started', `universe_attempt_open returned no usable attempt number: ${JSON.stringify(data)}`)
  }
  return { attemptNo, attemptsAtThisSpan: Number.isFinite(attemptsAtThisSpan) ? attemptsAtThisSpan : attemptNo }
}

/**
 * PHASE 2 — written **after one day's rows are durably upserted**, in `segments.date` order.
 *
 * ⛔ WITHOUT THIS RECORD, STREAMING MAKES THE SYSTEM LESS SAFE, NOT MORE. Writing rows as they arrive means
 * a kill mid-day leaves a PARTIALLY-WRITTEN DAY, and `metrics_daily`-derived coverage would count it as
 * covered — partial-coverage-reads-as-complete, one grain down from the defect that started the teardown.
 * A day counts as covered only when its `day_committed` record exists (or when a LATER day has rows, which
 * closes it by implication).
 */
export async function appendDayCommitted(
  k: AttemptKey,
  attemptNo: number,
  day: string,
  rowsWritten: number,
): Promise<void> {
  const { error } = await supabaseAdmin.from('universe_attempt_log').insert({
    client_id: k.clientId, vendor: k.vendor, resource: k.resource, segment: k.segment,
    window_start: k.windowStart, window_end: k.windowEnd,
    attempt_no: attemptNo, phase: 'day_committed', day, rows_written: rowsWritten,
  })
  if (error) fail('day_committed', error)
}

/**
 * PHASE 3 — written **after** the attempt ends, by any route.
 *
 * ⛔ IT DOES NOT UPDATE PHASE 1. The `attempt_started` row stays exactly as written, including its charged
 * spend. That is what makes a hard kill legible after the fact: a started row with no finished row IS the
 * failure, recorded, rather than a state that the next attempt silently overwrote.
 *
 * ⚠ `outcome: 'zero'` means THE VENDOR ANSWERED AND NAMED NOTHING — a fact about the data. It is NOT
 * interchangeable with 'ok' at rows_written = 0. The old log carries 556 rows that confused exactly these
 * two (queue ★WALK-OK-MEANS-ZERO); here `rows_written` is recorded alongside, so the distinction is
 * derivable from the count rather than resting on a hand-set label that can disagree with it.
 */
export async function appendAttemptFinished(
  k: AttemptKey,
  attemptNo: number,
  outcome: AttemptOutcome,
  detail: {
    rowsWritten?: number
    requestsSpent?: number
    refusedRows?: number
    diskFreeBytes?: number | null
    error?: string | null
  } = {},
): Promise<void> {
  const { error } = await supabaseAdmin.from('universe_attempt_log').insert({
    client_id: k.clientId, vendor: k.vendor, resource: k.resource, segment: k.segment,
    window_start: k.windowStart, window_end: k.windowEnd,
    attempt_no: attemptNo, phase: 'attempt_finished', outcome,
    rows_written: detail.rowsWritten ?? null,
    requests_spent: detail.requestsSpent ?? null,
    refused_rows: detail.refusedRows ?? null,
    disk_free_bytes: detail.diskFreeBytes ?? null,
    error: detail.error ?? null,
  })
  if (error) fail('attempt_finished', error)
}


/**
 * HOW MANY TIMES THIS RANGE HAS BEEN OPENED **AT A GIVEN SPAN**, read WITHOUT opening one.
 *
 * ⛔ WHY THIS EXISTS RATHER THAN READING THE VALUE `appendAttemptStarted` ALREADY RETURNS: the bound has to
 * be evaluated BEFORE the attempt is charged. `appendAttemptStarted` charges spend at open — deliberately,
 * because that is what makes a hard kill visible to the rate governor — so using its return value to then
 * REFUSE would bill a request the vendor was never asked for. Over-counting spend is the safe direction for
 * a governor (plan §23), but it is still a lie about what was spent, and this costs one indexed read.
 *
 * ⛔ IT IS NOT COVERAGE AND CANNOT BE MISTAKEN FOR IT. "How many times have we tried" is a fact about US.
 * Whether the data is captured is answered from `metrics_daily` by `universe-coverage.ts`, which may not
 * import this module at all.
 */
export async function readAttemptsAtSpan(k: AttemptKey): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('universe_attempt_log')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', k.clientId).eq('vendor', k.vendor).eq('resource', k.resource)
    .eq('segment', k.segment).eq('phase', 'attempt_started')
    .eq('window_start', k.windowStart).eq('window_end', k.windowEnd)
  if (error) fail('readAttemptsAtSpan', error)
  // ⛔ THE COUNT ARRIVES ON THE RESPONSE, NOT IN `data` — a head request returns no rows at all, so reading
  // `data.length` here would silently return 0 and the bound would NEVER fire. A bound that cannot fire is a
  // broken instrument that looks like a working one (plan §24).
  if (typeof count !== 'number') fail('readAttemptsAtSpan', `count was ${JSON.stringify(count)} — a bound that cannot read its own counter must not pass as zero`)
  return count as number
}

/**
 * Today's request spend for one vendor lane, summed IN POSTGRES.
 *
 * ⛔ SIBLING OF `universe_lane_spend_today` (migrations/057), REQUIRED IN THE SAME COMMIT (plan §7):
 * `google-op-budget.ts` sources the fleet backfill lane from the old aggregate, so without this the
 * forward/catchup/drain lanes would measure against a denominator missing the walk — a governor blind in
 * exactly the way that produced the 15× overspend. Both aggregates coexist while the old consumer runs.
 *
 * ⛔ IT SUMS `attempt_started`, NOT `attempt_finished`. Spend that was charged and then killed is still
 * counted. That is the entire improvement over 057, and it is not an optimisation — it is the difference
 * between a governor that can see a poison loop and one that cannot.
 *
 * ⚠ The Node-side sum this shape replaces truncated at PostgREST's 1,000-row page cap (measured: 10,788
 * rows, sum read as 997). A scalar cannot be page-capped; a row set can.
 */
export async function readAttemptLaneSpendToday(vendor: string, since: Date): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('universe_attempt_lane_spend_today', {
    p_vendor: vendor,
    p_since: since.toISOString(),
  })
  if (error) {
    fail('lane_spend', `${error.message} — migrations/061_universe_attempt_log.sql creates ` +
      `universe_attempt_lane_spend_today(); apply it before running.`)
  }
  const n = Number(data)
  // ⛔ AN UNREADABLE BUDGET HOLDS. A spend read that cannot answer must never be treated as zero spend —
  // that is a governor granting itself unlimited quota because its instrument broke.
  if (!Number.isFinite(n)) fail('lane_spend', `non-numeric spend: ${JSON.stringify(data)}`)
  return n
}
