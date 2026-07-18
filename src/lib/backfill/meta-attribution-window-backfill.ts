// LORAMER_META_ATTRIBUTION_WINDOW_V1 (M-FILL#2) — Meta ATTRIBUTION-WINDOW breakdown writer (backfill + forward via
// META_BREADTH_FORWARD; the drain runs it backward, cron/sync runs it forward one day). Captures Meta's per-window
// attribution decomposition of EVERY action_type — the layer that lets Lora answer "how much of this is view-through
// vs click, 1-day vs 7-day vs 28-day," which today's single blended conversion number cannot. FIRST-CLASS
// breakdown_type per LORAMER_FIRST_CLASS_DIMENSION_DEFAULT_V1 (not folded into extra).
//
// PROBED LIVE 2026-07-18 on Foam OH (act_916558565662035), 2024-11-25..12-01 (M-FILL#2 GATE-A PROBE):
//   • SHAPE: per-window values are INLINE keys on each actions / action_values entry alongside the default `value`,
//     e.g. {"action_type":"purchase","value":"368531.95","1d_click":"191639.38","7d_click":"275200.6","28d_click":
//     "278566.6","1d_view":"93331.35"}. A window key is OMITTED when it has no data → treat absent as skip (never
//     assume all windows present).
//   • WINDOW SET: the API ACCEPTS 1d_click/7d_click/28d_click/1d_view/7d_view/28d_view/dda (28d is NOT deprecated —
//     Meta re-enabled it). We request the FULL set and capture whatever POPULATES per action (Foam OH populated
//     1d_click/7d_click/28d_click/1d_view; 7d_view/28d_view/dda came back empty for that account — capture is
//     account-attribution-setting dependent, so never hardcode a subset).
//   • SPEND INVARIANT across windows (probe: identical $ every window) → these rows carry conversions + value ONLY;
//     spend/impressions/clicks = 0 (the base sentinel row owns spend). Do NOT recapture spend.
//   • LEVELS: per-window keys returned at ALL 4 (account/campaign/ad_set/ad).
//   • MATERIALITY: purchase value 7d_click = 1.44× 1d_click, view-through (1d_view) = 25% of the default total.
//
// POSTURE = WRITE-ONLY, NEVER reconciled. Windows OVERLAP by construction (1d_click ⊂ 7d_click ⊂ 28d_click; view +
// click double-count in the default) → summing them multi-counts. conversions never gate (L58). breakdown_type=
// 'attribution_window', breakdown_value = composite '<action_type>:<window>' (window alone would mix leads+purchases
// and lose the action_type). STORAGE: existing conversions + conversion_value columns + breakdown_value + extra on
// the EXISTING 7-col key — NO migration. Stateless-range. REUSE: metaFetchAllPaged.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { metaFetchAllPaged } from './meta-graph-paged'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

// The FULL candidate window set — requested every call; capture whatever populates per action (absent = skip).
// 28d_click/28d_view served (NOT deprecated); dda = data-driven attribution. Order is presentational only.
const REQUESTED_WINDOWS = ['1d_click', '7d_click', '28d_click', '1d_view', '7d_view', '28d_view', 'dda']
const WINDOW_SET = new Set(REQUESTED_WINDOWS)

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

// window keys present on an entry (excluding action_type + the default `value`), intersected with the requested set.
const windowKeys = (entry: any): string[] => Object.keys(entry).filter((k) => WINDOW_SET.has(k))

type Agg = { entityId: string; entityName: string; parentId: string; actionType: string; window: string; conversions: number; value: number }

export interface AttrWindowBackfillResult { status: number; body: Record<string, any> }

