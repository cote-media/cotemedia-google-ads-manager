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
//
// ═══ LORAMER_GA_DIM_COMPLETION_HONESTY_V1 — RESILIENCE AND COMPLETION WERE IN CONFLICT, AND COMPLETION WON WRONGLY
// MEASURED 2026-07-30: this cursor read backfill_complete=TRUE at HARD_FLOOR 2015-08-14 for Foam OH while its data
// began 2026-01-01 — 1,428 session-days unwritten behind a flag claiming the walk had finished — and the same shape
// for Influential Drones 5bb9b2ff (data from 2024-02-01; resolve it through src/lib/clients/canonical.ts, which
// records which of the two clients of that name this is) and My Vacation Network (from 2023-01-01). 13,103
// recoverable client-days sat behind three booleans (docs/LORAMER_FLEET_COMPLETENESS_2026_07_30.md).
//
// THE MECHANISM, plainly, because it is not obvious and it will be reintroduced by anyone who does not know it:
// the PER-FAMILY try/catch below exists so that ONE family GA cannot serve (age/gender without Google Signals,
// items on a non-ecommerce property) does not break the other eleven. That resilience is correct and stays. But
// the property-data-start detector counts CONSECUTIVE CLEAN-EMPTY MONTHS, and `consecutiveEmpty` only increments
// when `skipped.length === 0`. So ONE skipped family anywhere DISABLES THE FLOOR DETECTOR — the walk then grinds
// every remaining month to HARD_FLOOR, the old unconditional cursor advance moved it the whole way, and the old
// completion test (`earliestWritten <= targetStart`) was satisfied by DISTANCE TRAVELLED rather than by data
// written. A feature that protects against a missing family silently defeated the test for a missing floor.
// THE FIX: completion now DEFERS to resilience by refusing to claim done. A walk that met an unserved family ends
// INCOMPLETE with the skipped families named, and the cursor only advances over months it can honestly claim.
//
// ⛔ SECOND OCCURRENCE OF THE CLASS, not the first: the 2026-07-15 sealed Meta breadth cursors read 13/13 over a
// permanent hole for exactly the same reason — a completion flag is a claim the code makes about ITSELF, and
// nothing was checking the claim against the data. Prose did not stop the second one, so this ships with a guard
// (FIX-WITH-GUARD): tests/guards/ga-dim-completion-honesty.guard.mjs drives the real exported decision function.
// ⚠ THIS DOES NOT CLOSE THE CLASS. run-backfill.ts:~268 carries the identical shape
// (`backfill_complete: windowStart <= targetDate`) for google/meta/shopify/woocommerce and the GA ACCOUNT cursor,
// and is UNTOUCHED here — that is QUEUE ★COMPLETE-FLAG-AUDIT, a separate flight.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { getValidGaToken } from '@/lib/ga-token'
// LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — ADAPTED, not authored. Both of these already exist and already carry their
// own guards: upsertMetricsChunked is the ONE chunked metrics_daily writer (it calls normalizeMetricsRows internally,
// so the union-of-keys guard cannot be skipped), and shouldStartAnotherLap is the banked between-iteration budget rule
// with a measured reservation. Re-implementing either here would have been a second copy of a fact that already has
// a single owner.
import { upsertMetricsChunked } from '@/lib/metrics-upsert'
import { shouldStartAnotherLap } from '@/lib/backfill/lap-budget'

const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const CURSOR_PLATFORM = 'ga_dimensional' // sync_state progress key only; data rows stay platform='ga'
const HARD_FLOOR = '2015-08-14' // GA known_floors floor; the per-property data-start (below) usually clamps deeper
const PAGE_LIMIT = 100000

// LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — BOTH budgets sit strictly BELOW the lambda ceiling.
// The routes that reach this file declare `maxDuration = 300` (seconds). A budget EQUAL to the ceiling is not a
// budget: the check passes at t=299s, the next unit of work begins, and the lambda is killed mid-flight — which is
// the LORAMER_META_ASSET_BUDGET_HEADROOM_V1 defect, and it is why lowering a constant is never the whole fix (the
// reservation in shouldStartAnotherLap is the other half). 240s leaves 60s of headroom for the kill-safe return.
// ⛔ These two constants are asserted BELOW maxDuration by tests/guards/ga-dim-completion-honesty.guard.mjs, which
// RE-DERIVES the ceiling from the route files rather than restating it — so the number is not copied here either.
const DEFAULT_TIME_BUDGET_MS = 240_000 // per drain lap; cursor resumes across laps. WAS 300_000 == the ceiling.
const RECOVER_BUDGET_MS = 240_000 // per recover invocation; resumeFrom chains across invocations (no cursor)

// LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — the recover walk slices SUB-MONTH by default, and that is measured, not
// preference. Foam OH months ran 6s to 229s against the 300s ceiling and 2023-07 EXCEEDED it, so a calendar month is
// demonstrably NOT a survivable unit of work on this client — a month-sliced recover would still be killed on exactly
// the month that blocked the recovery. 10 days puts the worst observed month at roughly a third of that.
const DEFAULT_SLICE_DAYS = 10

// LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — the reservation for a slice we have not measured yet. DELIBERATELY ABOVE
// lap-budget's FIRST_LAP_MS default of 90s, and the reason is arithmetic on real numbers rather than taste: Foam OH's
// 2023-07 EXCEEDED 300s as a full month, so a 10-day third of it can plausibly run past 100s. Over-reserving costs
// one extra chained GET; under-reserving costs a 504 that destroys the resume contract — the asymmetry is the whole
// argument. ⚠ THIS IS AN ESTIMATE UNTIL THE FIRST LIVE RUN, which is exactly the mistake banked in
// LORAMER_META_PRODUCT_ID_ROUTE_V1 (a per-unit cost inferred from another family's constant measured 47% low). The
// response returns maxLapMs and lapMs[] on every invocation so it can be corrected from evidence.
const FIRST_SLICE_MS = 120_000

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

