// LORAMER_FORWARD_OBSERVATION_LOG_V1 — THE ONE MODULE THAT TOUCHES forward_observation_log (migrations/087).
//
// A forward record is an OBSERVATION: what a producer ASKED the vendor (the catalogue surface, the window, the
// request count) and what CAME BACK (rows per day, ok|zero|nongrain|error, the error text). It is never an
// ATTEST. The walk's coverage predicate (universe-coverage.ts) does not read this table and must never import
// this module — a yesterday zero is a lagging day, not an empty one, and sealing it is the lookback lane's job
// after the vendor's restatement window (LORAMER_RESTATEMENT_WINDOW_LAW_V1: 30 d default, 90 d for
// conversions). tests/guards/forward-observation-boundary.guard.mjs holds that line structurally.
//
// WHO READS THROUGH HERE (the NEED set): google-hole-map.ts (the observedUnsealed tier — a label over
// windowCoverage's answer, never an input to it), google-op-budget.ts (forward's requests, measured instead of
// derived ×67) and, in the filler commit, guard B. Nothing else selects from the table.
//
// ⛔ THE SURFACE SPELLING LIVES HERE AND NOWHERE ELSE. FORWARD_PRODUCER_SURFACES maps each of the ten Google
// forward producers to the catalogue surfaces (resource, segment) it asks for — the walk's own identity
// (docs/google-ads-capture-universe.json), so an observation and a walk attempt on the same surface agree on
// its name even though their warehouse keys differ (the legacy-key fork is a separate, undecided flight).
import { supabaseAdmin } from '@/lib/supabase'

export type ForwardObservationLane = 'forward'
export type ForwardObservationOutcome = 'ok' | 'zero' | 'nongrain' | 'error'

export interface ForwardSurface { resource: string; segment: string }

const GEO_SEGMENTS = ['city', 'metro', 'region', 'state', 'province', 'county', 'district', 'postal_code', 'most_specific_location']

/** producer marker → the catalogue surfaces it asks. Keys are the producer FILES' names (google-*.ts). */
export const FORWARD_PRODUCER_SURFACES: Record<string, ForwardSurface[]> = {
  'google-account-row': [{ resource: 'customer', segment: '' }],
  'google-campaign-backfill': [{ resource: 'campaign', segment: '' }],
  'google-adgroup-ad-backfill': [{ resource: 'ad_group', segment: '' }, { resource: 'ad_group_ad', segment: '' }],
  'google-dimensional': [{ resource: 'search_term_view', segment: '' }, { resource: 'keyword_view', segment: '' }],
  'google-device': [
    { resource: 'campaign', segment: 'segments.device' }, { resource: 'ad_group', segment: 'segments.device' },
    { resource: 'ad_group_ad', segment: 'segments.device' }, { resource: 'keyword_view', segment: 'segments.device' },
  ],
  'google-conversion-action': [{ resource: 'campaign', segment: 'segments.conversion_action_name' }],
  'google-impression-share': [{ resource: 'campaign', segment: '' }],
  'google-geo': [
    ...GEO_SEGMENTS.map((s) => ({ resource: 'geographic_view', segment: `segments.geo_target_${s}` })),
    { resource: 'geographic_view', segment: '' }, // geo_country reads geographic_view.country_criterion_id — a resource field, the base surface
    ...GEO_SEGMENTS.map((s) => ({ resource: 'user_location_view', segment: `segments.geo_target_${s}` })),
  ],
  'google-hour': [{ resource: 'campaign', segment: 'segments.hour' }, { resource: 'ad_group', segment: 'segments.hour' }],
  'google-demographic': [{ resource: 'age_range_view', segment: '' }, { resource: 'gender_view', segment: '' }],
}

/** The device producer's grain entityLevel → the catalogue surface it is asking. */
export const DEVICE_SURFACE_BY_ENTITY_LEVEL: Record<string, ForwardSurface> = {
  campaign: { resource: 'campaign', segment: 'segments.device' },
  ad_group: { resource: 'ad_group', segment: 'segments.device' },
  ad: { resource: 'ad_group_ad', segment: 'segments.device' },
  keyword: { resource: 'keyword_view', segment: 'segments.device' },
}

export interface ForwardObservationInput {
  clientId: string
  vendor: string
  resource: string
  segment: string
  lane: ForwardObservationLane
  producer: string
  cronRunId: number | null
  windowStart: string
  windowEnd: string
  requestsSpent: number
  /** day → rows written for that day. EMPTY when the producer only reports a total (campaign, ad_group/ad today). */
  rowsByDay: Record<string, number>
  rowsWritten: number
  outcome: ForwardObservationOutcome
  error?: string | null
}

const fail = (what: string, detail: unknown): never => {
  throw new Error(
    `[forward-observation-log] ${what} failed: ${detail instanceof Error ? detail.message : JSON.stringify(detail)}. ` +
    `⛔ THIS MUST NOT BE SWALLOWED HERE — the caller records it as a DEGRADED error so the fire's own ledger says ` +
    `an observation is missing, instead of the ask vanishing the way it did before this table existed.`
  )
}

