// LORAMER_METRICS_NORMALIZE_V1
// Write-boundary guard. Every NOT-NULL numeric metrics_daily column must be a FINITE number.
// Platforms can yield null/undefined/NaN (e.g. Meta parseFloat -> NaN, which JSON-serializes to
// null and 23502-rejects the whole row, silently dropping it). Coerce any PRESENT-but-non-finite
// numeric to 0. No-op on valid finite numbers. Number.isFinite catches NaN where ?? could not.
//
// LORAMER_METRICS_NORMALIZE_UNION_V1 — THE CORRECTION. The line that used to live here said
// "Omitted keys are left alone (DB default applies — preserves builder behavior)". THAT IS FALSE
// FOR A BULK WRITE, and the false belief is what let a live defect through: PostgREST builds ONE
// column list from the UNION of keys across the whole payload array, and any object missing a key
// that ANOTHER object supplies is sent as an explicit NULL — NOT the column DEFAULT. So a single
// row omitting `conversions` while its siblings set it 23502-rejects the ENTIRE statement.
// MEASURED IN PRODUCTION, 2026-07-26/27: the Shopify depth upsert failed every night on exactly
// this — 32 rejections naming "conversions" (product_type / product_vendor rows) and 16 naming
// "spend" (product rows, on days whose payload also carried a discount/abandoned row that DID set
// spend). Four stores, zero depth rows written, cron 200, every gate green.
//
// THE FIX IS UNION-SCOPED ON PURPOSE, not "always set all six". Filling a column that is absent
// from the ENTIRE payload would ADD it to the column list, and on a merge-duplicates upsert that
// converts a column the writer deliberately left untouched into one that is overwritten with 0 on
// every conflict. Filling ONLY within the payload's existing union changes no column list, alters
// no update semantics for any payload that is already uniform, and closes the defect exactly.
const METRIC_NUMERIC_NOT_NULL = ['spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'revenue'] as const
export function normalizeMetricsRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  // The union PostgREST will send as the column list, restricted to the NOT-NULL numerics.
  const union: string[] = []
  for (const c of METRIC_NUMERIC_NOT_NULL) {
    if (rows.some((r) => c in r)) union.push(c)
  }
  for (const r of rows) {
    for (const c of union) {
      const v = r[c]
      // absent → 0 (would otherwise be sent as explicit NULL); present-but-non-finite → 0 (the original guard).
      if (!(c in r) || typeof v !== 'number' || !Number.isFinite(v)) r[c] = 0
    }
  }
  return rows
}