// LORAMER_GA_RECOVER_QUOTA_VISIBILITY_V1 — the GA4 Data API's own quota accounting, surfaced instead of guessed.
// [VERIFIED 2026-07-30 against developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/PropertyQuota
// + /data/v1/quotas] Request `returnPropertyQuota: true` and the response carries a `propertyQuota` object whose
// members are QuotaStatus { consumed, remaining }: tokensPerDay · tokensPerHour · concurrentRequests ·
// serverErrorsPerProjectPerHour · potentiallyThresholdedRequestsPerHour · tokensPerProjectPerHour.
// ⛔ `consumed` IS PER-REQUEST, NOT CUMULATIVE — the doc says "quota used by the request". So a percentage CANNOT be
// derived as remaining/(consumed+remaining); it needs a real denominator, which is why the cap below exists.
export type GaQuotaStatus = { consumed?: number; remaining?: number }
export type GaPropertyQuota = Record<string, GaQuotaStatus>

// [VERIFIED 2026-07-30, same source] Core tokensPerDay: STANDARD property 200,000 · Analytics 360 2,000,000.
// Used ONLY as a denominator to turn "below 20% remaining" into a token count. It is deliberately combined with the
// highest remaining actually OBSERVED (see gaQuotaPctRemaining): whichever denominator is LARGER wins, so a 360
// property is not mis-measured against the standard cap, and every error in the estimate pushes the percentage DOWN
// — i.e. toward stopping EARLIER. The safe direction is the only acceptable direction here, because the thing being
// protected is tomorrow morning's forward GA capture on the same property.
export const GA_STANDARD_TOKENS_PER_DAY = 200_000

export function gaQuotaPctRemaining(remaining: number, maxObservedRemaining: number, cap = GA_STANDARD_TOKENS_PER_DAY): number {
  const denom = Math.max(cap, maxObservedRemaining, 1)
  return remaining / denom
}

// A quota refusal is NOT a family GA cannot serve. It must abort the chain, never be swallowed as a skip — which is
// exactly what the per-family catch would otherwise do, turning one wall into twelve fake "skipped" families and a
// completion claim that names the wrong cause.
export class GaQuotaExhaustedError extends Error {
  readonly status: string
  // LORAMER_GA_AUTH_IS_AN_ERROR_V1 (FIX 3) — the family lists AS THEY STOOD AT THE THROW. Without this the lists
  // die with the stack: run 1 (2026-07-30) hit the quota wall on slice 59 with FOUR families unasked and reported
  // `notAttemptedFamilies: []`, because fetchGaDimensionalRows never returns when it throws and the caller had
  // nothing to merge. An empty list next to a stop reason reads as "everything was covered" — the exact false
  // clean bill this repo keeps paying for.
  partial?: GaFamilyPartial
  constructor(message: string, status: string) { super(message); this.name = 'GaQuotaExhaustedError'; this.status = status }
}

// LORAMER_GA_AUTH_IS_AN_ERROR_V1 (FIX 2) — A CREDENTIAL FAILURE IS ITS OWN CATEGORY. It is NOT `skipped` ("GA
// refuses to serve this dimension for this property" — a permanent, per-family fact) and NOT `notAttempted` ("we
// ran out of budget" — pending, recoverable by chaining). It is US failing to authenticate, it applies to EVERY
// family equally, and it must reach the HTTP contract.
// MEASURED 2026-07-30: twelve 401s became twelve `skipped` entries and the route answered HTTP 200 with
// `errors: []`, `skippedFamilies: []` (they were swallowed a layer down) and zero rows — a total outage wearing a
// success code. The driver could not tell it from an honest empty window and looped for 25 minutes.
export class GaAuthError extends Error {
  readonly status: string
  partial?: GaFamilyPartial
  constructor(message: string, status: string) { super(message); this.name = 'GaAuthError'; this.status = status }
}

export type GaFamilyPartial = { skipped: string[]; notAttempted: string[]; errored: string[] }

async function runGaReport(
  propertyId: string, accessToken: string, body: Record<string, unknown>,
  onQuota?: (q: GaPropertyQuota) => void,
): Promise<GaRow[]> {
  const prop = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`
  const res = await fetch(`${GA_DATA_API}/${prop}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = (await res.json()) as { rows?: GaRow[]; propertyQuota?: GaPropertyQuota; error?: { message?: string; status?: string }; message?: string }
  if (json.propertyQuota && onQuota) onQuota(json.propertyQuota)
  if (!res.ok) {
    const msg = json.error?.message || json.message || `GA runReport HTTP ${res.status}`
    const status = json.error?.status || (res.status === 429 ? 'RESOURCE_EXHAUSTED' : (res.status === 401 ? 'UNAUTHENTICATED' : ''))
    // LORAMER_GA_AUTH_IS_AN_ERROR_V1 (FIX 2) — a credential rejection is a TYPED throw, checked FIRST, so the
    // per-family catch below cannot mistake it for "GA can't serve this dimension". Unlike a quota wall, this one
    // IS worth exactly one retry — but only after forcing a NEW token, which is the caller's job (onAuthRetry).
    if (res.status === 401 || status === 'UNAUTHENTICATED') throw new GaAuthError(msg, status || 'UNAUTHENTICATED')
    // Exhausting ANY property quota makes EVERY request to that property fail, so retrying is not a strategy —
    // it is the wall, and the only correct move is to stop and say so.
    if (status === 'RESOURCE_EXHAUSTED' || res.status === 429) throw new GaQuotaExhaustedError(msg, status || 'RESOURCE_EXHAUSTED')
    throw new Error(msg)
  }
  return json.rows || []
}

