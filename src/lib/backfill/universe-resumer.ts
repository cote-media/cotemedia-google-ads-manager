// LORAMER_UNIVERSE_RESUMER_V1 — THE DECISIONS. Pure, so the guard drives them with no DB and no vendor.
//
// ⛔ THE FAILURE MODE THIS FILE EXISTS TO PREVENT, STATED FIRST BECAUSE IT IS THE WHOLE RISK OF STEP 7:
// **A SCHEDULER OVER A WRONG COVERAGE ANSWER PUBLISHES WRONG WORK FOREVER, UNATTENDED.** Every recovery on
// 2026-08-08 required a human to name a row id; the resumer removes the human, and that is exactly what
// makes it dangerous. Coverage has been proven for ONE entry, ONE month, ONE platform. So every decision
// below is written to REFUSE AND RECORD rather than publish, and the refusals are the point of the file.
//
// ⛔ THREE PROPERTIES CARRIED FORWARD FROM THE JUNE ENGINE, WHICH IS THE ONLY VERSION OF THIS THAT EVER
// SHIPPED AS A BUTTON A PERSON PRESSED:
//   1. **THE NO-PROGRESS BOUND** — `BackfillControl.tsx:81-83`,
//      `if (earliest && earliest === lastEarliest) break`. A lap that did not move the cursor STOPS.
//      Not "retry three times" — stop, because a lap that changed nothing will change nothing next time.
//      ⛔ v2'S EXISTING BOUND CANNOT DO THIS: attempts-at-minimum-span fires on FAILURES, and a lap that
//      SUCCEEDS and covers zero new days is not a failure. It would sail straight past. The three
//      300-second poison loops were laps that changed nothing and re-published forever.
//   2. **THE DRIVER OWNS THE LOOP** — `BackfillControl.tsx:64-86` runs one lap per POST and re-reads state
//      between laps; the engine never schedules itself. The walk inverted that (each message publishes its
//      own successor) and became unbounded. See `windowsRemaining: 1` in the route.
//   3. **WRITE-THEN-ADVANCE-PER-UNIT** — `run-backfill.ts:242-260`: rows are written, THEN the cursor
//      advances, per chunk, inside the loop. v2 holds it at DAY grain in `universe-stream-capture`'s
//      `flush()`. The resumer cannot break it because it never writes rows or day commits at all — it only
//      publishes. That is asserted by a guard rather than left as a property of this comment.

