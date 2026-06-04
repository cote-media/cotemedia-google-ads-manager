// LORAMER_BACKFILL_ADAPTERS_V1
// Per-platform adapters for the shared backfill engine (run-backfill.ts).
// Google + Meta today; Shopify/GA/Woo register here later. The registry is the
// allowlist the session-authed trigger will consult.

import { supabaseAdmin } from '@/lib/supabase'
import { getDailyMetrics } from '@/lib/google-ads'
import { fetchMetaDailyMetrics } from '@/lib/meta-ads'
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

export const backfillAdapters: Record<string, BackfillAdapter> = {
  google: googleBackfillAdapter,
  meta: metaBackfillAdapter,
}
