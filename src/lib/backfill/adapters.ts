// LORAMER_BACKFILL_ADAPTERS_V2
// Per-platform adapters for the shared backfill engine (run-backfill.ts).
// Google + Meta use the default path; GA uses the V3 optional hooks
// (resolveContext + buildRows + floorDate) because its token/property live in
// ga_tokens and its metrics_daily row shape differs from the ads shape.
// The registry is the allowlist the session-authed trigger consults.

import { supabaseAdmin } from '@/lib/supabase'
import { getDailyMetrics } from '@/lib/google-ads'
import { fetchMetaDailyMetrics } from '@/lib/meta-ads'
import { getValidGaToken } from '@/lib/ga-token'
import { fetchGaDailyMetrics, type GaDailySlice } from '@/lib/intelligence/ga-intelligence'
import { buildGaMetricsRows } from '@/lib/intelligence/ga-metrics-row'
import type { BackfillAdapter, DailyRow } from './run-backfill'

export const googleBackfillAdapter: BackfillAdapter = {
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
    (await getDailyMetrics(
      token,
      accountId,
      'LAST_30_DAYS',
      undefined,
      'day',
      windowStart,
      windowEnd
    )) as DailyRow[],
}

export const metaBackfillAdapter: BackfillAdapter = {
  platform: 'meta',
  accountIdKey: 'accountId',
  chunkDays: 90,
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
  fetchDaily: async (token, accountId, windowStart, windowEnd) =>
    (await fetchMetaDailyMetrics(token, accountId, windowStart, windowEnd)) as DailyRow[],
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
