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
import {
  buildGaql, buildUniverseRowsAtGrain, entityLevelFor, breakdownTypeFor, VENDOR_FLOOR_DATE,
  type UniverseEntry,
} from '@/lib/backfill/google-ads-universe-writer'
import { serializeVendorError } from '@/lib/backfill/universe-stream-capture'
// ⛔ THE ALLOCATION IS IMPORTED FROM ITS OWNER, NOT RETYPED. LORAMER_GOOGLE_LANE_ALLOCATION_V1.
import { LANE_ALLOCATIONS } from '@/lib/backfill/google-op-budget'

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
 * ⛔ 37 MONTHS, DOCUMENTED, AND THE ACCOUNT MAY STILL SERVE OLDER ROWS. Foam OH served rows 53 months back,
 * contradicting the doc. That is recorded as an unresolved vendor question and costs nothing, because
 * ROWS-RETURNED ALWAYS BEATS THE FLOOR: `decideExhaustion` returns `complete: false` whenever the vendor
 * answers with anything at all, so an over-tight floor can never truncate a walk that is still yielding.
 * ⚠ `VENDOR_FLOOR_DATE` is Foam OH's MEASURED floor and is therefore per-account. The universal replacement
 * is `today − 37 months`; it is left as-is here because changing it is a behavioural change and this step
 * is a retrofit.
 */
const retention: RetentionFloor = {
  floorDate: VENDOR_FLOOR_DATE,
  source: 'vendor-measured',
  citation: 'measured on Foam OH 2026-08-03; Google documents 37 months for hourly/daily/weekly reporting (support.google.com/google-ads/answer/15188209). ⚠ the account served rows 53 months back — an unresolved vendor question that costs nothing, because rows-returned always beats the floor.',
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
      const since = new Date(); since.setUTCHours(0, 0, 0, 0)
      // ⛔ BOTH LOGS ARE SUMMED WHILE BOTH CONSUMERS EXIST. v1 bills into universe_window_log and v2 into
      // universe_attempt_log; reading only one under-counts the lane by exactly the other's spend, which is
      // a governor granting itself the difference. When v1 retires its term goes to zero on its own.
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
