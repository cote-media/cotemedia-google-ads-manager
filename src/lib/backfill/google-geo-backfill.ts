// LORAMER_GOOGLE_GEO_BACKFILL_V1 (full family — rebuilt)
// Geo BREADTH backfill writers. TWO family writers (one per resource) so the drain registers TWO steps:
//   runGoogleGeoBackfill      → geographic_view grains (10: 9 segments + country)  → drain step 'google_geo'
//   runGoogleUserGeoBackfill  → user_location_view grains (9 segments)             → drain step 'google_user_geo'
//
// Each loops its grains, runs ONE GAQL per grain over the [startDate,endDate] window (per-grain is REQUIRED —
// co-selecting segments returns the intersection and under-captures), buckets by date, builds via the shared
// builder, and idempotently upserts. NO RECONCILE (geo is non-partitioning — location_type overlap + multi-grain;
// write-only like search_term/keyword). NO LIMIT cap. Conversions never gate. Stateless-range (rangeLap-shaped).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { GEOGRAPHIC_GRAINS, USER_GRAINS, fetchGeoGrainWindow, buildGeoGrainRows, type GeoGrain, type GeoRow } from '@/lib/intelligence/google-geo'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

// Bound each per-grain fetch to ~1-month sub-windows (matches google-campaign / google-adgroup-ad / google-device
// chunking) → peak rows-in-memory = one month of one grain, NOT a full year of one grain. month-chunks are
// date-disjoint, so per-chunk processing yields BYTE-IDENTICAL rows to a single full-window fetch. The drain's
// rangeLap still owns the cursor/complete (stateless-range); this writer only sub-chunks within the given window.
const iso = (d: Date) => d.toISOString().split('T')[0]
function monthChunks(start: string, end: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = []
  let cur = start
  while (cur <= end) {
    const d = new Date(cur + 'T00:00:00Z')
    const mEnd = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
    const to = mEnd < end ? mEnd : end
    chunks.push({ from: cur, to })
    const next = new Date(to + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); cur = iso(next)
  }
  return chunks
}

export interface GeoBackfillResult { status: number; body: Record<string, any> }

async function runGeoFamily(
  clientId: string, grains: GeoGrain[], startDate: string, endDate: string, opts: { dryRun?: boolean }
): Promise<GeoBackfillResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'google')
  if (!conn) return { status: 400, body: { error: 'Client has no Google connection' } }
  const customerId = conn.account_id as string
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.refresh_token) return { status: 400, body: { error: 'No Google refresh token', detail: tErr?.message } }
  const refreshToken = tok.refresh_token as string

  let grainDayRows = 0, written = 0, daysWritten = 0
  const perGrain: Record<string, { rows: number; days: number }> = {}
  const distinctValuesSample = new Set<string>() // dryRun diagnostic — confirm encoding per grain
  let sampleRow: Record<string, unknown> | null = null

  for (const grain of grains) {
    let gRows = 0, gDays = 0
    for (const chunk of monthChunks(startDate, endDate)) {
      const rows = await fetchGeoGrainWindow(grain, refreshToken, customerId, chunk.from, chunk.to)
      const byDate: Record<string, GeoRow[]> = {}
      for (const r of rows) { (byDate[r.date] ||= []).push(r) }
      for (const [date, dayRows] of Object.entries(byDate)) {
        const built = buildGeoGrainRows(grain, clientId, userEmail, date, customerId, dayRows)
        grainDayRows += built.length; gRows += built.length
        if (built.length === 0) continue
        if (opts.dryRun) {
          if (!sampleRow) sampleRow = built[0]
          for (const b of built) { if (distinctValuesSample.size < 60) distinctValuesSample.add(`${grain.breakdownType}=${String((b as any).breakdown_value)}`) }
        }
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(built), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', grain: grain.breakdownType, date, detail: upErr.message } }
        }
        written += built.length; daysWritten++; gDays++
      }
    }
    perGrain[grain.breakdownType] = { rows: gRows, days: gDays }
  }

  return {
    status: 200,
    body: {
      clientId, customerId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      reconcile: 'NONE (write-only; geo is non-partitioning — location_type overlap + multi-grain)',
      grainCount: grains.length, queriesPerLap: grains.length, grainDayRows, written, daysWritten, perGrain,
      ...(opts.dryRun ? { distinctValuesSample: Array.from(distinctValuesSample), sampleRow } : {}),
    },
  }
}

// geographic_view family (targeted/interest; grains carry location_type) — drain step 'google_geo'.
export async function runGoogleGeoBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<GeoBackfillResult> {
  return runGeoFamily(clientId, GEOGRAPHIC_GRAINS, startDate, endDate, opts)
}
// user_location_view family (physical; no location_type) — drain step 'google_user_geo'.
export async function runGoogleUserGeoBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<GeoBackfillResult> {
  return runGeoFamily(clientId, USER_GRAINS, startDate, endDate, opts)
}