export type ResumeVerdict =
  | { publish: true; reason: string }
  | { publish: false; verdict: 'broken' | 'no-progress' | 'nothing-owed' | 'implausible' | 'bound'; reason: string }

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// BOUNDS — OURS, WITH ARITHMETIC. NOT VENDOR TRUTH.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ THE BOUND IS ON **REQUESTS THE PUBLISHED WORK WILL COST**, NOT ON MESSAGES — AND THAT DISTINCTION IS
 * THE 15× OVERSPEND. On 2026-08-08 ONE approved message matched 15 catalog entries and spent 15 GAQL
 * requests / 261,977 rows. A message is not a request, and the resumer knows the difference BEFORE it
 * publishes because it has already computed the owed ranges: **one owed range = one vendor request.**
 *
 * THE ARITHMETIC, and every number in it is ours or the governor's — none of it is a vendor claim.
 * ⛔ RE-DERIVED 2026-08-12 (LORAMER_WALK_BITE_40_V1) — the original block cited the RETIRED 6,000 allowance
 * and the retired 4,000/5,000 reserves; the numbers below are the ones in force, and the guard pins the
 * constant and this derivation TOGETHER so they cannot drift apart again:
 *   · the walk's lane is LANE_ALLOCATIONS.backfill = 13,500 ops/day (LORAMER_WALK_TAKES_THE_LANE_V1)
 *   · ⛔ RE-DERIVED AGAIN 2026-08-19 (DEPLOY 3) — the cadence is now every 5 minutes, i.e. 288 fires/day,
 *     and the BITE IS UNCHANGED at 40. (The cron token itself is not written here: the
 *     asterisk-slash form would CLOSE THIS COMMENT BLOCK and turn the rest of the header into code. It cost
 *     one red guard to learn; vercel.json holds the token and the consumer guard pins it byte-for-byte.)
 *     ⛔ THE GATE THAT AUTHORISED IT WAS A MEASUREMENT OF THE LANE, NOT AN APPETITE FOR THROUGHPUT. Trailing
 *     24h at the 15-minute cadence, read from the ledgers rather than modelled (⛔ AND THE TOKEN IS SPELLED
 *     OUT IN WORDS HERE FOR THE REASON THIS HEADER ALREADY GAVE, WHICH I WALKED INTO ANYWAY ON THE VERY EDIT
 *     THAT RAISED THE CADENCE: the asterisk-slash form closed this block and broke the build): the walk spent 3,215 REAL vendor
 *     requests of its 13,500 lane (24%), the whole fleet 4,421 of the 15,000 cap — 10,579 requests/day
 *     unspent, every day, against 436,616 days of ground still owed on ONE client. Both of the walk's own
 *     bounds sat at the wall (scan 60.0/60 on 96 of 96 fires; 37.6 of the 40-request bite) while neither the
 *     meter nor the quota sentinel held a single fire. ⇒ THE BITE WAS NOT THE THING TO RAISE: with the scan
 *     already binding, a bigger bite has nothing to bite. (DEPLOY 2, 2026-08-17, had moved hourly → 15 min
 *     on its own gate — a measured fire with rows_written > 0, met at 88,140 rows/24h against the
 *     migration-070 RPC counter, which read a structural zero until 2026-08-15.)
 *   · 40 requests/fire × 288 = **11520/day = 85.3% of the lane**, leaving ~15% headroom — still deliberately
 *     unsized-to-the-brim, so variance, re-walks and anything a human starts are absorbed retry-free.
 *     (Was 3840/day = 28.4% at 96 fires, and 960/day = 7.1% hourly.)
 *   · ⛔ THE REAL LIMITER IS NOT THE LANE, IT IS THE CONSUMER QUEUE'S WORST-CASE DRAIN, AND IT IS WHY THE TWO
 *     DEPLOY TOKENS ARE ONE DECISION RATHER THAN TWO KNOBS: each published message is one consumer
 *     invocation bounded by WALK_BUDGET_MS = 180s, delivered at maxConcurrency 24 (vercel.json), so a fire of
 *     40 all-worst-case messages drains in 40 × 180s ÷ 24 = 300s — EXACTLY the new fire interval, precisely as
 *     40 × 180s ÷ 8 = 900s was exactly the 15-minute one and 40 × 180s ÷ 2 = 3,600s the hourly one. Cutting
 *     the interval WITHOUT raising the concurrency in step backs the queue into the next fire; that is the
 *     property being preserved, not a coincidence of the numbers. 40 remains the largest bite whose worst
 *     case cannot back the queue up.
 *     ⛔ AND THAT IDENTITY IS NO LONGER ONLY WRITTEN DOWN — it is EXECUTED by
 *     `tests/guards/queue-drain-fits-the-interval.guard.mjs` (LORAMER_DRAIN_FITS_THE_INTERVAL_V1), which
 *     reads all four terms from their own sources and was SEEN RED at 5 minutes with concurrency 8 (900s
 *     drain against a 300s interval, 3.00× over) before the concurrency was raised. For two deploys this
 *     paragraph was the only thing holding the property, and a cadence change alone would have passed all
 *     133 guards.
 *     (Typical observed is ~6s/message — the first unattended night drained 20 in ~62s — and a backlog
 *     would be SAFE anyway: idempotency keys dedupe re-publishes and coverage is derived; the bound is for
 *     smoothness, not correctness.)
 *   · the resumer itself does not stretch with the bite — its duration is the coverage SCAN
 *     (≤MAX_ENTRIES_SCANNED_PER_RUN entries), MEASURED over 96 fires at min 75.6s / avg 96.4s / p95 130.8s /
 *     max 157.4s against its own maxDuration of 300s, so a bite of 40 is reachable without raising the scan
 *     cap. ⚠ AT A 5-MINUTE CADENCE THAT maxDuration EQUALS THE INTERVAL: a slow fire can overlap the next.
 *     Overlap is SAFE — publishes are idempotency-keyed and owed-ness is derived — but it is a real change
 *     in shape, and the worst fire measured (157.4s) sits at 52% of the interval rather than 17%.
 *   · the WORST case is the same number, because the bound counts ranges rather than messages — a window
 *     fragmented into 15 owed ranges consumes 15 of the 40 and the run stops there
 * ⛔ AND THE INVARIANT THAT MAKES "EXACT" TRUE RATHER THAN MERELY TRUE-TODAY — `sizing.maxDays` ≤ THIS.
 * `boundedSelection` admits an over-budget candidate ALONE when nothing has been taken yet (see its own
 * ⚠ below: skipping it forever would starve the most fragmented entries), so the real worst case per fire is
 * `max(MAX_REQUESTS_PER_RUN, largest single candidate's ranges)`. Ranges ≤ owed days ≤ window days ≤
 * `sizing.maxDays` (30 on Google, google-ads.adapter.ts:159), and 30 ≤ 40 — so the worst case IS 40.
 * Raise `maxDays` past this constant and the bound stops being exact with nothing to announce it, which is
 * why `universe-horizon-recedes.guard.mjs` leg (d) pins the RELATIONSHIP rather than either number.
 * ⛔ `MAX_PUBLISH_WITHOUT_FLAG = 4` (universe-start:50) IS THE WRONG BOUND TO REUSE AND IS DELIBERATELY NOT
 * REUSED. It bounds an OPERATOR's fan-out on a path where a human is present to say the dangerous thing out
 * loud. The resumer has no human, publishes single-window work rather than chains, and needs a bound
 * expressed in the unit that actually gets spent.
 */
export const MAX_REQUESTS_PER_RUN = 40

/**
 * ⛔ AND A SECOND, INDEPENDENT BOUND ON HOW MUCH THE RUN MAY *LOOK* AT. Coverage costs ~30 indexed reads per
 * entry; the catalog holds 559 delivering entries, so an unbounded scan is ~16,800 DB reads before a single
 * message is published. This caps the scan whether or not anything turns out to be owed, so a run that
 * finds nothing still terminates in bounded time.
 */
export const MAX_ENTRIES_SCANNED_PER_RUN = 60

/**
 * ⛔ EVERY PUBLISHED MESSAGE WALKS EXACTLY ONE WINDOW AND DOES NOT SELF-REPUBLISH. This is June's driver
 * shape (`BackfillControl.tsx:64` — one lap per POST, the driver re-reads between laps) transplanted to a
 * cron, and it is what makes `MAX_REQUESTS_PER_RUN` an EXACT bound rather than an opening bid.
 * With chain self-republish, publishing 4 messages starts 4 chains that each walk to the floor — ~148
 * requests from a bound that reads like 4.
 */
export const WINDOWS_PER_PUBLISHED_MESSAGE = 1

