// LORAMER_GOOGLE_DEVICE_BACKFILL_V1 (entity-level family — campaign + ad_group + ad + keyword)
// Device BREADTH backfill writer — Google {campaign, ad_group, ad, keyword} × device (all 4 entity grains, one
// pass). Backfill-only; forward capture lives in cron/sync + cron/catchup (shared builder, src/lib/intelligence/
// google-device.ts → byte-identical). Mirrors google-hour-backfill.ts (stateless-range for rangeLap, monthChunks,
// per-day CAMPAIGN-anchor reconcile FLAG-NOT-BLOCK, idempotent per-grain-per-day upsert).
//
// Device PARTITIONS campaign spend at EVERY entity level (every cost row carries exactly one device), so each
// grain reconciles vs the per-day campaign anchor (Σ over the campaigns present that day). FLAG-NOT-BLOCK: always
// write, record divergence in flagged[] (PMax/edge could diverge at finer grains). Anchor read PER DAY (bounded,
// never the silent 1000-row cap; Lesson 8). Conversions never gate.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import { DEVICE_GRAINS, fetchDeviceGrainWindow, buildDeviceGrainRows, type DeviceRow } from '@/lib/intelligence/google-device'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const CAMP_DAY_CAP = 5000

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
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

export interface DeviceBackfillResult { status: number; body: Record<string, any> }

export async function runGoogleDeviceBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<DeviceBackfillResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).is('deleted_at', null).single() // LORAMER_DELETE_CLIENT_V1 — archived client → no row → no-op
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'google')
  if (!conn) return { status: 400, body: { error: 'Client has no Google connection' } }
  const customerId = conn.account_id as string
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.refresh_token) return { status: 400, body: { error: 'No Google refresh token', detail: tErr?.message } }
  const refreshToken = tok.refresh_token as string

  // PER-DAY campaign-anchor cache (scoped to one date → bounded, never the silent 1000-row cap; Lesson 8).
  const campCache = new Map<string, Record<string, number>>()
  const campDay = async (date: string): Promise<Record<string, number>> => {
    const hit = campCache.get(date)
    if (hit) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('entity_id,spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'campaign')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).limit(CAMP_DAY_CAP)
    const m: Record<string, number> = {}
    for (const r of data || []) m[String((r as any).entity_id)] = fin((r as any).spend)
    campCache.set(date, m)
    return m
  }

  let grainDayRows = 0, written = 0, daysWritten = 0, daysFlagged = 0
  const perGrain: Record<string, { rows: number; daysFlagged: number }> = {}
  const flagged: any[] = []
  const distinctDeviceRaw = new Set<string>()
  let sampleRow: Record<string, unknown> | null = null

  for (const grain of DEVICE_GRAINS) {
    let gRows = 0, gFlagged = 0
    for (const chunk of monthChunks(startDate, endDate)) {
      const rows = await fetchDeviceGrainWindow(grain, refreshToken, customerId, chunk.from, chunk.to)
      const byDate: Record<string, { rows: DeviceRow[]; spend: number; campaignIds: Set<string> }> = {}
      for (const r of rows) {
        distinctDeviceRaw.add(r.deviceRaw)
        if (!byDate[r.date]) byDate[r.date] = { rows: [], spend: 0, campaignIds: new Set() }
        const b = byDate[r.date]
        b.rows.push(r); b.spend += r.spend; if (r.campaignId) b.campaignIds.add(r.campaignId)
      }
      for (const [date, bucket] of Object.entries(byDate)) {
        const built = buildDeviceGrainRows(grain, clientId, userEmail, date, customerId, bucket.rows)
        grainDayRows += built.length; gRows += built.length
        if (built.length === 0) continue
        if (opts.dryRun && !sampleRow) sampleRow = built[0]
        // PER-GRAIN reconcile posture: partition grains (campaign/ad_group/ad) FLAG-NOT-BLOCK vs the per-day
        // campaign anchor; SUBSET grains (keyword — search-only, not a partition) are WRITE-ONLY (skip reconcile).
        if (grain.reconcile) {
          const dayCamp = await campDay(date)
          let anchorSpend = 0, anchorMissing = 0
          for (const cid of bucket.campaignIds) { if (cid in dayCamp) anchorSpend += dayCamp[cid]; else anchorMissing++ }
          const { within: tolWithin, delta } = reconcileDay(bucket.spend, anchorSpend, { posture: 'flag' })
          const within = anchorMissing === 0 && tolWithin
          if (!within) {
            daysFlagged++; gFlagged++
            flagged.push({ grain: grain.entityLevel, date, device_spend: Number(bucket.spend.toFixed(2)), campaign_anchor_spend: Number(anchorSpend.toFixed(2)), delta_vs_campaign: Number(delta.toFixed(2)), anchor_missing_campaigns: anchorMissing })
          }
        }
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(built), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', grain: grain.entityLevel, date, detail: upErr.message, flagged } }
        }
        written += built.length; daysWritten++
      }
    }
    perGrain[grain.entityLevel] = { rows: gRows, daysFlagged: gFlagged }
  }

  return {
    status: 200,
    body: {
      clientId, customerId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      reconcile: 'PER-GRAIN: campaign/ad_group/ad = FLAG-NOT-BLOCK vs per-day campaign anchor (partition); keyword = write-only (search subset)',
      grainDayRows, written, daysWritten, daysFlagged, perGrain, flagged,
      ...(opts.dryRun ? { distinctDeviceRaw: Array.from(distinctDeviceRaw), sampleRow } : {}),
    },
  }
}
