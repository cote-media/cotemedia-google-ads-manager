// LORAMER_BACKFILL_ADAPTERS_V2
// Per-platform adapters for the shared backfill engine (run-backfill.ts).
// Meta uses the default path; Google and GA use the V3 optional hooks — GA because its token/property
// live in ga_tokens and its metrics_daily row shape differs from the ads shape, Google because its
// account row has exactly ONE producer (see below).
// The registry is the allowlist the session-authed trigger consults.

import { supabaseAdmin } from '@/lib/supabase'
import { fetchGoogleAccountWindow, buildGoogleAccountRows, type GoogleAccountDay } from '@/lib/intelligence/google-account-row' // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — the ONE account-row producer
import { fetchMetaDailyMetrics } from '@/lib/meta-ads'
import { getValidGaToken } from '@/lib/ga-token'
import { fetchGaDailyMetrics, type GaDailySlice } from '@/lib/intelligence/ga-intelligence'
import { buildGaMetricsRows } from '@/lib/intelligence/ga-metrics-row'
import { withGoogleRetry, fetchMetaDailyWithRetryNarrow } from './retry' // LORAMER_BACKFILL_RETRY_V1 — transient backoff at the backfill boundary
import type { BackfillAdapter, DailyRow } from './run-backfill'

// LORAMER_GOOGLE_FORWARD_RESTATE_V1 — GOOGLE ROUTES THROUGH THE SINGLE ACCOUNT-ROW PRODUCER.
//
// ⛔ WHAT THIS FIXES, AND IT WAS LIVE. This adapter declared NO buildRows, so google fell through to the
// SHARED DEFAULT row builder in run-backfill.ts — which writes platform:'google' + entity_level:'account'
// + breakdown_type:'' on the IDENTICAL 7-column conflict key as the producer. Two writers, one key:
//   · it wrote `extra: {}`, BLANKING the six ratio keys (ctr/cpc/cpm/roas/cpa/convRate) the producer and
//     the retired builder both carry;
//   · getDailyMetrics rounded conversions to ONE decimal (`toFixed(1)`) before we ever saw them.
// It is reachable from /api/backfill/google, /api/backfill/run, the drain's tier-1 'account' step and the
// one-click Backfill button — i.e. the COLD path a new customer takes, which is exactly the path
// LORAMER_BACKFILL_DONE_DONE_V1 is proven on. run-backfill descends from `backfill_earliest_date - 1` in
// 365-day chunks starting at yesterday, so the first lap on any client whose google backfill is not
// complete overlaps the producer's whole 30-day restate window.
//
// ⛔ BOTH HOOKS MOVE, NOT JUST buildRows. Routing only the BUILD would leave getDailyMetrics' `toFixed(1)`
// upstream, so the row would still not be byte-identical to forward and the divergence would survive a
// green guard — the exact false-green this flight exists to close.
// NO BEHAVIOUR CHANGE BEYOND THE ROW: `getDailyMetrics(customerId, no campaignId)` already queried
// `FROM customer` over the same `segments.date BETWEEN` (google-ads.ts), which is the producer's own
// source, so the SPEND is identical at 2dp and nothing about which days are asked for moves. The retry
// wrapper is preserved. googleAdsCustomerFor is the same construction as google-ads.ts's getCustomer
// (same customer_id / refresh_token / login_customer_id) and is the declared choke point for new code.
export const googleBackfillAdapter: BackfillAdapter<GoogleAccountDay> = {
  platform: 'google',
  accountIdKey: 'customerId',
  chunkDays: 365,
  connectionMissingError: 'Client has no Google connection',
  tokenMissingError: 'No Google refresh token',
  loadToken: async (userEmail: string) => {
    const { data, error } = await supabaseAdmin
      .from('google_tokens')
      .select('refresh_token')
      .eq('user_email', userEmail)
      .single()
    return { token: data?.refresh_token, error: error?.message }
  },
  fetchDaily: async (token, accountId, windowStart, windowEnd) =>
    await withGoogleRetry(() => fetchGoogleAccountWindow(token, accountId, windowStart, windowEnd)), // LORAMER_BACKFILL_RETRY_V1 — backoff was the missing per-source guard here
  buildRows: (daily, ctx) =>
    buildGoogleAccountRows(ctx.clientId, ctx.userEmail, ctx.accountId, ctx.accountName, daily),
}

export const metaBackfillAdapter: BackfillAdapter = {
  platform: 'meta',
  accountIdKey: 'accountId',
  chunkDays: 90,
  // Meta insights retain ~37 months; stop at 36 (safety margin) so the engine never requests pre-retention
  // (which Meta THROWS on, stopping the step short) — the floor becomes an empty-success, i.e. "complete".
  granularMonths: 36,
  connectionMissingError: 'Client has no Meta connection',
  tokenMissingError: 'No Meta access token',
  loadToken: async (userEmail: string) => {
    const { data, error } = await supabaseAdmin
      .from('meta_tokens')
      .select('access_token')
      .eq('user_email', userEmail)
      .single()
    return { token: data?.access_token, error: error?.message }
  },
  // (b) backfill-boundary retry: transient backoff + query-too-heavy (#100/1487534) window-halving.
  fetchDaily: async (token, accountId, windowStart, windowEnd) =>
    (await fetchMetaDailyWithRetryNarrow(
      (s, u) => fetchMetaDailyMetrics(token, accountId, s, u),
      windowStart,
      windowEnd
    )) as DailyRow[],
}

export const gaBackfillAdapter: BackfillAdapter<GaDailySlice> = {
  platform: 'ga',
  accountIdKey: 'propertyId',
  chunkDays: 365,
  connectionMissingError: 'Client has no GA connection',
  tokenMissingError: 'No GA token',
  floorDate: '2015-08-14',
  // GA never uses the default loadToken path (resolveContext handles auth), but
  // the field is required by the interface.
  loadToken: async () => ({ error: 'GA uses resolveContext' }),
  resolveContext: async (clientId) => {
    const { data: gaRow, error } = await supabaseAdmin
      .from('ga_tokens')
      .select('user_email, ga_property_id')
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) {
      return { ok: false, status: 500, error: 'ga_tokens lookup failed', detail: error.message }
    }
    if (!gaRow?.user_email || !gaRow?.ga_property_id) {
      return { ok: false, status: 400, error: 'Client has no GA connection (no ga_tokens row)' }
    }
    const tok = await getValidGaToken(clientId, gaRow.user_email)
    if (!tok.ok) {
      return {
        ok: false,
        status: 400,
        error: 'GA token unavailable',
        detail: `${tok.reason}${tok.detail ? ' - ' + tok.detail : ''}`,
      }
    }
    return {
      ok: true,
      token: tok.accessToken,
      accountId: tok.gaPropertyId,
      accountName: tok.gaPropertyName,
      userEmail: gaRow.user_email,
    }
  },
  fetchDaily: async (token, accountId, windowStart, windowEnd) =>
    await fetchGaDailyMetrics(accountId, token, windowStart, windowEnd),
  buildRows: (daily, ctx) =>
    daily.flatMap((slice) =>
      buildGaMetricsRows(
        ctx.clientId,
        ctx.userEmail,
        slice.date,
        ctx.accountId,
        ctx.accountName,
        slice
      )
    ),
}

export const backfillAdapters: Record<string, BackfillAdapter<any>> = {
  google: googleBackfillAdapter,
  meta: metaBackfillAdapter,
  ga: gaBackfillAdapter,
}
