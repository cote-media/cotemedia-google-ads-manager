// LORAMER_GOOGLE_GAQL_RETRY_V1
// Bounded retry for Google Ads GAQL calls on TRANSIENT failures (deep windows intermittently throw
// DEADLINE_EXCEEDED / INTERNAL / UNAVAILABLE — wide BETWEEN → slower query → occasional deadline).
// Same shape as the Shopify throttle wrapper. Non-transient errors propagate immediately.
//
// Lesson-15 instrumentation: EVERY failure logs the precise code/body UN-truncated (Vercel's log
// table truncates ~30 chars and free-tier logs expire in 1h), so the next occurrence captures the
// exact GoogleAdsFailure / gRPC status that justified (or didn't) the retry.

import { classifyGoogleAdsError, GoogleQuotaError } from './backfill/google-quota'

const TRANSIENT_GRPC = new Set([4, 13, 14]) // DEADLINE_EXCEEDED, INTERNAL, UNAVAILABLE
const TRANSIENT_RE = /DEADLINE_EXCEEDED|INTERNAL\b|UNAVAILABLE|deadline exceeded|temporar|service is currently unavailable|ETIMEDOUT|ECONNRESET|socket hang up/i

function isTransient(err: any): boolean {
  if (err && typeof err.code === 'number' && TRANSIENT_GRPC.has(err.code)) return true
  return TRANSIENT_RE.test(String(err?.message ?? err ?? ''))
}

function describe(err: any): string {
  try {
    return JSON.stringify(
      { code: err?.code, message: err?.message, errors: err?.errors, details: err?.details },
      (_k, v) => (v === undefined ? null : v)
    ).slice(0, 900)
  } catch {
    return String(err?.message ?? err)
  }
}

export async function withGaqlRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      // LORAMER_GOOGLE_QUOTA_GUARD_V1: developer-scope quota_error (read from e.errors[0]) → throw a typed
      // GoogleQuotaError, do NOT retry (reset is hours away, retrying just burns more ops). Transient unchanged.
      const k = classifyGoogleAdsError(e)
      if (k.quota) { console.error(`[gaql] ${label} GOOGLE QUOTA (developer-scope) reset=${k.resetIso}: ${describe(e)}`); throw new GoogleQuotaError(k.resetIso!, k.detail) }
      const transient = isTransient(e)
      console.error(`[gaql] ${label} attempt ${i + 1}/${attempts} failed transient=${transient}: ${describe(e)}`)
      if (!transient || i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}
