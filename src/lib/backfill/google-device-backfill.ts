// LORAMER_GOOGLE_DEVICE_BACKFILL_V1
// First BREADTH dimension writer (Phase 2) — Google campaign × device × day persisted into metrics_daily as
// BREAKDOWN rows: entity_level='campaign', breakdown_type='device', breakdown_value=<canonical device enum
// name>, entity_id=campaign.id, parent_entity_id=customerId.
//
// The fetch + row builder live in the SHARED module src/lib/intelligence/google-device.ts (fetchGoogleDeviceWindow
// + buildGoogleDeviceRows) so forward capture (cron/sync + cron/catchup) and this backfill write BYTE-IDENTICAL
// rows (the universal backfill pattern). This file owns ONLY the backfill control flow: month chunking,
// stateless-range signature (for drain-registry rangeLap), the per-day CAMPAIGN-anchor reconcile, and the
// idempotent UPSERT.
//
// RECONCILE = FLAG-NOT-BLOCK vs the per-day CAMPAIGN anchor (Lesson 59 posture; mirrors google-adgroup-ad /
// Meta-placement): Σ device spend over the campaigns present that day vs Σ their campaign-grain spend. Device
// SHOULD sum to the campaign total, but PMax/UNKNOWN coverage gaps can diverge → ALWAYS write, record a loud
// delta in flagged[]. Anchor read PER DAY (scoped to one date → bounded, never supabase-js's silent 1000-row
// cap that collapsed the anchor for high-campaign clients; Lesson 8). Conversions never gate.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import { fetchGoogleDeviceWindow, buildGoogleDeviceRows, type GoogleDeviceRow } from '@/lib/intelligence/google-device'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const CAMP_DAY_CAP = 5000 // one day's campaign rows are ≤ a few hundred; explicit guard, never near this

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

  // PER-DAY campaign-anchor cache (scoped to one date → bounded, never the silent 1000-row cap; Lesson 8).
  const campCache = new Map<string, Record<string, number>>()
  const acctCache = new Map<string, number>()
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
  const acctDay = async (date: string): Promise<number> => {
    const hit = acctCache.get(date)
    if (hit !== undefined) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'account')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
    const v = fin((data as any)?.spend)
    acctCache.set(date, v)
    return v
  }

  let grainDayRows = 0, written = 0, daysWritten = 0, daysFlagged = 0
  const flagged: any[] = []
  const distinctDeviceRaw = new Set<string>() // dryRun diagnostic — the actual enum forms Google returns
  let sampleRow: Record<string, unknown> | null = null

  for (const chunk of monthChunks(startDate, endDate)) {
    const rows = await fetchGoogleDeviceWindow(refreshToken, customerId, chunk.from, chunk.to)

    // Bucket the shared-fetched rows by date; track per-day Σspend + campaigns present for the reconcile.
    const byDate: Record<string, { rows: GoogleDeviceRow[]; spend: number; campaignIds: Set<string> }> = {}
    for (const r of rows) {
      distinctDeviceRaw.add(r.deviceRaw)
      if (!byDate[r.date]) byDate[r.date] = { rows: [], spend: 0, campaignIds: new Set() }
      const b = byDate[r.date]
      b.rows.push(r)
      b.spend += r.spend
      b.campaignIds.add(r.campaignId)
    }

    for (const [date, bucket] of Object.entries(byDate)) {
      const dayRows = buildGoogleDeviceRows(clientId, userEmail, date, customerId, bucket.rows)
      grainDayRows += dayRows.length
      if (dayRows.length === 0) continue
      if (opts.dryRun && !sampleRow) sampleRow = dayRows[0]

      // FLAG-NOT-BLOCK reconcile vs the per-day campaign anchor (Σ over the campaigns present this day).
      const dayCamp = await campDay(date)
      let anchorSpend = 0, anchorMissing = 0
      for (const cid of bucket.campaignIds) {
        if (cid in dayCamp) anchorSpend += dayCamp[cid]
        else anchorMissing++
      }
      const { within: tolWithin, delta } = reconcileDay(bucket.spend, anchorSpend, { posture: 'flag' })
      const within = anchorMissing === 0 && tolWithin
      if (!within) {
        daysFlagged++
        flagged.push({
          date,
          device_spend: Number(bucket.spend.toFixed(2)),
          campaign_anchor_spend: Number(anchorSpend.toFixed(2)),
          delta_vs_campaign: Number(delta.toFixed(2)),
          anchor_missing_campaigns: anchorMissing,
          ...(opts.dryRun ? { account_spend: Number((await acctDay(date)).toFixed(2)) } : {}),
        })
      }
      if (!opts.dryRun) {
        const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(dayRows), { onConflict: CONFLICT })
        if (upErr) return { status: 500, body: { error: 'upsert failed', date, detail: upErr.message, flagged } }
      }
      written += dayRows.length; daysWritten++
    }
  }

  return {
    status: 200,
    body: {
      clientId, customerId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      grainDayRows, written, daysWritten, daysFlagged,
      flagged,
      ...(opts.dryRun ? { distinctDeviceRaw: Array.from(distinctDeviceRaw), sampleRow } : {}),
    },
  }
}