/**
 * ⛔ THE TOP-EDGE BITE — LORAMER_TOP_EDGE_LANE_V1, 2026-08-19. DERIVED FROM DEMAND, NOT CHOSEN.
 *
 * THE DEMAND IS EXACT AND IT IS NOT AN ESTIMATE: the strip grows by ONE DAY PER SURFACE PER DAY, forever,
 * because the descent's anchor only moves down (★TOP-EDGE-HAS-NO-LANE). Foam OH's catalogue holds 346
 * selectable surfaces ⇒ **346 owed strip-days/day**, and one contiguous strip is ONE vendor request at any
 * span (a `segments.date BETWEEN` query is one operation — vendor-settled), so demand is **346 requests/day**.
 *
 * THE ARITHMETIC:
 *   · the cadence is 288 fires/day (5-minute cron; the token lives in vercel.json, not here)
 *   · at k slots/fire the lane can publish 288k/day
 *   · k = 1 → 288/day, BELOW the 346/day demand — the strip would grow faster than it is held. REFUSED.
 *   · k = 2 → 576/day = 1.66× demand. **This is the smallest k that meets demand at all**, which is why it
 *     is the value and not a preference.
 *   · every surface is therefore reached within 346/576 of a day = **14.4 hours worst case**
 *   · FIRST FULL CLOSURE of the standing 2,076-day strip (346 surfaces × 6 days): 346 requests at 2/fire =
 *     173 fires × 5 minutes = **~14.4 hours**
 *   · CEILING 288 × 2 = 576/day against the ~3,100/day headroom under the 13,500 lane = 19% of headroom;
 *     ACTUAL ~346/day = 11%. The walk's descent keeps its own MAX_REQUESTS_PER_RUN = 40 untouched.
 * ⛔ IT IS A SEPARATE BOUND RATHER THAN A SHARE OF THE 40, AND THAT IS THE POINT: folding the strip into the
 * descending bite would let a fragmented descent starve the top edge, or the top edge starve the descent,
 * depending only on scan order. Two lanes, two bounds, one meter.
 */
export const TOP_EDGE_REQUESTS_PER_RUN = 2

/**
 * ⛔ THE STRIP — the ground between the DESCENT's top window and the newest day the vendor can answer for.
 * Pure, so the guard drives it with no clock and no DB.
 *
 * ⛔ `newestServable` IS AN INPUT AND IS NOT DEFAULTED HERE, DELIBERATELY. Google's own retention doc states
 * a 37-month lookback but publishes NOTHING about how far behind "today" a granular `segments.date` row
 * becomes available, and it may differ per resource. The caller supplies the value it can defend — the
 * resumer supplies YESTERDAY, which forward capture demonstrates daily for the four base grains and which is
 * an ASSUMPTION for the other 342. ⚠ THAT ASSUMPTION IS RECORDED AS ONE: it was NOT measured, and the flight
 * that measures it changes this call site, not this function.
 * ⛔ AND THE ASSUMPTION IS MADE HARMLESS RATHER THAN TRUSTED: a top-edge `zero` DOES NOT ATTEST
 * (universe-coverage.ts filters attestation to the descending lane), so a day that was merely LAGGING can
 * never be sealed as empty. It is re-asked on the next pass for the same one request. That is
 * LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 applied where the ambiguity actually lives.
 *
 * Returns null when there is no strip — the descent's top already reaches the newest servable day.
 */