export async function runMetaAttributionWindowBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<AttrWindowBackfillResult> {
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

  const aw = encodeURIComponent(JSON.stringify(REQUESTED_WINDOWS))
  let written = 0
  const levelsQueried = new Set<string>()
  const windowsSeen = new Set<string>()
  const actionTypesSeen = new Set<string>()
  const sampleRows: Record<string, unknown>[] = []
  // dry-run verify: account-level per-window value for a chosen (date, action_type) — proves the decomposition.
  const decomp: Record<string, Record<string, { conversions: number; value: number }>> = {}

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))

    for (const level of LEVELS) {
      levelsQueried.add(level.entity_level)
      const idSel = level.idFields ? level.idFields + ',' : ''
      // ONE call per level returns ALL windows inline (low API fan-out); action_attribution_windows drives it.
      const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&action_attribution_windows=${aw}&fields=${idSel}actions,action_values&filtering=${filtering}&limit=500`
      const insights = await metaFetchAllPaged(url, token, { guard: 200 })

      const byDate: Record<string, Map<string, Agg>> = {}
      for (const ins of insights) {
        const date = ins?.date_start
        if (!date) continue
        const { entityId, entityName, parentId } = level.extract(ins, metaAccountId, acctName)
        if (!entityId) continue
        // union of action_types across actions[] (counts) + action_values[] (values); windows are per-action inline keys.
        const valByType: Record<string, any> = {}
        for (const av of ins.action_values || []) valByType[av.action_type] = av
        const cntByType: Record<string, any> = {}
        for (const a of ins.actions || []) cntByType[a.action_type] = a
        const types = new Set<string>([...Object.keys(cntByType), ...Object.keys(valByType)])
        const m = (byDate[date] ||= new Map<string, Agg>())
        for (const at of types) {
          const cEntry = cntByType[at], vEntry = valByType[at]
          const wins = new Set<string>([...(cEntry ? windowKeys(cEntry) : []), ...(vEntry ? windowKeys(vEntry) : [])])
          for (const w of wins) {
            const conversions = cEntry ? fin(cEntry[w]) : 0
            const value = vEntry ? fin(vEntry[w]) : 0
            if (conversions === 0 && value === 0) continue // no fabricated zero rows
            actionTypesSeen.add(at); windowsSeen.add(w)
            const bv = `${at}:${w}`
            const key = `${entityId}|${bv}`
            let agg = m.get(key)
            if (!agg) { agg = { entityId, entityName, parentId, actionType: at, window: w, conversions: 0, value: 0 }; m.set(key, agg) }
            agg.conversions += conversions; agg.value += value
            if (opts.dryRun && level.entity_level === 'account' && at === 'purchase') {
              const dd = (decomp[date] ||= {}); dd[w] = { conversions: agg.conversions, value: agg.value }
            }
          }
        }
      }

      for (const [date, m] of Object.entries(byDate)) {
        const rows: Record<string, unknown>[] = []
        for (const a of m.values()) {
          // WRITE-ONLY. PROVENANCE: attribution windows OVERLAP and view+click DOUBLE-COUNT — NEVER sum across
          // windows; the default (already in base conversion capture) = the account's own window setting
          // (here 7d_click+1d_view). spend=0 (base owns spend; windows are attribution outputs, not a spend split).
          rows.push({
            client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
            entity_level: level.entity_level, entity_id: a.entityId, entity_name: a.entityName,
            parent_entity_id: a.parentId, date, breakdown_type: 'attribution_window', breakdown_value: `${a.actionType}:${a.window}`,
            spend: 0, impressions: 0, clicks: 0,
            conversions: a.conversions, conversion_value: Number(a.value.toFixed(2)), revenue: 0,
            extra: { action_type: a.actionType, window: a.window },
          })
        }
        if (!rows.length) continue
        if (opts.dryRun && sampleRows.length < 40) sampleRows.push(...rows.slice(0, 40 - sampleRows.length).map((r) => ({ entity_level: r.entity_level, entity_id: r.entity_id, date: r.date, breakdown_value: r.breakdown_value, conversions: r.conversions, conversion_value: r.conversion_value, spend: r.spend })))
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(rows), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', entity_level: level.entity_level, date, detail: upErr.message } }
        }
        written += rows.length
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      written,
      // WRITE-ONLY: attribution windows are non-partitioning (overlap) → never reconciled.
      daysFlagged: 0, flagged: [], reconcile: [],
      accountQueried: levelsQueried.has('account'), levelsQueried: Array.from(levelsQueried),
      windowsSeen: Array.from(windowsSeen), actionTypeCount: actionTypesSeen.size,
      ...(opts.dryRun ? { sampleRows, purchaseAccountDecomp: decomp } : {}),
    },
  }
}
