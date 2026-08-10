// LORAMER_GOOGLE_ADS_UNIVERSE_WRITER_V1 — ONE WRITER, NOT 24. FLIGHT 1 OF 2: INVOCABLE ONLY, ON NO SCHEDULE.
//
// ⛔ THE WHOLE POINT: the surface list lives in docs/google-ads-capture-universe.json and NOWHERE ELSE. Adding a
// surface later is a DATA change. There is NO switch statement, NO per-resource branch, NO `if (resource === …)`
// anywhere below, and the guard fails the build if one appears. Twenty-four hand-written google writers is how
// we ended up capturing 14 of 38 surfaces Google was serving — the code could only ever reach what someone had
// already thought to type.
//
// ⛔ COMPLETE MEANS VENDOR-EXHAUSTED, NEVER CLOCK-EXHAUSTED. floor36() is NOT imported here and MUST NOT BE.
// The existing drain seals a cursor when `subStart <= floor36()` — a line 36 months before the day the lap runs
// — and that produced 214 cursors across 18 clients reading backfill_complete=true while Google still served
// years more (LORAMER_GOOGLE_CAPTURE_DENOMINATOR_2026_08_03_V1). On THIS path a family is complete when THE
// VENDOR returns no rows below a date, and the proof is recorded with that date and the response that produced
// it. A clock cannot end a walk here because no clock is consulted.
//
// ⛔ ZERO IS A FACT, NOT A SKIP. Every entry is requested for every client, forever; only the ANSWERS differ.
// A surface that returns nothing is recorded as an OBSERVED ZERO with its request, so "we asked and there was
// nothing" is distinguishable from "nobody asked" — the distinction this entire arc existed to restore.
//
// ⛔ ONE WRITE PATH. Rows go through upsertMetricsChunked, the same function live ingestion uses, conflicting on
// the same 7-column key. A second write path is how backfill rows and forward rows drift apart.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { upsertMetricsChunked, type ChunkedUpsertResult } from '@/lib/metrics-upsert'
import { describeGaqlError } from '@/lib/intelligence/google-intelligence'
// ⛔ THE CANONICAL KEY FORMS LIVE AS DATA IN THE SURFACE MODULE — LORAMER_CANONICAL_KEY_SPELLING_V1.
import { canonicalEntityId, canonicalBreakdownValue } from '@/lib/backfill/universe-surfaces'

export interface UniverseEntry {
  resource: string
  segment: string | null
  /** Present only when metrics.impressions is illegal beside this segment (query_error 53). */
  metricShape?: string | null
  /** LORAMER_UNIVERSE_PROBE_METRIC_SET_V1 — the metrics THIS entry actually serves, measured with the
   *  writer's own five-metric set. `[]` means it serves none of them: a CAPABILITY LIMIT, recorded and
   *  skipped before a request is spent, never silently dropped and never re-attempted every window. */
  servesMetrics?: string[]
  /** The metrics the vendor explicitly refused, from its own message. Partial is neither pole. */
  refusesMetrics?: string[]
  /** The vendor's words, verbatim, for whichever metrics it refused. */
  metricSetReason?: string
  /** Present when the vendor refuses the query without an extra predicate we may not be able to supply. */
  structuralRequirement?: string | null
  delivers?: boolean | null
  capturedToday?: boolean
  dateCombinable?: boolean
}

export interface UniverseDoc {
  marker: string
  entries: UniverseEntry[]
  structuralRequirements?: Array<Record<string, unknown>>
}

/** THE ONLY SOURCE OF SURFACES. Read from the artifact; never from a constant in this file. */
export function loadUniverse(root = process.cwd()): UniverseDoc {
  const doc = JSON.parse(readFileSync(resolve(root, 'docs/google-ads-capture-universe.json'), 'utf8')) as UniverseDoc
  if (doc.marker !== 'LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1') {
    throw new Error(`google-ads-capture-universe.json carries marker "${doc.marker}" — refusing to walk an artifact this writer does not recognise.`)
  }
  return doc
}

// ── DERIVED TIME SEGMENTS — LORAMER_UNIVERSE_DERIVED_TIME_V1, 2026-08-03 ───────────────────────────────────
// ⛔ WE STOP ASKING GOOGLE FOR ARITHMETIC WE CAN DO. Each of these six segments is a PURE FUNCTION of the
// `date` column that is already on every row we write, so requesting them buys nothing and costs a request
// per entry per window plus a full row set on disk.
//
// ⛔ MEASURED, NOT ASSUMED — 2026-08-03, against 1,850,202 landed rows, zero mismatches on all six. The two
// definitions nobody may guess at were settled empirically rather than from documentation:
//   WEEK STARTS MONDAY (ISO). `date − (isodow−1) days` reproduced all 308,367 stored values exactly; a
//     Sunday-start week would have mismatched on 6 of every 7 rows.
//   QUARTER IS CALENDAR, NOT FISCAL. A 2026-03-07 row carries 2026-01-01 and an April row carries
//     2026-04-01 — calendar Q1/Q2 boundaries.
//   day_of_week is Google's NUMERIC DayOfWeek enum, MONDAY=2 … SUNDAY=8, i.e. ISODOW + 1.
// ⚠ THE HONEST LIMIT ON TWO OF THEM: the proving window held exactly ONE distinct `year` and TWO distinct
// `quarter` values, so those two are proven across a narrow range. That is precisely why leg (c) of
// tests/guards/universe-derived-time.guard.mjs re-checks computed-vs-vendor on every row where both exist,
// rather than trusting this comment.
//
// ⛔ SEGMENT-LEVEL RULE, NOT A PER-RESOURCE BRANCH. This is a set of SEGMENT NAMES, exactly the same shape as
// DEFAULT_METRICS. There is no `if (resource === …)` here and the writer's governing law is untouched.
export interface DerivedTimeFamily {
  /** The GAQL segment we no longer request. */
  segment: string
  /** The breakdown_type it produced — UNCHANGED, so nothing downstream has to learn a new name. */
  breakdownType: string
  /** Derivation from the row's own date. `date` is the ISO day string. */
  derive: (date: string) => string
  /** Stated on every computed row so a reader never has to infer the rule. */
  rule: string
}

// ⛔ PURE INTEGER DATE ARITHMETIC — NO `Date` OBJECT ANYWHERE, AND THAT IS A HARD REQUIREMENT ON THIS PATH,
// not a style choice. `google-ads-universe-writer.guard.mjs` fails the build on ANY `new Date` here, because
// a clock is what sealed 214 cursors at `backfill_complete=true` while Google still served years more. The
// guard cannot distinguish "arithmetic on the row's own date string" from "asking what time it is", and the
// correct response to that is to need neither — not to weaken the rule. These are Howard Hinnant's
// days-from-civil / civil-from-days conversions: exact, proleptic-Gregorian, no locale, no timezone, no now().
const daysFromCivil = (y: number, m: number, d: number): number => {
  const yy = y - (m <= 2 ? 1 : 0)
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}
const civilFromDays = (z0: number): string => {
  const z = z0 + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y0 = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const y = y0 + (m <= 2 ? 1 : 0)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const parts = (d: string): [number, number, number] => [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))]
/** ISO day of week, Monday=1 … Sunday=7. Day 0 of the civil epoch (1970-01-01) was a THURSDAY, hence the +3. */
const isoDow = (d: string): number => (((daysFromCivil(...parts(d)) + 3) % 7) + 7) % 7 + 1

