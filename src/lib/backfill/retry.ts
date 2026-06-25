// LORAMER_BACKFILL_RETRY_V1
// Shared transient-error backoff for the Google backfill paths that lacked one (the account adapter's
// fetchDaily + the dimensional writer). Mirrors the PROVEN google-campaign-backfill queryWithRetry:
// 4 tries, exponential backoff on Google's transient signals. Wraps the fetch AT THE BACKFILL BOUNDARY so
// the shared google-ads.ts / intelligence fetchers (live app path) are NOT modified.
const TRANSIENT = /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE|429|rate/i

export async function withGoogleRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      if (TRANSIENT.test(String(e?.message || '')) && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
        continue
      }
      throw e
    }
  }
  throw lastErr
}

// VERIFIED Meta error taxonomy (developers.facebook.com + 2026 guide, this session):
//   RETRYABLE (transient → exp backoff): 1,2,4,17,613,80004; HTTP 429; timeouts.
//   QUERY TOO HEAVY: code 100 + subcode 1487534 → "narrow the date range and retry smaller" (NOT a floor, NOT a fail).
//   NOT retryable / surface: 100 (other), 190 (token — probe path), 368 (account disabled).
//   TRUE FLOOR / no-more-data = an EMPTY SUCCESS (zero rows, no error) below the range — handled by run-backfill.
const META_RETRYABLE = new Set([1, 2, 4, 17, 613, 80004])
const DAY_MS = 86_400_000
const toMs = (s: string) => new Date(s + 'T00:00:00Z').getTime()
const toIso = (ms: number) => new Date(ms).toISOString().split('T')[0]

// Backfill-boundary Meta daily fetch with transient backoff + query-too-heavy window-halving. fetchFn must
// surface Meta .code/.error_subcode/.http on throw (fetchMetaDailyMetrics does). NOT used by the live path.
export async function fetchMetaDailyWithRetryNarrow(
  fetchFn: (since: string, until: string) => Promise<any[]>,
  since: string,
  until: string,
  tries = 4
): Promise<any[]> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchFn(since, until)
    } catch (e: any) {
      lastErr = e
      const code = Number(e?.code)
      const sub = Number(e?.error_subcode)
      const http = Number(e?.http)
      // Query too heavy (#100/1487534): halve the window, fetch each half (recursively narrows), concat.
      if (code === 100 && sub === 1487534 && since < until) {
        const midMs = toMs(since) + Math.floor((toMs(until) - toMs(since)) / DAY_MS / 2) * DAY_MS
        const mid = toIso(midMs)
        const left = await fetchMetaDailyWithRetryNarrow(fetchFn, since, mid, tries)
        const right = await fetchMetaDailyWithRetryNarrow(fetchFn, toIso(toMs(mid) + DAY_MS), until, tries)
        return [...left, ...right]
      }
      // Transient → exponential backoff.
      const transient = META_RETRYABLE.has(code) || http === 429 || /timeout|ETIMEDOUT|ECONNRESET/i.test(String(e?.message || ''))
      if (transient && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
        continue
      }
      // 100 (other), 190, 368, single-day-too-heavy, or exhausted → surface (run-backfill records the code).
      throw e
    }
  }
  throw lastErr
}