// Fetch ONE family over [start,end] (with the date dimension for per-day rows), PAGED fully.
// returnPropertyQuota is OPT-IN and defaults OFF, so the forward/catchup/drain request bodies stay BYTE-IDENTICAL —
// only the human-invoked recover path asks for quota metadata. A new field on a scheduled lane's request is a
// behaviour change on a live capture path, and this flight has no business making one.
async function fetchFamily(
  propertyId: string, accessToken: string, fam: Family, startDate: string, endDate: string,
  opts: { returnPropertyQuota?: boolean; onQuota?: (q: GaPropertyQuota) => void } = {},
): Promise<GaRow[]> {
  const dims = [{ name: 'date' }, ...fam.dims.map((n) => ({ name: n }))]
  const metrics = fam.metrics.map((m) => ({ name: m.name }))
  const out: GaRow[] = []
  let offset = 0
  for (;;) {
    const body: Record<string, unknown> = {
      dateRanges: [{ startDate, endDate }], dimensions: dims, metrics, keepEmptyRows: false, limit: PAGE_LIMIT, offset,
    }
    if (opts.returnPropertyQuota) body.returnPropertyQuota = true
    const rows = await runGaReport(propertyId, accessToken, body, opts.onQuota)
    out.push(...rows)
    if (rows.length < PAGE_LIMIT) break
    offset += PAGE_LIMIT
  }
  return out
}