export function deriveTopStrip(a: {
  /** The newest `window_end` the DESCENDING lane asked for on this surface (the rotation's `last_window_end`). */
  descendTopEnd: string | null
  /** The newest day the vendor can answer for, in the caller's frame. */
  newestServable: string
  /**
   * ⛔ THE PROBE CEILING, AND IT IS THE ADAPTER'S OWN `sizing.maxDays` — NOT A NEW CONSTANT. Without it the
   * strip is `[rotationsLastWindowEnd + 1 … yesterday]`, and the rotation returns the descent's MOST RECENT
   * window rather than its TOP — so on a surface that has receded four months the strip would span ~112 days
   * and `windowCoverage` fires ONE INDEXED PROBE PER DAY. At 60 entries × 288 fires that is ~1.9M probes/day
   * for ground the descent has already covered. Clamping to the same span the descent itself uses keeps the
   * probe cost identical to one descending window, and the lane still CONVERGES: it closes the newest
   * `maxSpanDays` per pass while the unheld gap grows one day per day.
   */
  maxSpanDays: number
}): { windowStart: string; windowEnd: string; days: number } | null {
  const { descendTopEnd, newestServable, maxSpanDays } = a
  // ⛔ A SURFACE THE DESCENT HAS NEVER ASKED HAS NO STRIP TO HOLD — it has a WHOLE HISTORY, and that is the
  // descending lane's job. Publishing a strip here would put the first-ever attempt on a surface into the
  // lane the rotation ignores, and the descent would then anchor at the newest ground and re-walk it.
  if (descendTopEnd === null) return null
  const rawStart = addDaysISO(descendTopEnd, 1)
  if (rawStart > newestServable) return null
  const clamped = addDaysISO(newestServable, -(Math.max(1, maxSpanDays) - 1))
  const windowStart = rawStart > clamped ? rawStart : clamped
  const days = Math.round((Date.parse(newestServable + 'T00:00:00Z') - Date.parse(windowStart + 'T00:00:00Z')) / 86_400_000) + 1
  return { windowStart, windowEnd: newestServable, days }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// IMPLAUSIBLE COVERAGE — REFUSE AND RECORD
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CoverageShape {
  covered: string[]
  attestedEmpty: string[]
  uncovered: string[]
}

/**
 * ⛔ COVERAGE HAS BEEN PROVEN FOR ONE ENTRY, ONE MONTH, ONE PLATFORM. A scheduler that trusts it
 * unconditionally publishes wrong work forever, so it is checked against ARITHMETIC AND DECLARED FACTS
 * EVERY RUN — not because a specific bug is suspected, but because the cost of being wrong is unbounded and
 * the cost of checking is three comparisons.
 *
 * ⚠ THIS IS NOT A CORRECTNESS PROOF AND MUST NOT BE READ AS ONE. It catches coverage that CONTRADICTS
 * ITSELF or contradicts the adapter's floor. Coverage that is quietly, self-consistently wrong — every day
 * marked covered when rows are missing — passes here and is caught by nothing in this file. Gate-B and the
 * hand-check against `metrics_daily_p_2025_12` are what stand between us and that, and they are HUMAN steps.
 */
export function assessCoverage(a: {
  windowStart: string
  windowEnd: string
  coverage: CoverageShape
  /** The adapter's floor. null means the vendor imposes NO wall (GA4, Shopify, WooCommerce). */
  floorDate: string | null
  /** Does the warehouse hold ANY row for this entry, at any date? */
  entryHasAnyRows: boolean
}): { plausible: boolean; reason: string } {
  const { windowStart, windowEnd, coverage, floorDate, entryHasAnyRows } = a
  const days = Math.round((Date.parse(windowEnd + 'T00:00:00Z') - Date.parse(windowStart + 'T00:00:00Z')) / 86_400_000) + 1

  if (days <= 0) return { plausible: false, reason: `window is inverted or empty: ${windowStart}..${windowEnd}` }

  // (1) ⛔ THE OWED RANGE MAY NOT EXCEED THE DECLARED WINDOW. A larger owed set than the window it came from
  // is arithmetically impossible, so it means the coverage read is not answering the question it was asked.
  if (coverage.uncovered.length > days) {
    return { plausible: false, reason: `owed ${coverage.uncovered.length} day(s) for a ${days}-day window ${windowStart}..${windowEnd} — LARGER THAN DECLARED. Coverage is not answering the question it was asked.` }
  }

  // (2) ⛔ THE THREE SETS MUST PARTITION THE WINDOW. Anything else means days were double-counted or lost,
  // and a lost day is a gap that would never be walked.
  const total = coverage.covered.length + coverage.attestedEmpty.length + coverage.uncovered.length
  if (total !== days) {
    return { plausible: false, reason: `covered ${coverage.covered.length} + attestedEmpty ${coverage.attestedEmpty.length} + uncovered ${coverage.uncovered.length} = ${total}, but the window holds ${days} day(s). The three sets must PARTITION the window; anything else means a day was double-counted or LOST, and a lost day is a gap nothing would ever walk.` }
  }

  // (3) ⛔ NOTHING BELOW A NON-NULL FLOOR MAY BE OWED. Publishing there spends quota to learn what the
  // adapter already declares. A NULL floor means the vendor imposes no wall at all, so this check does not
  // apply — and must not be faked into applying, which would invent a wall from silence.
  if (floorDate !== null) {
    const below = coverage.uncovered.filter((d) => d < floorDate)
    if (below.length) {
      return { plausible: false, reason: `${below.length} owed day(s) fall BELOW the declared floor ${floorDate} (earliest ${below[0]}). Publishing there spends quota to learn what the adapter already declares.` }
    }
  }

  // (4) ⛔ AN EMPTY OWED SET ON AN ENTRY WITH NO ROWS ANYWHERE AND NO ATTESTATION IS A FALSE ALL-CLEAR — and
  // a false all-clear is the failure class this entire rebuild exists to end. It reads as "complete" while
  // nothing has ever been captured.
  if (coverage.uncovered.length === 0 && !entryHasAnyRows && coverage.attestedEmpty.length === 0) {
    return { plausible: false, reason: `NOTHING OWED, but this entry holds NO rows at any date and carries NO attested-empty record. That is a FALSE ALL-CLEAR: it reads as complete while nothing has ever been captured.` }
  }

  return { plausible: true, reason: `${coverage.covered.length} covered · ${coverage.attestedEmpty.length} attested-empty · ${coverage.uncovered.length} owed of ${days} day(s)` }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE REPUBLISH DECISION
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface LastAttempt {
  /** The most recent `attempt_finished` for THIS EXACT RANGE, or null if there has never been one. */
  outcome: string | null
  attemptNo: number | null
  /** How many `day_committed` records that attempt wrote. */
  daysCommitted: number
}

/**
 * ⛔ THE NO-PROGRESS BOUND — JUNE'S, AT `BackfillControl.tsx:81-83`, AND THE DEFENCE v2 DID NOT HAVE.
 *
 * v2's existing bound counts ATTEMPTS AT THE MINIMUM SPAN and fires on FAILURES. **A lap that SUCCEEDS and
 * covers zero new days is not a failure**, so it sails past that bound and the resumer would re-publish it
 * every run, forever, unattended. June's rule is the one that catches it: if the lap did not move the
 * cursor, STOP. Here the cursor is the owed set.
 *
 * ⛔ IT NEEDS NO NEW COLUMN, AND THAT MATTERS BECAUSE THE LOG IS APPEND-ONLY. "Did the last successful
 * attempt make progress" is derivable: the most recent `attempt_finished` for this exact range, and how
 * many `day_committed` records its `attempt_no` wrote.
 *
 * ⚠ AND THE ONE THAT LOOKS LIKE AN EXCEPTION AND IS NOT: `outcome='zero'` with zero days committed is a
 * PERFECTLY HONEST result — the vendor answered and named nothing. But an honest zero writes an
 * `attempt_finished` that `attestedEmptyDays()` then reads, so those days come back ATTESTED-EMPTY and are
 * no longer owed. **If the range is STILL owed after a `zero`, the attestation did not take, and
 * re-publishing would loop on it forever.** Refuse.
 */
export function decideRepublish(a: {
  owedDays: number
  attemptsAtMinSpan: number
  maxAttemptsAtMinSpan: number
  spanDays: number
  minSpanDays: number
  last: LastAttempt
  /**
   * ⛔ LORAMER_NO_PROGRESS_TESTS_THE_OWED_SET_V1 — OPTIONAL, AND ITS ABSENCE MUST MEAN "UNKNOWN", NEVER
   * "STALLED". How many days this SAME range owed when the last attempt ran. Derived by the caller from the
   * range's own span — `readLastAttempt` is keyed on the exact bounds, so the attempt found there was
   * published over that whole range. Undefined ⇒ the shrink test does not run and the bound behaves exactly
   * as it did before this field existed.
   */
  owedDaysAtLastAttempt?: number
}): ResumeVerdict {
  const { owedDays, attemptsAtMinSpan, maxAttemptsAtMinSpan, spanDays, minSpanDays, last, owedDaysAtLastAttempt } = a

  if (owedDays === 0) return { publish: false, verdict: 'nothing-owed', reason: 'nothing owed in this window' }

  // ⛔ BROKEN — AND ONLY AT THE MINIMUM SPAN. Three failures at 30 days is MIS-SIZED and the consumer
  // narrows. Three at one day means one day of one entry cannot complete in 300 s: there is nothing left to
  // narrow, so it STOPS BEING PUBLISHED and becomes reportable. Never silently retried forever.
  if (spanDays <= minSpanDays && attemptsAtMinSpan >= maxAttemptsAtMinSpan) {
    return { publish: false, verdict: 'broken', reason: `BROKEN: ${attemptsAtMinSpan} attempt(s) at the ${minSpanDays}-day minimum span. Nothing left to narrow — this is reportable, not retryable.` }
  }

  // ⛔ NO PROGRESS — June's rule.
  // 'nongrain' is a COMPLETED pass exactly like 'ok' and 'zero' — the vendor was asked and answered
  // (LORAMER_NONGRAIN_ATTESTS_V1). Omitting it here would leave the no-progress bound blind to the one
  // outcome most likely to repeat.
  const completed = last.outcome !== null && (last.outcome === 'ok' || last.outcome === 'zero' || last.outcome === 'nongrain')
  if (completed && last.daysCommitted === 0) {
    return {
      publish: false, verdict: 'no-progress',
      reason: `NO PROGRESS: the last attempt (#${last.attemptNo}) reported '${last.outcome}' and committed ZERO days, yet ${owedDays} day(s) are still owed. ` +
        `A lap that changed nothing will change nothing next time (June: BackfillControl.tsx:81-83). ` +
        (last.outcome === 'zero'
          ? `An honest zero should have attested these days empty and removed them from the owed set; it did not, so the attestation is not taking.`
          : `A successful attempt that committed no days did not do the work it reported.`),
    }
  }
  // ⛔ LORAMER_NO_PROGRESS_TESTS_THE_OWED_SET_V1 — THE SECOND SHAPE, AND IT IS THE ONE THAT ACTUALLY BIT.
  // The bound above asks "did the lap commit a day". The real stall commits EXACTLY ONE day per pass and
  // shrinks the owed set by NOTHING, because `coveredDaysStrict` strips the newest day-with-rows: measured
  // 2026-08-17, 340 of 346 Foam OH surfaces re-asked an identical range for an average of 10.4 hours while
  // this bound sat silent at 1 !== 0. Committing a day is not progress; SHRINKING THE OWED SET is.
  // ⛔ IT IS A SEPARATE BRANCH RATHER THAN A WIDER CONDITION, AND THAT IS DELIBERATE. Dropping the
  // `daysCommitted === 0` conjunct instead would refuse a legitimately fragmented window — an attempt that
  // committed 12 of 30 days and still owes 5 MUST be re-published or the walk never finishes it.
  // `universe-resumer.guard.mjs` leg (f) pins exactly that case and caught this being got wrong.
  // ⛔ AND UNKNOWN NEVER STALLS A WALK: with `owedDaysAtLastAttempt` undefined this branch cannot fire, so
  // every caller that has not been taught to derive it behaves exactly as before.
  if (completed && owedDaysAtLastAttempt !== undefined && owedDays >= owedDaysAtLastAttempt) {
    return {
      publish: false, verdict: 'no-progress',
      reason: `NO PROGRESS: the last attempt (#${last.attemptNo}) reported '${last.outcome}' over THIS EXACT RANGE and committed ${last.daysCommitted} day(s), ` +
        `yet the owed set did not shrink — ${owedDaysAtLastAttempt} day(s) owed then, ${owedDays} now. ` +
        `Committing a day is not progress; shrinking the owed set is. Re-publishing spends a vendor request to re-write ground we already hold.`,
    }
  }

  return { publish: true, reason: `${owedDays} day(s) owed, ${attemptsAtMinSpan} attempt(s) at this span` }
}

/**
 * ⛔ BOUNDED BY CONSTRUCTION, IN THE UNIT THAT GETS SPENT. Takes candidates in scan order and returns the
 * prefix whose TOTAL OWED RANGES fit the budget — because one owed range is one vendor request, and a
 * message is not a request (the 15× overspend: one approved message, fifteen requests).
 *
 * ⚠ AN ITEM THAT ALONE EXCEEDS THE BUDGET IS **NOT SKIPPED**, because skipping it forever would silently
 * starve the most fragmented entries — the ones most likely to be genuinely broken. It is admitted alone
 * when nothing has been taken yet, and the run stops after it.
 */
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE HORIZON — LORAMER_WALK_HORIZON_RECEDES_V1
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ WHAT WAS BROKEN, MEASURED BEFORE IT WAS CHANGED. The route read `const windowEnd = yesterday` — every
 * window, every fire, every surface, anchored at yesterday and never moving. **MEASURED 2026-08-13 on the
 * live attempt log: 244 vendor requests since 2026-08-10 23:52Z and ZERO ROWS WRITTEN, EVER. The oldest
 * window_start ever attempted is 2026-07-12 — 1,622 days above Foam OH's discovered floor of 2022-03-04.**
 * The scheduled walk was a second forward-capture loop re-buying the newest attested day every hour.
 *
 * ⛔ THE RECESSION IS DERIVED, NOT STORED, AND THAT IS THE WHOLE DESIGN CONSTRAINT. `universe-resumer.guard`
 * leg (a) forbids a stored owed-list or a cursor, and it is right to: on 2026-08-08 the walk's own owed list
 * was measured WRONG IN BOTH DIRECTIONS on the very range it was consulted about. So the anchor is recomputed
 * every fire from the append-only attempt log — a fact about WHAT WE ASKED FOR, never a claim about what is
 * captured. That separation is the same one `universe-sizing.ts` already respects and states in its header:
 * the attempt log may answer "what did we ask, and what came back"; ONLY `universe-coverage` may answer
 * "is this captured".
 *
 * ⛔ AND THE UNIT IT RECEDES BY IS THE **WINDOW THAT WAS ASKED** — LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1,
 * 2026-08-18. For a year it was the LAST RANGE WRITTEN, because five writers shared one column pair and the
 * rotation returned whichever row was newest. Ranges are walked in ASCENDING date order, so the newest row is
 * the range nearest the TOP of the window and the anchor gained ONE DAY per pass. MEASURED by
 * `scripts/drive-one-surface.mjs`, five consecutive passes, zero variance: ~1,427 passes and ~2,854 vendor
 * requests to floor ONE surface, ~4 years each, 346 surfaces — the walk could not reach inception at all.
 * `universe_attempt_log.parent_window_start/end` (migrations/082) records the ask; the rotation prefers it and
 * reports `parent_known`; a row without one is UNKNOWN and HOLDS. See the branch below and the § PROGRESS-TRUTH
 * spec in docs/LORAMER_WALK_REBUILD_ARCHITECTURE.md.
 *
 * ⛔ AND IT RECEDES ONLY OVER A WINDOW THAT IS ALREADY ANSWERED — the property that stops recession from
 * becoming skipping. The anchor moves below the LAST WINDOW ASKED only when that window owes nothing. A
 * window that still owes days HOLDS the anchor and is re-published, and `decideRepublish`'s no-progress
 * bound is what stops THAT from looping forever. **Receding past an unanswered day would be the
 * false-all-clear class this whole rebuild exists to end, arriving through a scheduler instead of a
 * coverage read.**
 *
 * ⛔ ONE WINDOW AT A TIME, AND THE REASON IS A COST MEASUREMENT, NOT A STYLE CHOICE. The first shape of this
 * checked the ENTIRE already-walked band before receding, which is strictly stronger and was rejected on
 * arithmetic: `windowCoverage` fires ONE INDEXED PROBE PER DAY (universe-coverage.ts:122), so at Foam OH's
 * 1,622-day depth that is 1,622 probes per surface × 60 surfaces = ~97k probes per fire. Checking the last
 * window only is 30 probes, and every window in the chain passed the SAME check when it was the anchor.
 *
 * ⚠ THE LIMIT THAT BUYS, STATED RATHER THAN GLOSSED: a window answered when it was the anchor and later
 * losing rows is not revisited by this scheduler — the anchor only moves down. That is a re-walk's job, not
 * a scheduler's, and it is a KNOWN gap rather than a covered one.
 */
export function deriveAnchorEnd(a: {
  /** Yesterday, in the caller's frame. The newest ground the vendor can answer for. */
  newestGround: string
  /** The most recent window this surface was ASKED for, or null if it never has been. */
  lastWindowStart: string | null
  lastWindowEnd: string | null
  /** Does that last window still owe days? Only a fully-answered window may be receded past. */
  lastWindowFullyAnswered: boolean
  /**
   * ⛔ IS THAT REALLY A WINDOW, OR ONLY THE RANGE WE HAPPENED TO WRITE LAST?
   * `universe_surface_rotation.parent_known` (migrations/082). FALSE = the row predates the parent stamp, so
   * the bounds above are RANGE bounds wearing a window's name. Defaults to FALSE so a caller that forgets to
   * pass it gets the SAFE answer rather than the fast one.
   */
  lastWindowKnown?: boolean
}): { anchorEnd: string; receded: boolean; basis: string } {
  const { newestGround, lastWindowStart, lastWindowEnd, lastWindowFullyAnswered } = a
  const lastWindowKnown = a.lastWindowKnown === true
  if (lastWindowStart === null || lastWindowEnd === null) {
    return { anchorEnd: newestGround, receded: false, basis: `never attempted — anchored at the newest ground ${newestGround}` }
  }
  // ⛔ UNKNOWN IS NOT "ANSWERED", AND IT IS NOT "UNANSWERED" EITHER — IT IS **DO NOT MOVE**.
  // LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1, and this branch is the transitional half of it. A legacy row carries
  // no parent, and the window it belonged to is recoverable from NO STORED FACT: sizing is adaptive and
  // time-varying, so yesterday's window cannot be re-derived from today's policy — the same argument that
  // ruled out recomputation, applied backwards. Receding by bounds we cannot vouch for is precisely the
  // false-all-clear this rebuild exists to end, so an unknown window is never receded past.
  // ⚠ THE RESIDUAL, STATED RATHER THAN GLOSSED: holding at `lastWindowEnd` still ANCHORS AT A RANGE'S END on a
  // legacy row, and a range's end can sit below the true window top. That is today's behaviour, unchanged and
  // not made worse — and it ends for a surface the moment ONE parent-stamped `attempt_started` lands on it,
  // which is one consumer pass. It is a transitional exposure with a known end, not a design position.
  if (!lastWindowKnown) {
    return {
      anchorEnd: lastWindowEnd, receded: false,
      basis: `the last attempt on this surface carries NO parent window (a pre-082 row) — the bounds ${lastWindowStart}..${lastWindowEnd} are a RANGE, not the window that was asked. UNKNOWN does not authorise a recession; holding until a parent-stamped attempt lands`,
    }
  }
  if (!lastWindowFullyAnswered) {
    return {
      anchorEnd: lastWindowEnd, receded: false,
      basis: `the last window asked (${lastWindowStart}..${lastWindowEnd}) STILL OWES days — the anchor HOLDS there until it is answered; receding past it would skip ground nothing else walks`,
    }
  }
  const receded = addDaysISO(lastWindowStart, -1)
  return {
    anchorEnd: receded, receded: true,
    basis: `${lastWindowStart}..${lastWindowEnd} fully answered — receding to ${receded}, the day below it`,
  }
}

/**
 * ⛔ THE MIS-SIZED SPLIT — LORAMER_MISSIZE_REOWES_THE_UPPER_HALF_V1, AND IT IS A PURE FUNCTION SO THAT THE
 * PROPERTY CAN BE DRIVEN RATHER THAN ARGUED. It lives here, beside the other pure decisions, because the
 * arithmetic that decides WHICH GROUND STAYS OWED must be testable with no clock, no DB and no queue.
 *
 * ⛔ WHAT IT REPLACES: the consumer computed `narrowedEnd = startDate + half - 1` inline, published
 * `[startDate, narrowedEnd]`, and DROPPED `[narrowedEnd+1, endDate]` on the floor. Nothing republished it and
 * the resumer could not: the anchor only moves DOWN, and the narrowed window's own attempt rows pull the
 * rotation below the dropped ground on the next fire. MEASURED 2026-08-18 — 12 surfaces holding exactly the
 * 15-day upper half of a 30-day window this branch had narrowed.
 *
 * THE CONTRACT, and every clause is asserted by `mis-size-must-re-owe.guard.mjs`:
 *   · `lower` starts where the window started and is `max(minDays, floor(span/2))` days wide — unchanged.
 *   · `upper` is EXACTLY the remainder, `[lower.end + 1, windowEnd]`, or null when the narrow consumed the
 *     whole window (`span <= minDays * 2` can leave nothing above).
 *   · The two are CONTIGUOUS and DISJOINT and their union is the original window, day for day. No day of the
 *     window may belong to neither — that is the defect, restated as an invariant.
 */
export function planMisSizedSplit(a: {
  windowStart: string
  windowEnd: string
  minDays: number
}): { lower: { start: string; end: string }; upper: { start: string; end: string } | null; halfDays: number } {
  const { windowStart, windowEnd, minDays } = a
  const spanDays = Math.round((Date.parse(windowEnd + 'T00:00:00Z') - Date.parse(windowStart + 'T00:00:00Z')) / 86_400_000) + 1
  const halfDays = Math.max(minDays, Math.floor(spanDays / 2))
  const lowerEnd = addDaysISO(windowStart, halfDays - 1)
  // ⛔ CLAMPED, SO THE FUNCTION CANNOT INVENT GROUND ABOVE THE WINDOW. If the half is not smaller than the
  // window there is nothing to split; returning an `upper` past `windowEnd` would publish a message for days
  // the walk was never asked about.
  if (lowerEnd >= windowEnd) {
    return { lower: { start: windowStart, end: windowEnd }, upper: null, halfDays: spanDays }
  }
  return {
    lower: { start: windowStart, end: lowerEnd },
    upper: { start: addDaysISO(lowerEnd, 1), end: windowEnd },
    halfDays,
  }
}

/** Date arithmetic in one place, so the pure decisions above stay drivable with no clock. */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

/**
 * ⛔ THE WINDOW, CLAMPED TO THE **RESOLVED** STOP — NEVER TO A GLOBAL CONSTANT. `stopDate === null` is
 * UNKNOWN: no wall has been observed and no inception discovered, so there is nothing to clamp to and
 * inventing one would be the wall-from-silence defect (LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1).
 * Returns `null` when the anchor has fallen below the stop — that surface is COMPLETE, not owed.
 */
export function deriveWindow(a: {
  anchorEnd: string
  sizingDays: number
  stopDate: string | null
}): { windowStart: string; windowEnd: string } | null {
  const { anchorEnd, sizingDays, stopDate } = a
  if (stopDate !== null && anchorEnd < stopDate) return null
  const raw = addDaysISO(anchorEnd, -(sizingDays - 1))
  const windowStart = stopDate !== null && raw < stopDate ? stopDate : raw
  return { windowStart, windowEnd: anchorEnd }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE FLOOR SEAL — LORAMER_WALK_FLOOR_SEAL_V1
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ WHY A SEAL EXISTS. ★WALK-WEDGES-AT-FLOOR-REACHED, measured 2026-08-24: the floor-reached branch wrote
 * NOTHING, so a finished surface's rotation recency froze, it rose to the FRONT of the least-recently-asked
 * order and stayed there — at ≥60 such surfaces every scan slot was monopolised and the 268 still-owing
 * surfaces starved (descend lane silent ~15h; fire log scanned=60/candidates=0/refusals={"floor-reached":60}
 * every fire). The seal is the durable EVIDENCE (one started(0)+finished('floor_stop') pair, written ONCE)
 * and the EXCLUSION key: a sealed surface leaves the scan set instead of re-fronting forever.
 *
 * ⛔ THE SEAL IS KEYED TO THE STOP FACTS, NOT TO A STORED BOOLEAN. The pair's error text carries
 * `stop=<date> basis=«<basis>»` — the exact resolved stop the seal was written against. Every fire re-derives
 * the current stop through the ONE composition site (resolveWalkStop) and compares: SAME stop ⇒ the seal
 * holds and the surface is skipped without a slot; ANY difference (date, basis, unparseable, or a stop that
 * now resolves UNKNOWN) ⇒ the surface RE-ENTERS the scan automatically. No manual un-seal exists to forget.
 *
 * ⛔ FAIL-OPEN DIRECTION IS DELIBERATE AND ASYMMETRIC: an unparseable or mismatched seal falls open to
 * SCANNING (the surface is re-derived, worst case re-sealed for two 0-request rows), never to EXCLUSION —
 * excluding on a seal we cannot read would be sealing on silence, the defect class
 * LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 exists to end.
 */
export function parseFloorSeal(error: string | null | undefined): { stopDate: string; basis: string } | null {
  if (!error) return null
  const m = /stop=(\d{4}-\d{2}-\d{2}) basis=«([^»]+)»/.exec(error)
  if (!m) return null
  return { stopDate: m[1], basis: m[2] }
}

export function floorSealHolds(
  seal: { stopDate: string; basis: string } | null,
  current: { stopDate: string | null; basis: string },
): boolean {
  if (seal === null) return false             // unparseable ⇒ re-admit (fail-open to scanning)
  if (current.stopDate === null) return false // stop now UNKNOWN ⇒ an unknown floor cannot hold a seal
  return seal.stopDate === current.stopDate && seal.basis === current.basis
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ROTATION — LORAMER_RESUMER_SCAN_ROTATES_V1
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ WHAT WAS BROKEN, MEASURED. The route scanned `entries` in CATALOG ORDER and broke at
 * `MAX_ENTRIES_SCANNED_PER_RUN`, so entries 61..346 were unreachable BY CONSTRUCTION, forever.
 * **MEASURED 2026-08-13: 61 distinct surfaces have ever been touched (60 real + the `__account_inception`
 * pseudo-row) of 346 selectable. 286 surfaces had never been asked once, in the engine's entire scheduled
 * life.** The scan cap was doing its job — bounding the run — while the ORDER silently made it a filter.
 *
 * ⛔ LEAST-RECENTLY-ATTEMPTED, WITH NEVER-ATTEMPTED FIRST, AND STARVATION IS IMPOSSIBLE BY CONSTRUCTION
 * rather than by a fairness argument: a surface that is not scanned is not attempted, so its key does not
 * move, so it strictly rises in the order every fire until it is scanned. The tie-break is the surface label,
 * so the order is TOTAL and deterministic — a guard can drive it with no clock and no DB.
 *
 * ⚠ AND IT IS AN ORDERING READ, NOT A CURSOR. `guard leg (a)` forbids `universe_run_state`,
 * `universe_window_log` and the June `sync_state` cursor — a stored list of PENDING WORK. This reads the
 * append-only attempt log for "when did we last ask", which is the same table `sizeNextWindow` already reads
 * for "what came back last time". Owed-ness is still recomputed from `metrics_daily` and from nothing else.
 */
export function orderForRotation<T>(
  entries: T[],
  keyOf: (e: T) => string,
  lastAttemptedAt: Map<string, string>,
): T[] {
  return [...entries].sort((x, y) => {
    const kx = keyOf(x), ky = keyOf(y)
    const ax = lastAttemptedAt.get(kx), ay = lastAttemptedAt.get(ky)
    if (ax === undefined && ay !== undefined) return -1
    if (ax !== undefined && ay === undefined) return 1
    if (ax !== undefined && ay !== undefined && ax !== ay) return ax < ay ? -1 : 1
    return kx < ky ? -1 : kx > ky ? 1 : 0
  })
}

export function boundedSelection<T extends { ranges: number }>(candidates: T[], maxRequests = MAX_REQUESTS_PER_RUN): { taken: T[]; requests: number; droppedForBound: number } {
  const taken: T[] = []
  let requests = 0
  let i = 0
  for (; i < candidates.length; i++) {
    const c = candidates[i]
    if (taken.length > 0 && requests + c.ranges > maxRequests) break
    taken.push(c); requests += c.ranges
    if (requests >= maxRequests) { i++; break }
  }
  return { taken, requests, droppedForBound: candidates.length - i }
}
