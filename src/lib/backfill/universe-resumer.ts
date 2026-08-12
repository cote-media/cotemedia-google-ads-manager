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
 *   · at an hourly cadence that is 24 fires/day
 *   · 40 requests/fire × 24 = **960/day = 7.1% of the lane**, leaving ~93% headroom — deliberately, so
 *     variance, re-walks and anything a human starts are absorbed retry-free rather than sized-to-the-brim
 *   · ⛔ THE REAL LIMITER IS NOT THE LANE, IT IS THE CONSUMER QUEUE'S WORST-CASE DRAIN: each published
 *     message is one consumer invocation bounded by WALK_BUDGET_MS = 180s, delivered at maxConcurrency 2
 *     (vercel.json), so a fire of 40 all-worst-case messages drains in 40 × 180s ÷ 2 = 3,600s — EXACTLY the
 *     fire interval. 40 is the largest bite whose worst case cannot back the queue into the next fire.
 *     (Typical observed is ~6s/message — the first unattended night drained 20 in ~62s — and a backlog
 *     would be SAFE anyway: idempotency keys dedupe re-publishes and coverage is derived; the bound is for
 *     smoothness, not correctness.)
 *   · the resumer itself does not stretch with the bite — its ~60-90s duration is the coverage SCAN
 *     (≤MAX_ENTRIES_SCANNED_PER_RUN entries), and the first night's fires found ~59 candidate ranges per
 *     60-entry scan, so a bite of 40 is reachable without raising the scan cap
 *   · the WORST case is the same number, because the bound counts ranges rather than messages — a window
 *     fragmented into 15 owed ranges consumes 15 of the 40 and the run stops there
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
}): ResumeVerdict {
  const { owedDays, attemptsAtMinSpan, maxAttemptsAtMinSpan, spanDays, minSpanDays, last } = a

  if (owedDays === 0) return { publish: false, verdict: 'nothing-owed', reason: 'nothing owed in this window' }

  // ⛔ BROKEN — AND ONLY AT THE MINIMUM SPAN. Three failures at 30 days is MIS-SIZED and the consumer
  // narrows. Three at one day means one day of one entry cannot complete in 300 s: there is nothing left to
  // narrow, so it STOPS BEING PUBLISHED and becomes reportable. Never silently retried forever.
  if (spanDays <= minSpanDays && attemptsAtMinSpan >= maxAttemptsAtMinSpan) {
    return { publish: false, verdict: 'broken', reason: `BROKEN: ${attemptsAtMinSpan} attempt(s) at the ${minSpanDays}-day minimum span. Nothing left to narrow — this is reportable, not retryable.` }
  }

  // ⛔ NO PROGRESS — June's rule.
  if (last.outcome !== null && (last.outcome === 'ok' || last.outcome === 'zero') && last.daysCommitted === 0) {
    return {
      publish: false, verdict: 'no-progress',
      reason: `NO PROGRESS: the last attempt (#${last.attemptNo}) reported '${last.outcome}' and committed ZERO days, yet ${owedDays} day(s) are still owed. ` +
        `A lap that changed nothing will change nothing next time (June: BackfillControl.tsx:81-83). ` +
        (last.outcome === 'zero'
          ? `An honest zero should have attested these days empty and removed them from the owed set; it did not, so the attestation is not taking.`
          : `A successful attempt that committed no days did not do the work it reported.`),
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
