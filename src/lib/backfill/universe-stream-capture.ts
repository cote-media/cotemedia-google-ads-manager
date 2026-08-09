// LORAMER_UNIVERSE_STREAM_CAPTURE_V1 — CAPTURE ONE ENTRY BY STREAMING, COMMITTING A DAY AT A TIME.
//
// ⛔ WHAT THIS REPLACES AND WHY. `captureUniverseEntry` calls `customer.query(gaql)`, which returns
// `Promise<T[]>`: it BUFFERS THE WHOLE WINDOW before a single row is written. A killed invocation therefore
// loses everything it fetched, having already spent the request — which is how a 300-second poison loop can
// burn quota indefinitely and leave nothing behind. `customer.queryStream(gaql)` returns
// `AsyncGenerator<T>` (google-ads-api 23.0.0, customer.d.ts:22) and has been available the whole time.
//
// ⛔ THE LIMITATION, STATED BEFORE THE DESIGN, BECAUSE IT SHAPES ALL OF IT: **A STREAM CANNOT BE RESUMED
// ACROSS INVOCATIONS.** There is no cursor to hand the next one. So "checkpoint per page" does NOT make an
// over-large window completable — it only stops us throwing away rows already written.
// **THE RESUMABLE UNIT IS THE DAY BECAUSE THE WAREHOUSE IS KEYED BY DAY** (ESSENCE law, banked 2026-08-08).
// ⚠ THIS FILE ORIGINALLY GAVE THE WEAKER REASON — "because GAQL filters segments.date BETWEEN" — which is a
// fact about ONE VENDOR'S API. It happens to hold for all five, so the design worked; but the load-bearing
// member was in the wrong place. `metrics_daily` is keyed by date, so the owed set is computable for any
// platform whose rows land there. Shopify is the proof: an opaque order cursor with no day concept, and it
// still resolves to days.
//
// ⛔ THE WRITER IS NOT EDITED. Every row-building decision stays in `google-ads-universe-writer.ts`. This
// file owns the STREAMING and the COMMIT BOUNDARY, nothing else. Two implementations of row building is how
// a repo ends up with 24 hand-written writers.
//
// ⛔ RETROFITTED TO THE ADAPTER CONTRACT (LORAMER_CAPTURE_ADAPTER_CONTRACT_V1). What LEFT this file:
//   · `ORDER BY segments.date` — GAQL syntax, now `ORDER_CLAUSE` in `capture-adapters/google-ads.adapter.ts`
//   · `buildGaql` / `buildUniverseRowsAtGrain` / `resolveStructural` — reached through `adapter.stream()`,
//     `adapter.buildRows()` and the surface, so this file names no vendor and no query language.
//   · `decideVendorExhaustion` — replaced by `decideExhaustion()` in the core, which takes a NULLABLE floor
//     and is STRUCTURALLY unable to claim exhaustion when there is no vendor wall (GA4, Shopify, Woo).
// What STAYED is the only genuinely neutral thing here: **the loop that writes a day and then commits it.**
// The runtime ordering check stayed too, but it is now conditional on the adapter's DECLARED entitlement —
// an adapter that may not infer closure from ordering never claims a day it did not explicitly commit.
import { upsertMetricsChunked } from '@/lib/metrics-upsert'
import {
  decideExhaustion, mayInferClosureFromOrder,
  type CaptureAdapter, type CaptureContext, type CaptureSurface, type ExhaustionVerdict,
} from '@/lib/backfill/capture-adapter'

