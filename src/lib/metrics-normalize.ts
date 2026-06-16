// LORAMER_METRICS_NORMALIZE_V1
// Write-boundary guard. Every NOT-NULL numeric metrics_daily column must be a FINITE number.
// Platforms can yield null/undefined/NaN (e.g. Meta parseFloat -> NaN, which JSON-serializes to
// null and 23502-rejects the whole row, silently dropping it). Coerce any PRESENT-but-non-finite
// numeric to 0. Omitted keys are left alone (DB default applies — preserves builder behavior).
// No-op on valid finite numbers. Number.isFinite catches NaN where ?? could not.
const METRIC_NUMERIC_NOT_NULL = ['spend','impressions','clicks','conversions','conversion_value','revenue'] as const
export function normalizeMetricsRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  for (const r of rows) {
    for (const c of METRIC_NUMERIC_NOT_NULL) {
      if (c in r) {
        const v = r[c]
        if (typeof v !== 'number' || !Number.isFinite(v)) r[c] = 0
      }
    }
  }
  return rows
}
