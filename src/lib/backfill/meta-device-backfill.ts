// LORAMER_META_DEVICE_BACKFILL_V1
// Meta device-BREADTH backfill writer (NEW, backfill-only — does NOT touch forward capture). The FIRST Meta
// breadth writer. Mirrors src/lib/backfill/meta-placement-backfill.ts (breakdown writer; spend/clicks/impr only,
// conversions=0, account-anchor FLAG-NOT-BLOCK) + the multi-entity-level config shape of meta-adset-ad-backfill.ts.
//
// CAPTURES BOTH Meta device dimensions as TWO SEPARATE breakdown_type families (each a clean partition; NEVER summed):
//   breakdown_type='device'          ← Meta breakdowns=impression_device  (values lowercased verbatim:
//                                       iphone / android_smartphone / ipad / android_tablet / desktop / other)
//   breakdown_type='device_platform' ← Meta breakdowns=device_platform    (desktop / mobile_app / mobile_web / unknown)
// across FOUR entity levels {account, campaign, ad_set, ad} — Meta serves device at all four (probe-proven 2026-06-28
// on Escential: every level × both fields returned device-split data). Native repo terms ad_set/ad per meta-adset-ad.
//
// RECONCILE = SPEND-only FLAG-NOT-BLOCK vs the account×day anchor (entity_level='account', breakdown_type=''),
// read via .maybeSingle() (one row/day → NO silent 1000-row cap). Device PARTITIONS spend EXACTLY at every level
// (Σ device == account to the penny — probe-proven), so divergence = stale-anchor restatement noise, flagged-but-
// written, never blocking. CONVERSIONS are a SEPARATE grain (Meta account-level dedup, L58) → NEVER reconciled;
// conversions=conversion_value=0, never fabricated (Meta does not attribute conversions cleanly per device here).
//
// FLOOR: Meta breakdown retention is ~13mo (NOT the 37mo aggregate floor; L61). This writer is stateless-range —
// it processes the [startDate,endDate] window it is handed; the ~13mo floor-clamp lives in the drain wiring (NEXT
// step: a ~13mo rangeLap floor, NOT floor36). Past the breakdown floor Meta returns empty → empty-success at floor.
//
// REUSE: metaFetchAllPaged (full pagination — the forward limit=100 truncates the ad tail; L) + reconcileDay.
// NO schema change — rides the existing (breakdown_type, breakdown_value) 7-col key.
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

// Entity-level configs (native repo terms ad_set/ad per meta-adset-ad-backfill.ts). At account level the insights
// report carries NO entity id → entity_id = the account id (matches the forward account-grain row's entity_id).
interface LevelCfg {
  entity_level: 'account' | 'campaign' | 'ad_set' | 'ad'
  metaLevel: string
  idFields: string
  extract: (ins: any, acctId: string, acctName: string) => { entityId: string; entityName: string; parentId: string }
}
const LEVELS: LevelCfg[] = [
  { entity_level: 'account', metaLevel: 'account', idFields: '',
    extract: (_ins, acctId, acctName) => ({ entityId: acctId, entityName: acctName, parentId: '' }) },
  { entity_level: 'campaign', metaLevel: 'campaign', idFields: 'campaign_id,campaign_name',
    extract: (ins, acctId) => ({ entityId: String(ins.campaign_id || ''), entityName: String(ins.campaign_name || ''), parentId: acctId }) },
  { entity_level: 'ad_set', metaLevel: 'adset', idFields: 'adset_id,adset_name,campaign_id',
    extract: (ins) => ({ entityId: String(ins.adset_id || ''), entityName: String(ins.adset_name || ''), parentId: String(ins.campaign_id || '') }) },
  { entity_level: 'ad', metaLevel: 'ad', idFields: 'ad_id,ad_name,adset_id',
    extract: (ins) => ({ entityId: String(ins.ad_id || ''), entityName: String(ins.ad_name || ''), parentId: String(ins.adset_id || '') }) },
]

// The two device dimensions Meta serves — captured SEPARATELY (each its own partition; NEVER summed together).
interface FieldCfg { breakdown_type: 'device' | 'device_platform'; metaBreakdown: string; extract: (ins: any) => string }
const FIELDS: FieldCfg[] = [
  { breakdown_type: 'device', metaBreakdown: 'impression_device', extract: (ins) => String(ins.impression_device || '').toLowerCase() },
  { breakdown_type: 'device_platform', metaBreakdown: 'device_platform', extract: (ins) => String(ins.device_platform || '').toLowerCase() },
]

