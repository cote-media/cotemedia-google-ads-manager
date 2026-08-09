// LORAMER_GOOGLE_ROLLING_QUOTA_WINDOW_V1 — THE ONE WINDOW BOTH SPEND READERS MEASURE OVER.
//
// ⛔ WHAT WAS WRONG, AND IT IS THE MECHANISM OF THE 2026-08-06 QUOTA CRISIS STILL RUNNING TODAY
// (★SPEND-COUNTER-MEASURES-CALENDAR-DAY-AGAINST-A-ROLLING-VENDOR-WINDOW). Both readers floored their window
// to UTC midnight — `google-op-budget.ts` and `universe-window-log.ts`, independently — while Google enforces
// a ROLLING 24-HOUR PERIOD:
//     "per day is based on a rolling 24 hour period in which API requests were made with your developer token"
//     and the daily limits "don't reset at precisely the same time every day"
//     https://developers.google.com/google-ads/api/docs/best-practices/quotas
//     https://developers.google.com/google-ads/api/docs/api-policy/access-levels
// ⛔ RE-VERIFIED AT THE VENDOR ON 2026-08-09 rather than cited back from our own docs — the reset-time
// constant in this repo was once self-invented, and LORAMER_ESSENCE_LAW_9_V1 is the reason that matters.
//
// ⛔ THE FAILURE SHAPE IS DAILY AND SPECIFIC: at 00:05 UTC a calendar counter reads ~0 while the vendor may
// still be holding ~14,000 requests from the previous 23 hours. Every lane therefore sees an EMPTY budget at
// exactly the hour refusal is most likely. MEASURED over 30 days: the rolling measure breaches the 15,000 cap
// in 57 of 721 hours (7.9%) against 2 of 30 calendar days — four times the exposure, invisible to every lane.
//
// ⛔ WHY THIS IS ITS OWN MODULE AND NOT A FUNCTION IN `google-op-budget.ts`. That file already imports
// `universe-window-log`, and its own header records the acyclicity as load-bearing. The shared window must be
// importable by BOTH readers, so it lives one level below both — same reason `google-quota.ts` is import-free.
// ⛔ AND IT MUST BE SHARED RATHER THAN COPIED: the fleet total is assembled from BOTH readers, so two
// independently-computed windows means one fleet measured over two different periods. That is the defect one
// layer up from the calendar bug, and it is what leg (o) of `google-op-budget.guard.mjs` exists to prevent.

/** The vendor's window length. Not a tunable: it is Google's published period, not our policy. */
export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The start of the rolling window every Google spend read measures over.
 *
 * ⛔ EXPECT THE COUNTER TO READ HIGHER THAN THE OLD CALENDAR ONE AT ALMOST EVERY HOUR, AND EXPECT LANES TO
 * DECLINE MORE OFTEN. That is the fix working, not a regression: the old reading was an under-count of a
 * ceiling the vendor was already enforcing.
 *
 * `now` is injectable so the decision is drivable with no clock — the same property that makes every other
 * decision in this subsystem guardable.
 */
export function rollingWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - ROLLING_WINDOW_MS)
}
