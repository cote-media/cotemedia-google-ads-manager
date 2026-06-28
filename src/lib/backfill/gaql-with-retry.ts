// LORAMER_GAQL_WITH_RETRY_V1
// Shared GAQL retry primitive — extracted VERBATIM (zero behavior change) from the duplicate
// queryWithRetry in google-campaign-backfill.ts + google-adgroup-ad-backfill.ts. Owns ONLY the
// transient-retry mechanics; the GAQL string is built by the caller and the result is consumed by the
// caller unchanged. google-ads-api's customer.query auto-paginates, so there is NO manual paging here.
//
// NOTE (separate decision, do NOT do here): the FORWARD fetcher uses a DIFFERENT helper
// src/lib/google-retry.ts withGaqlRetry (gRPC code set {4,13,14} + richer regex, attempts=3, LINEAR
// backoff, L15 logging). Unifying the two onto one policy is a future BEHAVIOR-CHANGE decision; this
// primitive deliberately preserves the backfill writers' existing behavior (regex + 1000*2^i, tries=4).
// LORAMER_GOOGLE_QUOTA_GUARD_V1: classify via err.errors[0] (the GoogleAdsFailure carries code/text there —
// err.message is undefined for these, so the prior /…/.test(e.message) matched nothing and neither quota NOR
// transient detection ever fired). Developer-scope quota_error → throw a typed GoogleQuotaError (do NOT retry;
// reset is hours away) so the drain can pause+persist the global marker. Transient → retry as before (exp backoff).
import { classifyGoogleAdsError, GoogleQuotaError } from './google-quota'

export async function gaqlWithRetry(customer: any, gaql: string, tries = 4): Promise<any[]> {
  let lastErr: any
  for (let i = 0; i < tries; i++) {
    try { return await customer.query(gaql) } catch (e: any) {
      lastErr = e
      const k = classifyGoogleAdsError(e)
      if (k.quota) throw new GoogleQuotaError(k.resetIso!, k.detail)
      if (k.transient && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); continue
      }
      throw e
    }
  }
  throw lastErr
}