interface ComboStat {
  entity_level: string; breakdown_type: string
  rows: number; daysWritten: number; daysFlagged: number; anchorSum: number; deviceSum: number
}

export interface DeviceBackfillResult { status: number; body: Record<string, any> }

export async function runMetaDeviceBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<DeviceBackfillResult> {
  const { data: clientRow, error: cErr } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
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

  // PER-DAY account-spend anchor cache (.maybeSingle → one row/day, no bulk query → no silent 1000-row cap).
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

  const combos: Record<string, ComboStat> = {}
  const comboOf = (l: string, b: string): ComboStat => {
    const k = `${l}|${b}`
    if (!combos[k]) combos[k] = { entity_level: l, breakdown_type: b, rows: 0, daysWritten: 0, daysFlagged: 0, anchorSum: 0, deviceSum: 0 }
    return combos[k]
  }
  const flagged: any[] = []
  const sampleRow: Record<string, unknown> = {} // dryRun diagnostic: first built row per breakdown_type
  let written = 0

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))

    for (const level of LEVELS) {
      const idSel = level.idFields ? level.idFields + ',' : ''
      for (const field of FIELDS) {
        const combo = comboOf(level.entity_level, field.breakdown_type)
        // breakdowns in &breakdowns= (NOT &fields=, L12). Full pagination via metaFetchAllPaged (guard 200).
        const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&breakdowns=${field.metaBreakdown}&fields=${idSel}spend,clicks,impressions&filtering=${filtering}&limit=500`
        const insights = await metaFetchAllPaged(url, token, { guard: 200 })

        const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number }> = {}
        for (const ins of insights) {
          const date = ins?.date_start // time_increment=1 → one day per row
          if (!date) continue
          const { entityId, entityName, parentId } = level.extract(ins, metaAccountId, acctName)
          if (!entityId) continue // fail-safe: a row with no entity id is unkeyable — skip (never a fabricated key)
          const deviceValue = field.extract(ins)
          const spend = fin(parseFloat(ins.spend || '0'))
          const clicks = fin(parseInt(ins.clicks || '0'))
          const impressions = fin(parseInt(ins.impressions || '0'))
          if (!byDate[date]) byDate[date] = { rows: [], spend: 0 }
          const b = byDate[date]
          b.spend += spend
          b.rows.push({
            client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
            entity_level: level.entity_level, entity_id: entityId, entity_name: entityName,
            parent_entity_id: parentId, date, breakdown_type: field.breakdown_type, breakdown_value: deviceValue,
            spend: Number(spend.toFixed(2)), impressions, clicks, conversions: 0, conversion_value: 0, revenue: 0,
            extra: {
              ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
              deviceField: field.metaBreakdown,
            },
          })
        }
        combo.rows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
        if (opts.dryRun && !sampleRow[field.breakdown_type]) {
          const fb = Object.values(byDate).find((d) => d.rows.length > 0)
          if (fb) sampleRow[field.breakdown_type] = fb.rows[0]
        }

        for (const [date, bucket] of Object.entries(byDate)) {
          // RECONCILE = ACCOUNT level, SPEND only, FLAG-NOT-BLOCK. Σ(device spend) at THIS level for THIS day
          // must equal the account×day anchor (device is a true partition at every level). Always write; only
          // record a loud delta when divergent (stale-anchor restatement noise). Conversions NEVER reconciled.
          const acctSpend = await acctDay(date)
          const { within, delta } = reconcileDay(bucket.spend, acctSpend, { posture: 'flag' })
          combo.anchorSum += acctSpend
          combo.deviceSum += bucket.spend
          if (!within) {
            combo.daysFlagged++
            flagged.push({
              entity_level: level.entity_level, breakdown_type: field.breakdown_type, date,
              device_spend: Number(bucket.spend.toFixed(2)), account_spend: Number(acctSpend.toFixed(2)), delta: Number(delta.toFixed(2)),
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
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      written,
      reconcile: Object.values(combos).map((c) => ({
        entity_level: c.entity_level, breakdown_type: c.breakdown_type,
        rows: c.rows, daysWritten: c.daysWritten, daysFlagged: c.daysFlagged,
        anchorSum: Number(c.anchorSum.toFixed(2)), deviceSum: Number(c.deviceSum.toFixed(2)),
        delta: Number((c.deviceSum - c.anchorSum).toFixed(2)),
      })),
      daysFlagged: flagged.length, flagged,
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
