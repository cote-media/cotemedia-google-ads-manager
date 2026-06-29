// LORAMER_META_ACTION_TYPE_TAXONOMY_V1 (T1.1)
// Meta FULL conversion/action-taxonomy backfill writer (NEW; backfill-only, the drain runs it forward AND backward).
// Captures the ENTIRE per-action taxonomy Meta returns in every insights call — NOT the ~5 types the base writers
// collapse into the single `conversions` number. GATE-0 live probe (2026-06-29, Veterinary mastermind, ad-level,
// last_30d): actions[] returns 36 distinct action_types; cost_per_action_type returns 19 when requested; we discard
// the tail today. breakdown_type='action_type'.
//
// COST-CLASS: RIDES-EXISTING (actions/action_values are already in every insights fields list) + FIELD-WIDEN
// (cost_per_action_type, purchase_roas, website_purchase_roas added to the SAME per-level call — NO new calls,
// NO row multiplication: the action arrays are already per-row). Meta has NO quota wall → this back-drains the
// whole cohort to floor36 automatically (unlike the Google Tier-0 flight which was forward-only).
//
// ENCODING (7-col key, collision-free with base rows): entity_level ∈ {account,campaign,ad_set,ad} (Meta serves the
// actions array at all four), breakdown_type='action_type', breakdown_value=<action_type string verbatim>.
//   conversions       = actions[type].value         (per-action COUNT)
//   conversion_value  = action_values[type].value   (per-action VALUE; 0 for lead-gen accounts with no revenue actions)
//   extra             = Meta's NON-DERIVABLE attribution outputs we cannot recompute: cost_per_action_type +
//                       purchase_roas + website_purchase_roas for THAT action_type. (Simple ratios stay derive-on-read.)
//   spend/clicks/impressions = 0 — a single ad's spend yields MANY action types, so spend is NOT per-action; it lives
//                       in the base sentinel row (breakdown_type='').
//
// RECONCILE = WRITE-ONLY (no anchor, no flags): action_type does NOT partition account spend (one ad → many action
// types) and Meta conversions don't sum to account (account-level dedup, L58). Per the per-GRAIN reconcile rule a
// non-partition grain is WRITE-ONLY — reconciling it would manufacture false flags. (Contrast age/gender, which
// PARTITION spend → FLAG-NOT-BLOCK.) conversions/values are never fabricated; absent action → no row.
// FLOOR: standard floor36 (same ~37mo Meta aggregate limit). Stateless-range: processes the [startDate,endDate]
// handed by the drain's rangeLap. REUSE: metaFetchAllPaged. NO schema change — rides the (breakdown_type,value) key.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { metaFetchAllPaged } from './meta-graph-paged'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

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

// Entity-level configs (native repo terms ad_set/ad). Account carries no entity id → entity_id = the account id.
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

interface ActStat { count: number; value: number; cpa: number | null; roas: number | null; wroas: number | null }
// Collapse the parallel action-keyed arrays on ONE insights row into action_type → {count, value, cpa, roas, wroas}.
function actionMap(ins: any): Map<string, ActStat> {
  const m = new Map<string, ActStat>()
  const ensure = (t: string): ActStat => { let e = m.get(t); if (!e) { e = { count: 0, value: 0, cpa: null, roas: null, wroas: null }; m.set(t, e) } return e }
  for (const a of (ins.actions || [])) { const t = String(a?.action_type || ''); if (t) ensure(t).count = fin(parseFloat(a.value)) }
  for (const a of (ins.action_values || [])) { const t = String(a?.action_type || ''); if (t) ensure(t).value = fin(parseFloat(a.value)) }
  for (const a of (ins.cost_per_action_type || [])) { const t = String(a?.action_type || ''); if (t) ensure(t).cpa = fin(parseFloat(a.value)) }
  for (const a of (ins.purchase_roas || [])) { const t = String(a?.action_type || ''); if (t) ensure(t).roas = fin(parseFloat(a.value)) }
  for (const a of (ins.website_purchase_roas || [])) { const t = String(a?.action_type || ''); if (t) ensure(t).wroas = fin(parseFloat(a.value)) }
  return m
}

interface LevelStat { entity_level: string; rows: number; daysWritten: number }

export interface ActionTypeBackfillResult { status: number; body: Record<string, any> }

export async function runMetaActionTypeBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<ActionTypeBackfillResult> {
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

  const ACTION_FIELDS = 'actions,action_values,cost_per_action_type,purchase_roas,website_purchase_roas'
  const stats: Record<string, LevelStat> = {}
  const statOf = (l: string): LevelStat => { if (!stats[l]) stats[l] = { entity_level: l, rows: 0, daysWritten: 0 }; return stats[l] }
  const actionTypesSeen = new Set<string>()
  const sampleRow: Record<string, unknown> = {}
  let written = 0

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))

    for (const level of LEVELS) {
      const idSel = level.idFields ? level.idFields + ',' : ''
      const stat = statOf(level.entity_level)
      // action arrays ride &fields= (NOT &breakdowns= — action_type is a response array, not a Meta breakdown).
      const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&fields=${idSel}${ACTION_FIELDS}&filtering=${filtering}&limit=500`
      const insights = await metaFetchAllPaged(url, token, { guard: 200 })

      const byDate: Record<string, Record<string, unknown>[]> = {}
      for (const ins of insights) {
        const date = ins?.date_start // time_increment=1 → one day per row
        if (!date) continue
        const { entityId, entityName, parentId } = level.extract(ins, metaAccountId, acctName)
        if (!entityId) continue // unkeyable row — skip (never a fabricated key)
        const am = actionMap(ins)
        for (const [actionType, v] of am) {
          if (!actionType) continue
          if (v.count === 0 && v.value === 0 && v.cpa === null && v.roas === null && v.wroas === null) continue
          actionTypesSeen.add(actionType)
          ;(byDate[date] ||= []).push({
            client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
            entity_level: level.entity_level, entity_id: entityId, entity_name: entityName,
            parent_entity_id: parentId, date, breakdown_type: 'action_type', breakdown_value: actionType,
            spend: 0, impressions: 0, clicks: 0,
            conversions: Number(v.count.toFixed(2)), conversion_value: Number(v.value.toFixed(2)), revenue: 0,
            extra: { cost_per_action_type: v.cpa, purchase_roas: v.roas, website_purchase_roas: v.wroas },
          })
        }
      }

      for (const [, rows] of Object.entries(byDate)) {
        stat.rows += rows.length
        if (opts.dryRun && !sampleRow.row && rows.length) sampleRow.row = rows[0]
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(rows), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', entity_level: level.entity_level, detail: upErr.message } }
        }
        written += rows.length
        stat.daysWritten++
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      written,
      // WRITE-ONLY: action_type is non-partitioning → never reconciled (these stay 0/[] so the drain/route reporting is uniform).
      daysFlagged: 0, flagged: [], reconcile: [],
      levels: Object.values(stats),
      actionTypesSeen: actionTypesSeen.size,
      ...(opts.dryRun ? { sampleRow, actionTypeList: [...actionTypesSeen].sort() } : {}),
    },
  }
}