export interface StreamCaptureResult {
  entry: string
  /**
   * ⛔ RENAMED FROM `gaql`. A field called `gaql` in a platform-neutral module is a Google assumption wearing
   * a struct field — the next adapter would either carry a misleading name or force a rename under pressure.
   * `asked` is what every adapter can answer: a query, a job id, a URL.
   */
  asked: string | null
  apiRows: number
  rowsWritten: number
  /** Days whose rows were durably upserted, in the order they were committed. */
  daysCommitted: string[]
  observedZero: boolean
  skipped: { entry: string; requirement: string; recorded: true } | null
  exhaustion: ExhaustionVerdict | null
  error: string | null
  entityLevel: string
  grainDeclines: number
  /**
   * ⛔ TRUE when the vendor returned a row for a day OLDER than one already committed. See ORDER, below.
   * It is a recorded fact rather than a thrown error: the rows are still correct and still written; what is
   * void is the CLAIM that the earlier days were closed.
   */
  orderViolation: boolean
}

/**
 * ⛔ ORDER IS LOAD-BEARING, AND WHETHER AN ADAPTER MAY LEAN ON IT IS THE ADAPTER'S DECLARATION.
 *
 * The commit boundary is "a later day arrived, so the previous day is finished" — sound ONLY if delivery is
 * ordered by day. Google earns it (`ORDER BY segments.date`, verified monotonic at runtime rather than
 * trusted). **Shopify does not**: `orders(first: 250, query: …)` is an opaque cursor connection with no
 * ordering guarantee verifiable from its documentation.
 *
 * So the runtime check runs ONLY for an adapter entitled to `later-day-closes`, and for everyone else the
 * day is closed by its explicit `day_committed` record — rule (b), already built and already optional in
 * `coveredDaysStrict`. **The predicate never changed; the entitlement is data.**
 */

export interface StreamCaptureArgs<TRow = any> {
  /** ⛔ THE ADAPTER SUPPLIES THE VENDOR, THE FLOOR, THE ORDERING ENTITLEMENT AND THE ROW BUILDER. */
  adapter: CaptureAdapter<TRow>
  surface: CaptureSurface
  ctx: CaptureContext
  startDate: string
  endDate: string
  /**
   * INJECTED so this is drivable with no network — the guard proves the commit boundary against a stub.
   * Defaults to `adapter.stream()`, which is required when `fetchShape === 'stream'`.
   */
  stream?: () => AsyncGenerator<TRow>
  /** Called after each day's rows are DURABLY upserted. The consumer appends `day_committed` here. */
  onDayCommitted?: (day: string, rowsWritten: number) => Promise<void>
  /** INJECTED for the guard; defaults to the one write path the whole repo uses. */
  upsert?: (rows: Record<string, unknown>[]) => Promise<{ written: number }>
}

