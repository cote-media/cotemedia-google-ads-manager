// LORAMER_GOOGLE_CLIENT_CHOKE_POINT_V1 — THE ONE PLACE A GOOGLE ADS CLIENT IS CONSTRUCTED (for new code).
//
// ⛔ WHY, measured 2026-08-10: six Russ-approved probe operations hit Google and appeared in NO ledger —
// universe_attempt_log 0, universe_window_log 0, cron_runs 0 (docs/LORAMER_BACKFILL_FACT_REGISTRY.md owns
// the measurement). Every governor sums OUR OWN ledgers, so spend that bypasses them is quota the governors
// re-grant to someone else. Under Basic access Google enforced 15,000 ops/day per developer token regardless of our accounting; since 2026-09-15 (Standard, DECISIONS LORAMER_GOOGLE_ACCESS_STANDARD_V1) there is no daily cap and the per-second QPS buckets bind regardless of our accounting.
//
// ⛔ THE POSTURE, HONEST ABOUT WHAT THIS FLIGHT DID AND DID NOT CLOSE:
//   · CONSTRUCTION is choked HERE for new code, and `google-client-choke-point.guard.mjs` freezes the
//     14 pre-existing construction sites as a RATCHET — the count may only fall. A NEW unledgered path
//     is now a build failure, not a code-review hope.
//   · CHARGING is NOT unified here yet. The v2 walk charges spend-at-start into universe_attempt_log at its
//     own boundary (the correct, banked posture — a refusal still costs quota); the v1 walk bills
//     universe_window_log; forward/catchup/drain are estimated from cron_runs × the unmeasured 67. A
//     request-grain ledger charged INSIDE this factory would DOUBLE-charge those lanes today. The unified
//     charge needs its own table and lane attribution — QUEUE ★GOOGLE-REQUEST-LEDGER owns that follow-on.
//     This file is the structural half: the door everything must eventually walk through.
//
// ⛔ NOT A SECOND ERROR BOUNDARY. Quota arming stays where it is (google-quota-store's five boundaries;
// universe-vendor-stream's armingStream is the fifth). This factory constructs; it does not intercept.
import { GoogleAdsApi } from 'google-ads-api'

/** The three env credentials, read in ONE place. Missing env throws HERE, at construction, with a name —
 *  never later as an opaque vendor 401. */
function apiFromEnv(): GoogleAdsApi {
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_MANAGER_ACCOUNT_ID']) {
    if (!process.env[k]) throw new Error(`[google-ads-client] ${k} is not set — refusing to construct a client that would fail as an opaque vendor error`)
  }
  return new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  })
}

export type GoogleAdsCustomer = ReturnType<GoogleAdsApi['Customer']>

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// LORAMER_DIRECT_ACCESS_CUSTOMER_V1 — REACHING AN ACCOUNT THE CUSTOMER'S OWN LOGIN HOLDS DIRECTLY
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ THE FACT THIS RESTS ON, AND IT IS THE VENDOR'S, NOT AN INFERENCE. Google's access-model doc:
 * *"You can skip providing the `login-customer-id` header if the user has direct access to the Google Ads
 * account that you are making calls to."* The header is required only when access runs THROUGH a manager.
 *
 * ⛔ MEASURED THROUGH THIS EXACT LIBRARY (google-ads-api 23.0.0) ON 2026-09-16, and the two halves point
 * in OPPOSITE directions — which is the whole reason this is a fallback and not a switch:
 *   FIVE live accounts OUTSIDE the env manager, reached directly by the stored token:
 *     with the manager header → USER_PERMISSION_DENIED, every one · header omitted → OK, every one
 *   EXISTING CONNECTIONS (sample of 3 of 18):
 *     with the manager header → OK, every one · header omitted → USER_PERMISSION_DENIED, every one
 * ⇒ NEITHER FORM WORKS FOR BOTH. A one-sided change in either direction breaks the other population, and
 * "always omit" would have taken the whole live fleet down — 6 of the 18 connections are reachable ONLY
 * through the manager, and the sampled three failed without it.
 *
 * ⛔ THEREFORE: THE MANAGER HEADER IS TRIED FIRST, ALWAYS, AND IT IS THE ONLY PATH ANY EXISTING CONNECTION
 * EVER TAKES. Every current caller succeeds on the first attempt, so its request count, its headers and its
 * result are byte-identical to before this change. The fallback is reached ONLY by a customer whose account
 * is refused today — i.e. only where the behaviour is currently a failure, which is the one place it is
 * safe to change. `direct-access-fallback.guard.mjs` pins that asymmetry.
 */
