// LORAMER_META_BATCH_MG_V1 (M-γ) — SHARED ENGINE for single-value Meta breadth families. Deliberately named
// without the `-backfill` suffix: the meta-breadth-forward guard resolves every `./meta-*-backfill` module the
// forward list imports and reads the breakdown_types IT emits, so one module per family is the contract. This
// file holds the machinery; each family gets its own thin writer module carrying its own literal
// breakdown_type. The guard caught the first attempt (one shared module, three runners) — conforming to the
// convention beat relaxing the check.
// Three single-value Meta breadth families share this shape,
// exactly as meta-device-backfill drives two fields and meta-age-gender drives three from a FieldCfg array.
// Cloned from meta-geo-backfill (the proven breadth shape: metaFetchAllPaged guard 200, monthChunks,
// time_increment=1, spend>0 filtering, per-day reconcile FLAG-NOT-BLOCK, floor36 handled by the drain).
//
//   product_id       — catalog / Advantage+ shopping grain. breakdowns=product_id.
//   comscore_market  — the forward-only replacement for `dma`, which Meta REMOVED API-wide.
//   frequency_value  — how many times a person saw the ad, bucketed by Meta.
//
// ⚠ THE RECONCILE ANCHOR IS NOT THE SAME FOR ALL THREE, and getting this wrong is how a family flags every
// account every day until someone stops reading the flags:
//   frequency_value PARTITIONS EVERYTHING — every impression has a frequency — so it reconciles against the
//     ACCOUNT×day spend anchor like geo/device.
//   product_id and comscore_market are PARTIAL BY NATURE. product_id exists only for catalog/Advantage+
//     campaigns; comscore_market only for comScore-MEASURED accounts. Anchoring either to total account
//     spend guarantees a daily false flag on every account that has any non-catalog / non-measured spend —
//     which is most of them. They reconcile against the CAMPAIGNS PRESENT IN THE BREAKDOWN, the same
//     approach google-demographic uses for PMax-less campaigns.
//   Because "campaigns present" is undefined at the ACCOUNT grain (there is no campaign to scope to, and the
//     account number would be a strict subset of account spend), those two families run at
//     campaign+ad_set+ad only. Account is DERIVE-NOT-CAPTURE — the clean rollup of campaign — exactly the
//     posture meta placement already documents. 3 grains IS complete for them; 4 for frequency_value.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { metaFetchAllPaged } from './meta-graph-paged'
import { reconcileDay } from './reconcile-day'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)

