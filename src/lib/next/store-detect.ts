// LORAMER_NEXT_STORE_READS_V1 — connection/data-aware store-platform resolution for the -next store reads. Mirrors
// the /api/next/money detection (data-based, most-recent wins) but broadened to ANY captured account row (not just
// extra.money) so a store with revenue that predates the money back-drain still resolves. hasDataEver law: a client
// with NO captured store data resolves to chosen=null → the reads return an honest empty/connect state, never a false $0.
import { supabaseAdmin } from '@/lib/supabase'
import { probeRead, probeYes, valueOf, type Probe } from '@/lib/next/presence' // LORAMER_FAILURE_IS_NOT_A_FACT_V1

export const STORE_PLATFORMS = ['woocommerce', 'shopify'] as const

// most-recent captured ACCOUNT-row date for a store platform. null = no captured store data ever.
// LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1 — breakdown_value='' is LOAD-BEARING, not redundant: migration 035's partial
// index requires ALL THREE of entity_level='account', breakdown_type='' and breakdown_value='', so without it the
// planner cannot prove implication and the index is silently unusable. Rests on the EMPIRICAL invariant that an
// account row exists on every captured day (23/23 fleet + per client×platform, 2026-07-15; NOT schema-enforced).
// Do not delete as redundant.
async function latestStoreDate(clientId: string, pf: string): Promise<Probe<string>> {
  return probeRead<any[]>(
    `latest ${pf} account-row date`,
    () => supabaseAdmin
      .from('metrics_daily')
      .select('date')
      .eq('client_id', clientId).eq('platform', pf)
      .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
      .order('date', { ascending: false })
      .limit(1),
    (rows) => Array.isArray(rows) && rows.length > 0,
  ).then((p) => (p.state === 'yes' ? probeYes(p.value[0].date as string) : (p as Probe<string>)))
}

// Resolve which store platform to serve: an explicit `requested` if it has data, else the store with the MOST-RECENT
// captured data. chosen=null when the client has NO captured store data on either platform.
export async function resolveStorePlatform(clientId: string, requested?: string | null): Promise<{ chosen: string | null; available: string[]; unknown: string[] }> {
  const probes = await Promise.all(STORE_PLATFORMS.map((pf) => latestStoreDate(clientId, pf)))
  const unknown = STORE_PLATFORMS.filter((_, i) => probes[i].state === 'unknown')
  const avail = STORE_PLATFORMS
    .map((pf, i) => ({ pf, date: valueOf(probes[i]) }))
    .filter((x) => x.date) as { pf: string; date: string }[]
  const chosen =
    (requested && avail.find((a) => a.pf === requested)?.pf) ||
    avail.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.pf ||
    null
  // ⛔ THE ONE BEHAVIOURAL CHANGE IN PART 1, AND IT IS DELIBERATE: chosen=null MUST mean "this client has no
  // captured store data", never "we could not find out". Returning null on a failed read makes the store
  // surface render an honest-empty connect prompt to a client who HAS a store — the same lie as
  // "not connected", one surface over. Three -next callers only (store page + store-stats + store-timeseries),
  // no legacy path. Failing LOUD is the correct trade: a 500 is recoverable and visible; a false empty is not.
  if (chosen === null && unknown.length) {
    const reasons = probes.filter((p) => p.state === 'unknown').map((p) => (p as { reason: string }).reason).join(' · ')
    throw new Error(`store platform is UNKNOWN, not absent — ${unknown.join(' and ')} could not be read: ${reasons}`)
  }
  return { chosen, available: avail.map((a) => a.pf), unknown: [...unknown] }
}
