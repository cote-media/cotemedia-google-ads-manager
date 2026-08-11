// LORAMER_CAPTURE_ADAPTER_CONTRACT_V1 — GOOGLE ADS, THE FIRST ADAPTER.
//
// ⛔ THIS FILE EXISTS TO HOLD THE GOOGLE ASSUMPTIONS THAT WERE SITTING IN THE CORE. Nothing here is new
// behaviour; every constant below was already in the engine, in a file that had no business knowing it:
//   · `ROW_BUDGET` / `COLD_START_DAYS` were in `universe-sizing.ts` — a module whose name promises neutrality
//   · `ORDER BY segments.date` was in `universe-stream-capture.ts`
//   · `VENDOR_FLOOR_DATE` sits in the writer and was read directly by the consumer
//   · the operations meter sits in `universe-governor.ts`
// The retrofit is mostly DELETION from those files, not addition here.
import type {
  CaptureAdapter, CaptureContext, CaptureSurface, RetentionFloor, DayClosure, Meter, SizingPolicy,
} from '@/lib/backfill/capture-adapter'
// ⛔ VENDOR_FLOOR_DATE IS DELIBERATELY NOT IMPORTED — LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1. It is one
// account's measurement and this adapter serves every account. See `retention` below.
import {
  buildGaql, buildUniverseRowsAtGrain, entityLevelFor, breakdownTypeFor,
  type UniverseEntry,
} from '@/lib/backfill/google-ads-universe-writer'
import { serializeVendorError } from '@/lib/backfill/universe-stream-capture'
// ⛔ THE ALLOCATION IS IMPORTED FROM ITS OWNER, NOT RETYPED. LORAMER_GOOGLE_LANE_ALLOCATION_V1.
import { LANE_ALLOCATIONS } from '@/lib/backfill/google-op-budget'
// ⛔ THE WINDOW IS IMPORTED FROM ITS OWNER TOO, AND FOR THE SAME REASON ONE LAYER DOWN.
// LORAMER_V2_METER_ROLLING_WINDOW_V1 — this file is the THIRD spend reader and it was measuring over a
// different period than the other two. See the `spentSoFar` comment below.
import { rollingWindowStart } from '@/lib/backfill/google-quota-window'

/**
 * ⛔ ORDERED DELIVERY IS ASSERTED TWICE AND THAT IS WHY GOOGLE EARNS RULE (a). The query asks for it; the
 * stream is checked at runtime anyway (`universe-stream-capture.ts`). An `ORDER BY` the vendor silently
 * ignored would turn every day commit into a false claim — and a claim that is wrong ONLY SOMETIMES is
 * worse than one that is always wrong.
 */
export const ORDER_CLAUSE = ' ORDER BY segments.date'

const dayClosure: DayClosure = {
  rule: 'later-day-closes',
  mechanism: 'GAQL `ORDER BY segments.date`, and the stream is verified monotonic at runtime rather than trusted',
  runtimeChecked: true,
}

/**
 * ⛔⛔ THERE IS NO PRE-KNOWN WALL FOR AN ARBITRARY ACCOUNT — LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1, 2026-08-10.
 *
 * This declared `floorDate: VENDOR_FLOOR_DATE` — **one account's measured floor, applied to every account**,
 * and the comment that used to sit here admitted it in the same breath as shipping it. For an account a
 * customer connects tomorrow, which nobody here has ever seen, that date is not conservative and it is not
 * approximate. It is a fabricated claim about someone else's history.
 *
 * ⛔ `null` HERE IS A FACT, NOT A GAP, AND IT IS LOAD-BEARING. `capture-adapter.ts:245-253` makes exhaustion
 * STRUCTURALLY UNCLAIMABLE on a null floor: zero rows becomes DORMANCY, never a wall, and the type cannot
 * express `complete: true` without a non-null `exhaustedBelow`. The correct behaviour for this design was
 * already written into the contract; it was switched off by a constant. This turns it on.
 *
 * ⛔ SO WHAT ENDS A GOOGLE WALK? A VENDOR REFUSAL, discovered per (account, surface) and stored — see
 * `isRetentionWallRefusal()` below and `readAccountWall()`/`recordAccountWall()` in the writer. Not a clock.
 * A clock is what produced 214 cursors reading `backfill_complete=true` while Google still served years more.
 *
 * ⚠ THE MEASUREMENT THAT SETTLED THIS, with its limit on its face: on 2026-08-04..08 — AFTER Google's own
 * 37-month wall took effect on 2026-06-01 — the vendor served DAILY, VENDOR_REPORTED rows 53 months back
 * (255,452 of them at geographic_view/geo_target_most_specific_location). ONE account, ONE token, FIVE days.
 * It does not prove the policy is generally unenforced; it does prove a global 37-month stop would have
 * discarded ground the vendor was still serving. docs/LORAMER_BACKFILL_FACT_REGISTRY.md owns both facts.
 */
