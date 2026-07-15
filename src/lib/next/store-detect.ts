// LORAMER_NEXT_STORE_READS_V1 — connection/data-aware store-platform resolution for the -next store reads. Mirrors
// the /api/next/money detection (data-based, most-recent wins) but broadened to ANY captured account row (not just
// extra.money) so a store with revenue that predates the money back-drain still resolves. hasDataEver law: a client
// with NO captured store data resolves to chosen=null → the reads return an honest empty/connect state, never a false $0.
import { supabaseAdmin } from '@/lib/supabase'

export const STORE_PLATFORMS = ['woocommerce', 'shopify'] as const

// most-recent captured ACCOUNT-row date for a store platform. null = no captured store data ever.
// LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1 — breakdown_value='' is LOAD-BEARING, not redundant: migration 035's partial
// index requires ALL THREE of entity_level='account', breakdown_type='' and breakdown_value='', so without it the
// planner cannot prove implication and the index is silently unusable. Rests on the EMPIRICAL invariant that an
// account row exists on every captured day (23/23 fleet + per client×platform, 2026-07-15; NOT schema-enforced).
// Do not delete as redundant.
async function latestStoreDate(clientId: string, pf: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('metrics_daily')
    .select('date')
    .eq('client_id', clientId).eq('platform', pf)
    .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
    .order('date', { ascending: false })
    .limit(1)
  return data && data[0] ? (data[0].date as string) : null
}

// Resolve which store platform to serve: an explicit `requested` if it has data, else the store with the MOST-RECENT
// captured data. chosen=null when the client has NO captured store data on either platform.
export async function resolveStorePlatform(clientId: string, requested?: string | null): Promise<{ chosen: string | null; available: string[] }> {
  const dates = await Promise.all(STORE_PLATFORMS.map((pf) => latestStoreDate(clientId, pf)))
  const avail = STORE_PLATFORMS.map((pf, i) => ({ pf, date: dates[i] })).filter((x) => x.date) as { pf: string; date: string }[]
  const chosen =
    (requested && avail.find((a) => a.pf === requested)?.pf) ||
    avail.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.pf ||
    null
  return { chosen, available: avail.map((a) => a.pf) }
}
