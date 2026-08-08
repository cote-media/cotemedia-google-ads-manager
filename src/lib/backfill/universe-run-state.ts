// LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — DURABLE PER-ENTRY STATE + THE COMPLETION DECISION.
//
// ⛔ THIS FILE NEVER WRITES sync_state.backfill_complete. That column reads TRUE on 214 cursors across 18
// clients while Google still serves years more data, because the drain seals it from a 36-month clock. A path
// built to end that defect may not inherit the column that carries it.
//
// ⛔ COMPLETION IS THE VENDOR'S WORD, CARRIED WITH ITS PROOF. `vendor_exhausted_below` is a DATE and is only
// ever written together with the literal request that returned zero rows. There is no boolean to flip and no
// clock to consult — the guard asserts both.
import { supabaseAdmin } from '@/lib/supabase'
import type { VendorExhaustion } from '@/lib/backfill/google-ads-universe-writer'

export const VENDOR = 'google_ads' // ⛔ NOT 'google' — LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1.
const TABLE = 'universe_run_state'
const NOTICE = 'universe_run_notice'

export interface EntryKey { clientId: string; resource: string; segment: string | null }
const seg = (s: string | null) => s ?? ''

/**
 * ⛔ FAIL LOUDLY ON A MISSING TABLE. Migration 051 is AUTHORED AND NOT APPLIED; until it is, every read here
 * throws with the migration named. A runner that silently degraded to memory-only state would forget its
 * progress on every restart and re-spend quota walking ground it had already covered — and it would look
 * healthy while doing it.
 */
function assertTable(error: { message?: string; code?: string } | null): void {
  if (!error) return
  const m = String(error.message || '')
  if (/relation .*universe_run_state.* does not exist|could not find the table/i.test(m)) {
    throw new Error(`universe_run_state is MISSING — migrations/051_universe_run_state.sql is authored but NOT APPLIED. Apply it in the Supabase SQL Editor before starting a run. Refusing to walk with no durable state: a restart would forget every cursor and re-spend the quota. (${m})`)
  }
  throw new Error(`universe_run_state read/write failed: ${m}`)
}

export async function readEntryState(k: EntryKey) {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*')
    .eq('client_id', k.clientId).eq('vendor', VENDOR).eq('resource', k.resource).eq('segment', seg(k.segment)).maybeSingle()
  if (error) assertTable(error)
  return data as Record<string, any> | null
}

/**
 * Record the outcome of ONE window for ONE entry.
 * ⛔ `exhaustion` is the writer's own proof-carrying verdict and is the ONLY thing that may set
 * `vendor_exhausted_below`. This function does not compute completion; it records the writer's.
 */
export async function recordEntryOutcome(args: {
  key: EntryKey
  cursorDate: string
  exhaustion: VendorExhaustion | null
  observedZero: boolean
  skippedReason: string | null
  rowsWritten: number
  requestsSpent: number
  error: string | null
}) {
  const { key, cursorDate, exhaustion, observedZero, skippedReason, rowsWritten, requestsSpent, error } = args
  const prior = await readEntryState(key)
  const row: Record<string, unknown> = {
    client_id: key.clientId, vendor: VENDOR, resource: key.resource, segment: seg(key.segment),
    cursor_date: cursorDate,
    rows_written: Number(prior?.rows_written || 0) + rowsWritten,
    requests_spent: Number(prior?.requests_spent || 0) + requestsSpent,
    last_error: error, updated_at: new Date().toISOString(),
  }
  // ⛔ ONLY the writer's vendor-exhausted verdict may seal an entry, and it brings its evidence with it.
  if (exhaustion?.complete) {
    row.vendor_exhausted_below = exhaustion.exhaustedBelow
    row.exhaustion_proof = exhaustion.proof
  }
  if (observedZero) row.observed_zero_at = new Date().toISOString()
  if (skippedReason) row.skipped_reason = skippedReason
  const { error: e } = await supabaseAdmin.from(TABLE).upsert(row, { onConflict: 'client_id,vendor,resource,segment' })
  if (e) assertTable(e)
}

