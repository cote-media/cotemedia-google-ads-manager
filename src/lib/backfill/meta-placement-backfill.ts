// LORAMER_META_PLACEMENT_BACKFILL_SLICE2_V1  (+ LORAMER_META_PLACEMENT_ADSET_AD_V1 — grain completion 2026-07-18)
// Meta placement-grain (entity × placement × day) backfill writer — publisher_platform × platform_position.
// Source: Meta insights level=<campaign|adset|ad>, breakdowns=publisher_platform,platform_position, time_increment=1.
// Persists entity_level=<campaign|ad_set|ad>, breakdown_type='placement', breakdown_value='<publisher>:<position>'
// (raw composite — NO hardcoded position list, so new positions land automatically). SPEND/clicks/impressions ONLY —
// Meta does not break conversions out per placement (conversions=0, conversion_value=0, never fabricated).
//
// GRAIN SET = campaign + ad_set + ad (probed 2026-07-18: adset_id/ad_id return alongside placement; Σ partitions the
// entity's spend to 0.00% at both grains). ACCOUNT is NOT captured — it is the clean rollup of campaign (Σ placement
// == account spend to the cent), derive-not-capture. The `levels` opt selects which grains a caller drives:
//   drain 'meta_placement' → ['campaign'] (byte-identical to Slice 2); drain 'meta_placement_adset_ad' + the
//   META_BREADTH_FORWARD 'placement_adset_ad' entry → ['ad_set','ad']. Campaign forward stays in meta-metrics-row.ts.
// RECONCILE = ACCOUNT-level FLAG-NOT-BLOCK on spend (the deep, always-present account×day row is the anchor; Σ
// placement at ANY grain == account spend). ALWAYS write; only RECORD a loud delta — never suppress real placement rows.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import { metaFetchAllPaged } from './meta-graph-paged'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)
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

export type PlacementLevel = 'campaign' | 'ad_set' | 'ad'
interface LevelCfg {
  entity_level: PlacementLevel
  metaLevel: string
  idFields: string
  extract: (ins: any, acctId: string) => { entityId: string; entityName: string; parentId: string }
}
// campaign row shape is byte-identical to Slice 2 (entity_id=campaign_id, parent=account). adset/ad add the deeper grains.
const LEVELS: Record<PlacementLevel, LevelCfg> = {
  campaign: { entity_level: 'campaign', metaLevel: 'campaign', idFields: 'campaign_id,campaign_name',
    extract: (ins, acctId) => ({ entityId: String(ins.campaign_id || ''), entityName: String(ins.campaign_name || ''), parentId: acctId }) },
  ad_set: { entity_level: 'ad_set', metaLevel: 'adset', idFields: 'adset_id,adset_name,campaign_id',
    extract: (ins) => ({ entityId: String(ins.adset_id || ''), entityName: String(ins.adset_name || ''), parentId: String(ins.campaign_id || '') }) },
  ad: { entity_level: 'ad', metaLevel: 'ad', idFields: 'ad_id,ad_name,adset_id',
    extract: (ins) => ({ entityId: String(ins.ad_id || ''), entityName: String(ins.ad_name || ''), parentId: String(ins.adset_id || '') }) },
}

export interface PlacementBackfillResult { status: number; body: Record<string, any> }