// SHARED builder — used by backfill AND forward/catchup so rows are byte-identical. Fetches ALL families over the
// window and returns metrics_daily breakdown rows. A family GA can't serve is skipped (logged), never fatal.
// LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — TWO OPTIONAL HOOKS, both additive. A caller that passes NEITHER is
// BYTE-IDENTICAL to the pre-change function (same assembled array, same merge, same order), which is what keeps
// forward + catchup + the drain untouched by this flight.
//   onFamilyRows — receives each family's merged rows AS SOON AS that family completes, so a caller can make them
//     DURABLE before the next GA call is issued. When supplied, rows are NOT accumulated into the return value
//     (a 30-month recovery must not hold every row in memory to hand back a value the caller already consumed).
//   shouldStop — consulted BEFORE each family. This is the INSIDE-THE-LOOP budget check: the family loop is where
//     the time goes (12 GA reports, fully paged), so a check only between windows can overrun on the first window.
// ⛔ notAttempted IS NOT skipped, AND THE DISTINCTION IS LOAD-BEARING. `skipped` means GA REFUSED a family (no
// Google Signals, non-ecommerce property) → coverage UNKNOWN, forever. `notAttempted` means WE ran out of budget →
// coverage simply pending, recoverable by chaining. Folding them together would be the LORAMER_DEGRADED_IS_NOT_
// FAILED_V1 defect again: a counter that cannot tell partial from total manufactures alarms and hides real ones.
//   onAuthRetry — LORAMER_GA_TOKEN_LIVENESS_V1 (FIX 1). Called when GA answers 401 UNAUTHENTICATED. It must FORCE a
//     token refresh (bypassing expires_at, which cannot prove liveness) and return the new access token, or null if
//     it could not get one. The family is retried ONCE with it, and every LATER family uses it too. A caller that
//     passes nothing keeps the old behaviour except that a 401 now THROWS instead of being logged as a skip.
export async function fetchGaDimensionalRows(args: {
  clientId: string; userEmail: string; accessToken: string; propertyId: string; propertyName: string; startDate: string; endDate: string
  onFamilyRows?: (bt: string, famRows: Record<string, unknown>[]) => Promise<void>
  shouldStop?: () => boolean
  returnPropertyQuota?: boolean
  onQuota?: (q: GaPropertyQuota) => void
  onAuthRetry?: () => Promise<string | null>
}): Promise<{ rows: Record<string, unknown>[]; perFamily: Record<string, number>; skipped: string[]; notAttempted: string[]; errored: string[] }> {
  const { clientId, userEmail, accessToken, propertyId, propertyName, startDate, endDate, onFamilyRows, shouldStop, returnPropertyQuota, onQuota, onAuthRetry } = args
  const rows: Record<string, unknown>[] = []
  const perFamily: Record<string, number> = {}
  const skipped: string[] = []
  const notAttempted: string[] = []
  const errored: string[] = []
  let stopped = false
  // The token is MUTABLE across the family loop: a mid-walk refresh must not leave the remaining eleven families
  // hammering the credential GA already rejected.
  let token = accessToken
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const fam = FAMILIES[fi]
    // FIX 3 — snapshot the lists onto the error so a THROW carries the same coverage story a RETURN would.
    // Families after this index were never asked: they are notAttempted, not skipped and not errored.
    const attachPartial = <E extends { partial?: GaFamilyPartial }>(e: E): E => {
      e.partial = {
        skipped: [...skipped],
        notAttempted: [...notAttempted, ...FAMILIES.slice(fi + 1).map((f) => f.bt)],
        errored: [...errored],
      }
      return e
    }
    if (stopped || (shouldStop && shouldStop())) { stopped = true; notAttempted.push(fam.bt); continue }
    // Per-family accumulator. mergeConflictKeyDupes keys on (entity_level, entity_id, date, breakdown_type,
    // breakdown_value) and breakdown_type IS IN THAT KEY, so two rows from DIFFERENT families can never collide.
    // Merging per family is therefore EXACTLY equivalent to merging the assembled set — the dedup guarantee that
    // stops the "ON CONFLICT cannot affect row a second time" abort is preserved, not weakened.
    const famRows: Record<string, unknown>[] = []
    try {
      let gaRows: GaRow[]
      try {
        gaRows = await fetchFamily(propertyId, token, fam, startDate, endDate, { returnPropertyQuota, onQuota })
      } catch (authErr: any) {
        // FIX 1 — THE LIVENESS PATH. expires_at said this token was fine; GA says otherwise, and GA is the only
        // authority on that. Force a NEW credential and retry exactly once. One retry, not a loop: if a
        // freshly-minted token is also rejected the problem is not staleness and hammering it proves nothing.
        if (!(authErr instanceof GaAuthError) || !onAuthRetry) throw authErr
        console.warn(`[ga-dim] client=${clientId} family=${fam.bt} 401 UNAUTHENTICATED — forcing a token refresh and retrying ONCE.`)
        const fresh = await onAuthRetry()
        if (!fresh) throw authErr
        token = fresh
        gaRows = await fetchFamily(propertyId, token, fam, startDate, endDate, { returnPropertyQuota, onQuota })
      }
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
        famRows.push({
          client_id: clientId, user_email: userEmail, platform: 'ga', account_id: propertyId,
          entity_level: 'account', entity_id: propertyId, entity_name: propertyName, date,
          breakdown_type: fam.bt, breakdown_value: value || '(not set)',
          conversions, revenue, extra,
        })
        n += 1
      }
      perFamily[fam.bt] = n
      // LORAMER_GA_DIM_DEDUP_V1 — merge duplicate-conflict-key rows BEFORE any upsert (else the atomic batch throws
      // and writes nothing). Per family, which is equivalent — see the note above the loop.
      const merged = mergeConflictKeyDupes(famRows)
      if (onFamilyRows) await onFamilyRows(fam.bt, merged)
      else rows.push(...merged)
    } catch (e: any) {
      // ⛔ A QUOTA WALL IS NOT A SKIP — RETHROW IT. Left to the generic branch below, one RESOURCE_EXHAUSTED would be
      // recorded as "GA cannot serve this family", the loop would keep going and hit the same wall eleven more times,
      // and the caller would be handed twelve fake skips naming entirely the wrong cause. Exhausting a property quota
      // fails EVERY request to that property, so there is nothing to continue to.
      if (e instanceof GaQuotaExhaustedError) throw attachPartial(e)
      // FIX 2 — AN AUTH FAILURE IS NOT A SKIP. Reaching here means the retry above ALSO got 401 (or there was no
      // onAuthRetry to try with). A credential that GA rejects rejects it for all twelve families, so continuing
      // would manufacture eleven more fake skips naming the wrong cause — the same shape as the quota wall, and
      // exactly what happened on 2026-07-30. It is recorded in its OWN list and rethrown so it reaches errors[].
      if (e instanceof GaAuthError) {
        console.error(`[ga-dim] client=${clientId} family=${fam.bt} AUTH FAILED ${startDate}..${endDate} after a forced refresh: ${e.message}`)
        errored.push(fam.bt)
        throw attachPartial(e)
      }
      // GA can't serve this family (e.g. age/gender w/o Google Signals, or an unavailable dim) → SKIP loud, never fabricate.
      // NOTE the ordering: onFamilyRows runs INSIDE this try, so a WRITE failure lands here too and is recorded as a
      // skip rather than silently swallowed — the caller sees the family did not land and cannot claim it.
      console.warn(`[ga-dim] client=${clientId} family=${fam.bt} SKIPPED ${startDate}..${endDate}: ${e?.message ?? e}`)
      skipped.push(fam.bt)
    }
  }
  return { rows, perFamily, skipped, notAttempted, errored }
}

// LORAMER_GA_AUTH_IS_AN_ERROR_V1 — the family count, EXPORTED rather than restated, so the all-families-failed rule
// in recoverGaDimensionalForward cannot drift from the array it is counting.
export const GA_FAMILY_COUNT = FAMILIES.length