const PERMISSION_REFUSAL = /USER_PERMISSION_DENIED|User doesn't have permission to access customer/i

/**
 * Per-process memo of customers proven to need the header OMITTED. A refusal costs a real vendor request,
 * so paying it once per invocation is the point; it is deliberately NOT persisted — a cache that outlives
 * the process is a fact about access that can go stale silently, and access changes on the customer's side.
 */
const directAccessCustomers = new Set<string>()

/** Exposed for the guard and for callers that want the decision without making a call. */
export function isKnownDirectAccess(customerId: string): boolean {
  return directAccessCustomers.has(customerId)
}
export function __resetDirectAccessMemo(): void { directAccessCustomers.clear() }

function customerWith(k: { refreshToken: string; customerId: string }, loginCustomerId: string | undefined): GoogleAdsCustomer {
  return apiFromEnv().Customer({
    customer_id: k.customerId,
    refresh_token: k.refreshToken,
    ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
  })
}

/** THE choke point. Every NEW Google Ads touch constructs its Customer here and nowhere else. */
export function googleAdsCustomerFor(k: { refreshToken: string; customerId: string }): GoogleAdsCustomer {
  return customerWith(k, process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!)
}

/**
 * Run `use` against the account, reaching it the way it can actually be reached.
 *
 * ⛔ THE ORDER IS THE SAFETY PROPERTY AND IT IS NOT AN OPTIMISATION: manager-first means an account that
 * works today takes exactly the path it takes today and never enters the fallback at all. Only a refusal —
 * the state that is already a failure for that customer — opens the second attempt.
 * ⛔ THE REFUSAL MUST BE A PERMISSION REFUSAL. A quota error, a network error or a malformed query must NOT
 * be retried headerless: that would turn one unrelated failure into two vendor requests and hide the cause.
 */
export async function withGoogleAdsCustomer<T>(
  k: { refreshToken: string; customerId: string },
  use: (c: GoogleAdsCustomer) => Promise<T>,
): Promise<T> {
  const manager = process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!
  if (directAccessCustomers.has(k.customerId)) return use(customerWith(k, undefined))
  try {
    return await use(customerWith(k, manager))
  } catch (e: any) {
    // serializeVendorError's lesson: read the vendor's own words, never String(e) on an object.
    const text = `${e?.errors?.[0]?.message ?? ''} ${e?.message ?? ''} ${JSON.stringify(e?.errors?.[0]?.error_code ?? e?.errors?.[0]?.errorCode ?? {})}`
    if (!PERMISSION_REFUSAL.test(text)) throw e
    const out = await use(customerWith(k, undefined))
    // Only remembered once the headerless attempt has actually SUCCEEDED — a memo written on the way in
    // would pin a customer to a path that was never proven to work.
    directAccessCustomers.add(k.customerId)
    console.log(`[google-ads-client] ${k.customerId}: refused through the manager, reached DIRECTLY — the customer's own login holds this account`)
    return out
  }
}

/**
 * The STREAMING twin of `withGoogleAdsCustomer`, and it exists because a generator's rejection arrives on the
 * PULL, not on the call — the same fact `armingStream` is built around.
 *
 * ⛔ THE FALLBACK IS ALLOWED ONLY BEFORE THE FIRST ROW, AND THAT BOUND IS THE CORRECTNESS PROPERTY, NOT A
 * CAUTION. Re-opening a stream that has already yielded would replay rows the caller has already written, and
 * the walk writes as it reads. A permission refusal always arrives before any row, so this costs nothing real;
 * it is enforced anyway, because "it cannot happen" is how it happens.
 */
export async function* withGoogleAdsStream(
  k: { refreshToken: string; customerId: string },
  open: (c: GoogleAdsCustomer) => AsyncGenerator<any>,
): AsyncGenerator<any> {
  const manager = process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!
  if (directAccessCustomers.has(k.customerId)) { yield* open(customerWith(k, undefined)); return }
  let yielded = 0
  try {
    for await (const row of open(customerWith(k, manager))) { yielded++; yield row }
    return
  } catch (e: any) {
    const text = `${e?.errors?.[0]?.message ?? ''} ${e?.message ?? ''} ${JSON.stringify(e?.errors?.[0]?.error_code ?? e?.errors?.[0]?.errorCode ?? {})}`
    if (yielded > 0 || !PERMISSION_REFUSAL.test(text)) throw e
  }
  for await (const row of open(customerWith(k, undefined))) yield row
  directAccessCustomers.add(k.customerId)
  console.log(`[google-ads-client] ${k.customerId}: stream refused through the manager, reached DIRECTLY`)
}
