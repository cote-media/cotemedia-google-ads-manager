// LORAMER_METRICS_UPSERT_CHUNKED_V1 — the ONE chunked writer for metrics_daily.
//
// WHY THIS EXISTS. A single supabase-js `.upsert(array)` is ONE Postgres statement, and on a slice that is
// ALREADY POPULATED every row in that array is a CONFLICT — i.e. an UPDATE, not an insert. Postgres writes a
// new heap tuple per updated row and then maintains every index that covers it; metrics_daily carries SIX
// indexes totalling ~14 GB against a ~16 GB heap, including the 8.2 GB unique conflict-key index that each
// row must probe. `spend`/`revenue` are INCLUDE columns on idx_metrics_daily_account_canonical, so an update
// touching them defeats HOT and forces full index maintenance per row. Published measurement of the same
// shape: an "overwrite" batch of 10,000 rows costs ~281x the same batch as pure inserts (Datadog, "When
// upserts don't update but still write"). The remedy in every source is to REDUCE THE BATCH so one statement
// fits the timeout — never to raise the timeout, which is separately forbidden here (LIVE statement_timeout
// is 8s via the PostgREST `authenticator` role; the 120s figure is visible only to MCP/superuser sessions).
//
// MEASURED, 2026-07-29, the defect this closes: google_geo / google_user_geo laps issued single statements of
// 15,587 rows (Foam OH geo_city/campaign 2026-03-25) and 13,117 rows (Inside 2025-07-24) and died with
// "canceling statement due to statement timeout". The lap returns 500 on the first failure, so rangeLap never
// advances its cursor — both families sat frozen for ~4 weeks, re-attempting the same 40-day window, and each
// retry was strictly more expensive than the last because earlier partial successes had turned the inserts
// into updates.
//
// normalizeMetricsRows IS CALLED HERE, not by the caller. That is deliberate: it is the union-of-keys guard
// (LORAMER_SHOPIFY_DEPTH_NOTNULL_FIX_V1 — PostgREST builds ONE column list from the union across the payload,
// so a row missing a key a sibling supplies is sent as an explicit NULL and 23502-rejects the whole
// statement). Routing every write through this function means no caller can skip it. NOTE the normalisation
// runs PER CHUNK, which is correct and is the reason chunking is safe: the union is computed over the rows
// that actually travel in that statement, so each statement stays internally uniform.
//
// ⚠ HONEST LIMIT, stated rather than implied away: the default chunk size is a bound on ROW COUNT, not on
// statement COST. It is not proven against the 8s PostgREST ceiling for arbitrary future row shapes — a wider
// row, a heavier index set, or a colder buffer cache all move the real ceiling and nothing here measures it.
// The guard that ships with this proves every write goes THROUGH this function; it cannot prove the number is
// small enough. If a chunked write ever times out, the failure names its chunk index and row count so the
// next reader tunes from evidence instead of from a guess.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'

// The 7-column natural key. Every metrics_daily writer conflicts on exactly this; it lives here so the
// string cannot drift per writer.
export const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

export const DEFAULT_CHUNK_SIZE = 1000

export interface ChunkedUpsertResult {
  written: number // rows sent (== rows.length on success; the upsert is idempotent, so this is not "rows changed")
  chunks: number // statements issued
}

export async function upsertMetricsChunked(
  rows: Record<string, unknown>[],
  opts: { chunkSize?: number } = {},
): Promise<ChunkedUpsertResult> {
  const size = Math.max(1, opts.chunkSize ?? DEFAULT_CHUNK_SIZE)
  if (rows.length === 0) return { written: 0, chunks: 0 }

  const total = Math.ceil(rows.length / size)
  let written = 0
  for (let i = 0; i < total; i++) {
    const slice = rows.slice(i * size, (i + 1) * size)
    const { error } = await supabaseAdmin
      .from('metrics_daily')
      .upsert(normalizeMetricsRows(slice), { onConflict: METRICS_DAILY_CONFLICT })
    if (error) {
      // Name WHERE it died. A bare "upsert failed" cost four weeks of not knowing whether the payload, the
      // window, or the client was the variable that mattered.
      throw new Error(
        `metrics_daily chunked upsert FAILED at chunk ${i + 1}/${total} (${slice.length} rows, ${written} rows already written of ${rows.length}, chunkSize=${size}): ${error.message}`,
      )
    }
    written += slice.length
  }
  return { written, chunks: total }
}
