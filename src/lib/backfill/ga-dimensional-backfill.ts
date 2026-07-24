// LORAMER_GA_DIMENSIONAL_CAPTURE_V1 — GA4 DIMENSIONAL breadth capture (families A–I). WRITE-ONLY (GA is an
// attribution/behavioral platform → label, NEVER equality-reconcile; mirrors google_geo, NOT meta_geo's spend
// anchor). Persists metrics_daily BREAKDOWN ROWS on the EXISTING 7-col key (breakdown_type='ga_*') — NO schema
// change, NO migration (per the settled §8 storage decision: "dimensional breakdowns ride the existing 7-col key";
// GA metrics ride extra-JSONB like the shipped account rows). Self-contained runReport (does NOT import the live
// prompt's ga-intelligence → that fetch stays UNTOUCHED). Each family = its OWN runReport (GA4 scope-compat), PAGED
// FULLY (limit≤100k + offset), keepEmptyRows:false so an empty day/dim writes NOTHING (false-zero guard). Per-family
// try/catch: a family GA can't serve (age/gender w/o Google Signals; items on a non-ecom property) is SKIPPED loudly,
// never breaks the others. Quota is PER-PROPERTY (sharded) → paced by the drain's per-client __drain_ga claim; NO
// global guard needed (unlike Google Ads' developer-token quota).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { getValidGaToken } from '@/lib/ga-token'

const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const CURSOR_PLATFORM = 'ga_dimensional' // sync_state progress key only; data rows stay platform='ga'
const HARD_FLOOR = '2015-08-14' // GA known_floors floor; the per-property data-start (below) usually clamps deeper
const PAGE_LIMIT = 100000
const DEFAULT_TIME_BUDGET_MS = 300_000 // per drain lap; cursor resumes across laps

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const fmt = (d: Date) => d.toISOString().split('T')[0]
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return fmt(d) }
const gaDate = (yyyymmdd: string) => (yyyymmdd && yyyymmdd.length === 8 ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : yyyymmdd)

// US states + DC → ISO 3166-2 (GA4 'region' returns the NAME; match Shopify/Meta geo_region "US-CA").
const US_REGION_TO_ISO: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
}
const regionCode = (country: string, region: string) => `${country || '(not set)'}-${US_REGION_TO_ISO[region] || region || '(not set)'}`

type Metric = { name: string; to: 'conversions' | 'revenue' | 'extra'; additive?: boolean } // LORAMER_GA_DIM_DEDUP_V1 — additive:false marks a RATE (never summed when merging duplicate-key rows)
type Family = { bt: string; dims: string[]; metrics: Metric[]; value: (d: string[]) => string }
const S = (n: string): Metric => ({ name: n, to: 'extra' }) // session/behavioral COUNT metric → extra JSONB (additive)
const RATE = (n: string): Metric => ({ name: n, to: 'extra', additive: false }) // LORAMER_GA_DIM_DEDUP_V1 — a RATE (e.g. sessionConversionRate): extra JSONB but NON-additive; dropped on merge (a rate over a merged bucket is not recoverable from the component rates)
const C: Metric = { name: 'conversions', to: 'conversions' }
const R: Metric = { name: 'totalRevenue', to: 'revenue' }
const SESSION_METRICS: Metric[] = [S('sessions'), S('engagedSessions'), C, R]
const GEO_METRICS: Metric[] = [S('sessions'), C, R]