const retention: RetentionFloor = {
  floorDate: null,
  source: 'none',
  citation: 'No PRE-KNOWN wall exists for an arbitrary Google Ads account. Google publishes a 37-month granular-retention policy effective 2026-06-01 (support.google.com/google-ads/answer/15188209) AND was measured serving daily vendor-reported rows 53 months back on 2026-08-04..08. The wall is therefore DISCOVERED per (account, surface) from the vendor\'s own DateRangeError refusal and stored in universe_account_floor — never derived from a clock.',
}

/**
 * ⛔ THE WALL DISCRIMINATOR. THE ONE SIGNAL PERMITTED TO END A GOOGLE WALK.
 *
 * ⛔ AND THE DISTINCTION IT EXISTS TO MAKE, because collapsing it is how history gets sealed by accident:
 *   · **REFUSAL** — the vendor was asked and said NO. `DateRangeError`. That is a WALL. Floor found.
 *   · **SUCCESSFUL ZERO** — the vendor was asked and named nothing. That is DORMANCY, not a wall, and it is
 *     handled by `decideExhaustion` on the success path where it belongs. It must NEVER reach this function.
 * `LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1` is the rule; this is the other half of it, which never existed:
 * the capture path returns early on an error (`universe-stream-capture.ts:155-160`), so `decideExhaustion`
 * has structurally never seen a refusal. It reads `rowsReturned: number` and cannot represent one.
 *
 * ⛔ MATCHED ON THE VENDOR'S OWN ERROR NAMES, NOT ON PROSE. Google returns `DateRangeError.INVALID_DATE`
 * today and `DateRangeError.REQUESTED_DATE_GRANULARITY_NOT_SUPPORTED` in v24+
 * (developers.google.com/google-ads/api/docs/reporting/segmentation). Both are date-range refusals and both
 * are walls. A message-text match would break on the first wording change; these are enum names.
 *
 * ⛔ NARROW ON PURPOSE. Any OTHER vendor error — auth, quota, timeout, a malformed query — is NOT a wall and
 * must not become one. Treating a transient failure as the end of history is the catastrophic direction:
 * it seals real ground permanently and silently, and nothing downstream would ever ask again.
 */
export const RETENTION_WALL_ERROR_NAMES = [
  'REQUESTED_DATE_GRANULARITY_NOT_SUPPORTED',
  'INVALID_DATE',
] as const

export function isRetentionWallRefusal(serializedError: string | null | undefined): boolean {
  if (!serializedError) return false
  const s = String(serializedError)
  // The serialized shape is `{"date_range_error":"INVALID_DATE"} <message>` (serializeVendorError stringifies
  // the error_code object), so BOTH the enum name and the date_range_error key must be present. Requiring the
  // key is what stops an unrelated error whose free text happens to contain "INVALID_DATE" from sealing a surface.
  if (!/date_?range_?error/i.test(s)) return false
  return RETENTION_WALL_ERROR_NAMES.some((n) => s.includes(n))
}

/**
 * ⛔ A QUERY IS **ONE OPERATION AT ANY SPAN**, and paginated requests carrying a valid next_page_token are
 * not counted at all. That is what makes `costDirection: 'flat-per-request'` true here and what makes a
 * BIGGER window CHEAPER per day — the exact opposite of GA4, where token cost rises with range length.
 *
 * ⚠ ★GAQL-OP-METER STAYS OPEN: the API returns no operation count on a search response, so the governor
 * counts REQUESTS and converts with a stated pessimistic assumption of 1 op/request rather than a
 * measurement. The only source for the true number is the API Center UI, which is a human read.
 */