export async function runMetaPlacementBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean; levels?: PlacementLevel[] } = {}
): Promise<PlacementBackfillResult> {
  const levels = opts.levels && opts.levels.length ? opts.levels : (['campaign', 'ad_set', 'ad'] as PlacementLevel[])
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'meta')
  if (!conn) return { status: 400, body: { error: 'Client has no Meta connection' } }
  const metaAccountId = conn.account_id as string
  const actId = metaAccountId.startsWith('act_') ? metaAccountId : 'act_' + metaAccountId
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('meta_tokens').select('access_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.access_token) return { status: 400, body: { error: 'No Meta access token', detail: tErr?.message } }
  const token = tok.access_token as string

  const flagged: any[] = []
  let written = 0, daysWritten = 0, placementDayRows = 0, daysFlagged = 0, skippedNoEntity = 0
  const perLevel: Record<string, { rows: number; daysFlagged: number }> = {}
  const sampleRow: Record<string, Record<string, unknown>> = {} // dryRun: first built row per level
  const acctCache = new Map<string, number>() // account base spend per date (reconcile anchor, read once, reused across levels)
  const acctBase = async (date: string): Promise<number> => {
    if (acctCache.has(date)) return acctCache.get(date)!
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('spend')
      .eq('client_id', clientId).eq('platform', 'meta').eq('entity_level', 'account')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
    const v = fin((data as any)?.spend)
    acctCache.set(date, v)
    return v
  }

  for (const lvKey of levels) {
    const level = LEVELS[lvKey]
    perLevel[lvKey] = { rows: 0, daysFlagged: 0 }
    for (const chunk of monthChunks(startDate, endDate)) {
      const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
      const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))
      const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&breakdowns=publisher_platform,platform_position&fields=${level.idFields},spend,clicks,impressions&filtering=${filtering}&limit=500`
      const insights = await metaFetchAllPaged(url, token)

      const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number }> = {}
      for (const ins of insights) {
        const date = ins?.date_start
        if (!date) continue
        const { entityId, entityName, parentId } = level.extract(ins, metaAccountId)
        if (!entityId) { skippedNoEntity++; continue } // no entity id → skip (never a fabricated key)
        const publisher = String(ins.publisher_platform || '').toLowerCase()
        const position = String(ins.platform_position || '').toLowerCase()
        const spend = fin(parseFloat(ins.spend || '0'))
        const clicks = fin(parseInt(ins.clicks || '0'))
        const impressions = fin(parseInt(ins.impressions || '0'))
        if (!byDate[date]) byDate[date] = { rows: [], spend: 0 }
        const b = byDate[date]
        b.spend += spend
        b.rows.push({
          client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
          entity_level: level.entity_level, entity_id: entityId, entity_name: entityName,
          parent_entity_id: parentId, date, breakdown_type: 'placement', breakdown_value: `${publisher}:${position}`,
          spend: Number(spend.toFixed(2)), impressions, clicks, conversions: 0, conversion_value: 0, revenue: 0,
          extra: {
            ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
            publisherPlatform: publisher, platformPosition: position,
          },
        })
      }
      const dayRows = Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
      placementDayRows += dayRows; perLevel[lvKey].rows += dayRows
      if (opts.dryRun && !sampleRow[lvKey]) { const fb = Object.values(byDate).find((d) => d.rows.length > 0); if (fb) sampleRow[lvKey] = fb.rows[0] }

      for (const [date, bucket] of Object.entries(byDate)) {
        const anchor = await acctBase(date)
        const { within, delta } = reconcileDay(bucket.spend, anchor, { posture: 'flag' })
        if (!within) {
          daysFlagged++; perLevel[lvKey].daysFlagged++
          flagged.push({ level: lvKey, date, placement_spend: Number(bucket.spend.toFixed(2)), account_spend: Number(anchor.toFixed(2)), delta: Number(delta.toFixed(2)) })
        }
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', level: lvKey, date, detail: upErr.message, flagged } }
        }
        written += bucket.rows.length; daysWritten++
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun, levels,
      placementDayRows, written, daysWritten, daysFlagged, skippedNoEntity, perLevel, flagged,
      accountQueried: false, // account is derive-not-capture — NEVER queried at the placement grain
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}

// Named grain wrappers (direct references — the drain + META_BREADTH_FORWARD register these, not closures, so the
// meta-breadth-forward guard's imports==registrations parity holds). Campaign = byte-identical to Slice 2.
export function runMetaPlacementCampaignBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<PlacementBackfillResult> {
  return runMetaPlacementBackfill(clientId, startDate, endDate, { ...opts, levels: ['campaign'] })
}
export function runMetaPlacementAdsetAdBackfill(clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}): Promise<PlacementBackfillResult> {
  return runMetaPlacementBackfill(clientId, startDate, endDate, { ...opts, levels: ['ad_set', 'ad'] })
}