// LORAMER_GA_DIM_COMPLETION_HONESTY_V1 — the completion decision, extracted as a PURE function so it can be
// proven without a DB, a token or a live lap. Same move as shouldStartAnotherLap (lap-budget.ts) and
// dedupeBreakdownRows (meta-simple-breakdown-core.ts): the thing that was wrong was one boolean expression buried
// inside a DB-driven walk, and a boolean you cannot drive is a boolean nobody tests.
//
// ⛔ THE RULE: COMPLETION IS A CLAIM ABOUT WHAT WAS WRITTEN, NEVER ABOUT HOW FAR THE WALK GOT. `skippedCount` is
// the clause that was missing. A walk that met an unserved family cannot claim it covered the ground it crossed —
// it does not know what was there. It ends INCOMPLETE, with the skipped families named, which also keeps the
// cursor visible to LORAMER_FROZEN_CURSOR_DETECTOR_V1 (that detector filters backfill_complete=false, so a
// dishonest `true` hides from it BY CONSTRUCTION).
// LORAMER_GA_DIM_ZERO_WORK_RESTART_V1 — the walk WINDOW decision, extracted for the same reason the completion
// decision was: it is the real decision point of the branch that lied, and a branch you cannot drive is a branch
// nobody tests.
//
// ⛔ THE BRANCH THIS REPLACES asserted `complete=true` having walked ZERO months and written ZERO rows:
//     if (windowEnd < targetStart) { upsertCursor(clientId, targetStart, targetStart, true); return … }
// Same law as LORAMER_GA_DIM_COMPLETION_HONESTY_V1 (94a627d) — completion is a claim about what was WRITTEN —
// violated by a DIFFERENT branch, which that commit did not touch. Measured cost: three golden-client cursors
// (Foam OH · Influential Drones 5bb9b2ff · My Vacation Network — resolve via src/lib/clients/canonical.ts) sat at
// the floor claiming a finished walk over years of unwritten data, and the 2026-07-30 recovery probe proved the
// data was there all along (2022-02..2023-06 returns real rows, NO family ever throws), so the walk never asked.
//
// ⛔ WHY RESTARTING IS THE CORRECT ANSWER AND NOT MERELY THE SAFE ONE: this branch is only reachable when
// `backfill_complete` is FALSE — a genuinely finished walk returns earlier, at the `state?.backfill_complete`
// guard. So "cursor at/below the floor AND not complete" is BY CONSTRUCTION an anomalous state: either a walk
// that ended without covering its ground, or a flag a human deliberately cleared to force a re-walk. In both
// cases the honest move is the same — WALK AGAIN from the top. Re-walking ground that already has rows is
// wasteful, not wrong: every write is an idempotent upsert on the 7-col conflict key.
// The alternative (return without touching the cursor) stops the lie but leaves the cursor inert forever, doing
// nothing 4x/day and never recovering the data. That is honest and useless. This restarts.
export function resolveGaDimWindowEnd(earliest: string | null, endDate: string, targetStart: string): string {
  if (!earliest) return endDate                       // never walked: start at yesterday and walk backward
  const prior = addDays(earliest, -1)
  if (prior < targetStart) return endDate             // anomalous (see above): RESTART, never claim completion
  return prior                                        // normal resume: continue below the last covered month
}

export function decideGaDimCompletion(args: {
  reachedStart: boolean          // 6 consecutive CLEAN-empty months — the property's data-start, honestly detected
  earliestWritten: string        // deepest month the walk can HONESTLY claim (see the line-244 rule below)
  targetStart: string            // HARD_FLOOR
  errorCount: number             // a thrown month (write failure or fetch failure) — cursor must not claim done
  timedOut: boolean              // lap budget exhausted mid-walk — resume, do not claim done
  skippedCount: number           // families GA could not serve ANYWHERE in this walk
}): boolean {
  const { reachedStart, earliestWritten, targetStart, errorCount, timedOut, skippedCount } = args
  if (reachedStart) return true
  return earliestWritten <= targetStart && errorCount === 0 && !timedOut && skippedCount === 0
}

// LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — the RECOVER route's completion decision, extracted as a PURE function for
// the third time in this file and for the same reason both times before it: a boolean buried inside an I/O-driven
// walk is a boolean nobody can test, and the two that lied here were exactly that shape.
//
// ⛔ COMPLETION IS A CLAIM ABOUT WHAT LANDED, NEVER ABOUT HOW FAR THE WALK GOT (LORAMER_LANDING_IS_THE_ONLY_SHIPPED_V1
// + the completion-claim invariant). Four ways this must refuse to claim done:
//   timedOut / unwalked slices → the ground was never asked for.
//   errorCount > 0             → a slice threw; what it held is unknown.
//   skippedCount > 0           → GA REFUSED a family somewhere; coverage is UNKNOWN, not empty.
//
// ⚠ ONE EXCEPTION, NARROWED AND NAMED RATHER THAN PRESENTED AS FULL COMPLIANCE WITH THE BRIEF. The brief said fail
// any completion claim "without landed rows". Taken literally, a window GA honestly served nothing for could never
// be marked done, and a human would re-run it forever. So zero rows CAN complete — but ONLY on a fully clean walk
// (every slice attempted, every family ran, nothing thrown), which is the HONEST-EMPTY case and is reported as such
// via rowsCovered:false + emptyMeans. If ANY family was skipped or ANY slice was missed, zero rows is NOT complete.
// This is the same split LORAMER_RANGELAP_COMPLETION_HONESTY_V1 settled — coverage decides `complete`, rows decide a
// separate LOUD signal — minus its infinite-loop hazard, because this route writes no cursor and never self-re-enters.
export function decideGaRecoverCompletion(args: {
  slicesWalked: number
  slicesTotal: number
  errorCount: number
  skippedCount: number
  timedOut: boolean
  rowsWritten: number
}): { complete: boolean; rowsCovered: boolean } {
  const { slicesWalked, slicesTotal, errorCount, skippedCount, timedOut, rowsWritten } = args
  const cleanWalk = slicesWalked >= slicesTotal && slicesTotal > 0 && errorCount === 0 && skippedCount === 0 && !timedOut
  return { complete: cleanWalk, rowsCovered: rowsWritten > 0 }
}

// LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — fixed-length day slices. Pure, so the guard can drive the boundaries.
// A calendar month is NOT a survivable unit on a heavy property (measured: 229s, and one month over 300s), which is
// why the recover walk does not reuse monthChunks.
export function daySlices(start: string, end: string, sliceDays: number): { from: string; to: string }[] {
  const n = Math.max(1, Math.floor(sliceDays))
  const out: { from: string; to: string }[] = []
  let cur = start
  while (cur <= end) {
    const last = addDays(cur, n - 1)
    const to = last < end ? last : end
    out.push({ from: cur, to })
    cur = addDays(to, 1)
  }
  return out
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

  const windowEnd = resolveGaDimWindowEnd(state?.backfill_earliest_date ?? null, endDate, targetStart)
  if (state?.backfill_earliest_date && addDays(state.backfill_earliest_date, -1) < targetStart) {
    console.warn(`[ga-dim] client=${clientId} ANOMALOUS CURSOR: complete=false with backfill_earliest_date=${state.backfill_earliest_date} at/below floor ${targetStart}. RESTARTING the walk from ${endDate} rather than claiming completion for zero work (LORAMER_GA_DIM_ZERO_WORK_RESTART_V1).`)
  }

  // Walk months OLDER, newest-first, time-budgeted.
  // LORAMER_GA_DIM_COMPLETION_HONESTY_V1 — earliestWritten = the deepest month this walk can HONESTLY CLAIM: one
  // that WROTE rows, or one that came back CLEAN EMPTY (every family ran, nothing returned). ⛔ IT IS NO LONGER
  // "deepest month COVERED (empty or not)" — that wording was the defect stated out loud, and it is corrected here
  // rather than left to re-teach itself to the next reader. A month where a family was SKIPPED is an UNKNOWN, not
  // coverage: we do not know what was in it, so it must not move the cursor.
  const months = monthChunks(targetStart, windowEnd).reverse()
  // LORAMER_GA_DIM_ZERO_WORK_RESTART_V1 — derived from windowEnd, NOT read straight off the cursor. The deepest
  // month we can claim starts one day after the window we are about to walk. For a normal resume this is exactly
  // the old value (windowEnd = earliest-1, so +1 = earliest) and for a never-walked cursor it is exactly the old
  // value (endDate+1) — both byte-identical. It MATTERS for the anomalous restart: reading 2015-08-14 off the
  // cursor there would start earliestWritten already AT the floor, so decideGaDimCompletion would see
  // earliestWritten <= targetStart after one lap and re-declare completion. Restarting the window without
  // restarting this counter would have re-sealed the cursor on the very next lap.
  let earliestWritten = addDays(windowEnd, 1)
  let rowsWritten = 0, monthsWalked = 0, timedOut = false, reachedStart = false, consecutiveEmpty = 0
  const perFamilyTotal: Record<string, number> = {}
  const skippedFamilies = new Set<string>()
  const errors: Array<{ month: string; message: string }> = []

  for (const { from, to } of months) {
    if (Date.now() - startedAt > timeBudgetMs) { timedOut = true; break }
    try {
      // FIX 1 — the deep month-walk gets the same liveness path. A 30-month backfill is exactly where a token dies
      // mid-run, and without this it would burn the rest of the walk against a credential GA has already rejected.
      const { rows, perFamily, skipped } = await fetchGaDimensionalRows({
        clientId, userEmail, accessToken: tok.accessToken, propertyId, propertyName, startDate: from, endDate: to,
        onAuthRetry: async () => {
          const re = await getValidGaToken(clientId, userEmail, { forceRefresh: true })
          if (!re.ok) { console.error(`[ga-dim-backfill] client=${clientId} forced token refresh FAILED: ${re.reason}`); return null }
          return re.accessToken
        },
      })
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
      // LORAMER_GA_DIM_COMPLETION_HONESTY_V1 — the guarded advance. Previously unconditional, which is how the
      // cursor walked to 2015-08-14 across 100+ months that produced nothing and still reported complete.
      if ((rows.length > 0 || skipped.length === 0) && from < earliestWritten) earliestWritten = from
      monthsWalked += 1
      if (consecutiveEmpty >= EMPTY_MONTH_STOP) { reachedStart = true; break } // passed the property data-start
    } catch (e: any) {
      console.error(`[ga-dim] client=${clientId} month=${from}..${to} FAILED:`, e?.message ?? e)
      errors.push({ month: from, message: String(e?.message ?? e) })
      break // stop loud; cursor not advanced → resume re-processes this month
    }
  }

  // LORAMER_GA_DIM_COMPLETION_HONESTY_V1 — completion now requires a CLEAN walk. skippedFamilies.size is the
  // clause that was missing; see decideGaDimCompletion for the rule and why it is a pure function.
  const done = decideGaDimCompletion({
    reachedStart, earliestWritten, targetStart, errorCount: errors.length, timedOut, skippedCount: skippedFamilies.size,
  })
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
export async function recoverGaDimensionalForward(
  clientId: string, from: string, to: string, opts: { sliceDays?: number; budgetMs?: number } = {},
): Promise<GaDimBackfillResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return { status: 400, body: { error: 'from/to must be YYYY-MM-DD with from<=to', clientId, from, to } }
  }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? RECOVER_BUDGET_MS
  const sliceDays = opts.sliceDays ?? DEFAULT_SLICE_DAYS

  const { data: gaRow } = await supabaseAdmin.from('ga_tokens').select('user_email, ga_property_id').eq('client_id', clientId).maybeSingle()
  if (!gaRow?.user_email || !gaRow?.ga_property_id) return { status: 400, body: { error: 'Client has no GA connection', clientId } }
  const userEmail = gaRow.user_email as string
  const tok = await getValidGaToken(clientId, userEmail)
  if (!tok.ok) return { status: 400, body: { error: 'GA token unavailable', detail: tok.reason, clientId } }

  // ⛔ THE DEFECT THIS REPLACES, stated so it is not reintroduced: the whole [from..to] window was ONE
  // fetchGaDimensionalRows call followed by ONE upsert. A maxDuration kill anywhere in that fetch wrote NOTHING —
  // ATOMIC-NOTHING, verified live (zero 2023-07 rows after the hang) — and returned no resume point, so the caller
  // could not even tell how far it got. Nothing was corrupted; the work was simply lost, every time, forever.
  const slices = daySlices(from, to, sliceDays)
  const perFamilyTotal: Record<string, number> = {}
  const skippedFamilies = new Set<string>()
  const notAttemptedFamilies = new Set<string>()
  // FIX 2 — THE THIRD CATEGORY, kept deliberately separate from the other two. skipped = GA refused the dimension;
  // notAttempted = we ran out of budget; errored = WE could not authenticate. Merging any pair loses the only
  // information that tells a reader whether to re-run, re-scope, or re-auth.
  const erroredFamilies = new Set<string>()
  const errors: Array<{ slice: string; message: string }> = []
  const lapMs: number[] = []
  let rowsWritten = 0, chunksIssued = 0, slicesWalked = 0, maxLapMs = 0, timedOut = false
  let resumeFrom: string | null = null

  // LORAMER_GA_RECOVER_QUOTA_VISIBILITY_V1 — the HARD STOP. ~1,104 reports against a per-property daily cap is not
  // something to spend blind, and the property being spent is the SAME one tomorrow morning's forward GA capture runs
  // on. So: observe GA's own accounting on every response, and abort the chain — never retry into the wall — when
  // daily tokens fall below the floor or GA says RESOURCE_EXHAUSTED.
  const QUOTA_FLOOR_PCT = 0.20
  let lastQuota: GaPropertyQuota | null = null
  let maxObservedRemaining = 0
  let minObservedRemaining = Number.POSITIVE_INFINITY
  let quotaStop: string | null = null
  const onQuota = (q: GaPropertyQuota) => {
    lastQuota = q
    const rem = q?.tokensPerDay?.remaining
    if (typeof rem !== 'number') return
    if (rem > maxObservedRemaining) maxObservedRemaining = rem
    if (rem < minObservedRemaining) minObservedRemaining = rem
    const pct = gaQuotaPctRemaining(rem, maxObservedRemaining)
    if (pct < QUOTA_FLOOR_PCT && !quotaStop) {
      quotaStop = `tokensPerDay remaining ${rem} is ${(pct * 100).toFixed(1)}% of the denominator ${Math.max(GA_STANDARD_TOKENS_PER_DAY, maxObservedRemaining)} — below the ${QUOTA_FLOOR_PCT * 100}% floor`
      console.error(`[ga-dim-recover] client=${clientId} QUOTA FLOOR HIT — ${quotaStop}. STOPPING the chain; forward GA capture on this property must not be starved.`)
    }
  }

  for (const s of slices) {
    // The quota floor is checked BEFORE starting a slice as well as inside it — a floor breach observed on the last
    // family of the previous slice must not be followed by twelve more reports.
    if (quotaStop) { resumeFrom = s.from; break }
    // BETWEEN slices: reserve headroom for the slice we are about to START, measured from the slices already run
    // (LORAMER_META_ASSET_BUDGET_HEADROOM_V1 — a between-iteration check that reserves nothing is not a budget).
    if (!shouldStartAnotherLap(Date.now() - startedAt, maxLapMs, budgetMs, FIRST_SLICE_MS)) {
      timedOut = true
      resumeFrom = s.from
      break
    }
    const lapStart = Date.now()
    try {
      const { perFamily, skipped, notAttempted } = await fetchGaDimensionalRows({
        clientId, userEmail, accessToken: tok.accessToken, propertyId: tok.gaPropertyId, propertyName: tok.gaPropertyName,
        startDate: s.from, endDate: s.to,
        // FLUSH PER FAMILY — the rows are durable before the next GA report is issued, so a kill leaves landed data
        // plus an accurate resumeFrom instead of nothing. upsertMetricsChunked owns the conflict key + the
        // union-of-keys normalisation, so this write cannot skip either.
        onFamilyRows: async (_bt, famRows) => {
          if (famRows.length === 0) return
          const res = await upsertMetricsChunked(famRows)
          rowsWritten += res.written
          chunksIssued += res.chunks
        },
        // INSIDE the slice: the 12 GA reports are where the time actually goes, so the budget is consulted before
        // each family too — not only between slices. Families left unasked are reported as notAttempted, never skipped.
        // The quota floor rides the SAME hook, so a breach stops the very next family rather than the next slice.
        shouldStop: () => quotaStop !== null || Date.now() - startedAt > budgetMs,
        returnPropertyQuota: true,
        onQuota,
        // FIX 1 — the liveness path, wired. `forceRefresh` bypasses expires_at, which is the whole point: the
        // stored token satisfied expires_at and was dead anyway.
        onAuthRetry: async () => {
          const re = await getValidGaToken(clientId, userEmail, { forceRefresh: true })
          if (!re.ok) {
            console.error(`[ga-dim-recover] client=${clientId} forced token refresh FAILED: ${re.reason} ${re.detail ?? ''}`)
            return null
          }
          return re.accessToken
        },
      })
      for (const [k, v] of Object.entries(perFamily)) perFamilyTotal[k] = (perFamilyTotal[k] || 0) + v
      for (const x of skipped) skippedFamilies.add(x)
      for (const x of notAttempted) notAttemptedFamilies.add(x)
      slicesWalked += 1
      // FIX 2 — A SLICE WHERE EVERY FAMILY FAILED IS NOT A DEGRADED SUCCESS. Twelve skips is not "GA cannot serve
      // twelve dimensions on this property"; it is the slice failing outright, and answering 200 with an empty
      // errors[] over it is the false-success this fix exists to remove. Non-auth causes reach here too (a total
      // write failure, a property-wide refusal) and they are no more of a success than a 401 is.
      if (skipped.length === GA_FAMILY_COUNT) {
        console.error(`[ga-dim-recover] client=${clientId} slice=${s.from}..${s.to} ALL ${GA_FAMILY_COUNT} FAMILIES FAILED — recording an error, not a degraded pass.`)
        errors.push({ slice: s.from, message: `all ${GA_FAMILY_COUNT} families failed on slice ${s.from}..${s.to} — total slice failure, not a partial degradation` })
        resumeFrom = s.from
        slicesWalked -= 1
        break
      }
      if (notAttempted.length > 0) {
        // The in-slice budget-or-quota bit: this slice is PARTIAL, so it must be re-walked in full. Re-walking a
        // partially-landed slice is wasteful, not wrong — every write is an idempotent upsert on the 7-col key.
        if (!quotaStop) timedOut = true
        resumeFrom = s.from
        slicesWalked -= 1
        break
      }
    } catch (e: any) {
      // FIX 3 — drain whatever coverage the throw was carrying. Without this the lists die with the stack and the
      // report claims "notAttemptedFamilies: []" over families that were never asked (run 1, slice 59, four of them).
      const mergePartial = (p?: GaFamilyPartial) => {
        for (const x of p?.skipped ?? []) skippedFamilies.add(x)
        for (const x of p?.notAttempted ?? []) notAttemptedFamilies.add(x)
        for (const x of p?.errored ?? []) erroredFamilies.add(x)
      }
      // FIX 2 — AUTH IS AN ERROR, and it is neither a quota wall nor a skip. It goes into errors[], which makes the
      // status 207 rather than 200, so the HTTP contract finally reflects what happened. A caller that only reads
      // the status code now learns the truth; on 2026-07-30 it learned "success".
      if (e instanceof GaAuthError) {
        mergePartial(e.partial)
        const msg = `GA ${e.status} on slice ${s.from}..${s.to} — credential rejected after a forced refresh: ${e.message}`
        console.error(`[ga-dim-recover] client=${clientId} ${msg}`)
        errors.push({ slice: s.from, message: msg })
        resumeFrom = s.from
        slicesWalked -= 1
        break
      }
      // A quota wall is its OWN outcome, distinct from a failure: nothing is broken, we are simply out of budget for
      // the day. It is recorded as a stop reason rather than an error so the report cannot read as a defect.
      if (e instanceof GaQuotaExhaustedError) {
        mergePartial(e.partial)
        quotaStop = `GA returned ${e.status}: ${e.message}`
        console.error(`[ga-dim-recover] client=${clientId} slice=${s.from}..${s.to} ${e.status} — STOPPING the chain, no retry.`)
        resumeFrom = s.from
        slicesWalked -= 1
        break
      }
      console.error(`[ga-dim-recover] client=${clientId} slice=${s.from}..${s.to} FAILED:`, e?.message ?? e)
      errors.push({ slice: s.from, message: String(e?.message ?? e) })
      resumeFrom = s.from
      break // stop loud; the caller re-invokes from this slice
    }
    const lap = Date.now() - lapStart
    lapMs.push(lap)
    if (lap > maxLapMs) maxLapMs = lap
  }

  const { complete, rowsCovered } = decideGaRecoverCompletion({
    slicesWalked, slicesTotal: slices.length, errorCount: errors.length,
    // A quota stop is a walk that did not finish, so it must block the completion claim exactly as a timeout does.
    // Passing it through `timedOut` keeps ONE rule for "the walk was cut short" rather than a second parallel clause
    // the guard would then have to learn separately.
    skippedCount: skippedFamilies.size, timedOut: timedOut || quotaStop !== null, rowsWritten,
  })
  if (!complete && !resumeFrom) resumeFrom = slices[slicesWalked]?.from ?? null
  if (complete && !rowsCovered) {
    console.warn(`[ga-dim-recover] client=${clientId} ${from}..${to} COMPLETE WITH ZERO ROWS — every slice ran and every family answered, so GA served nothing for this window. Honest empty, not a failure.`)
  }

  return {
    status: errors.length ? 207 : 200,
    body: {
      clientId, from, to, sliceDays,
      complete, rowsCovered, resumeFrom, timedOut,
      slicesTotal: slices.length, slicesWalked, rowsWritten, chunksIssued,
      maxLapMs, lapMs, budgetMs,
      // GA's OWN accounting, verbatim, every invocation — the answer to "what did that cost me" is never inferred.
      quotaStop,
      propertyQuota: lastQuota,
      tokensPerDayRemaining: (lastQuota as GaPropertyQuota | null)?.tokensPerDay?.remaining ?? null,
      tokensPerDayRemainingMin: Number.isFinite(minObservedRemaining) ? minObservedRemaining : null,
      tokensPerDayRemainingMax: maxObservedRemaining || null,
      quotaFloorPct: QUOTA_FLOOR_PCT,
      perFamily: perFamilyTotal,
      skippedFamilies: Array.from(skippedFamilies),
      notAttemptedFamilies: Array.from(notAttemptedFamilies),
      // FIX 2 — reported as its OWN field. A reader must be able to tell "GA won't serve age/gender on this
      // property" (skipped, permanent) from "we ran out of budget" (notAttempted, retry) from "our credential was
      // rejected" (errored, re-auth). Three different next actions; three different lists.
      erroredFamilies: Array.from(erroredFamilies),
      errors,
      emptyMeans: complete && !rowsCovered ? 'GA returned no rows for any family across every slice — the window is genuinely empty for this property' : undefined,
    },
  }
}