export async function captureSurfaceStreaming<TRow>(args: StreamCaptureArgs<TRow>): Promise<StreamCaptureResult> {
  const { adapter, surface, ctx, startDate, endDate, onDayCommitted } = args
  const upsert = args.upsert ?? ((rows) => upsertMetricsChunked(rows).then((r) => ({ written: r.written })))
  const label = `${adapter.platform}:${surface.resource}${surface.segment ? ' / ' + surface.segment : ''}`
  const out: StreamCaptureResult = {
    entry: label, asked: null, apiRows: 0, rowsWritten: 0, daysCommitted: [], observedZero: false,
    skipped: null, exhaustion: null, error: null, entityLevel: surface.entityLevel, grainDeclines: 0,
    orderViolation: false,
  }

  const source = args.stream
    ?? (adapter.stream ? () => adapter.stream!(ctx, surface, startDate, endDate) : null)
  if (!source) {
    // ⛔ A `'job'` ADAPTER HAS NO STREAM AND MUST NOT BE SILENTLY TREATED AS EMPTY. Shopify bulk and Meta
    // async submit a job and collect it later — possibly in a LATER INVOCATION, which is the point. Routing
    // one through here and reading zero rows would be a false "the vendor had nothing".
    out.error = `adapter '${adapter.platform}' declares fetchShape='${adapter.fetchShape}' and supplies no stream(). ⛔ A TWO-PHASE ADAPTER MUST BE DRIVEN BY submit()/collect(), NOT BY THIS PATH — reading it as zero rows would manufacture an honest-zero that nobody observed.`
    return out
  }

  // ⛔ WHETHER A LATER DAY MAY CLOSE AN EARLIER ONE IS THE ADAPTER'S DECLARATION, NOT AN ASSUMPTION.
  const mayInferOrder = mayInferClosureFromOrder(adapter)

  let currentDay: string | null = null
  let buf: TRow[] = []
  const committed = new Set<string>()

  const flush = async (day: string, rows: TRow[]) => {
    // ⛔ ROWS ARE BUILT PER DAY BY THE ADAPTER. Google's builder aggregates on (date | segment value |
    // entity), all within-day keys, so building one day at a time is byte-identical to building the whole
    // window at once. An adapter whose builder is NOT within-day-decomposable may not use this path.
    const built = adapter.buildRows(surface, ctx, rows)
    out.grainDeclines += built.grainDeclines
    if (built.rows.length) out.rowsWritten += (await upsert(built.rows)).written
    committed.add(day)
    out.daysCommitted.push(day)
    // ⛔ THE APPEND HAPPENS **AFTER** THE UPSERT RESOLVES, NEVER BEFORE. A `day_committed` written first
    // would attest to rows that a kill one line later means do not exist — the same
    // durable-state-on-the-wrong-side-of-the-work defect the whole rebuild exists to end, inverted.
    if (onDayCommitted) await onDayCommitted(day, built.rows.length)
  }

  try {
    for await (const row of source()) {
      const d = adapter.dateOf(row)
      out.apiRows++
      if (!d) continue                                     // no date ⇒ not a daily grain
      if (currentDay !== null && d !== currentDay) {
        if (committed.has(d) || d < currentDay) {
          // ⛔ OUT OF ORDER. The rows are still written — they are correct — but the CLAIM that earlier days
          // were closed is void, so it is recorded and the caller is told.
          out.orderViolation = true
        } else {
          await flush(currentDay, buf); buf = []
        }
      }
      currentDay = d
      buf.push(row)
    }
    if (currentDay !== null) await flush(currentDay, buf)
  } catch (e: any) {
    out.error = adapter.serializeError(e)
    // ⛔ AND THE ROWS ALREADY COMMITTED STAY COMMITTED. That is the entire point of streaming: a failure at
    // day 22 keeps days 1-21, and the coverage model will ask only for 22-30 next time.
    return out
  }

  // ⚠ AN UNENTITLED ADAPTER NEVER GETS TO CLAIM ORDERING WAS FINE. Reporting `orderViolation: false` for an
  // adapter that was never entitled to rule (a) would read as "ordering verified" to the next reader.
  if (!mayInferOrder) out.orderViolation = true
  out.observedZero = out.rowsWritten === 0 && out.apiRows === 0
  out.exhaustion = decideExhaustion({
    windowStart: startDate, rowsReturned: out.apiRows, floor: adapter.retention,
    asked: `${adapter.platform} ${surface.resource}/${surface.segment || '(base)'} ${startDate}..${endDate}`,
  })
  return out
}

/**
 * ⛔ A GoogleAdsFailure IS NOT AN Error AND HAS NO `.message`. The repo solved this once already
 * (LORAMER_GAQL_ERROR_SERIALIZE_V1) and the universe writer simply never used it. Reuse the shape rather
 * than rediscovering "[object Object]" on the next 55-entry failure.
 */
export function serializeVendorError(e: any): string {
  if (!e) return 'unknown error (falsy throw)'
  if (typeof e === 'string') return e
  const parts: string[] = []
  const errs = e?.errors ?? e?.failure?.errors
  if (Array.isArray(errs) && errs.length) {
    for (const x of errs.slice(0, 4)) {
      const code = x?.error_code ? JSON.stringify(x.error_code) : ''
      parts.push(`${code} ${x?.message ?? ''}`.trim())
    }
  }
  if (e?.message) parts.push(String(e.message))
  if (!parts.length) { try { parts.push(JSON.stringify(e).slice(0, 400)) } catch { parts.push(Object.prototype.toString.call(e)) } }
  return parts.join(' | ')
}