/** Append one observation. Throws on failure; the CALLER (cron/sync observeForward) catches into summary.errors. */
export async function appendForwardObservation(o: ForwardObservationInput): Promise<void> {
  const { error } = await supabaseAdmin.from('forward_observation_log').insert({
    client_id: o.clientId, vendor: o.vendor, resource: o.resource, segment: o.segment ?? '',
    lane: o.lane, producer: o.producer, cron_run_id: o.cronRunId,
    window_start: o.windowStart, window_end: o.windowEnd,
    requests_spent: o.requestsSpent, rows_by_day: o.rowsByDay ?? {}, rows_written: o.rowsWritten,
    outcome: o.outcome, error: o.error ?? null,
  })
  if (error) fail('append', error)
}

/** day → count of rows carrying that date. */
export function summarizeRowsByDay(rows: Array<{ date: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[r.date] = (out[r.date] ?? 0) + 1
  return out
}

/**
 * The outcome vocabulary, derived from counts rather than hand-set (the walk's own rule, universe-v2-worker):
 * error → 'error' · the vendor returned nothing → 'zero' · it returned rows and none became a row → 'nongrain'.
 * ⚠ Producers that expose only a written total (campaign, ad_group/ad) pass apiRows = rowsWritten, so they can
 * say ok|zero|error but never nongrain — stated here rather than inferred at read time.
 */
export function observationOutcome(a: { apiRows: number; rowsWritten: number; error?: string | null }): ForwardObservationOutcome {
  if (a.error) return 'error'
  if (a.apiRows === 0) return 'zero'
  if (a.rowsWritten === 0) return 'nongrain'
  return 'ok'
}

export interface ForwardObservationDays {
  /** every day at least one observation's window covers — forward ASKED, whatever came back */
  asked: string[]
  /** asked, and the newest observation carrying per-day counts says this day had rows */
  observedNonEmpty: string[]
  /** asked, and the newest observation carrying per-day counts says this day had none */
  observedEmpty: string[]
  /** asked by a producer that reports only a window total — per-day unknown, stated */
  askedOnly: string[]
  lastObservedAt: string | null
}

const dayList = (from: string, to: string): string[] => {
  const out: string[] = []
  const d = new Date(from + 'T00:00:00Z'); const end = new Date(to + 'T00:00:00Z')
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}

/**
 * THE ONE READER. Per day in [from, to], what forward observed on this surface. Newest observation per day wins
 * for the empty/non-empty verdict; a day is `asked` if any observation's window covers it. A failed read THROWS —
 * an observation answer must not be synthesised from a failed read (universe-coverage's own rule).
 */
export async function readForwardObservations(k: {
  clientId: string; vendor: string; resource: string; segment: string; from: string; to: string
}): Promise<ForwardObservationDays> {
  const { data, error } = await supabaseAdmin
    .from('forward_observation_log')
    .select('window_start, window_end, rows_by_day, rows_written, observed_at')
    .eq('client_id', k.clientId).eq('vendor', k.vendor)
    .eq('resource', k.resource).eq('segment', k.segment ?? '')
    .lte('window_start', k.to).gte('window_end', k.from)
    .order('observed_at', { ascending: false })
  if (error) throw new Error(`[forward-observation-log] read failed for ${k.resource}/${k.segment || '(base)'}: ${error.message}. ⛔ AN OBSERVATION ANSWER MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
  const rows = (data ?? []) as Array<{ window_start: string; window_end: string; rows_by_day: Record<string, number> | null; rows_written: number; observed_at: string }>
  const asked: string[] = [], observedNonEmpty: string[] = [], observedEmpty: string[] = [], askedOnly: string[] = []
  for (const day of dayList(k.from, k.to)) {
    const covering = rows.filter((r) => r.window_start <= day && r.window_end >= day) // newest first
    if (covering.length === 0) continue
    asked.push(day)
    const perDay = covering.find((r) => r.rows_by_day && Object.keys(r.rows_by_day).length > 0)
    if (perDay) {
      if ((perDay.rows_by_day?.[day] ?? 0) > 0) observedNonEmpty.push(day); else observedEmpty.push(day)
    } else {
      askedOnly.push(day)
    }
  }
  return { asked, observedNonEmpty, observedEmpty, askedOnly, lastObservedAt: rows[0]?.observed_at ?? null }
}

/**
 * Forward's requests since a moment, in REQUESTS — the fleet meter's witness, replacing connections × 67.
 * Same posture as readAttemptLaneSpendToday: an unreadable ledger THROWS so the budget yields 'unknown' and
 * every lane holds, never a clean 0 that reads like "nothing spent".
 */
export async function readForwardObservationSpendToday(vendor: string, since: Date): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('forward_observation_spend_today', { p_vendor: vendor, p_since: since.toISOString() })
  if (error) fail('spend_today', `${error.message} — migrations/087_forward_observation_log.sql creates forward_observation_spend_today(); apply it before running.`)
  const n = Number(data)
  if (!Number.isFinite(n)) fail('spend_today', `non-numeric sum: ${JSON.stringify(data)}`)
  return n
}
