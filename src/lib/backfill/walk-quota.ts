// LORAMER_WALK_QUOTA_SCOPE_V1 — THE WALK READS GOOGLE'S OWN QUOTA DETAILS AND KEYS ITS HOLD ON SCOPE, NEVER ON THE CODE.
//
// ⛔ WHY THIS IS A SECOND CLASSIFIER AND NOT A FIX TO THE FIRST (route R2, 2026-09-18). `classifyGoogleAdsError`
// (google-quota.ts) is read by three LIVE paths (Lora's answer route, the live Google fetchers, the live retry
// wrapper) and two frozen legacy lanes. It reads only `error_code.quota_error` and the message string, invents a
// 3,600 s pause when the message carries no countdown, and pauses the FLEET on every quota code. Changing it is
// live-path blast for every client. This module is PURE, reaches only the walk's own boundary
// (universe-vendor-stream.ts armingStream) and hold paths, and leaves the shared module byte-identical
// (walk-quota-scope.guard.mjs pins its hash).
//
// ⛔ WHAT GOOGLE ACTUALLY SENDS (rounds 3–5, 2026-09-18). The decoded GoogleAdsFailure carries
// `errors[i].details.quota_error_details { rate_scope: ACCOUNT(2)|DEVELOPER(3), rate_name, retry_delay }`
// (google-ads-node v23 descriptor; forum payloads CZzu5ciO3qk, AChSpxBxlyQ, 4J0UpuiU5dw). Every real throttle this
// repo has stored was code 2 (RESOURCE_EXHAUSTED) with "Retry in 900 seconds" — the SAME code as the daily cap —
// so the code number cannot decide anything. Scope can: ACCOUNT is one customer's bucket, DEVELOPER is the token's.
//
// ⛔ NEVER SHORTER THAN A DELAY GOOGLE SENT. Airbyte, Singer and Google's own sample all ignore retry_delay and
// back off blind (5/10/20/40 s ×5, 1/2/4/8 ×5, 10/20/40 ×3); against a real 900 s bucket that is five wasted
// requests. A sent delay is honoured exactly; the sample's 10/20/40 is used ONLY when no delay exists anywhere.

/** Google's handle-rate-exceeded sample: three tries, doubling from 10 s. Used only when the payload carries no delay. */
export const WALK_QUOTA_FALLBACK_BACKOFF_S = [10, 20, 40] as const
/** After the three fallback tries, the lane holds this long rather than looping — Google's own canned figure. */
export const WALK_QUOTA_FALLBACK_EXHAUSTED_HOLD_S = 900
/** A fallback try older than this starts the schedule over (a fresh incident, not a continuation). */
export const WALK_QUOTA_BACKOFF_STREAK_WINDOW_MS = 10 * 60 * 1000

export type WalkRateScope = 'ACCOUNT' | 'DEVELOPER' | 'UNKNOWN'

export interface WalkQuotaKind {
  quota: boolean
  /** The QuotaError enum value as sent (2 RESOURCE_EXHAUSTED, 4 RESOURCE_TEMPORARILY_EXHAUSTED, …) or null. */
  code: number | null
  codeName: string | null
  rateScope: WalkRateScope
  rateName: string | null
  /** Seconds Google asked us to wait, from details.retry_delay first, else the message's "Retry in N seconds". */
  retryDelayS: number | null
  delaySource: 'details' | 'message' | 'none'
  /** The raw vendor message, for the ledger. */
  message: string
}

const QUOTA_CODE_NAMES: Record<number, string> = {
  0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'RESOURCE_EXHAUSTED', 3: 'ACCESS_PROHIBITED', 4: 'RESOURCE_TEMPORARILY_EXHAUSTED',
  5: 'EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION', 6: 'EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION',
  7: 'PAYMENTS_PROFILE_ACTIVATION_RATE_LIMIT_EXCEEDED',
}

function scopeOf(raw: unknown): WalkRateScope {
  if (raw === 2 || raw === 'ACCOUNT') return 'ACCOUNT'
  if (raw === 3 || raw === 'DEVELOPER') return 'DEVELOPER'
  return 'UNKNOWN'
}

/** google.protobuf.Duration arrives as {seconds, nanos}; `seconds` may be a number, a numeric string, or a Long. */
function durationSeconds(raw: any): number | null {
  if (raw == null) return null
  const s = raw.seconds ?? raw
  let n: number | null = null
  if (typeof s === 'number') n = s
  else if (typeof s === 'string' && /^\d+$/.test(s)) n = parseInt(s, 10)
  else if (s && typeof s === 'object' && typeof s.toNumber === 'function') n = s.toNumber()
  else if (s && typeof s === 'object' && typeof s.low === 'number') n = s.low + (s.high ?? 0) * 4294967296
  if (n === null || !Number.isFinite(n) || n < 0) return null
  return Math.ceil(n + ((raw.nanos ?? 0) > 0 ? 1 : 0))
}

/**
 * PURE. Reads the decoded failure's FIRST quota error: its code, its scope/name/delay from details, and the message.
 * Accepts the raw GoogleAdsFailure (`errors[]`) and the partial-failure shape (`failure.errors[]`).
 */