// FAMILIES A–I. Each: breakdown_type · dims (date is prepended by the fetcher) · metrics · breakdown_value encoder.
const FAMILIES: Family[] = [
  { bt: 'ga_source_medium', dims: ['sessionSource', 'sessionMedium'], metrics: SESSION_METRICS, value: (d) => `${d[0]} / ${d[1]}` },        // A
  { bt: 'ga_channel', dims: ['sessionDefaultChannelGroup'], metrics: SESSION_METRICS, value: (d) => d[0] },                                   // B
  { bt: 'ga_campaign', dims: ['sessionCampaignName'], metrics: SESSION_METRICS, value: (d) => d[0] },                                          // C
  { bt: 'ga_landing_page', dims: ['landingPagePlusQueryString'], metrics: [S('sessions'), S('engagedSessions'), C, RATE('sessionConversionRate'), R], value: (d) => d[0] }, // D — sessionConversionRate is a RATE (LORAMER_GA_DIM_DEDUP_V1)
  { bt: 'ga_device', dims: ['deviceCategory'], metrics: SESSION_METRICS, value: (d) => d[0] },                                                 // E
  { bt: 'ga_geo_country', dims: ['country'], metrics: GEO_METRICS, value: (d) => d[0] },                                                       // F1
  { bt: 'ga_geo_region', dims: ['country', 'region'], metrics: GEO_METRICS, value: (d) => regionCode(d[0], d[1]) },                            // F2
  { bt: 'ga_geo_city', dims: ['country', 'region', 'city'], metrics: GEO_METRICS, value: (d) => `${regionCode(d[0], d[1])}-${d[2] || '(not set)'}` }, // F3
  { bt: 'ga_age', dims: ['userAgeBracket'], metrics: GEO_METRICS, value: (d) => d[0] },                                                        // G1 (Signals-gated)
  { bt: 'ga_gender', dims: ['userGender'], metrics: GEO_METRICS, value: (d) => d[0] },                                                         // G2 (Signals-gated)
  { bt: 'ga_event', dims: ['eventName'], metrics: [S('eventCount'), S('eventValue')], value: (d) => d[0] },                                    // H (event-scoped)
  { bt: 'ga_item', dims: ['itemName', 'itemId'], metrics: [S('itemsPurchased'), S('itemRevenue')], value: (d) => `${d[0]}${d[1] ? ' (' + d[1] + ')' : ''}` }, // I (item-scoped)
]

// LORAMER_GA_DIM_DEDUP_V1 — the non-additive extra metric names, DERIVED from the family metric defs (single source:
// mark a rate with RATE()). Used by mergeConflictKeyDupes to know which extra fields must NOT be summed.
const NON_ADDITIVE_EXTRA = new Set(FAMILIES.flatMap((f) => f.metrics).filter((m) => m.additive === false).map((m) => m.name))

// LORAMER_GA_DIM_DEDUP_V1 — GENERAL guard against a duplicate metrics_daily conflict key. A family can emit TWO rows
// with the SAME (entity_level, entity_id, date, breakdown_type, breakdown_value) — e.g. GA returns both '(not set)'
// AND an empty sessionCampaignName that value()'s `|| '(not set)'` collapses to '(not set)'. They are the SAME
// semantic bucket (an empty campaign name IS "not set"), so we MERGE, not keep-distinct: SUM the additive metrics
// (conversions, revenue, and additive extra COUNTS) and DROP non-additive extra rates (a rate over the merged bucket
// is not recoverable from the two component rates — keeping either would misrepresent it). Without this, the ATOMIC
// batch upsert throws "ON CONFLICT DO UPDATE command cannot affect row a second time" and writes NOTHING for the whole
// batch (the confirmed Bath Fitter freeze). Runs on the ASSEMBLED rows, so EVERY family is covered — not ga_campaign
// only. A row with no duplicate passes through byte-identical (same object reference).
export function mergeConflictKeyDupes(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const r of rows) {
    const key = [r.entity_level, r.entity_id, r.date, r.breakdown_type, r.breakdown_value].join('')
    const prev = byKey.get(key)
    if (!prev) { byKey.set(key, r); continue }
    prev.conversions = fin(prev.conversions) + fin(r.conversions)
    prev.revenue = fin(prev.revenue) + fin(r.revenue)
    const pe = (prev.extra as Record<string, unknown>) || {}, re = (r.extra as Record<string, unknown>) || {}
    const out: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(pe), ...Object.keys(re)])) {
      if (NON_ADDITIVE_EXTRA.has(k)) continue // DROP the rate — it cannot be re-derived over the merged bucket
      out[k] = fin(pe[k]) + fin(re[k])
    }
    prev.extra = out
  }
  return Array.from(byKey.values())
}