// ⛔ `segments.date` IS NOT IN THIS LIST, AND ITS ABSENCE IS THE POINT (Russ approved 2026-08-03).
// It was here for one commit and measured at EXACTLY ZERO saving: its period IS the day, so its
// aggregate is one row per entity per day — which is the base family, byte for byte. 78,300 computed
// groups against 78,300 base rows on the largest resource, and PROVEN lossless on three resources
// covering 219,155 of the 308,488 landed `date` rows: zero rows unreachable via the base family and
// zero metric-value mismatches. So it is neither requested from Google NOR computed locally: the base
// family already answers every question it answered, at the same grain, with the same numbers.
// ⛔ THE FAMILY IS STILL DECLARED AND STILL NAMED IN LORA'S PROSE — pointed at the base rows. Deleting
// a shelf she can select is UNWIRED IS MISSING pointing the other way.
export const DERIVED_TIME_FAMILIES: DerivedTimeFamily[] = [
  { segment: 'segments.week', breakdownType: 'week', rule: 'ISO week start (Monday) = date − (isodow−1) days',
    derive: (d) => civilFromDays(daysFromCivil(...parts(d)) - (isoDow(d) - 1)) },
  { segment: 'segments.month', breakdownType: 'month', rule: 'first day of the calendar month',
    derive: (d) => `${d.slice(0, 7)}-01` },
  { segment: 'segments.quarter', breakdownType: 'quarter', rule: 'first day of the CALENDAR quarter (not fiscal)',
    derive: (d) => `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01` },
  { segment: 'segments.year', breakdownType: 'year', rule: 'calendar year', derive: (d) => d.slice(0, 4) },
  { segment: 'segments.day_of_week', breakdownType: 'day_of_week', rule: "Google DayOfWeek enum ordinal, MONDAY=2 … SUNDAY=8 (isodow + 1)",
    derive: (d) => String(isoDow(d) + 1) },
]
/** Requested from Google: NONE of these. `segments.date` is listed here but NOT in DERIVED_TIME_FAMILIES,
 *  because it is neither requested nor computed — the base family already carries it. */
export const DERIVED_TIME_SEGMENTS = new Set<string>(['segments.date', ...DERIVED_TIME_FAMILIES.map((f) => f.segment)])
/** ⛔ Stamped on every locally computed row. A derived aggregate presented as vendor-reported is a HONESTY
 *  violation, not a storage optimisation — Lora must be able to say which it is looking at. */
export const PROVENANCE_COMPUTED = 'COMPUTED_FROM_DATE'
export const PROVENANCE_VENDOR = 'VENDOR_REPORTED'

/**
 * ⛔⛔ DO NOT USE THIS AS AN ACCOUNT FLOOR. IT IS ONE ACCOUNT'S MEASUREMENT, KEPT ONLY FOR THE v1 CONSUMER.
 * LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1, 2026-08-10.
 *
 * This was Foam OH's measured floor written as a global constant, and it is the fifth constant of that
 * shape this project has found. It is WRONG BY CONSTRUCTION for an account nobody here has ever seen —
 * which is every account a paying customer connects tomorrow, and they are the ones this engine is for.
 *
 * ⛔ THE v2 PATH NO LONGER READS IT. `google-ads.adapter.ts` declares `floorDate: null` (there is no
 * PRE-KNOWN wall for an arbitrary account), and the v2 consumer resolves a DISCOVERED floor per
 * (account, surface) at EXECUTE time via `readAccountWall()` below. `google-account-floor.guard.mjs`
 * fails the build if a global date literal is reintroduced as an account floor on that path.
 *
 * ⚠ IT SURVIVES FOR EXACTLY TWO CALLERS, BOTH OUTSIDE THIS FLIGHT'S CEILING AND BOTH NAMED SO THE RESIDUAL
 * IS NOT INVISIBLE: `src/app/api/queues/google-ads-universe/route.ts` (the v1 consumer) and
 * `src/app/api/cron/universe-resume/route.ts`. Deleting the export requires editing those two files.
 * QUEUE: ★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR.
 */
export const VENDOR_FLOOR_DATE = '2022-03-05'

// ── THE RETENTION WARNING LINE — REPORTING ONLY, AND IT NEVER STOPS A WALK ─────────────────────────────────
/**
 * ⛔ THIS IS A LABEL, NOT A LIMIT. Google publishes a 37-month wall for granular segments effective
 * 2026-06-01 (docs/LORAMER_BACKFILL_FACT_REGISTRY.md holds the URL and the verbatim quote). We measured the
 * vendor serving DAILY, VENDOR_REPORTED rows **53 months back** on 2026-08-04..08 — after that date. Both
 * facts are true and they disagree; the registry records the disagreement rather than resolving it.
 *
 * ⛔ SO THE LINE MAY CHANGE WHAT A REPORT SAYS AND MAY NEVER CHANGE WHAT A WALK DOES. A clock-derived stop
 * is precisely what produced 214 cursors reading `backfill_complete=true` while Google still served years
 * more (see this file's header). The walk stops on a VENDOR REFUSAL and on nothing else.
 *
 * ⚠ AMBIGUITY CARRIED DELIBERATELY, NOT RESOLVED IN CODE: Google never expresses this as a number of DAYS.
 * "37 months" as calendar months and 37 × 30.44 ≈ 1,126 days give different boundary dates. Calendar
 * months is used here because that is the vendor's own unit; the registry records that the vendor has not
 * said which it means. Nothing depends on the answer, because nothing stops here.
 */
export const RETENTION_WARNING_LINE_MONTHS = 37

/**
 * Calendar-month arithmetic on the vendor's own unit. REPORTING ONLY — never a stop, never a clamp.
 *
 * ⛔ PURE, AND IT CONSTRUCTS NO `Date`. `google-ads-universe-writer.guard.mjs` leg (a) forbids this file
 * consulting a clock at all, and it FAILED THIS FUNCTION on its first version, which used
 * `new Date(Date.UTC(...))` only to find a month length. The guard was right: it cannot tell a Date used for
 * arithmetic from a Date used to end a walk, and it should not have to. `today` arrives as an argument.
 */
export function retentionWarningLine(todayIso: string): string {
  const [y, m, d] = todayIso.slice(0, 10).split('-').map(Number)
  const total = y * 12 + (m - 1) - RETENTION_WARNING_LINE_MONTHS
  const ny = Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12
  // Clamp the day into the target month rather than rolling over (2026-03-31 − 37mo must not land in March).
  const leap = (ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0
  const lastDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nm]
  const nd = Math.min(d, lastDay)
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

// ── THE DISCOVERED FLOOR — PER (ACCOUNT, SURFACE), FROM THE VENDOR'S REFUSAL, NEVER FROM A CLOCK ───────────
/**
 * ⛔ ABSENCE OF A ROW MEANS **UNKNOWN**, AND `null` IS RETURNED FOR IT. Not '1970-01-01', not
 * VENDOR_FLOOR_DATE, not "no history". A caller that cannot tell UNKNOWN from a measured wall will
 * eventually treat one as the other, which is the entire failure this replaces.
 *
 * ⛔ AN UNREADABLE STORE IS ALSO UNKNOWN, AND IT THROWS RATHER THAN ANSWERING. Returning null on a failed
 * read would say "no wall known" — which is the SAFE direction for walking but a LIE about what we know,
 * and it is the same synthesise-an-answer-from-a-failed-read defect universe-coverage.ts:130-134 forbids.
 */
export async function readAccountWall(k: {
  clientId: string; vendor: string; resource: string; segment: string
}): Promise<{ wallDate: string; source: string; citation: string } | null> {
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data, error } = await supabaseAdmin
    .from('universe_account_floor')
    .select('wall_date, source, citation')
    .eq('client_id', k.clientId).eq('vendor', k.vendor)
    .eq('resource', k.resource).eq('segment', k.segment)
    .limit(1)
  if (error) throw new Error(
    `[universe-floor] wall read failed for ${k.resource}/${k.segment || '(base)'}: ${error.message}. ` +
    `⛔ A FLOOR MUST NOT BE SYNTHESISED FROM A FAILED READ — an unreadable store is UNKNOWN, and UNKNOWN stops the walk.`)
  const row = data?.[0]
  if (!row) return null
  return { wallDate: String(row.wall_date), source: String(row.source), citation: String(row.citation) }
}

/**
 * ⛔ THE ONLY WRITER OF A FLOOR IN THIS SYSTEM, AND ITS ONLY INPUT IS A VENDOR REFUSAL. It is never called
 * with a computed date, and `source` is CHECK-constrained to 'vendor-refusal' in the migration so a future
 * caller cannot quietly widen it.
 *
 * ⛔ THE HIGHEST WALL WINS. If a wall is already recorded, a NEWER refusal at an OLDER date does not lower
 * it — the vendor refusing at 2020 does not un-refuse 2022. `greatest()` keeps the shallowest observed
 * refusal, which is the conservative direction: it claims LESS history is unreachable, so the walk keeps
 * asking for ground we might still get rather than sealing it.
 */
