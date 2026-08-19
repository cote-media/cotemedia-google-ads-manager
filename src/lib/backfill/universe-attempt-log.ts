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

/**
 * ⛔ THE PHASES, AS A UNION SO THE DATABASE CAN BE PINNED TO IT — LORAMER_COMPLETION_SIGNAL_V1.
 * `universe_attempt_log_phase_ck` is the DB half and `db-enum-mirrors-ts.guard.mjs` registers the pair. It
 * exists because on 2026-08-17 `AttemptOutcome` was widened and its CHECK was not: Postgres rejected every
 * write with 23514 while `npm run build`, 124 guards and a full check:data all read GREEN, because not one of
 * them wrote such a row. This union is the same shape of change in the opposite order, and the guard is what
 * stops the two drifting apart in EITHER direction.
 * ⛔ 'message_finished' IS NOT AN ATTEMPT. It is the MESSAGE's terminal fact — the thing no observer could see
 * before, which is why two instruments guessed at it. It carries no outcome (outcome_ck admits none on a
 * non-finished phase) and no day; its reason goes in `error`.
 */
export type AttemptPhase = 'attempt_started' | 'day_committed' | 'attempt_finished' | 'message_finished'

// ⛔ THE TERMINAL PHASE LIVES HERE, NOT IN THE CONTRACT MODULE, AND THE REASON IS A GUARD RATHER THAN TASTE.
// It was in `universe-v2-contract.ts` for one build, and importing it made THIS file "reach the v2 topic" in
// `universe-stream-consumer.guard.mjs` leg (e) — the guard that keeps the publisher set to exactly one. The
// guard was right: an append helper has no business importing a topic module. The phases belong with the
// union that names them and with the writers that use them.
export const TERMINAL_PHASE: AttemptPhase = 'message_finished'

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

/**
 * ⛔ THE WINDOW THAT WAS ASKED — LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1. NOT part of `AttemptKey`, and the
 * separation is the whole point: identity is the RANGE, the parent is a PROPERTY of the attempt saying what
 * larger ask it was one piece of. `universe_surface_rotation` prefers it and `deriveAnchorEnd` recedes by it,
 * so a walked 30-day window gains ~30 days instead of the width of whichever range was written last.
 *
 * ⛔ OMITTING IT IS A REAL CHOICE WITH A REAL COST, NOT A CONVENIENCE. A row written without a parent reads as
 * UNKNOWN at the rotation (`parent_known = false`), and an unknown window HOLDS the anchor rather than
 * receding it — deliberately, because the window a parentless row belonged to is recoverable from no stored
 * fact (sizing is adaptive and time-varying). So a writer that forgets this does not corrupt anything; it
 * STALLS that surface until a stamped row lands. Fail-safe, and visible.
 */
export interface ParentWindow {
  startDate: string
  endDate: string
}

/**
 * ⛔ WHOSE WORK, AND WHICH EXECUTION — LORAMER_COMPLETION_SIGNAL_V1. TWO FACTS, AND THE SECOND IS NOT
 * REDUNDANT. This was worked out against three separate adversary findings and each needs a different half:
 *  · `messageKey` — PRODUCER-ASSIGNED, the idempotency key the publisher already mints. It answers WHOSE
 *    WORK THIS IS, which is what a drive needs to stop counting a scheduled fire's requests as its own
 *    (finding 4g). Enterprise Integration Patterns names exactly this as the minimum durable fact.
 *  · `invocationId` — CONSUMER-ASSIGNED, minted once per handler entry. It answers WHICH EXECUTION wrote a
 *    row. ⛔ **A MESSAGE KEY CANNOT DO THIS AND THAT IS WHY THERE ARE TWO.** Vercel Queues retries, and a
 *    REDELIVERY OF THE SAME MESSAGE CARRIES THE SAME KEY — so an observer keyed on the message alone still
 *    sees delivery #1's terminal row followed by delivery #2's range rows (finding 4f), and still cannot tell
 *    two terminal rows apart (finding 4c). One id per delivery is the only thing that separates them.
 * Both are OPTIONAL and both are NULL on every pre-083 row; the readers that matter fall back exactly as the
 * parent-window columns do.
 */