const meter: Meter = {
  unit: 'operations/day',
  // ⛔ IMPORTED, NOT COPIED, 2026-08-09. This read `cap: 6_000` — a hand-typed literal of a number owned two
  // files away, which is exactly what single-owner-vendor-facts.guard.mjs exists to stop and what it froze as
  // a baseline violation on the day it was written. The value is unchanged by the re-allocation; the
  // DEPENDENCY is the fix (LORAMER_GOOGLE_LANE_ALLOCATION_V1).
  cap: LANE_ALLOCATIONS.backfill,
  costDirection: 'flat-per-request',
  costOf: () => 1,
  spentSoFar: async () => {
    try {
      const { readLaneSpendToday } = await import('@/lib/backfill/universe-window-log')
      const { readAttemptLaneSpendToday } = await import('@/lib/backfill/universe-attempt-log')
      // ⛔ LORAMER_V2_METER_ROLLING_WINDOW_V1, 2026-08-11. THIS READ THE CALENDAR DAY
      // (`since.setUTCHours(0, 0, 0, 0)`) WHILE THE v1 TERM BESIDE IT ROLLED 24 HOURS — verbatim the defect
      // `google-quota-window.ts:22-24` forbids: "the fleet total is assembled from BOTH readers, so two
      // independently-computed windows means one fleet measured over two different periods."
      // ⛔ IT WAS NOT PREDICTED, IT WAS MEASURED, on the walk's second night alive: at 01:21Z on 2026-08-11
      // `universe_attempt_lane_spend_today('google', rolling 24h)` read 23 while the midnight read gave 20.
      // The failure shape is daily and specific — an hourly cron crosses midnight on day one and under-reads
      // its own spend at exactly the hour the vendor is fullest.
      // ⚠ EXPECT THIS TERM TO READ HIGHER AT ALMOST EVERY HOUR. That is the fix working, not a regression.
      const since = rollingWindowStart()
      // ⛔ BOTH LOGS ARE SUMMED WHILE BOTH CONSUMERS EXIST. v1 bills into universe_window_log and v2 into
      // universe_attempt_log; reading only one under-counts the lane by exactly the other's spend, which is
      // a governor granting itself the difference. When v1 retires its term goes to zero on its own.
      // ⛔ AND BOTH TERMS NOW MEASURE THE SAME PERIOD — `readLaneSpendToday()` argless defaults to
      // `rollingWindowStart()` (universe-window-log.ts:256), so the sum is over ONE window, not two.
      const [v1, v2] = await Promise.all([readLaneSpendToday(), readAttemptLaneSpendToday('google', since)])
      return v1 + v2
    } catch {
      // ⛔ null MEANS UNREADABLE AND `mayFetch` HOLDS ON IT. Never 0 — a broken gauge is not permission.
      return null
    }
  },
}

/**
 * ⛔ EVERY NUMBER HERE IS OURS OR GOOGLE'S, AND SAYING WHICH IS THE POINT. `rowBudget` is a property of OUR
 * write path (~2,300 rows/sec measured × a 300 s ceiling ⇒ ~690k; this is deliberately under half of it,
 * because the ceiling is a throughput measurement on a good day). `coldStartDays` is derived from that AND
 * from the flat cost curve above — the densest month ever measured is ~40,900 rows/day, so 7 days ≈ 286k
 * rows ≈ 124 s. Under `'rises-with-range'` that arithmetic points the wrong way, which is why the direction
 * travels with the meter rather than being assumed by the sizer.
 */
const sizing: SizingPolicy = { rowBudget: 300_000, coldStartDays: 7, minDays: 1, maxDays: 30 }

export function googleAdsCaptureAdapter(
  streamFor: (gaql: string) => AsyncGenerator<any>,
  entryOf: (s: CaptureSurface) => UniverseEntry,
  filtersOf: (s: CaptureSurface) => string[] = () => [],
): CaptureAdapter {
  return {
    platform: 'google',
    fetchShape: 'stream',
    retention, dayClosure, meter, sizing,
    stream(_ctx, surface, startDate, endDate) {
      return streamFor(buildGaql(entryOf(surface), startDate, endDate, filtersOf(surface)) + ORDER_CLAUSE)
    },
    dateOf: (row) => (row?.segments?.date ? String(row.segments.date) : null),
    buildRows: (surface, ctx, rows) => buildUniverseRowsAtGrain(entryOf(surface), ctx as any, rows),
    serializeError: (e) => serializeVendorError(e),
  }
}

/** The catalog entry → the two columns coverage is asked at. A pure function of the entry, as it always was. */
export function surfaceOfEntry(entry: UniverseEntry): CaptureSurface {
  return {
    entityLevel: entityLevelFor(entry),
    breakdownType: breakdownTypeFor(entry),
    resource: entry.resource,
    segment: entry.segment ?? '',
  }
}