type GaRow = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }

async function runGaReport(propertyId: string, accessToken: string, body: Record<string, unknown>): Promise<GaRow[]> {
  const prop = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`
  const res = await fetch(`${GA_DATA_API}/${prop}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = (await res.json()) as { rows?: GaRow[]; error?: { message?: string }; message?: string }
  if (!res.ok) throw new Error(json.error?.message || json.message || `GA runReport HTTP ${res.status}`)
  return json.rows || []
}

// Fetch ONE family over [start,end] (with the date dimension for per-day rows), PAGED fully.
async function fetchFamily(propertyId: string, accessToken: string, fam: Family, startDate: string, endDate: string): Promise<GaRow[]> {
  const dims = [{ name: 'date' }, ...fam.dims.map((n) => ({ name: n }))]
  const metrics = fam.metrics.map((m) => ({ name: m.name }))
  const out: GaRow[] = []
  let offset = 0
  for (;;) {
    const rows = await runGaReport(propertyId, accessToken, {
      dateRanges: [{ startDate, endDate }], dimensions: dims, metrics, keepEmptyRows: false, limit: PAGE_LIMIT, offset,
    })
    out.push(...rows)
    if (rows.length < PAGE_LIMIT) break
    offset += PAGE_LIMIT
  }
  return out
}

// SHARED builder — used by backfill AND forward/catchup so rows are byte-identical. Fetches ALL families over the
// window and returns metrics_daily breakdown rows. A family GA can't serve is skipped (logged), never fatal.
export async function fetchGaDimensionalRows(args: {
  clientId: string; userEmail: string; accessToken: string; propertyId: string; propertyName: string; startDate: string; endDate: string
}): Promise<{ rows: Record<string, unknown>[]; perFamily: Record<string, number>; skipped: string[] }> {
  const { clientId, userEmail, accessToken, propertyId, propertyName, startDate, endDate } = args
  const rows: Record<string, unknown>[] = []
  const perFamily: Record<string, number> = {}
  const skipped: string[] = []
  for (const fam of FAMILIES) {
    try {
      const gaRows = await fetchFamily(propertyId, accessToken, fam, startDate, endDate)
      let n = 0
      for (const gr of gaRows) {
        const dv = (gr.dimensionValues || []).map((x) => x.value ?? '')
        const mv = (gr.metricValues || []).map((x) => x.value ?? '')
        const date = gaDate(dv[0] || '')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
        const value = fam.value(dv.slice(1).map((v) => v || '(not set)'))
        let conversions = 0, revenue = 0
        const extra: Record<string, unknown> = {}
        fam.metrics.forEach((m, i) => {
          const num = fin(mv[i])
          if (m.to === 'conversions') conversions = num
          else if (m.to === 'revenue') revenue = num
          else extra[m.name] = num
        })
        rows.push({
          client_id: clientId, user_email: userEmail, platform: 'ga', account_id: propertyId,
          entity_level: 'account', entity_id: propertyId, entity_name: propertyName, date,
          breakdown_type: fam.bt, breakdown_value: value || '(not set)',
          conversions, revenue, extra,
        })
        n += 1
      }
      perFamily[fam.bt] = n
    } catch (e: any) {
      // GA can't serve this family (e.g. age/gender w/o Google Signals, or an unavailable dim) → SKIP loud, never fabricate.
      console.warn(`[ga-dim] client=${clientId} family=${fam.bt} SKIPPED ${startDate}..${endDate}: ${e?.message ?? e}`)
      skipped.push(fam.bt)
    }
  }
  return { rows: mergeConflictKeyDupes(rows), perFamily, skipped } // LORAMER_GA_DIM_DEDUP_V1 — merge duplicate-conflict-key rows before any upsert (else the atomic batch throws + writes nothing)
}