export async function recordAccountWall(k: {
  clientId: string; vendor: string; resource: string; segment: string
  wallDate: string; citation: string
}): Promise<void> {
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { error } = await supabaseAdmin.rpc('universe_record_account_wall', {
    p_client_id: k.clientId, p_vendor: k.vendor, p_resource: k.resource,
    p_segment: k.segment, p_wall_date: k.wallDate, p_citation: k.citation,
  })
  if (error) throw new Error(`[universe-floor] wall write failed for ${k.resource}/${k.segment || '(base)'}: ${error.message}`)
}

// ── THE INCEPTION STOP — PER ACCOUNT, FROM THE VENDOR'S OWN EARLIEST CAMPAIGN ──────────────────────────────
/**
 * ⛔ ONE OP PER ACCOUNT, AND THE QUERY IS A CONSTANT SO A GUARD CAN PIN ITS SHAPE. NO STATUS FILTER — the
 * API includes REMOVED campaigns by default (cookbook, verbatim: "The Google Ads UI implicitly filters out
 * removed entities, whereas the API does not"), and a well-meaning `!= REMOVED` added later would silently
 * OVERSTATE the floor on exactly the old accounts that matter. `inception-stop.guard.mjs` leg (a) fails the
 * build if a status predicate appears here.
 * ⚠ `campaign.start_date` does NOT exist in API v23 — probe op 5 was refused with query_error 32. This is
 * the successor field, proven by probe op 6. The registry owns both measurements.
 */
export const INCEPTION_DISCOVERY_GAQL =
  'SELECT campaign.start_date_time FROM campaign ORDER BY campaign.start_date_time ASC LIMIT 1'

/** Absence of a row is **UNKNOWN**, returned as null — never a default. An unreadable store THROWS. */
export async function readAccountInception(k: { clientId: string; vendor: string }):
  Promise<{ inceptionDate: string; rawStartDateTime: string; source: string } | null> {
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data, error } = await supabaseAdmin
    .from('universe_account_inception')
    .select('inception_date, raw_start_date_time, source')
    .eq('client_id', k.clientId).eq('vendor', k.vendor)
    .limit(1)
  if (error) throw new Error(
    `[universe-inception] read failed for ${k.clientId}: ${error.message}. ` +
    `⛔ AN INCEPTION MUST NOT BE SYNTHESISED FROM A FAILED READ — unreadable is UNKNOWN, and UNKNOWN refuses an unbounded walk.`)
  const row = data?.[0]
  if (!row) return null
  return { inceptionDate: String(row.inception_date), rawStartDateTime: String(row.raw_start_date_time), source: String(row.source) }
}

/** The derived date is .slice(0,10) of the vendor's ACCOUNT-TIMEZONE datetime — same frame as segments.date
 *  days, so the comparison is internally consistent (registry row, probe op 6, owns the caveat). */
export async function recordAccountInception(k: { clientId: string; vendor: string; rawStartDateTime: string }): Promise<void> {
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { error } = await supabaseAdmin.rpc('universe_record_account_inception', {
    p_client_id: k.clientId, p_vendor: k.vendor,
    p_inception_date: k.rawStartDateTime.slice(0, 10), p_raw: k.rawStartDateTime,
  })
  if (error) throw new Error(`[universe-inception] write failed for ${k.clientId}: ${error.message}`)
}

/** min(date) this account already holds in metrics_daily — an index-head read on
 *  idx_mdp_client_platform_date, one row. null = the account holds nothing yet. */
export async function readEarliestHeldDate(clientId: string, platform: string): Promise<string | null> {
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data, error } = await supabaseAdmin
    .from('metrics_daily')
    .select('date')
    .eq('client_id', clientId).eq('platform', platform)
    .order('date', { ascending: true })
    .limit(1)
  if (error) throw new Error(`[universe-inception] earliest-held read failed for ${clientId}: ${error.message}`)
  return data?.[0]?.date ? String(data[0].date) : null
}

/**
 * ⛔⛔ THE ONE COMPOSITION SITE'S ONE FUNCTION — LORAMER_INCEPTION_STOP_V1. Pure, so a guard can drive it.
 * `inception-stop.guard.mjs` leg (c) fails the build if more than one call site exists: two reads composed
 * in two places is the two-owners shape that put a floor on a queue message.
 *
 * THE ALGEBRA, each line an adversarially-settled decision:
 *   inceptionStop = min(inceptionDate, earliestHeldDate)   — the held-data min is the SAFEGUARD, a
 *     measurement not a margin: data we already hold is proof the vendor served below the claimed
 *     inception, so the stop can never orphan ground we can see.
 *   stopDate = max(wallDate, inceptionStop)                — the vendor's own refusal outranks our
 *     inference; both survive with their own stores and provenance.
 *   inceptionKnown = false                                 — UNKNOWN. It does not fall through to ANY
 *     date (leg (d) drives this): the caller must refuse an unbounded walk and report. Walk-to-epoch is
 *     an EXPLICIT operator choice on the message, never a fallback.
 */
export function composeWalkStop(args: {
  wallDate: string | null
  inceptionDate: string | null
  earliestHeldDate: string | null
}): { stopDate: string | null; inceptionKnown: boolean; basis: string } {
  const { wallDate, inceptionDate, earliestHeldDate } = args
  const inceptionStop = inceptionDate === null
    ? null
    : (earliestHeldDate !== null && earliestHeldDate < inceptionDate ? earliestHeldDate : inceptionDate)
  const stopDate = wallDate === null ? inceptionStop
    : inceptionStop === null ? wallDate
    : (wallDate > inceptionStop ? wallDate : inceptionStop)
  const basis = stopDate === null ? 'UNKNOWN — no wall observed, no inception discovered'
    : stopDate === wallDate && (inceptionStop === null || wallDate! > inceptionStop)
      ? `vendor refusal wall ${wallDate}`
      : earliestHeldDate !== null && stopDate === earliestHeldDate && inceptionDate !== null && earliestHeldDate < inceptionDate
        ? `held-data floor ${earliestHeldDate} (below the claimed inception ${inceptionDate} — held rows outrank the claim)`
        : `account inception ${inceptionDate}`
  return { stopDate, inceptionKnown: inceptionDate !== null, basis }
}