export function classifyWalkQuotaError(err: any): WalkQuotaKind {
  const errs: any[] = Array.isArray(err?.errors) ? err.errors : Array.isArray(err?.failure?.errors) ? err.failure.errors : []
  const first = errs.find((x) => x?.error_code?.quota_error != null) ?? errs[0]
  const message = String(first?.message ?? err?.message ?? '')
  const codeRaw = first?.error_code?.quota_error
  const code = typeof codeRaw === 'number' ? codeRaw : typeof codeRaw === 'string' && /^\d+$/.test(codeRaw) ? parseInt(codeRaw, 10)
    : typeof codeRaw === 'string' ? (Object.entries(QUOTA_CODE_NAMES).find(([, n]) => n === codeRaw)?.[0] ?? null) as any : null
  if (code == null) {
    return { quota: false, code: null, codeName: null, rateScope: 'UNKNOWN', rateName: null, retryDelayS: null, delaySource: 'none', message }
  }
  const details = first?.details?.quota_error_details ?? first?.details?.quotaErrorDetails ?? null
  const fromDetails = durationSeconds(details?.retry_delay ?? details?.retryDelay)
  const m = message.match(/retry in (\d+)\s*second/i)
  const fromMessage = m ? parseInt(m[1], 10) : null
  const retryDelayS = fromDetails ?? fromMessage
  return {
    quota: true,
    code: Number(code),
    codeName: QUOTA_CODE_NAMES[Number(code)] ?? String(code),
    rateScope: scopeOf(details?.rate_scope ?? details?.rateScope),
    rateName: details?.rate_name ?? details?.rateName ?? null,
    retryDelayS,
    delaySource: fromDetails !== null ? 'details' : fromMessage !== null ? 'message' : 'none',
    message,
  }
}

/** The ledger/sentinel text: everything Google said, as one JSON object after a fixed key. */
export function describeWalkQuota(k: WalkQuotaKind): string {
  return 'quota_error_details=' + JSON.stringify({
    code: k.code, name: k.codeName, rate_scope: k.rateScope, rate_name: k.rateName,
    retry_delay_s: k.retryDelayS, delay_source: k.delaySource, message: k.message.slice(0, 300),
  })
}

export type WalkHoldDecision =
  | { kind: 'none'; reason: string }
  /** The fleet sentinel row, exactly as today: DEVELOPER scope, or a delay whose scope Google did not name. */
  | { kind: 'fleet'; untilMs: number; reason: string }
  /** ONE (client, vendor) lane: ACCOUNT scope, or the no-delay fallback schedule. */
  | { kind: 'lane'; untilMs: number; reason: string; backoffTries: number }

/**
 * PURE. Scope decides the hold. `priorBackoffTries` is how many fallback (no-delay) tries this lane has already
 * taken inside WALK_QUOTA_BACKOFF_STREAK_WINDOW_MS; the caller reads it from the lane record.
 */
export function decideWalkHold(a: { kind: WalkQuotaKind; nowMs: number; priorBackoffTries: number }): WalkHoldDecision {
  const { kind, nowMs } = a
  if (!kind.quota) return { kind: 'none', reason: 'not a quota error' }
  const tag = `${kind.codeName} · rate_scope ${kind.rateScope}${kind.rateName ? ` · rate_name "${kind.rateName}"` : ''}`
  if (kind.retryDelayS !== null) {
    const untilMs = nowMs + kind.retryDelayS * 1000
    if (kind.rateScope === 'ACCOUNT') {
      return { kind: 'lane', untilMs, backoffTries: 0, reason: `${tag} — Google named this ACCOUNT's bucket; holding this lane for the sent ${kind.retryDelayS} s (${kind.delaySource}); other lanes continue` }
    }
    // DEVELOPER, or a delay whose scope Google did not name: the fleet, exactly as today.
    return { kind: 'fleet', untilMs, reason: `${tag} — ${kind.rateScope === 'DEVELOPER' ? "Google named the DEVELOPER token's bucket" : 'scope not named by Google'}; holding the fleet for the sent ${kind.retryDelayS} s (${kind.delaySource})` }
  }
  // No delay anywhere: Google's sample schedule, lane-scoped, then a bounded hold rather than a loop.
  const tries = Math.max(0, Math.floor(a.priorBackoffTries)) + 1
  if (tries > WALK_QUOTA_FALLBACK_BACKOFF_S.length) {
    return { kind: 'lane', untilMs: nowMs + WALK_QUOTA_FALLBACK_EXHAUSTED_HOLD_S * 1000, backoffTries: tries, reason: `${tag} — no delay in the payload and the ${WALK_QUOTA_FALLBACK_BACKOFF_S.join('/')} s fallback is exhausted (${tries - 1} tries); holding this lane ${WALK_QUOTA_FALLBACK_EXHAUSTED_HOLD_S} s (bounded, not a loop)` }
  }
  const waitS = WALK_QUOTA_FALLBACK_BACKOFF_S[tries - 1]
  return { kind: 'lane', untilMs: nowMs + waitS * 1000, backoffTries: tries, reason: `${tag} — no delay in the payload; fallback try ${tries} of ${WALK_QUOTA_FALLBACK_BACKOFF_S.length}, holding this lane ${waitS} s (Google's handle-rate-exceeded schedule)` }
}