/**
 * ⛔ THE DONE SIGNAL. A client is complete when EVERY entry is settled — exhausted, or recorded as skipped.
 * An entry with no row at all is NOT settled: never-asked and asked-and-empty are different facts, and
 * conflating them is the exact defect this whole arc exists to end.
 */
export function isClientComplete(args: { totalEntries: number; states: Array<Record<string, any>> }): { done: boolean; reason: string } {
  const { totalEntries, states } = args
  const settled = states.filter((s) => s.vendor_exhausted_below !== null || s.skipped_reason)
  if (states.length < totalEntries) {
    return { done: false, reason: `${states.length} of ${totalEntries} entries have any state at all — an entry with no row was never asked, which is not the same as answered-empty` }
  }
  if (settled.length < totalEntries) {
    return { done: false, reason: `${settled.length} of ${totalEntries} entries settled (vendor-exhausted or recorded-skipped); ${totalEntries - settled.length} still owed` }
  }
  return { done: true, reason: `all ${totalEntries} entries settled: ${states.filter((s) => s.vendor_exhausted_below).length} vendor-exhausted, ${states.filter((s) => s.skipped_reason).length} recorded-skipped` }
}

/** THE NOTICE — a queryable record, not an email. Written once when a client's walk settles. */
export async function writeCompletionNotice(
  clientId: string,
  states: Array<Record<string, any>>,
  totalEntries: number,
  // ⛔ REQUIRED, NOT OPTIONAL. A notice that states only what the walk covered reports 346 of 559 as
  // "complete" — a green flag over a hole, which the governing law forbids. The vendor's denominator travels
  // WITH the claim or the claim is not written.
  catalog: { catalogTotal: number; exclusions: Array<{ resource: string; segment: string | null; reason: string }> }
) {
  const detail: Record<string, unknown> = {}
  for (const s of states) {
    const k = `${s.resource}${s.segment ? '/' + s.segment : ''}`
    detail[k] = { rows: s.rows_written, requests: s.requests_spent, exhaustedBelow: s.vendor_exhausted_below, zero: !!s.observed_zero_at, skipped: s.skipped_reason || null }
  }
  // ⛔ THE EXCLUSIONS ARE ITEMISED, NEVER SUMMARISED. "213 excluded" is a number nobody can act on; the list
  // with its per-entry reason is a work queue. LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1 stands — the
  // catalog is not narrowed, the debt is made visible.
  const excluded = catalog.exclusions.length
  const { error } = await supabaseAdmin.from(NOTICE).insert({
    client_id: clientId, vendor: VENDOR,
    entries_total: totalEntries,
    entries_catalog_total: catalog.catalogTotal,
    entries_excluded: excluded,
    entries_exhausted: states.filter((s) => s.vendor_exhausted_below).length,
    entries_zero: states.filter((s) => s.observed_zero_at).length,
    entries_skipped: states.filter((s) => s.skipped_reason).length,
    rows_written: states.reduce((a, s) => a + Number(s.rows_written || 0), 0),
    requests_spent: states.reduce((a, s) => a + Number(s.requests_spent || 0), 0),
    detail: {
      ...detail,
      __denominator: {
        marker: 'LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1',
        walked: totalEntries,
        vendorCatalog: catalog.catalogTotal,
        excluded,
        note: 'entries_total is the set the walk PUBLISHES (selectableEntries). entries_catalog_total is what the VENDOR serves. "Complete" means complete over the first number — the gap is real and itemised below, not absent.',
        exclusions: catalog.exclusions,
      },
    },
  })
  if (error) assertTable(error)
}

export async function readAllEntryStates(clientId: string) {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('client_id', clientId).eq('vendor', VENDOR)
  if (error) assertTable(error)
  return (data || []) as Array<Record<string, any>>
}

/** The backfill lane's OWN request spend today — the governor's input. Never a fleet number. */
export async function readBackfillRequestsToday(): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabaseAdmin.from(TABLE).select('requests_spent, updated_at')
    .eq('vendor', VENDOR).gte('updated_at', since.toISOString())
  if (error) assertTable(error)
  return (data || []).reduce((a: number, r: any) => a + Number(r.requests_spent || 0), 0)
}