// ── DEFERRED UNDER A DISK CONSTRAINT — LORAMER_UNIVERSE_NARROWED_SET_V1, 2026-08-04 ────────────────────────
// ⛔ THESE ARE DEFERRED, NOT DROPPED, AND ALL-MEANS-ALL IS NOT REPEALED. This is SEQUENCING UNDER A DISK
// CONSTRAINT and nothing else: 12 of 358 entries carry 41.9% of the walk's disk (68.2 GB of 162.9 GB),
// measured from the landed Foam OH window 2026-03-07..04-05 (LORAMER_UNIVERSE_YIELD_RANK_V1). The moment the
// volume grows these are the FIRST thing walked, and this table is what makes that a one-line change rather
// than a re-argument.
//
// ⛔ EVERY ONE CARRIES ITS REASON AND ITS MEASURED YIELD, so a deferral can never read as an absence. A slot
// that is simply missing is indistinguishable from a slot nobody thought of — the exact confusion this whole
// arc exists to end.
//
// ⛔ THE SELECTION RULE THAT BOUND THIS LIST WAS *REACHABILITY*, NOT COST. Every deferred segment still lands
// at another entity_level, so NO DECLARED FAMILY BECOMES UNREACHABLE. That constraint is why
// `expanded_landing_page_view/landing_page_source` and the resource-only base entries were KEPT even though
// they are not cheap: they are the only remaining home for their families. UNWIRED IS MISSING cuts both ways.
export interface DeferralNote {
  reason: string
  /** Measured rows for ONE 30-day window on the probe account. One entry × one window = one request. */
  measuredRowsPerRequest: number
  /** What the entry would cost across the 50-window walk, at the measured 832 B/row. */
  measuredGBPerWalk: number
  /** ⛔ Named, not glossed: what Lora can no longer answer while this is deferred. */
  loraLoses: string
}
const GEO_LOSS = 'presence-vs-target geography — "where the user actually WAS" as distinct from "where we TARGETED" — at this grain. The targeting answer survives in full via geographic_view; the presence answer survives only at region/state/metro.'
const LP_LOSS = 'landing-page performance SPLIT BY this segment. Landing-page totals and landing_page_source survive.'
const PLACEMENT_LOSS = 'placement performance split by this segment. Placement totals survive.'
export const DEFERRED_ENTRIES: Record<string, DeferralNote> = {
  'user_location_view|segments.geo_target_most_specific_location': { reason: 'geographic_view serves the SAME declared family at 19.9% fill vs 0.3% here — 66× denser for the same row count', measuredRowsPerRequest: 427_020, measuredGBPerWalk: 16.54, loraLoses: GEO_LOSS },
  'user_location_view|segments.geo_target_postal_code':            { reason: 'geographic_view serves the same family at 24.7% fill vs 1.3% here', measuredRowsPerRequest: 327_676, measuredGBPerWalk: 12.70, loraLoses: GEO_LOSS },
  'user_location_view|segments.geo_target_city':                   { reason: 'geographic_view serves the same family at 24.1% fill vs 0.5% here', measuredRowsPerRequest: 234_007, measuredGBPerWalk: 9.07,  loraLoses: GEO_LOSS },
  'user_location_view|segments.geo_target_county':                 { reason: 'geographic_view serves the same family at 39.5% fill vs 4.2% here', measuredRowsPerRequest: 69_968,  measuredGBPerWalk: 2.71,  loraLoses: GEO_LOSS },
  'expanded_landing_page_view|segments.click_type':          { reason: 'landing-page × click_type cross-product at 0.7% fill; click_type stays reachable at many other grains', measuredRowsPerRequest: 118_948, measuredGBPerWalk: 4.61, loraLoses: LP_LOSS },
  'expanded_landing_page_view|segments.device':              { reason: 'landing-page × device cross-product at 1.0% fill; device stays reachable at many other grains',        measuredRowsPerRequest: 85_871,  measuredGBPerWalk: 3.33, loraLoses: LP_LOSS },
  'expanded_landing_page_view|segments.slot':                { reason: 'landing-page × slot cross-product at 1.0% fill; slot stays reachable at other grains',                 measuredRowsPerRequest: 80_140,  measuredGBPerWalk: 3.10, loraLoses: LP_LOSS },
  'expanded_landing_page_view|segments.ad_sub_network_type': { reason: 'landing-page × ad_sub_network_type at 1.2% fill; the segment stays reachable at other grains',          measuredRowsPerRequest: 79_120,  measuredGBPerWalk: 3.07, loraLoses: LP_LOSS },
  'expanded_landing_page_view|segments.ad_network_type':     { reason: 'landing-page × ad_network_type at 0.8% fill; the segment stays reachable at other grains',              measuredRowsPerRequest: 78_300,  measuredGBPerWalk: 3.03, loraLoses: LP_LOSS },
  'detail_placement_view|segments.device':    { reason: 'placement × device cross-product at 2.6% fill; device stays reachable at many other grains',     measuredRowsPerRequest: 92_509, measuredGBPerWalk: 3.58, loraLoses: PLACEMENT_LOSS },
  'group_placement_view|segments.device':     { reason: 'placement × device cross-product at 3.1% fill; device stays reachable at many other grains',     measuredRowsPerRequest: 92_222, measuredGBPerWalk: 3.57, loraLoses: PLACEMENT_LOSS },
  'group_placement_view|segments.click_type': { reason: 'placement × click_type cross-product at 1.8% fill; click_type stays reachable at other grains',  measuredRowsPerRequest: 75_440, measuredGBPerWalk: 2.92, loraLoses: PLACEMENT_LOSS },
}
export const deferralKey = (e: UniverseEntry): string => `${e.resource}|${e.segment ?? ''}`
export function deferralFor(e: UniverseEntry): DeferralNote | null {
  return DEFERRED_ENTRIES[deferralKey(e)] ?? null
}

/**
 * Entries this writer will REQUEST: proven to deliver, date-combinable, not a derived time segment, and not
 * DEFERRED under the disk constraint.
 * ⛔ Neither the derived-time entries nor the deferred ones are dropped from the artifact or from the
 * registry — they are dropped from the REQUEST list only. `selectableEntries` answers "what do we ask Google
 * for"; it is deliberately not the same question as "what do we store", and now also not the same question as
 * "what exists". Use `deferredEntries()` to report the difference; never let it read as an absence.
 */
export function selectableEntries(doc: UniverseDoc): UniverseEntry[] {
  return doc.entries.filter((e) => e.delivers === true && (e.segment === null || e.dateCombinable === true)
    && !(e.segment !== null && e.segment !== undefined && DERIVED_TIME_SEGMENTS.has(e.segment))
    && !deferralFor(e))
}

/**
 * ⛔ THE VENDOR'S OWN DENOMINATOR — every entry the catalog says DELIVERS and can be asked per-date.
 * LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1: completeness is measured against the vendor's list, never
 * ours. `selectableEntries` above is the NUMERATOR — what we actually publish — and the difference between
 * the two is DEBT, which must stay visible rather than being quietly redefined away.
 * MEASURED 2026-08-08 on docs/google-ads-capture-universe.json: this returns 559, selectableEntries 346.
 */
export function catalogEligibleEntries(doc: UniverseDoc): UniverseEntry[] {
  return doc.entries.filter((e) => e.delivers === true && (e.segment === null || e.dateCombinable === true))
}

/**
 * ⛔ WHAT THE WALK DOES NOT ASK FOR, AND WHY — one row per excluded entry, never a bare count.
 * "213 excluded" is a number nobody can act on; "these 213, for these two reasons" is a work list. This is
 * what makes a completion notice honest: it states the vendor's total, ours, and the gap ITEMISED.
 */
export function excludedFromWalk(doc: UniverseDoc): Array<{ resource: string; segment: string | null; reason: 'derived_time_segment' | 'deferred_under_disk_constraint' }> {
  const out: Array<{ resource: string; segment: string | null; reason: 'derived_time_segment' | 'deferred_under_disk_constraint' }> = []
  for (const e of catalogEligibleEntries(doc)) {
    if (e.segment !== null && e.segment !== undefined && DERIVED_TIME_SEGMENTS.has(e.segment)) {
      // Computed locally from segments.date rather than requested — PROVENANCE_COMPUTED, not a capture gap.
      out.push({ resource: e.resource, segment: e.segment ?? null, reason: 'derived_time_segment' })
    } else if (deferralFor(e)) {
      // LORAMER_UNIVERSE_NARROWED_SET_V1 — sequencing under a disk constraint. DEFERRED, NOT DROPPED.
      out.push({ resource: e.resource, segment: e.segment ?? null, reason: 'deferred_under_disk_constraint' })
    }
  }
  return out
}

/** ⛔ THE DEFERRED SET, WITH REASONS — so "what are we not asking for, and why" is always answerable. */
export function deferredEntries(doc: UniverseDoc): Array<{ entry: UniverseEntry; note: DeferralNote }> {
  return doc.entries
    .filter((e) => e.delivers === true && (e.segment === null || e.dateCombinable === true)
      && !(e.segment !== null && e.segment !== undefined && DERIVED_TIME_SEGMENTS.has(e.segment)))
    .flatMap((e) => { const note = deferralFor(e); return note ? [{ entry: e, note }] : [] })
}

/** Every entry the artifact declares selectable, INCLUDING the derived-time ones. The registry declares from
 *  this, because those families still land in metrics_daily — computed rather than captured. */
export function declarableEntries(doc: UniverseDoc): UniverseEntry[] {
  return doc.entries.filter((e) => e.delivers === true && (e.segment === null || e.dateCombinable === true))
}

