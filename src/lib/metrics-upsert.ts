// LORAMER_METRICS_UPSERT_CHUNKED_V1 — the ONE chunked writer for metrics_daily.
//
// WHY THIS EXISTS. A single supabase-js `.upsert(array)` is ONE Postgres statement, and on a slice that is
// ALREADY POPULATED every row in that array is a CONFLICT — i.e. an UPDATE, not an insert. Postgres writes a
// new heap tuple per updated row and then locates every one of them in the unique conflict-key index first.
//
// ⛔ THE SIZES ARE NOT WRITTEN HERE, ON PURPOSE (LORAMER_DOCS_NEVER_RESTATE_LIVE_STATE_V1). This block used to
// state "SIX indexes totalling ~14 GB against a ~16 GB heap" and "the 8.2 GB unique conflict-key index"; all
// three had drifted low by 2026-08-02 and a number in a comment is a snapshot with a shelf life. WRITE THE
// READ INSTEAD — index inventory and sizes: `select pg_size_pretty(pg_relation_size(i.oid)), pg_get_indexdef(
// i.oid) from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class t on t.oid=x.indrelid where
// t.relname='metrics_daily' order by pg_relation_size(i.oid) desc;` — heap/index/total via
// pg_relation_size / pg_indexes_size / pg_total_relation_size on the same relation. A dated snapshot of all
// of it lives in LORAMER_DECISIONS.md → LORAMER_COMPUTE_BASELINE_2026_08_02_V1, tense-locked and re-measurable.
//
// ⛔ WHY IT IS EXPENSIVE — CORRECTED 2026-08-02, THE PREVIOUS MECHANISM HERE WAS REFUTED BY MEASUREMENT.
// This block used to claim: "`spend`/`revenue` are INCLUDE columns on idx_metrics_daily_account_canonical, so
// an update touching them defeats HOT and forces full index maintenance per row." That is FALSE for the rows
// it was invoked to explain, three ways: (1) that index is PARTIAL on entity_level='account' AND
// breakdown_type='' AND breakdown_value='', so a geo row (entity_level='campaign',
// breakdown_type='user_geo_city') is NOT IN IT AT ALL; (2) the table measured 87.56% HOT
// (n_tup_hot_upd/n_tup_upd), i.e. index maintenance is being AVOIDED on ~7 of 8 updates; (3) that index is
// ~3 MB against a multi-GB index set and cannot drive an 8s statement. Re-derive any of it with
// `select n_tup_upd, n_tup_hot_upd from pg_stat_user_tables where relname='metrics_daily';`.
//
// THE MEASURED CAUSE IS COLD-CACHE PHYSICAL I/O against a working set far larger than shared_buffers. Proven
// by controlled repetition on one slice, identical plan and identical rows, cold vs warm: ~150x. The upsert
// must locate 1000 scattered keys in a unique index whose pages are, by the cache-to-object ratio, almost
// never resident. Ratio and timings: the DECISIONS entry above; do not copy them here.
// ⛔ NOT A MISSING INDEX, and do NOT "fix" this by adding one — the planner already SEEKS on
// idx_metrics_daily_client_platform_bt_level_date with every filtered column in the Index Cond. A further
// index adds write cost and cache pressure and removes no scan. (Distinguish this from LORAMER_BREAKDOWN_
// INDEX_V1 / 71c2ca5, which WAS a missing-index read fix on a different query shape.)
//
// The remedy in every published source for an over-long upsert is to REDUCE THE BATCH so one statement fits
// the timeout — never to raise the timeout, which is separately forbidden here (LIVE statement_timeout is 8s
// via the PostgREST `authenticator` role; the 120s figure is visible only to MCP/superuser sessions).
// ⚠ Cited for context, NOT as this table's diagnosis: an "overwrite" batch of 10,000 rows measured ~281x the
// same batch as pure inserts (Datadog, "When upserts don't update but still write"). Our own measurement
// locates the dominant cost in I/O residency rather than in index maintenance — see the correction above.
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
