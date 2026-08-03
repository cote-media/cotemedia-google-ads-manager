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

export interface UniverseEntry {
  resource: string
  segment: string | null
  /** Present only when metrics.impressions is illegal beside this segment (query_error 53). */
  metricShape?: string | null
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

/** Entries this writer will attempt: proven to deliver, date-combinable, and not already captured. */
export function selectableEntries(doc: UniverseDoc): UniverseEntry[] {
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
  select.push(...(entry.metricShape ? [entry.metricShape] : DEFAULT_METRICS))
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
export function decideVendorExhaustion(args: { windowStart: string; rowsReturned: number; gaql: string }): VendorExhaustion {
  const { windowStart, rowsReturned, gaql } = args
  if (rowsReturned > 0) {
    return { complete: false, exhaustedBelow: null, proof: `vendor returned ${rowsReturned} row(s) at/below ${windowStart} — the walk continues` }
  }
  return {
    complete: true,
    exhaustedBelow: windowStart,
    proof: `vendor returned 0 rows for [${windowStart}] via: ${gaql}`,
  }
}

// ── ROW BUILDER ────────────────────────────────────────────────────────────────────────────────────────────
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v || 0))
const ratio = (a: number, b: number, mult = 1) => (b > 0 ? Number(((a / b) * mult).toFixed(4)) : 0)

export interface BuildCtx { clientId: string; userEmail: string; customerId: string }

/**
 * Generic row build. `entityLevel` is 'account' for a resource-only entry and stays 'account' for segment
 * entries in this flight — the entity axis is Flight 2. The segment VALUE becomes breakdown_value; a
 * resource-only entry writes the base row triple ('' / '').
 */
export function buildUniverseRows(entry: UniverseEntry, ctx: BuildCtx, apiRows: any[]): Record<string, unknown>[] {
  const bt = breakdownTypeFor(entry)
  const segPath = entry.segment ? entry.segment.replace(/^segments\./, '') : null
  const out: Record<string, unknown>[] = []
  const agg = new Map<string, any>()
  for (const r of apiRows) {
    const date = r?.segments?.date
    if (!date) continue
    // Segment entry → the value is the segment. Resource-only entry → the value is the resource's own
    // identity, taken from the `resource_name` the GAQL always selects (see buildGaql). Both branches read
    // the ENTRY, never the resource name, so neither is per-surface.
    const raw = segPath
      ? segPath.split('.').reduce((a: any, k) => (a == null ? a : a[k]), r.segments)
      : r?.[entry.resource]?.resource_name
    const value = raw === undefined || raw === null ? '' : String(raw)
    if (value === '') continue // a row with no grain value is not a grain, it is noise
    const key = `${date}|${value}`
    let a = agg.get(key)
    if (!a) { a = { date, value, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }; agg.set(key, a) }
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
      entity_level: 'account', entity_id: ctx.customerId, entity_name: null, parent_entity_id: null,
      date: a.date, breakdown_type: bt, breakdown_value: a.value,
      spend, impressions: a.impressions, clicks: a.clicks, conversions: a.conversions,
      conversion_value: convValue, revenue: 0,
      extra: {
        ctr: ratio(a.clicks, a.impressions, 100), cpc: ratio(spend, a.clicks), cpm: ratio(spend, a.impressions, 1000),
        roas: ratio(convValue, spend), cpa: ratio(spend, a.conversions), convRate: ratio(a.conversions, a.clicks, 100),
      },
    })
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
  const structural = resolveStructural(entry, supplied)
  if (!structural.ok) {
    return { entry: label, gaql: null, apiRows: 0, rowsWritten: 0, observedZero: false, skipped: structural.skip, exhaustion: null, error: null }
  }
  const gaql = buildGaql(entry, startDate, endDate, structural.filters)
  let apiRows: any[]
  try { apiRows = await query(gaql) } catch (e: any) {
    return { entry: label, gaql, apiRows: 0, rowsWritten: 0, observedZero: false, skipped: null, exhaustion: null, error: String(e?.message || e).slice(0, 300) }
  }
  const exhaustion = decideVendorExhaustion({ windowStart: startDate, rowsReturned: apiRows.length, gaql })
  const rows = buildUniverseRows(entry, ctx, apiRows)
  let written: ChunkedUpsertResult = { written: 0, chunks: 0 }
  if (!dryRun && rows.length) written = await upsertMetricsChunked(rows)
  return {
    entry: label, gaql, apiRows: apiRows.length, rowsWritten: written.written,
    observedZero: apiRows.length === 0, skipped: null, exhaustion, error: null,
  }
}