// ── NAMING, AND THE RULE IS DETERMINISTIC SO TWO WRITERS CANNOT DISAGREE ────────────────────────────────────
// breakdown_type = the segment's short name when there is a segment, else the resource name.
//   segments.income_range_type   → 'income_range_type'
//   resource-only (no segment)   → 'shopping_performance_view'
// A COMPOSITE PAIR (two segments at once) joins the two short names with '_x_' and joins the two VALUES with
// '|', which is the banked LORAMER_SEGMENT_PAIR_COMPOSITE_ENCODING_V1 shape and matches the two precedents
// already in the data: geo_city's ':LOCATION_OF_PRESENCE' suffix and meta_age_gender's paired family name.
// ⛔ A COMPOSITE TYPE MUST BE DECLARED IN src/lib/breakdown-registry.ts BEFORE IT IS WRITTEN, or Lora renders
// 'SEARCH|MOBILE' raw at a user. That declaration is a Flight-2 requirement and is asserted by the guard there,
// not here — this flight writes no composites.
export function breakdownTypeFor(entry: UniverseEntry): string {
  if (!entry.segment) return entry.resource
  return entry.segment.replace(/^segments\./, '').replace(/\./g, '_')
}

export function compositeBreakdownType(a: UniverseEntry, b: UniverseEntry): string {
  return `${breakdownTypeFor(a)}_x_${breakdownTypeFor(b)}`
}
export function compositeBreakdownValue(a: string, b: string): string {
  return `${a}|${b}`
}

// ── GAQL, BUILT FROM THE ENTRY ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_METRICS = [
  'metrics.cost_micros', 'metrics.impressions', 'metrics.clicks', 'metrics.conversions', 'metrics.conversions_value',
]

/**
 * ⛔ THE ONLY PLACE A QUERY IS CONSTRUCTED, AND IT READS THE ENTRY — NOT THE RESOURCE NAME.
 * `metricShape` is honoured when present: some segments reject metrics.impressions outright
 * (query_error 53 "Cannot select the following segments because at least one unsupported metric is found"),
 * and the artifact records the metric that IS legal for each. Guessing three shapes at runtime would spend
 * three requests where the artifact already knows the answer.
 */
export function buildGaql(entry: UniverseEntry, startDate: string, endDate: string, filters: string[] = []): string {
  const select = ['segments.date']
  // ⛔ A RESOURCE-ONLY ENTRY CARRIES ITS DIMENSION ON THE RESOURCE, NOT IN A SEGMENT — and Gate-A caught me
  // assuming otherwise. The artifact's segment rows for a `*_view` are the segments SELECTABLE WITH it
  // (device, click_type, ad_network_type…), NOT the view's own grain: `income_range_view` has NO
  // `segments.income_range_type`, and asking for one returns
  //   {"query_error":32} "Unrecognized field in the query: 'segments.income_range_type'."
  // The bracket lives on the VIEW ITSELF. `resource_name` is present on EVERY resource in the catalog, so
  // selecting `<resource>.resource_name` is a generic rule — it needs no knowledge of which resource this is,
  // which is the property that keeps this writer surface-agnostic.
  select.push(entry.segment ? entry.segment : `${entry.resource}.resource_name`)
  // ⛔ ASK FOR WHAT THE ENTRY ACTUALLY SERVES — READ FROM THE ARTIFACT, NOT FROM A BRANCH.
  // `servesMetrics` is measured by the probe using THIS EXACT list, so the probe and the walk finally ask the
  // same question. Before this, the probe tested ONE metric and the writer requested FIVE, and 55 of 559
  // entries (9.8%) came back delivers:true and then errored on every single window. It is data on the entry,
  // exactly like metricShape — there is still no `if (resource === …)` anywhere in this file.
  const metrics = entry.servesMetrics && entry.servesMetrics.length
    ? entry.servesMetrics
    : entry.metricShape ? [entry.metricShape] : DEFAULT_METRICS
  select.push(...metrics)
  const where = [`segments.date BETWEEN '${startDate}' AND '${endDate}'`, ...filters]
  return `SELECT ${select.join(', ')} FROM ${entry.resource} WHERE ${where.join(' AND ')}`
}

// ── STRUCTURAL REQUIREMENTS: SKIP AND RECORD, NEVER SILENTLY PASS ───────────────────────────────────────────
export type SkipReason = { entry: string; requirement: string; recorded: true }

/**
 * An entry whose structuralRequirement we cannot satisfy from the supplied filters is SKIPPED AND RECORDED.
 * ⛔ Returning null (a silent pass) is the failure mode this exists to prevent: a surface nobody asked for and
 * nobody logged is indistinguishable from a surface that returned nothing, which is exactly how 24 surfaces
 * went unnoticed for six weeks.
 */
export function resolveStructural(entry: UniverseEntry, supplied: Record<string, string | undefined>): { ok: true; filters: string[] } | { ok: false; skip: SkipReason } {
  const req = entry.structuralRequirement
  if (!req) return { ok: true, filters: [] }
  const filters: string[] = []
  const need: string[] = []
  for (const m of req.matchAll(/([a-z_]+\.[a-z_]+)\s*=/g)) {
    const field = m[1]
    const val = supplied[field]
    if (val === undefined) need.push(field)
    else filters.push(`${field} = ${/^\d+$/.test(val) ? val : `'${val}'`}`)
  }
  if (need.length) {
    return { ok: false, skip: { entry: `${entry.resource}${entry.segment ? ' / ' + entry.segment : ''}`, requirement: `unsatisfied: ${need.join(', ')} (declared: ${req})`, recorded: true } }
  }
  return { ok: true, filters }
}

// ── COMPLETION: THE VENDOR SAYS SO, OR NOBODY DOES ─────────────────────────────────────────────────────────
export interface VendorExhaustion {
  complete: boolean
  /** The date below which the vendor returned nothing. Null while the walk is still producing rows. */
  exhaustedBelow: string | null
  /** The literal evidence — row count and the request that produced it. A boolean with no proof is a claim. */
  proof: string
}

/**
 * ⛔ NO CLOCK. The ONLY input that can end a walk is `rowsReturned === 0` from a real request.
 * There is deliberately no `Date`, no floor, no month arithmetic in this function — the guard asserts that,
 * and reverting to a clock-based rule is what leg (a) proves RED.
 */
// ── LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1, 2026-08-05 ─────────────────────────────────────────────────────
// ⛔ WHAT THIS REPLACES, AND IT COST TWO RELEASES. The old rule was `rowsReturned === 0 → complete`, i.e. ONE
// EMPTY WINDOW MEANT "THE VENDOR HAS NO HISTORY BELOW THIS DATE". Those are not the same fact, and on
// 2026-08-05 the difference sealed 344 of 346 entries with FOUR YEARS of real data beneath them: Foam OH's
// account went dormant in early April 2026, the walk's first window (2026-07-05..08-03) sat inside that dead
// period, Google correctly returned zero rows, and the walk concluded it had reached the bottom of history.
// Worse, `isClientComplete` settles on `vendor_exhausted_below`, so the walk then read as FINISHED rather
// than stalled — a false seal walks straight through every "no silent success" check we have.
//
// ⛔ ABSENCE, DORMANCY AND EXHAUSTION ARE THREE DIFFERENT FACTS:
//   ABSENCE    — we never asked.
//   DORMANCY   — we asked, the account simply had no activity in that window. THE VENDOR RETURNS ZERO ROWS.
//   EXHAUSTION — we asked and the vendor has nothing left to give at any earlier date.
// A zero-row response is the vendor stating DORMANCY. It is not, and cannot be, a statement about earlier
// dates: the query asked about ONE window and the answer describes ONE window.
//
// ⛔ WEB-FIRST, AND THE HONEST RESULT (2026-08-05). Google's data-retention policy
// (support.google.com/google-ads/answer/15188209) confirms the BOUNDARY exists — "hourly, daily and weekly
// reporting data … will be available for 37 months", "After that period, the data will not be accessible via
// the Google Ads interface or APIs", monthly/quarterly/annual for 11 years — but it does NOT document any
// signal that separates "no data in this window" from "past retention". A search summary asserted that
// granular segments past retention return a DateRangeError; ⚠ I COULD NOT CONFIRM THAT FROM A PRIMARY PAGE
// AND THEREFORE DO NOT BUILD ON IT (LORAMER_ESSENCE_LAW_9 — an asserted mechanism is not an established one).
// If it is ever confirmed, a DateRangeError becomes a second, vendor-sourced exhaustion signal and belongs
// here. Until then the ONLY trustworthy stop is the floor we measured ourselves.
//
// ⇒ THE RULE, AND WHY IT IS RIGHT RATHER THAN MERELY SUFFICIENT FOR THIS CASE:
//   · rows > 0                        → not complete. Trivially.
//   · rows == 0 AND at/below the FLOOR → COMPLETE. The floor is a MEASURED property of this account
//     (2022-03-05), established by probing rather than assumed, so an empty window there is corroborated by
//     independent evidence and is a real conclusion.
//   · rows == 0 ABOVE the floor        → NOT COMPLETE. One empty window, nothing more.
// ⛔ NO CONSECUTIVE-EMPTY-WINDOW THRESHOLD. It was considered and REJECTED: any N would be a number chosen to
// make this account work. Foam OH has a 20-month dormant stretch (2023-04 missing, and 2026-05 onward), so a
// threshold small enough to be useful would seal it falsely again, and one large enough to be safe would
// never fire before the floor did — making it decoration. The floor already terminates the walk; a heuristic
// on top of it buys nothing and can only be wrong.
export function decideVendorExhaustion(args: {
  windowStart: string
  rowsReturned: number
  gaql: string
  /** The MEASURED vendor floor for this account. Exhaustion may only be concluded at or below it. */
  floorDate: string
}): VendorExhaustion {
  const { windowStart, rowsReturned, gaql, floorDate } = args
  if (rowsReturned > 0) {
    return { complete: false, exhaustedBelow: null, proof: `vendor returned ${rowsReturned} row(s) at/below ${windowStart} — the walk continues` }
  }
  if (windowStart > floorDate) {
    return {
      complete: false,
      exhaustedBelow: null,
      proof: `vendor returned 0 rows for [${windowStart}], which is ABOVE the measured floor ${floorDate} — that is ONE EMPTY WINDOW (dormancy), NOT exhaustion. The walk continues.`,
    }
  }
  return {
    complete: true,
    exhaustedBelow: windowStart,
    proof: `vendor returned 0 rows for [${windowStart}] at/below the MEASURED floor ${floorDate} — corroborated by the probe that established the floor. via: ${gaql}`,
  }
}

