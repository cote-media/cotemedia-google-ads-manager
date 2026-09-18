// LORAMER_UNIVERSE_CONSUMER_V2_V1 — the v2 walk contract: topic, message shape, and the two bounds.
//
// ⛔ IT LIVES OUTSIDE THE ROUTE FOR TWO REASONS, AND THE FIRST ONE IS A BUILD FACT THAT `tsc` CANNOT SEE.
// Next.js validates the export surface of an App Router route file and rejects anything that is not a
// recognised Route export: `Type error: Route "…/route.ts" does not match the required types of a Next.js
// Route. "TOPIC" is not a valid Route export field.` **`npx tsc --noEmit` passes that file clean.** This is
// exactly the case CLAUDE.md warns about — a full `npm run build` is the gate, and a type check is not a
// substitute for it.
//
// ⛔ AND THE DESIGN REASON, which would justify the move on its own: a PUBLISHER needs the topic and the
// message shape. Importing a route module to get them would drag a handler, its `maxDuration`, and its whole
// dependency tree into the publisher — which is how the v1 starter ended up importing from the v1 consumer.
import type { UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'

export const TOPIC = 'google-ads-universe-v2'
export const VENDOR = 'google'

/**
 * ⛔ THE BOUND THAT SEPARATES **BROKEN** FROM **MIS-SIZED**, AND IT IS EVALUATED AT THE MINIMUM SPAN.
 *
 * v1 ships `MAX_OPEN_ATTEMPTS = 3` counted at ANY span, and the 2026-08-08 poison loops hit three attempts
 * at THIRTY DAYS. That is mis-sized, not broken — and a product that says "broken" there is lying to a
 * customer about their own data. Three failures at ONE DAY is a different fact entirely: one day of one
 * entry cannot complete in 300 seconds, there is nothing left to narrow, and a human needs to know.
 */
export const MAX_ATTEMPTS_AT_MIN_SPAN = 3

/** Above the minimum span, a repeated failure means NARROW AND RETRY, never stop. */
export const NARROW_AFTER_ATTEMPTS = 2

/**
 * ⛔ EMPTY-STRETCH VISIBILITY, NOT A STOP — LORAMER_EMPTY_STRETCH_VISIBILITY_V1, 2026-08-10.
 * After this many CONSECUTIVE all-empty windows on one chain, the consumer writes ONE
 * `abandoned_owed`-class attempt record for the operator and KEEPS WALKING. Nothing is parked, nothing is
 * sealed, no new status word exists — a row's absence proves nothing (LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1),
 * so the only lawful output of a long empty stretch is VISIBILITY.
 *
 * ⛔ WHY 400, ARGUED FROM DATA AND NOT FROM TASTE: the longest dormancy gap measured anywhere in the
 * roster's held history is BusyBee Bookkeeping's **2,267 days (~6.2 years, data on BOTH sides of it)** —
 * ≈324 consecutive 7-day windows, ≈76 at 30 days. 400 windows sits ABOVE the worst dormancy ever observed
 * at ANY window size the sizer can produce, so the record fires only on something we have genuinely never
 * seen — never on a real client's real quiet years. A small N here is the park-the-surface design that was
 * adversarially killed on 2026-08-10: at N=10-20 it would have stopped BusyBee's walk mid-gap and refused
 * the 2019 history on the far side.
 */
export const EMPTY_STRETCH_REPORT_AFTER = 400

/**
 * ⛔ THE CONSUMER'S DECLARED DURATION CONTRACT — LORAMER_COMPLETION_SIGNAL_V1, and it lives HERE rather than
 * in the route because an OBSERVER needs it and must not import a handler to get it.
 *
 * ⛔ WHY THIS IS A CONTRACT AND NOT AN OBSERVATION, WHICH IS THE WHOLE POINT. Vercel's own documentation
 * (vercel.com/docs/functions/configuring-functions/duration, page last_updated 2026-07-01): *"If a function
 * runs for longer than its set maximum duration, Vercel will terminate it."* That is a PLATFORM GUARANTEE
 * enforced by someone other than the observer — the bar Temporal's Start-To-Close and SQS's visibility
 * timeout both meet, and the bar `QUIET_MS = 10_000` never met, because 10s came from a measured 1-4s
 * inter-range GAP rather than from any contract. An invocation cannot be alive past this value.
 *
 * ⛔ AND 300 IS OUR CHOICE, NOT THE PLATFORM'S CEILING. The same page gives Pro a maximum of 800s and an
 * extended maximum of 1800s. Raising this is legal and plausible; anything that hard-codes 300 elsewhere
 * becomes silently wrong the day it moves. `drive-ceiling-pin.guard.mjs` pins the route's export and the
 * drive's ceiling to THIS constant for exactly that reason.
 */
export const CONSUMER_MAX_DURATION_S = 300

/**
 * ⛔ THE FIRE-LEASE TTL — LORAMER_INLINE_FIRE_LEASE_V1, and it lives HERE, beside the ceiling it is
 * derived from, so the two can never drift apart in separate files. A lease holder cannot live past the
 * platform kill at CONSUMER_MAX_DURATION_S, so ceiling + grace covers every possible holder lifetime.
 * The 30s is a NAMED GRACE for the acquisition write landing after process start (argued ≪ 30s at pdx1;
 * not measured). THE INVARIANT (pinned by the C2 interval guard): LEASE_TTL_S > CONSUMER_MAX_DURATION_S —
 * raising the ceiling without this moving must fail the build, never silently invert the lease.
 * All TTL COMPARISON happens in DB time inside migrations/085's CAS function; this constant is passed
 * on every call and the DB default is only a fallback.
 */
export const LEASE_TTL_S = CONSUMER_MAX_DURATION_S + 30

/**
 * ⛔ THE FIRE'S WORK BUDGET — LORAMER_FIRE_DEADLINE_FROM_FIRE_START_V1, 2026-09-16. ONE number, ONE
 * clock, and the clock starts when the FIRE starts. Pinned by `inline-fire-fits-the-ceiling.guard.mjs`:
 *   FIRE_WORK_BUDGET_MS + UNIT_RESERVATION_FLOOR_MS = CONSUMER_MAX_DURATION_S × 1000
 *
 * ⛔ WHAT THIS REPLACES, AND WHY IT IS A CORRECTNESS FIX RATHER THAN A RE-TUNE. The budget used to be
 * `300,000 − SCAN_ALLOWANCE_MS − UNIT_RESERVATION_FLOOR_MS`, and the capture clock started AFTER the
 * scan (`captureStartedAt = Date.now()`). So the deadline FLOATED: every millisecond the scan ran over
 * its allowance was a millisecond added to the fire's total, invisible to the admission rule. A fire
 * that actually spent its budget ran `scan + 235,000` against a 300,000 ms kill and would have died
 * MID-WORK — the one outcome [[LORAMER_FIRE_BITE_FITS_THE_BUDGET_V1]] exists to prevent.
 *
 * ⛔ AND THE ALLOWANCE COULD NOT BE FIXED BY RAISING IT. MEASURED 2026-09-16 on the SHIPPED concurrent
 * code (n=157 wet fires since the 02:51Z bite deploy; scan derived per fire as first
 * `universe_attempt_log.recorded_at` minus fire start): min 22,963 · p50 65,380 · p90 83,848 ·
 * p99 133,891 · MAX 139,911 ms. **132 of 157 exceeded the 55,000 allowance, and 45 of 157 exceeded the
 * 71,000 the queue item proposed as its replacement** — a constant proposed against a 19-fire sample
 * was already wrong for 29% of fires one day later, because the scan's cost tracks entries × coverage
 * probes and that grows with clients and surfaces. A per-phase allowance must be re-tuned every time
 * the phase changes shape. AN ABSOLUTE DEADLINE NEVER DOES: whatever the scan spends simply is not
 * available to capture, automatically, at any scan duration including ones never measured.
 *
 * FIRE_WORK_BUDGET_MS — the latest point at which a unit may still be ADMITTED, measured from fire
 * start. The unit loop, the range admission inside the worker, and every mis-size continuation all
 * reserve against this one number via `fireDeadlineAt()`.
 *
 * UNIT_RESERVATION_FLOOR_MS — unchanged, and it is doing TWO jobs, both stated: the reservation for a
 * unit not yet measured this fire, AND the kill-margin — after the loop stops admitting, one
 * worst-case unit plus the post-loop writes (heartbeat + lease release, measured ≤82ms at pdx1) still
 * fit under the platform kill. DERIVED: all-time per-range p99 6,768ms (N=14,154) × 1.48 ≈ 10,000.
 * ⚠ The ×1.48 is a DECLARED SAFETY FACTOR, not a measurement.
 *
 * ⚠ WHAT THIS DOES **NOT** BOUND, said plainly so nobody reads it as more than it is: the SCAN itself.
 * A scan that alone exceeds the budget yields a fire that admits NOTHING and records that — safe, and
 * strictly better than today's, which would admit units and overrun the kill — but it is still a fire
 * that did no work. Bounding the scan is the ENTRY-CAP flight (QUEUE ★SCAN-ALLOWANCE-IS-16S-SHORT's
 * sibling ★COVERAGE-DAY-SET-RPC), deliberately not done here.
 */
// ⛔ RE-DERIVED 2026-09-18 (LORAMER_UNIT_RESERVE_PER_SURFACE_V1): 18,000 = the vendor-latency floor (p99.9 of ≤1,000-row
// requests, n=26,724), the FLOOR under the per-surface reserve in capture-adapter.ts unitReserveMs — the flat 10,000
// (p99 6,768 × 1.48 on ≤30-day units) admitted a 70 s unit 60 s from the kill at 90-day windows. Kept as a literal here
// (this module is compiled standalone by guards); unit-reserve-per-surface.guard.mjs pins the two equal.
export const UNIT_RESERVATION_FLOOR_MS = 18_000
export const FIRE_WORK_BUDGET_MS = (CONSUMER_MAX_DURATION_S * 1000) - UNIT_RESERVATION_FLOOR_MS

/**
 * ⛔ THE ONE PLACE A FIRE DEADLINE IS COMPUTED. Callers pass the moment the FIRE started — never the
 * moment a later phase started — and get the absolute epoch-ms ceiling every admission reserves
 * against. A function rather than a constant because the only way to get this wrong is to add the
 * budget to the wrong clock, and a function makes that clock a named argument the guard can read.
 */
export function fireDeadlineAt(fireStartedAtMs: number): number {
  return fireStartedAtMs + FIRE_WORK_BUDGET_MS
}

/**
 * ⛔ HOW MANY UNITS A FIRE RUNS AT ONCE — LORAMER_FIRE_UNITS_CONCURRENT_V1, 2026-09-15. DERIVED FROM A LOAD
 * MEASUREMENT OF THE PRODUCTION WRITER, NOT CHOSEN, and the measurement is the reason the number is 12.
 *
 * MEASURED 2026-09-15 22:33Z through `upsertMetricsChunked` itself (the real writer against the live conflict
 * key, chunked as production chunks it), 2,000 rows per stream, widths 1→16, probe rows deleted and the
 * deletion verified at 0 remaining:
 *     width  1 →   946 rows/s        width  8 → 5,950 rows/s
 *     width  2 → 2,477 rows/s        width 12 → 7,521 rows/s   ← PEAK
 *     width  4 → 3,820 rows/s        width 16 → 6,657 rows/s   ← KNEE: throughput FELL
 * 12 is the peak and the last width before throughput turns over: 7.95× a single stream. 16 is measurably
 * WORSE than 12, so this is not a conservative shading of a bigger number — past 12 the database gives less.
 *
 * ⛔ IT IS NOT A CONNECTION COUNT, and round 16 had that wrong. The app reaches Postgres through PostgREST,
 * which multiplexes over its OWN pool — measured 31 of 41 live connections were idle PostgREST, with
 * max_connections 90. Our request width does not consume a Postgres connection each, so the pool is not the
 * ceiling and this width answers to PostgREST's queue and the write path instead.
 * ⚠ AND THE BUSY CRON BAND DOES NOT MOVE IT: per-attempt p50 measured flat across 2026-09-15 — 674/674/668/717 ms
 * in the 08–11Z cron band against 691/692/691 ms in the quiet evening. p90 tracks ROW VOLUME, not the band.
 */
export const UNIT_CONCURRENCY = 12


export interface UniverseMessageV2 {
  clientId: string
  userEmail: string
  customerId: string
  entry: UniverseEntry
  /** Inclusive window this message must capture. It rides on the MESSAGE — nothing is inferred from order. */
  startDate: string
  endDate: string
  /** How many windows this chain may still walk, including this one. UNDEFINED = unbounded. */
  windowsRemaining?: number
  /**
   * ⛔ WHICH LANE PUBLISHED THIS — LORAMER_TOP_EDGE_LANE_V1, 2026-08-19. `'descend'` (or absent) is the walk
   * marching toward inception; `'top-edge'` holds the strip between the descent's top window and the newest
   * servable day. It rides the MESSAGE for the same reason `windowsRemaining` does — the chain is the only
   * writer and the only reader — and it decides exactly two things in the consumer:
   *   1. the lane stamped on `attempt_started`, which the rotation (migrations/084) filters on so a top-edge
   *      attempt cannot drag the descending anchor to the top of the calendar; and
   *   2. ⛔ WHETHER `advance()` RUNS AT ALL. A top-edge message MUST NOT self-chain: `advance` derives its
   *      successor as `startDate − 1`, so a strip message would publish a window ending the day below the
   *      strip and start a SECOND descent through ground the walk has already covered.
   * ⛔ ABSENT MEANS `'descend'`, so every in-flight message published before this field existed consumes
   * with byte-identical behaviour.
   * ⛔ `'lookback'` — LORAMER_LOOKBACK_LANE_V1 (2026-09-08): the top-edge lane converted. Same two consumer effects
   * as 'top-edge' (stamped on attempt_started; never self-chains) with ONE difference the consumer does not see:
   * its terminal ATTESTS (universe-coverage.ts resolveTerminalLane). Spelled inline here rather than imported so
   * this module stays a pure contract; db-enum-mirrors-ts registers THIS union against the CHECK (migrations/088)
   * beside AttemptLane, so the two spellings cannot drift.
   */
  lane?: 'descend' | 'top-edge' | 'lookback' | 'missed' // LORAMER_MISSED_DAY_WALK_V1 — the fourth value, registered against migrations/090 beside AttemptLane
  /**
   * ⛔ THE PRODUCER-ASSIGNED MESSAGE IDENTIFIER — LORAMER_COMPLETION_SIGNAL_V1, and it is REQUIRED prior art
   * rather than a convenience. Enterprise Integration Patterns: *"Use a producer-assigned message identifier
   * or a business-level idempotency key that identifies the specific logical operation."* We already MINT one
   * — it is the idempotency key every publisher hands the queue — and until now we threw it away, so no
   * durable row could say WHICH PUBLISHER caused it. That is what let a scheduled fire's requests be
   * attributed to a drive's pass, and the earlier design banked that as "an acceptable counting error"; the
   * pattern does not offer that option. Optional on the type so a legacy in-flight message still consumes.
   */
  messageKey?: string
  /**
   * LORAMER_OWN_INVOCATION_METER_V1 — the FIRE's invocation id (universe-resume/route.ts mints one per fire). The worker
   * prefixes every unit's own invocation id with it (`${fire}:${uuid}`), so the run's step can count the days ITS fire
   * committed and no others — the rotation fires the same lane beside a run. Absent on the drive's messages.
   */
  fireInvocationId?: string
  /**
   * ⛔ DEAD FIELD — the consumer NEVER reads it (universe-floor-execute-time.guard.mjs fails the build if it
   * does). The floor is resolved at EXECUTE time from universe_account_floor. The field survives only
   * because the resumer still writes it; removing it rides with ★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR.
   */
  floorDate?: string
  /**
   * CONSECUTIVE all-empty windows on this chain, INCLUSIVE of none-yet (undefined = 0). Chain-local pacing
   * state in `windowsRemaining`'s exact shape — it may ride the message because no second owner exists: the
   * chain is the only writer and the only reader. (A FLOOR may not ride the message — that has two owners
   * and a 24h TTL against a moving boundary. The distinction is the whole design.)
   */
  emptyStretch?: number
  /**
   * ⛔ EXPLICIT OPERATOR CHOICE ONLY — LORAMER_INCEPTION_STOP_V1. When the account's inception is UNKNOWN
   * (discovery failed, no row stored) an UNBOUNDED walk REFUSES to run. Setting this true is the operator
   * saying "walk to epoch anyway, eyes open". It is never set by code; no default ever supplies it.
   */
  walkToEpoch?: boolean
}

/**
 * LORAMER_OWN_INVOCATION_METER_V1 — PURE. The unit's invocation id: unique per delivery (the uuid), prefixed with the
 * fire's id when the message carries one, so a `like '<fire>:%'` on the ledger selects one fire's rows and nothing else.
 */
export function mintUnitInvocationId(fireInvocationId: string | null | undefined, uuid: () => string): string {
  const u = uuid()
  return fireInvocationId ? `${fireInvocationId}:${u}` : u
}
