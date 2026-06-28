// LORAMER_GOOGLE_QUOTA_GUARD_V1 — PURE classification (no DB import, so it is unit-testable in isolation).
// Reactive, developer-scoped Google Ads quota guard. There is NO op-metering in the codebase (confirmed),
// so we cannot run a proactive reserve; instead we classify the GoogleAdsFailure the API throws and, on a
// developer-scope quota_error, signal a PAUSE up to the reset time the error itself carries.
//
// ROOT BLIND SPOT this fixes: a google-ads-api GoogleAdsFailure stringifies to "[object Object]" and its
// .message is undefined — the real code/text live in err.errors[0].error_code / err.errors[0].message.
// The old retry primitives tested err.message (always '' for these), so neither quota NOR transient
// detection actually fired. This reads the correct field.

// Global sentinel: a single sync_state row that is NOT a real (client, platform). The quota is developer-
// token scoped (one dev token across ALL google clients), so the pause is GLOBAL, never per-(client,platform).
// The DB read/write of this marker lives in ./google-quota-store (keeps this file import-free for testing).
export const GOOGLE_QUOTA_SENTINEL_CLIENT = '00000000-0000-0000-0000-000000000000'
export const GOOGLE_QUOTA_PLATFORM = '__google_quota'

// Typed quota error — the retry primitives throw THIS (not the opaque GoogleAdsFailure) so the drain can
// recognize it with `instanceof` and route to the global pause, and so a logged message is human-readable.
export class GoogleQuotaError extends Error {
  resetIso: string
  constructor(resetIso: string, detail?: string) {
    super(`google_quota: developer-scope quota exhausted; retry after ${resetIso}${detail ? ` (${detail})` : ''}`)
    this.name = 'GoogleQuotaError'
    this.resetIso = resetIso
  }
}

export interface GoogleAdsErrorKind {
  quota: boolean       // developer/account-scope quota_error — do NOT retry; pause until resetIso
  transient: boolean   // UNAVAILABLE / DEADLINE / INTERNAL / 429 / rate — retry with backoff (as before)
  resetIso?: string    // when quota: now + the "Retry in N seconds" the error reported
  detail?: string      // the raw GoogleAdsFailure message text
}

// Classify a thrown google-ads-api error. Reads err.errors[0] (GoogleAdsFailure) — NOT err.message.
export function classifyGoogleAdsError(err: any): GoogleAdsErrorKind {
  const first = err?.errors?.[0]
  const msg = String(first?.message ?? err?.message ?? '')
  const quotaCode = first?.error_code?.quota_error
  if (quotaCode != null) {
    const m = msg.match(/retry in (\d+)\s*second/i)
    const secs = m ? parseInt(m[1], 10) : 3600 // default 1h if the message carries no countdown
    const resetIso = new Date(Date.now() + secs * 1000).toISOString()
    return { quota: true, transient: false, resetIso, detail: msg }
  }
  // Transient set — unchanged semantics, but now also reads err.errors[0].message, not only err.message.
  const code = err?.code
  const grpcTransient = typeof code === 'number' && (code === 4 || code === 13 || code === 14) // DEADLINE/INTERNAL/UNAVAILABLE
  if (grpcTransient || /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE|INTERNAL\b|429|\brate\b/i.test(msg)) {
    return { quota: false, transient: true }
  }
  return { quota: false, transient: false }
}

// A drain lap is a FAILURE when it threw (handled in the route's catch) OR returned a writer non-200, which
// rangeLap surfaces as detail.error ('writer failed'). A legitimate mid-progress non-advance (detail.range,
// reachedFloor:false) has NO .error and is NOT a failure. Exported so the drain + Gate A use the SAME predicate.
export function isLapFailure(lap: any): boolean {
  return !!(lap && lap.detail && (lap.detail as any).error)
}