// ── ROW BUILDER ────────────────────────────────────────────────────────────────────────────────────────────
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v || 0))
const ratio = (a: number, b: number, mult = 1) => (b > 0 ? Number(((a / b) * mult).toFixed(4)) : 0)

// ── LORAMER_REFUSED_RATIO_IS_NULL_V1, 2026-08-04 ───────────────────────────────────────────────────────────
// ⛔ A RATIO BUILT ON A REFUSED METRIC MUST BE NULL, NEVER 0. NULL AND 0 ARE DIFFERENT FACTS: a 0 ROAS is a
// CLAIM about performance; a null is an ABSENCE of information. Writing 0 here was the defect measured on
// 2026-08-04 — 119,375 of 119,375 stamped rows carried roas/cpa/cpc/ctr/cpm computed on a denominator the
// vendor had REFUSED, sitting directly beneath a `refusedMeaning` that says never to do exactly that. The row
// carried its own contradiction.
//
// ⛔ WHY IT HAPPENED, so the shape is not repeated: the ratios were computed at the top of the `extra` literal
// and the refusal stamp was spread in at the bottom. The ratio was produced BEFORE the refusal was consulted.
// Order of evaluation was the whole bug — nothing was wrong with either half on its own.
//
// ⛔ NULL IS EXPRESSIBLE HERE AND THAT IS NOT TRUE OF THE METRIC COLUMNS. `extra` is jsonb and NULLABLE, so
// `"roas": null` needs no migration. `spend`/`clicks`/`impressions`/`conversions`/`conversion_value`/`revenue`
// are NOT NULL DEFAULT 0 and STILL cannot hold a refusal — that limit is unchanged and is why the stamp on the
// row remains the only thing standing between a refused metric and a reader who trusts the column.
//
// EITHER SIDE POISONS THE RATIO. CPC = spend/clicks is meaningless if EITHER is refused, not just the divisor.
const refusedMetricNames = (entry: UniverseEntry): Set<string> =>
  new Set((entry.refusesMetrics || []).map((m) => REFUSAL_KEYS[m] || m))

/** null when either input metric is refused; otherwise the ordinary ratio (0 when the divisor is a true 0). */
function safeRatio(
  refused: Set<string>, numeratorMetric: string, denominatorMetric: string,
  a: number, b: number, mult = 1
): number | null {
  if (refused.has(numeratorMetric) || refused.has(denominatorMetric)) return null
  return ratio(a, b, mult)
}

/** The six derived ratios, each declaring which METRICS it is built from. One place, so a new ratio cannot
 *  be added without declaring its inputs and inheriting the refusal rule. */
export function derivedRatios(entry: UniverseEntry, m: {
  spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number
}): Record<string, number | null> {
  const r = refusedMetricNames(entry)
  return {
    ctr: safeRatio(r, 'clicks', 'impressions', m.clicks, m.impressions, 100),
    cpc: safeRatio(r, 'spend', 'clicks', m.spend, m.clicks),
    cpm: safeRatio(r, 'spend', 'impressions', m.spend, m.impressions, 1000),
    roas: safeRatio(r, 'conversion_value', 'spend', m.conversionValue, m.spend),
    cpa: safeRatio(r, 'spend', 'conversions', m.spend, m.conversions),
    convRate: safeRatio(r, 'conversions', 'clicks', m.conversions, m.clicks, 100),
  }
}

// ── REFUSED METRICS ARE NOT ZEROS — LORAMER_UNIVERSE_REFUSED_METRIC_V1, 2026-08-03 ────────────────────────
// ⛔ MEASURED: of the 358 entries the walk requests, 100 are PARTIAL and 59 of those serve ONLY
// conversions + conversions_value — the vendor REFUSES clicks, cost_micros and impressions at that grain.
// Their rows would otherwise carry spend=0 / impressions=0 / clicks=0 that are NOT zeros. Absence, refusal
// and a true zero are three different facts, and a ratio built on a refused denominator (ROAS, CPA, CPC) is
// a confident wrong number — the exact failure this product exists to prevent.
//
// ⛔ THE HONEST LIMIT, STATED RATHER THAN ENGINEERED AROUND: `spend`, `impressions`, `clicks`, `conversions`,
// `conversion_value` and `revenue` are all **NOT NULL DEFAULT 0** in metrics_daily. A refused metric therefore
// CANNOT be written as NULL without a migration, and this flight does not change the schema. So the column
// holds 0 and the ROW says that 0 is not real: `refusedMetrics`, `refusedReason` (the vendor verbatim),
// `refusedCode`, and `metricsReported` (the ones that ARE real). Making the read path refuse to serve those
// columns is ★UNIVERSE-REFUSED-METRIC-READ-PATH and is NOT done here.
const REFUSAL_KEYS: Record<string, string> = {
  'metrics.cost_micros': 'spend', 'metrics.impressions': 'impressions', 'metrics.clicks': 'clicks',
  'metrics.conversions': 'conversions', 'metrics.conversions_value': 'conversion_value',
}
export function refusalStamp(entry: UniverseEntry): Record<string, unknown> | null {
  const refused = entry.refusesMetrics
  if (!refused || refused.length === 0) return null
  const code = /"query_error":(\d+)/.exec(entry.metricSetReason || '')?.[1] ?? null
  return {
    refusedMetrics: refused.map((m) => REFUSAL_KEYS[m] || m),
    refusedReason: entry.metricSetReason || 'refused, no reason recorded',
    refusedCode: code ? `query_error ${code}` : null,
    metricsReported: (entry.servesMetrics || []).map((m) => REFUSAL_KEYS[m] || m),
    // ⛔ THE INSTRUCTION TO THE READER, ON THE ROW, so it survives every layer that forgets to look it up.
    refusedMeaning: 'THESE COLUMNS ARE NOT ZERO — the vendor refuses to report them at this grain. Never sum them, never present them as 0, and never use one as a ratio denominator (ROAS/CPA/CPC).',
  }
}

export interface BuildCtx { clientId: string; userEmail: string; customerId: string }

