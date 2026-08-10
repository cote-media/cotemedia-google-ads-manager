// LORAMER_GOOGLE_CLIENT_CHOKE_POINT_V1 — THE ONE PLACE A GOOGLE ADS CLIENT IS CONSTRUCTED (for new code).
//
// ⛔ WHY, measured 2026-08-10: six Russ-approved probe operations hit Google and appeared in NO ledger —
// universe_attempt_log 0, universe_window_log 0, cron_runs 0 (docs/LORAMER_BACKFILL_FACT_REGISTRY.md owns
// the measurement). Every governor sums OUR OWN ledgers, so spend that bypasses them is quota the governors
// re-grant to someone else. Google enforces 15,000 ops/day per developer token regardless of our accounting.
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

/** THE choke point. Every NEW Google Ads touch constructs its Customer here and nowhere else. */
export function googleAdsCustomerFor(k: { refreshToken: string; customerId: string }): GoogleAdsCustomer {
  return apiFromEnv().Customer({
    customer_id: k.customerId,
    refresh_token: k.refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
}