function monthChunks(start: string, end: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  let cur = start
  while (cur <= end) {
    const d = new Date(cur + 'T00:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + 1)
    d.setUTCDate(d.getUTCDate() - 1)
    const to = d.toISOString().split('T')[0]
    out.push({ from: cur, to: to > end ? end : to })
    const n = new Date((to > end ? end : to) + 'T00:00:00Z')
    n.setUTCDate(n.getUTCDate() + 1)
    cur = n.toISOString().split('T')[0]
  }
  return out
}

interface LevelCfg {
  entity_level: 'account' | 'campaign' | 'ad_set' | 'ad'
  metaLevel: 'account' | 'campaign' | 'adset' | 'ad'
  idFields: string
  extract: (ins: any, acctId: string, acctName: string) => { entityId: string; entityName: string; parentId: string }
}
// campaign_id is requested at EVERY level because the campaigns-present anchor needs it even at ad grain.
const LEVELS: LevelCfg[] = [
  { entity_level: 'account', metaLevel: 'account', idFields: '',
    extract: (_i, acctId, acctName) => ({ entityId: acctId, entityName: acctName || acctId, parentId: '' }) },
  { entity_level: 'campaign', metaLevel: 'campaign', idFields: 'campaign_id,campaign_name',
    extract: (i, acctId) => ({ entityId: String(i.campaign_id || ''), entityName: String(i.campaign_name || ''), parentId: acctId }) },
  { entity_level: 'ad_set', metaLevel: 'adset', idFields: 'adset_id,adset_name,campaign_id',
    extract: (i) => ({ entityId: String(i.adset_id || ''), entityName: String(i.adset_name || ''), parentId: String(i.campaign_id || '') }) },
  { entity_level: 'ad', metaLevel: 'ad', idFields: 'ad_id,ad_name,adset_id,campaign_id',
    extract: (i) => ({ entityId: String(i.ad_id || ''), entityName: String(i.ad_name || ''), parentId: String(i.adset_id || '') }) },
]

type AnchorMode = 'account' | 'campaigns_present' | 'none'
export interface FieldCfg {
  breakdown_type: string
  metaBreakdown: string
  anchor: AnchorMode
  levels: LevelCfg['entity_level'][]
  emptyMeans: string // what a ZERO-row result actually means — surfaced in the result body, never as "failure"
}

export interface SimpleBreakdownResult { status: number; body: Record<string, any> }

export async function runSimpleBreakdown(
  field: FieldCfg, clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<SimpleBreakdownResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).is('deleted_at', null).single()
  if (cErr || !clientRow) return { status: 404, body: { error: 'Client not found', detail: cErr?.message } }
  const conn = (clientRow.platform_connections || []).find((c: any) => c.platform === 'meta')
  if (!conn) return { status: 400, body: { error: 'Client has no Meta connection' } }
  const metaAccountId = conn.account_id as string
  const actId = metaAccountId.startsWith('act_') ? metaAccountId : 'act_' + metaAccountId
  const acctName = String(conn.account_name || '')
  const userEmail = (conn.user_email || clientRow.user_email) as string
  const { data: tok, error: tErr } = await supabaseAdmin
    .from('meta_tokens').select('access_token').eq('user_email', userEmail).single()
  if (tErr || !tok?.access_token) return { status: 400, body: { error: 'No Meta access token', detail: tErr?.message } }
  const token = tok.access_token as string

  // ACCOUNT×day spend anchor (frequency_value).
  const acctCache = new Map<string, number>()
  const acctDay = async (date: string): Promise<number> => {
    const hit = acctCache.get(date)
    if (hit !== undefined) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('spend')
      .eq('client_id', clientId).eq('platform', 'meta').eq('entity_level', 'account')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
    const v = fin((data as any)?.spend)
    acctCache.set(date, v)
    return v
  }
  // CAMPAIGNS-PRESENT anchor (product_id, comscore_market): Σ campaign-grain base spend for exactly the
  // campaigns that appear in this day's breakdown. Campaigns with no rows in the breakdown are EXCLUDED from
  // the anchor rather than counted as a shortfall — that is the whole point.
  const campCache = new Map<string, number>()
  const campaignsPresentSpend = async (date: string, campaignIds: string[]): Promise<number> => {
    const ids = [...new Set(campaignIds.filter(Boolean))].sort()
    if (!ids.length) return 0
    const k = `${date}|${ids.join(',')}`
    const hit = campCache.get(k)
    if (hit !== undefined) return hit
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('spend')
      .eq('client_id', clientId).eq('platform', 'meta').eq('entity_level', 'campaign')
      .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).in('entity_id', ids)
    const v = (data || []).reduce((s: number, r: any) => s + fin(r.spend), 0)
    campCache.set(k, v)
    return v
  }

  const combos: Record<string, { entity_level: string; rows: number; daysWritten: number; daysFlagged: number; anchorSum: number; famSum: number }> = {}
  const comboOf = (l: string) => (combos[l] ||= { entity_level: l, rows: 0, daysWritten: 0, daysFlagged: 0, anchorSum: 0, famSum: 0 })
  const flagged: any[] = []
  const sampleRow: Record<string, unknown> = {}
  let written = 0
  const levels = LEVELS.filter((l) => field.levels.includes(l.entity_level))

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))
    for (const level of levels) {
      const combo = comboOf(level.entity_level)
      const idSel = level.idFields ? level.idFields + ',' : ''
      const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&breakdowns=${field.metaBreakdown}&fields=${idSel}spend,clicks,impressions&filtering=${filtering}&limit=500`
      const insights = await metaFetchAllPaged(url, token, { guard: 200 })

      const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number; campaignIds: string[] }> = {}
      for (const ins of insights) {
        const date = ins?.date_start
        if (!date) continue
        const { entityId, entityName, parentId } = level.extract(ins, metaAccountId, acctName)
        if (!entityId) continue // unkeyable → skip, never a fabricated key
        const raw = ins[field.metaBreakdown]
        // Meta serves these as scalars. Missing → 'UNKNOWN' so the row is never silently dropped out of a
        // partition it belongs to (the sales_channel/geo rule).
        const value = raw == null || String(raw).trim() === '' ? 'UNKNOWN' : String(raw).trim()
        const spend = fin(parseFloat(ins.spend || '0'))
        const clicks = fin(parseInt(ins.clicks || '0'))
        const impressions = fin(parseInt(ins.impressions || '0'))
        const b = (byDate[date] ||= { rows: [], spend: 0, campaignIds: [] })
        b.spend += spend
        if (ins.campaign_id) b.campaignIds.push(String(ins.campaign_id))
        b.rows.push({
          client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
          entity_level: level.entity_level, entity_id: entityId, entity_name: entityName,
          parent_entity_id: parentId, date, breakdown_type: field.breakdown_type, breakdown_value: value,
          spend: Number(spend.toFixed(2)), impressions, clicks, conversions: 0, conversion_value: 0, revenue: 0,
          extra: {
            ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
            metaBreakdown: field.metaBreakdown, anchorMode: field.anchor,
          },
        })
      }
      combo.rows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
      if (opts.dryRun && !sampleRow[level.entity_level]) {
        const fb = Object.values(byDate).find((d) => d.rows.length > 0)
        if (fb) sampleRow[level.entity_level] = fb.rows[0]
      }

      for (const [date, bucket] of Object.entries(byDate)) {
        // WRITE-ONLY families skip reconcile entirely — no anchor, no flags, by design.
        if (field.anchor === 'none') {
          if (!opts.dryRun) {
            const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
            if (upErr) return { status: 500, body: { error: 'upsert failed', entity_level: level.entity_level, breakdown_type: field.breakdown_type, date, detail: upErr.message } }
          }
          written += bucket.rows.length
          combo.daysWritten++
          continue
        }
        const anchor = field.anchor === 'account' ? await acctDay(date) : await campaignsPresentSpend(date, bucket.campaignIds)
        const { within, delta } = reconcileDay(bucket.spend, anchor, { posture: 'flag' })
        combo.anchorSum += anchor
        combo.famSum += bucket.spend
        if (!within) {
          combo.daysFlagged++
          flagged.push({
            entity_level: level.entity_level, breakdown_type: field.breakdown_type, date,
            family_spend: Number(bucket.spend.toFixed(2)), anchor_spend: Number(anchor.toFixed(2)),
            anchor_mode: field.anchor, delta: Number(delta.toFixed(2)),
          })
        }
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', entity_level: level.entity_level, breakdown_type: field.breakdown_type, date, detail: upErr.message, flagged } }
        }
        written += bucket.rows.length
        combo.daysWritten++
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, breakdown_type: field.breakdown_type, range: `${startDate}→${endDate}`,
      dryRun: !!opts.dryRun, written,
      anchorMode: field.anchor,
      // EMPTY IS AN ANSWER, NOT A FAILURE. Surfaced in the body so a zero-row lap reads as the fact it is.
      ...(written === 0 ? { emptyMeans: field.emptyMeans } : {}),
      reconcile: Object.values(combos).map((c) => ({
        entity_level: c.entity_level, rows: c.rows, daysWritten: c.daysWritten, daysFlagged: c.daysFlagged,
        anchorSum: Number(c.anchorSum.toFixed(2)), famSum: Number(c.famSum.toFixed(2)),
        delta: Number((c.famSum - c.anchorSum).toFixed(2)),
      })),
      daysFlagged: flagged.length, flagged,
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}