async function upsertCursor(clientId: string, earliest: string, target: string, complete: boolean) {
  await supabaseAdmin.from('sync_state').upsert(
    { client_id: clientId, platform: CURSOR_PLATFORM, backfill_earliest_date: earliest, backfill_target_date: target, backfill_complete: complete, updated_at: new Date().toISOString() },
    { onConflict: 'client_id,platform' }
  )
}

function monthChunks(start: string, end: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = []
  let cur = start
  while (cur <= end) {
    const d = new Date(cur + 'T00:00:00Z')
    const mEnd = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
    chunks.push({ from: cur, to: mEnd < end ? mEnd : end })
    const next = new Date((mEnd < end ? mEnd : end) + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); cur = fmt(next)
  }
  return chunks
}

export interface GaDimBackfillResult { status: number; body: Record<string, any> }

// CURSOR-RESUMING backfill (own 'ga_dimensional' cursor; the account 'ga' cursor + rows are NEVER touched). Walks
// MONTH chunks OLDER from the resume point to the property's data-start, upserting breakdown rows. Time-budgeted.
export async function runGaDimensionalBackfill(clientId: string, opts: { timeBudgetMs?: number; now?: string } = {}): Promise<GaDimBackfillResult> {
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = Date.now()

  // Resolve GA token + property (mirrors the account backfill's resolveContext).
  const { data: gaRow } = await supabaseAdmin.from('ga_tokens').select('user_email, ga_property_id').eq('client_id', clientId).maybeSingle()
  if (!gaRow?.user_email || !gaRow?.ga_property_id) return { status: 400, body: { error: 'Client has no GA connection', clientId } }
  const userEmail = gaRow.user_email as string
  const tok = await getValidGaToken(clientId, userEmail)
  if (!tok.ok) return { status: 400, body: { error: 'GA token unavailable', detail: tok.reason, clientId } }
  const propertyId = tok.gaPropertyId, propertyName = tok.gaPropertyName

  const nowIso = opts.now ?? fmt(new Date())
  const endDate = addDays(nowIso, -1)

  // Cursor.
  const { data: state } = await supabaseAdmin.from('sync_state').select('backfill_earliest_date, backfill_complete').eq('client_id', clientId).eq('platform', CURSOR_PLATFORM).maybeSingle()
  if (state?.backfill_complete) return { status: 200, body: { clientId, complete: true, note: 'already complete' } }

  // Floor = the property data-start, detected by an EMPTY-MONTH early-stop in the walk below (a run of consecutive
  // CLEAN-empty months — all families ran, all returned 0 rows — means we've passed the property's first data → done).
  // HARD_FLOOR is the absolute cap. False-zero-safe: an empty month writes NOTHING. (No jsonb-cast presence query.)
  const targetStart = HARD_FLOOR
  const EMPTY_MONTH_STOP = 6

  const windowEnd = state?.backfill_earliest_date ? addDays(state.backfill_earliest_date, -1) : endDate
  if (windowEnd < targetStart) { await upsertCursor(clientId, targetStart, targetStart, true); return { status: 200, body: { clientId, complete: true, note: 'window already covered' } } }

  // Walk months OLDER, newest-first, time-budgeted. earliestWritten = deepest month COVERED (empty or not).
  const months = monthChunks(targetStart, windowEnd).reverse()
  let earliestWritten = state?.backfill_earliest_date || addDays(endDate, 1)
  let rowsWritten = 0, monthsWalked = 0, timedOut = false, reachedStart = false, consecutiveEmpty = 0
  const perFamilyTotal: Record<string, number> = {}
  const skippedFamilies = new Set<string>()
  const errors: Array<{ month: string; message: string }> = []

  for (const { from, to } of months) {
    if (Date.now() - startedAt > timeBudgetMs) { timedOut = true; break }
    try {
      const { rows, perFamily, skipped } = await fetchGaDimensionalRows({ clientId, userEmail, accessToken: tok.accessToken, propertyId, propertyName, startDate: from, endDate: to })
      if (rows.length > 0) {
        const { error } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(rows), { onConflict: CONFLICT })
        if (error) throw error
        rowsWritten += rows.length
        for (const [k, v] of Object.entries(perFamily)) perFamilyTotal[k] = (perFamilyTotal[k] || 0) + v
        consecutiveEmpty = 0
      } else if (skipped.length === 0) {
        consecutiveEmpty += 1 // a CLEAN empty month (all families ran, nothing returned) — counts toward the floor stop
      }
      for (const s of skipped) skippedFamilies.add(s)
      if (from < earliestWritten) earliestWritten = from
      monthsWalked += 1
      if (consecutiveEmpty >= EMPTY_MONTH_STOP) { reachedStart = true; break } // passed the property data-start
    } catch (e: any) {
      console.error(`[ga-dim] client=${clientId} month=${from}..${to} FAILED:`, e?.message ?? e)
      errors.push({ month: from, message: String(e?.message ?? e) })
      break // stop loud; cursor not advanced → resume re-processes this month
    }
  }

  const done = reachedStart || (earliestWritten <= targetStart && errors.length === 0 && !timedOut)
  await upsertCursor(clientId, earliestWritten, targetStart, done)

  return {
    status: errors.length ? 207 : 200,
    body: {
      clientId, propertyId, dateRange: { start: targetStart, end: endDate }, processedThrough: earliestWritten,
      monthsWalked, rowsWritten, perFamily: perFamilyTotal, skippedFamilies: Array.from(skippedFamilies),
      complete: done, timedOut, resumeFrom: done ? null : (errors[0]?.month || addDays(earliestWritten, -1)), errors,
    },
  }
}

