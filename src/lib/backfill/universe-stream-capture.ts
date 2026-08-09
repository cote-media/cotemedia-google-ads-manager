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
// over-large window completable — it only stops us throwing away rows already written. **THE RESUMABLE UNIT
// IS THE DAY**, because GAQL filters `segments.date BETWEEN` and the coverage model already computes exactly
// which days are owed. That is the dbt-microbatch shape and it needs no vendor feature.
//
// ⛔ THE WRITER IS NOT EDITED. Every row-building decision — the GAQL, the entity axis, the refusal stamp,
// the null-not-zero ratios, the exhaustion verdict — stays in `google-ads-universe-writer.ts` and is IMPORTED
// here. This file owns the STREAMING and the COMMIT BOUNDARY, nothing else. Two implementations of row
// building is how a repo ends up with 24 hand-written writers.
import {
  buildGaql, buildUniverseRowsAtGrain, resolveStructural, decideVendorExhaustion, entityLevelFor,
  breakdownTypeFor, type UniverseEntry, type BuildCtx, type SkipReason, type VendorExhaustion,
} from '@/lib/backfill/google-ads-universe-writer'
import { upsertMetricsChunked } from '@/lib/metrics-upsert'

export interface StreamCaptureResult {
  entry: string
  gaql: string | null
  apiRows: number
  rowsWritten: number
  /** Days whose rows were durably upserted, in the order they were committed. */
  daysCommitted: string[]
  observedZero: boolean
  skipped: SkipReason | null
  exhaustion: VendorExhaustion | null
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
 * ⛔ ORDER IS LOAD-BEARING AND IS ASSERTED TWICE.
 *
 * The commit boundary is "a later day arrived, so the previous day is finished". That inference is only
 * valid if the vendor delivers in date order, so:
 *   1. the query asks for it — `ORDER BY segments.date` is appended to the writer's GAQL;
 *   2. **and the stream is checked at runtime anyway**, because an ORDER BY the vendor silently ignores
 *      would turn every commit into a false claim, and a claim that is wrong only sometimes is worse than
 *      one that is always wrong. If a row arrives for an already-committed day, `orderViolation` is set and
 *      the caller must not treat this attempt's day commits as proof.
 * Verify-the-instrument, applied to the vendor's own guarantee.
 */
export const ORDER_CLAUSE = ' ORDER BY segments.date'

export interface StreamCaptureArgs {
  entry: UniverseEntry
  ctx: BuildCtx
  startDate: string
  endDate: string
  /** INJECTED so this is drivable with no network — the guard proves the commit boundary against a stub. */
  stream: (gaql: string) => AsyncGenerator<any>
  /** Called after each day's rows are DURABLY upserted. The consumer appends `day_committed` here. */
  onDayCommitted?: (day: string, rowsWritten: number) => Promise<void>
  /** INJECTED for the guard; defaults to the one write path the whole repo uses. */
  upsert?: (rows: Record<string, unknown>[]) => Promise<{ written: number }>
  supplied?: Record<string, string | undefined>
  floorDate: string
  dryRun?: boolean
}

export async function captureEntryStreaming(args: StreamCaptureArgs): Promise<StreamCaptureResult> {
  const { entry, ctx, startDate, endDate, stream, onDayCommitted, supplied = {}, floorDate, dryRun } = args
  const upsert = args.upsert ?? ((rows) => upsertMetricsChunked(rows).then((r) => ({ written: r.written })))
  const label = `${entry.resource}${entry.segment ? ' / ' + entry.segment : ''}`
  const level = entityLevelFor(entry)
  const base: StreamCaptureResult = {
    entry: label, gaql: null, apiRows: 0, rowsWritten: 0, daysCommitted: [], observedZero: false,
    skipped: null, exhaustion: null, error: null, entityLevel: level, grainDeclines: 0, orderViolation: false,
  }

  // ⛔ A MEASURED CAPABILITY LIMIT IS RECORDED AND SKIPPED BEFORE A REQUEST IS SPENT. `servesMetrics: []`
  // means the probe asked with the writer's own metric set and the vendor refused all of them. Rediscovering
  // that every window is pure waste. (And per plan §11 a `skipped` is NOT negative coverage — it is a
  // statement about US, and must be re-evaluated whenever the requirement changes.)
  if (entry.servesMetrics && entry.servesMetrics.length === 0) {
    return { ...base, skipped: { entry: label, requirement: `capability limit: the vendor serves NONE of the writer's metrics for this entry — ${entry.metricSetReason || 'no reason recorded'}`, recorded: true } }
  }
  const structural = resolveStructural(entry, supplied)
  if (!structural.ok) return { ...base, skipped: structural.skip }

  const gaql = buildGaql(entry, startDate, endDate, structural.filters) + ORDER_CLAUSE
  if (dryRun) return { ...base, gaql }

  // ── THE STREAM ────────────────────────────────────────────────────────────────────────────────────────
  let currentDay: string | null = null
  let buf: any[] = []
  const committed = new Set<string>()
  const out = { ...base, gaql }

  const flush = async (day: string, rows: any[]) => {
    // ⛔ THE ROWS ARE BUILT BY THE WRITER, PER DAY. `buildUniverseRowsAtGrain` aggregates on
    // (date | segment value | entity), all of which are within-day keys, so building one day at a time is
    // byte-identical to building the whole window at once. That is what makes the commit boundary safe.
    const built = buildUniverseRowsAtGrain(entry, ctx, rows)
    out.grainDeclines += built.grainDeclines
    if (built.rows.length) {
      const res = await upsert(built.rows)
      out.rowsWritten += res.written
    }
    committed.add(day)
    out.daysCommitted.push(day)
    // ⛔ THE APPEND HAPPENS **AFTER** THE UPSERT RESOLVES, NEVER BEFORE. A `day_committed` written first
    // would attest to rows that a kill one line later means do not exist — the same
    // durable-state-on-the-wrong-side-of-the-work defect the whole rebuild exists to end, inverted.
    if (onDayCommitted) await onDayCommitted(day, built.rows.length)
  }

  try {
    for await (const row of stream(gaql)) {
      const d = row?.segments?.date ? String(row.segments.date) : null
      out.apiRows++
      if (!d) continue                                     // no date ⇒ not a daily grain; the writer drops it too
      if (currentDay !== null && d !== currentDay) {
        if (committed.has(d) || d < currentDay) {
          // ⛔ OUT OF ORDER. The rows are still written — they are correct — but the CLAIM that earlier days
          // were closed is void, so it is recorded and the caller is told.
          out.orderViolation = true
        } else {
          await flush(currentDay, buf)
          buf = []
        }
      }
      currentDay = d
      buf.push(row)
    }
    if (currentDay !== null) await flush(currentDay, buf)
  } catch (e: any) {
    // ⛔ NEVER `String(e)` A GoogleAdsFailure — its `.message` is undefined and `String(<object>)` yields the
    // literal "[object Object]", which is exactly what made 55 failing entries unreadable on 2026-08-03.
    out.error = serializeVendorError(e)
    // ⛔ AND THE ROWS ALREADY COMMITTED STAY COMMITTED. That is the entire point of streaming: a failure at
    // day 22 keeps days 1-21, and the coverage model will ask only for 22-30 next time.
    return out
  }

  out.observedZero = out.rowsWritten === 0 && out.apiRows === 0
  out.exhaustion = decideVendorExhaustion({ windowStart: startDate, rowsReturned: out.apiRows, gaql, floorDate })
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

/** The coverage grain for one catalog entry — the two fields `universe-coverage` asks for, derived once. */
export function coverageGrainFor(entry: UniverseEntry): { entityLevel: string; breakdownType: string } {
  return { entityLevel: entityLevelFor(entry), breakdownType: breakdownTypeFor(entry) }
}