export interface WriteProvenance {
  messageKey?: string | null
  invocationId?: string | null
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
/**
 * ⛔ WHICH LANE ASKED — LORAMER_TOP_EDGE_LANE_V1, 2026-08-19. `'descend'` is the walk marching toward
 * inception; `'top-edge'` is the lane holding the strip between the descent's top window and yesterday.
 * `universe_surface_rotation` (migrations/084) reads ONLY `'descend'` rows, because the rotation answers
 * "where is the descent" and a top-edge attempt is not part of it — without the filter the newest top-edge
 * row wins the DISTINCT ON and drags the anchor to the top of the calendar every pass.
 * ⛔ THE DEFAULT IS THE SAFE DIRECTION, NOT THE COMMON ONE. A caller that forgets the lane writes `'descend'`,
 * which can only make the descent HOLD on ground it has seen; the reverse default would hide a real window
 * from the anchor.
 */
export type AttemptLane = 'descend' | 'top-edge'

export async function appendAttemptStarted(k: AttemptKey, requests = 1, parent?: ParentWindow, prov?: WriteProvenance, lane: AttemptLane = 'descend'): Promise<AttemptOpened> {
  // ⛔ THE PARENT IS STAMPED **IN THE RPC**, NOT HERE, AND THAT IS NOT AN IMPLEMENTATION DETAIL. This function
  // does not INSERT — `universe_attempt_open` (migrations/082, SECURITY DEFINER) owns the only INSERT that
  // ever writes an `attempt_started` row, because `attempt_no` must be derived under an advisory lock. The
  // 2026-08-18 adversary pass caught the banked design saying "written by the consumer": the consumer cannot
  // write it, it can only PASS it. Sending null is the same as sending nothing — the row reads UNKNOWN.
  const { data, error } = await supabaseAdmin.rpc('universe_attempt_open', {
    p_client_id: k.clientId,
    p_vendor: k.vendor,
    p_resource: k.resource,
    p_segment: k.segment,
    p_window_start: k.windowStart,
    p_window_end: k.windowEnd,
    p_requests: requests,
    p_parent_window_start: parent?.startDate ?? null,
    p_parent_window_end: parent?.endDate ?? null,
    p_message_key: prov?.messageKey ?? null,
    p_invocation_id: prov?.invocationId ?? null,
    p_lane: lane,
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
  prov?: WriteProvenance,
): Promise<void> {
  const { error } = await supabaseAdmin.from('universe_attempt_log').insert({
    client_id: k.clientId, vendor: k.vendor, resource: k.resource, segment: k.segment,
    window_start: k.windowStart, window_end: k.windowEnd,
    attempt_no: attemptNo, phase: 'day_committed', day, rows_written: rowsWritten,
    message_key: prov?.messageKey ?? null, invocation_id: prov?.invocationId ?? null,
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
  prov?: WriteProvenance,
): Promise<void> {
  const { error } = await supabaseAdmin.from('universe_attempt_log').insert({
    client_id: k.clientId, vendor: k.vendor, resource: k.resource, segment: k.segment,
    window_start: k.windowStart, window_end: k.windowEnd,
    attempt_no: attemptNo, phase: 'attempt_finished', outcome,
    message_key: prov?.messageKey ?? null, invocation_id: prov?.invocationId ?? null,
    rows_written: detail.rowsWritten ?? null,
    requests_spent: detail.requestsSpent ?? null,
    refused_rows: detail.refusedRows ?? null,
    disk_free_bytes: detail.diskFreeBytes ?? null,
    error: detail.error ?? null,
  })
  if (error) fail('attempt_finished', error)
}


/**
 * PHASE 4 — ⛔ THE MESSAGE IS FINISHED. THE FACT THAT DID NOT EXIST, AND WHOSE ABSENCE MADE EVERY OBSERVER
 * GUESS. LORAMER_COMPLETION_SIGNAL_V1.
 *
 * ⛔ IT IS WRITTEN FROM A `finally`, ON EVERY EXIT PATH INCLUDING AN UNCAUGHT THROW. The consumer has NINE
 * exits — eight bare returns and a throw — and its only `try` wrapped one range. A per-return write would have
 * covered eight of nine, and the ninth is the one that matters: `appendAttemptStarted` and
 * `appendAttemptFinished` throw BY DESIGN, so the paths most likely to end badly were the paths least likely
 * to record it.
 *
 * ⛔ IT CARRIES **NO OUTCOME**, DELIBERATELY, AND THE REASON IS A CONSTRAINT RATHER THAN A PREFERENCE.
 * `universe_attempt_log_outcome_ck` binds `outcome` to `phase = 'attempt_finished'` BY STRUCTURE — a new phase
 * is admitted only with `outcome IS NULL`. Carrying one would mean rewriting that constraint's shape, not its
 * value list: a SECOND 23514-class change on the very constraint that produced a live incident on 2026-08-17.
 * The exit reason goes in `error`, which is free text and carries no CHECK, so nothing is lost but the cost.
 *
 * ⚠ `attemptNo` IS 1 AND IS NOT AN ATTEMPT COUNT. `universe_attempt_log_attempt_no_ck` requires >= 1 and a
 * message is not a try; the number is a constraint tax, stated so nobody reads meaning into it.
 */
export async function appendMessageFinished(
  k: AttemptKey,
  detail: { error?: string | null } = {},
  prov?: WriteProvenance,
): Promise<void> {
  const { error } = await supabaseAdmin.from('universe_attempt_log').insert({
    client_id: k.clientId, vendor: k.vendor, resource: k.resource, segment: k.segment,
    window_start: k.windowStart, window_end: k.windowEnd,
    parent_window_start: k.windowStart, parent_window_end: k.windowEnd,
    attempt_no: 1, phase: TERMINAL_PHASE,
    error: detail.error ?? null,
    message_key: prov?.messageKey ?? null, invocation_id: prov?.invocationId ?? null,
  })
  if (error) fail('message_finished', error)
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