// LORAMER_GA_FORWARD_DIM_LOOKBACK_V1 — ONE-TIME forward RE-WALK of an explicit [from..to] window for ONE client.
// Purpose: recover a gap the forward-dim path missed (e.g. Bath Fitter 07-15..today, frozen by the old single-shot
// captureDate fetch). It does NOT touch either cursor (account 'ga' or 'ga_dimensional') and never marks anything
// complete — it just re-fetches the window and upserts on the conflict key (finalized values overwrite intraday),
// scoped to `clientId` only (fetchGaDimensionalRows stamps client_id, so no other client's rows are touched). Invoked
// ONLY behind the explicit /api/backfill/ga-dimensional-recover route (CRON_SECRET + required from/to) — it is NOT on
// any cron and NEVER fires on deploy.
export async function recoverGaDimensionalForward(clientId: string, from: string, to: string): Promise<GaDimBackfillResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return { status: 400, body: { error: 'from/to must be YYYY-MM-DD with from<=to', clientId, from, to } }
  }
  const { data: gaRow } = await supabaseAdmin.from('ga_tokens').select('user_email, ga_property_id').eq('client_id', clientId).maybeSingle()
  if (!gaRow?.user_email || !gaRow?.ga_property_id) return { status: 400, body: { error: 'Client has no GA connection', clientId } }
  const userEmail = gaRow.user_email as string
  const tok = await getValidGaToken(clientId, userEmail)
  if (!tok.ok) return { status: 400, body: { error: 'GA token unavailable', detail: tok.reason, clientId } }
  const { rows, perFamily, skipped } = await fetchGaDimensionalRows({ clientId, userEmail, accessToken: tok.accessToken, propertyId: tok.gaPropertyId, propertyName: tok.gaPropertyName, startDate: from, endDate: to })
  let rowsWritten = 0
  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(rows), { onConflict: CONFLICT })
    if (error) return { status: 500, body: { error: error.message, clientId, from, to } }
    rowsWritten = rows.length
  }
  return { status: 200, body: { clientId, from, to, rowsWritten, perFamily, skippedFamilies: skipped } }
}