// ── THE ENTITY AXIS — LORAMER_UNIVERSE_ENTITY_AXIS_V1 ──────────────────────────────────────────────────────
// ⛔ THE VENDOR NAMES THE GRAIN. entity_level IS the GAQL `FROM` resource; entity_id IS that resource's
// `resource_name`. There is no mapping table, no switch and no per-resource branch — which is the point: the
// eight-value legacy enum could name only 2 of the 29 resources this walk queries, and inventing names for
// the other 27 is the 24-hand-written-writers pathology in a new costume.
//
// ⛔ THIS ADDS ZERO REQUESTS AND ZERO API ROWS, AND THAT IS MEASURED, NOT ASSUMED. The identity was ALREADY
// in every response and was being thrown away by the aggregation below. Google's reporting doc:
// "Every report is initially segmented by the resource specified in the FROM clause. The resource_name field
// of the resource in the FROM clause is returned and metrics are segmented by it, EVEN WHEN the resource_name
// field is not explicitly included in the query." Verified live on Foam OH 2026-08-03 over
// 2026-03-07..2026-04-05: the writer's own query returned 418 rows, the same query plus campaign.id returned
// 418 rows, and campaign.resource_name was present in the unselected case. Collapsing those 418 rows onto
// (date|value) produced 133 keys — so the old builder was discarding a measured 3.14× of vendor-served grain
// that we had already paid for.
export function entityLevelFor(entry: UniverseEntry): string {
  return entry.resource
}

/**
 * The vendor's identity for this row, or null when it declined to name one. Reads the ENTRY, not the surface.
 *
 * ⛔ NORMALISED 2026-08-09 — LORAMER_CANONICAL_KEY_SPELLING_V1. For the three resources whose NAME IS a legacy
 * `entity_level` (campaign, ad_group, ad) this now emits the BARE ID the drain has always written
 * (`google-device.ts:56,61,66`), not the vendor's resource path. Before this, the walk wrote
 * `customers/7688521852/campaigns/23424584377` where the drain wrote `23424584377`, so the same fact landed as
 * TWO rows that `metrics_daily_p_natural_key` could not collapse — 67,455 of them on Foam OH.
 * ⛔ THE DRAIN IS THE INCUMBENT AND DOES NOT MOVE. The mapping is DATA in `universe-surfaces.ts`, never a
 * conditional here: scattering that judgment across the builder is how the next adapter misses one.
 */
export function entityIdFor(entry: UniverseEntry, row: any): string | null {
  const rn = row?.[entry.resource]?.resource_name
  const raw = rn === undefined || rn === null || rn === '' ? null : String(rn)
  return canonicalEntityId(entry.resource, raw)
}

/** ⛔ A DECLINED GRAIN IS ITS OWN FACT. Not absence, not zero — the vendor answered and named no entity. */
export const VENDOR_DECLINED_GRAIN = '__vendor_declined_grain__'

export interface BuiltRows {
  rows: Record<string, unknown>[]
  /** Rows the vendor returned WITHOUT a resource_name. Recorded, never silently folded into the account. */
  grainDeclines: number
}

/**
 * Generic row build at VENDOR GRAIN.
 * `entity_level` = the FROM resource; `entity_id` = its resource_name. The segment VALUE becomes
 * breakdown_value; a resource-only entry writes the base value ('') and carries its identity in entity_id
 * rather than smuggling it into breakdown_value the way the account-grain builder had to.
 *
 * ⛔ IDEMPOTENT AT THE NEW GRAIN. The conflict key is
 * (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value) and every one of
 * those is now a pure function of the entry and the vendor's own response — so a redelivered message
 * re-fetches the same window and re-upserts the same keys. Adding entity_id to the aggregation key makes
 * the keys STRICTLY MORE specific than before; it cannot create a collision that did not already exist.
 */
export function buildUniverseRowsAtGrain(entry: UniverseEntry, ctx: BuildCtx, apiRows: any[]): BuiltRows {
  const bt = breakdownTypeFor(entry)
  const level = entityLevelFor(entry)
  const segPath = entry.segment ? entry.segment.replace(/^segments\./, '') : null
  const out: Record<string, unknown>[] = []
  const agg = new Map<string, any>()
  const refusal = refusalStamp(entry)
  let grainDeclines = 0
  for (const r of apiRows) {
    const date = r?.segments?.date
    if (!date) continue
    // Segment entry → the value is the segment. Resource-only entry → there is no segment axis, so the value
    // is the base '' and the row is identified entirely by its entity. Both branches read the ENTRY.
    const raw = segPath
      ? segPath.split('.').reduce((a: any, k) => (a == null ? a : a[k]), r.segments)
      : ''
    // ⛔ CANONICALISED 2026-08-09 — LORAMER_CANONICAL_KEY_SPELLING_V1. The raw segment value is the VENDOR's
    // spelling; the drain's is the incumbent and wins. device: the ordinal "4" becomes DESKTOP
    // (`google-device.ts:31-33`). hour: "0" becomes "00" (`google-hour.ts:33`). Anything else passes through —
    // a fact only the walk writes has no incumbent to conform to, and inventing one would repeat the mistake.
    const rawValue = raw === undefined || raw === null ? '' : String(raw)
    const value = rawValue === '' ? '' : canonicalBreakdownValue(bt, rawValue)
    if (segPath && value === '') continue // a SEGMENT row with no segment value is not a grain, it is noise
    const id = entityIdFor(entry, r)
    if (id === null) grainDeclines++
    const entityId = id ?? VENDOR_DECLINED_GRAIN
    const key = `${date}|${value}|${entityId}`
    let a = agg.get(key)
    if (!a) { a = { date, value, entityId, declined: id === null, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; agg.set(key, a) }
    a.spend += num(r?.metrics?.cost_micros) / 1_000_000
    a.impressions += num(r?.metrics?.impressions)
    a.clicks += num(r?.metrics?.clicks)
    a.conversions += num(r?.metrics?.conversions)
    a.convValue += num(r?.metrics?.conversions_value)
  }
  for (const a of agg.values()) {
    // ⛔ ALL-ZERO ROWS ARE DROPPED FROM THE PAYLOAD, NOT FROM THE RECORD. The observed zero is reported by the
    // caller as a captureResult; it is not smuggled in as 0-valued rows that would inflate every row count.
    if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
    const spend = Number(a.spend.toFixed(2))
    const convValue = Number(a.convValue.toFixed(2))
    out.push({
      client_id: ctx.clientId, user_email: ctx.userEmail, platform: 'google', account_id: ctx.customerId,
      entity_level: level, entity_id: a.entityId, entity_name: null, parent_entity_id: ctx.customerId,
      date: a.date, breakdown_type: bt, breakdown_value: a.value,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions,
      conversion_value: convValue, revenue: 0,
      extra: {
        // ⛔ LORAMER_REFUSED_RATIO_IS_NULL_V1 — null, not 0, when either input metric is refused.
        ...derivedRatios(entry, { spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: convValue }),
        // ⛔ THE THREE STATES KEPT APART, ON THE ROW, so a reader never has to infer which one it is:
        //   grain: 'VENDOR_NAMED'   — the vendor named this entity (the normal case)
        //   grain: 'VENDOR_DECLINED'— the vendor answered and named NO entity for this row
        //   (no row at all)         — absence; and an observed zero is reported by the caller, not as a row
        grain: a.declined ? 'VENDOR_DECLINED' : 'VENDOR_NAMED',
        grainSource: 'FROM_RESOURCE_NAME',
        ...(refusal || {}),
      },
    })
  }
  return { rows: out, grainDeclines }
}

/**
 * LORAMER_UNIVERSE_DERIVED_TIME_V1 — the six time families, COMPUTED from the rows we already fetched.
 *
 * ⛔ ZERO VENDOR REQUESTS. This runs on the SAME `apiRows` the base entry already paid for, which is the
 * whole of Route B: we stopped asking Google for arithmetic and started doing it.
 *
 * ⛔ AND IT IS A TRUE AGGREGATE, WHICH THE VENDOR FAMILY WAS NOT. Google's `segments.month` rows are DAILY
 * rows wearing a month label — one per entity per DAY — which is why every time family returned a row count
 * identical to its base family and why the whole set was 30.6% of a window for no information. These are one
 * row per entity per PERIOD, so the row count falls out of the aggregation rather than out of a decision.
 *
 * ⛔ ONLY RESOURCE-ONLY ENTRIES FEED THIS. A segment entry is already split by its own dimension, so rolling
 * it up by period would silently sum across that dimension and produce a number nobody asked for.
 */
export function buildDerivedTimeRows(entry: UniverseEntry, ctx: BuildCtx, apiRows: any[]): Record<string, unknown>[] {
  if (entry.segment) return []
  const level = entityLevelFor(entry)
  const refusal = refusalStamp(entry)
  const out: Record<string, unknown>[] = []
  for (const fam of DERIVED_TIME_FAMILIES) {
    const agg = new Map<string, any>()
    for (const r of apiRows) {
      const date = r?.segments?.date
      if (!date) continue
      const id = entityIdFor(entry, r)
      const entityId = id ?? VENDOR_DECLINED_GRAIN
      const period = fam.derive(String(date))
      const key = `${entityId}|${period}`
      let a = agg.get(key)
      if (!a) { a = { entityId, period, declined: id === null, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0, days: new Set<string>() }; agg.set(key, a) }
      a.spend += num(r?.metrics?.cost_micros) / 1_000_000
      a.impressions += num(r?.metrics?.impressions)
      a.clicks += num(r?.metrics?.clicks)
      a.conversions += num(r?.metrics?.conversions)
      a.convValue += num(r?.metrics?.conversions_value)
      a.days.add(String(date))
    }
    for (const a of agg.values()) {
      if (a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.conversions === 0) continue
      const spend = Number(a.spend.toFixed(2))
      const convValue = Number(a.convValue.toFixed(2))
      // ⛔ THE CONFLICT KEY NEEDS A DATE AND AN AGGREGATE HAS NO SINGLE DAY. We use the PERIOD'S OWN ANCHOR —
      // the earliest day of this entity's activity in that period — so the key is deterministic, idempotent,
      // and cannot collide with the base row (which carries a different breakdown_type).
      const anchor = [...a.days].sort()[0]
      out.push({
        client_id: ctx.clientId, user_email: ctx.userEmail, platform: 'google', account_id: ctx.customerId,
        entity_level: level, entity_id: a.entityId, entity_name: null, parent_entity_id: ctx.customerId,
        date: anchor, breakdown_type: fam.breakdownType, breakdown_value: a.period,
        spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions,
        conversion_value: convValue, revenue: 0,
        extra: {
          // ⛔ LORAMER_REFUSED_RATIO_IS_NULL_V1 — the derived-time rows inherit the same rule. A computed
          // aggregate over a refused metric is no more divisible than the vendor's own row was.
          ...derivedRatios(entry, { spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions, conversionValue: convValue }),
          grain: a.declined ? 'VENDOR_DECLINED' : 'VENDOR_NAMED',
          grainSource: 'FROM_RESOURCE_NAME',
          // ⛔ PROVENANCE IS MANDATORY ON EVERY COMPUTED ROW. Without it a reader — Lora included — cannot
          // tell an aggregate we did from a figure Google reported, and presenting the first as the second
          // is a HONESTY failure rather than a storage detail. The guard fails the build if it is missing.
          provenance: PROVENANCE_COMPUTED,
          derivedFrom: 'segments.date',
          derivationRule: fam.rule,
          periodDays: a.days.size,
          periodAnchor: anchor,
          ...(refusal || {}),
        },
      })
    }
  }
  return out
}

// ── THE CAPTURE ────────────────────────────────────────────────────────────────────────────────────────────
export interface CaptureResult {
  entry: string
  gaql: string | null
  apiRows: number
  rowsWritten: number
  /** TRUE when the vendor answered with nothing. A recorded fact, never a skip. */
  observedZero: boolean
  skipped: SkipReason | null
  exhaustion: VendorExhaustion | null
  error: string | null
  /** LORAMER_UNIVERSE_ENTITY_AXIS_V1 — the vendor grain this entry was written at (the GAQL FROM resource). */
  entityLevel: string
  /** Rows the vendor returned with NO resource_name. A labelled fact; never folded into absence or zero. */
  grainDeclines: number
  /** LORAMER_UNIVERSE_DERIVED_TIME_V1 — rows COMPUTED from `date` rather than requested. Zero extra requests. */
  derivedRows: number
}

/**
 * Capture ONE universe entry for one client over one window. `query` is injected so this function is drivable
 * with no network — the guard runs it against a stub, which is how leg (b) and (c) are proven without quota.
 */
export async function captureUniverseEntry(args: {
  entry: UniverseEntry
  ctx: BuildCtx
  startDate: string
  endDate: string
  query: (gaql: string) => Promise<any[]>
  supplied?: Record<string, string | undefined>
  dryRun?: boolean
}): Promise<CaptureResult> {
  const { entry, ctx, startDate, endDate, query, supplied = {}, dryRun } = args
  const label = `${entry.resource}${entry.segment ? ' / ' + entry.segment : ''}`
  const level = entityLevelFor(entry)
  // ⛔ A MEASURED CAPABILITY LIMIT IS RECORDED AND SKIPPED BEFORE A REQUEST IS SPENT — it is not an error to
  // rediscover every window. `servesMetrics: []` means the probe asked with the writer's own metric set, the
  // vendor refused all five, and narrowing found nothing left to ask for.
  if (entry.servesMetrics && entry.servesMetrics.length === 0) {
    return { entry: label, gaql: null, apiRows: 0, rowsWritten: 0, observedZero: false,
      skipped: { entry: label, requirement: `capability limit: the vendor serves NONE of the writer's metrics for this entry — ${entry.metricSetReason || 'no reason recorded'}`, recorded: true },
      exhaustion: null, error: null, entityLevel: level, grainDeclines: 0, derivedRows: 0 }
  }
  const structural = resolveStructural(entry, supplied)
  if (!structural.ok) {
    return { entry: label, gaql: null, apiRows: 0, rowsWritten: 0, observedZero: false, skipped: structural.skip, exhaustion: null, error: null, entityLevel: level, grainDeclines: 0, derivedRows: 0 }
  }
  const gaql = buildGaql(entry, startDate, endDate, structural.filters)
  let apiRows: any[]
  try { apiRows = await query(gaql) } catch (e: any) {
    // ⛔ NEVER `String(e)` A GoogleAdsFailure. Its `.message` is undefined and String(<object>) yields the
    // literal "[object Object]" — which is exactly what this line produced for all 55 failing entries on the
    // 2026-08-03 measured window, making a real vendor verdict unreadable. The repo already solved this once
    // (LORAMER_GAQL_ERROR_SERIALIZE_V1, google-intelligence.ts) and this writer simply never used it. Reusing
    // it rather than reinventing a second serializer is the whole point of the banked law.
    return { entry: label, gaql, apiRows: 0, rowsWritten: 0, observedZero: false, skipped: null, exhaustion: null, error: describeGaqlError(e).slice(0, 300), entityLevel: level, grainDeclines: 0, derivedRows: 0 }
  }
  const exhaustion = decideVendorExhaustion({ windowStart: startDate, rowsReturned: apiRows.length, gaql, floorDate: VENDOR_FLOOR_DATE })
  const built = buildUniverseRowsAtGrain(entry, ctx, apiRows)
  // ⛔ THE SIX TIME FAMILIES RIDE THE SAME RESPONSE (LORAMER_UNIVERSE_DERIVED_TIME_V1) — no second request,
  // no second window, no second walk. Marked COMPUTED_FROM_DATE on every row.
  const derived = buildDerivedTimeRows(entry, ctx, apiRows)
  const payload = [...built.rows, ...derived]
  let written: ChunkedUpsertResult = { written: 0, chunks: 0 }
  if (!dryRun && payload.length) written = await upsertMetricsChunked(payload)
  return {
    entry: label, gaql, apiRows: apiRows.length, rowsWritten: written.written,
    observedZero: apiRows.length === 0, skipped: null, exhaustion, error: null,
    entityLevel: level, grainDeclines: built.grainDeclines, derivedRows: derived.length,
  }
}
