// LORAMER_META_ASSET_CAPTURE_V1 (M-FILL#1) — Meta creative-ASSET breakdown writer (backfill + forward via the
// META_BREADTH_FORWARD registry; the drain runs it backward, cron/sync runs it forward one day). Captures the 7
// creative-asset breakdowns Meta serves — the Meta analog of Google's asset-combination attribution. NEW writer;
// does NOT touch the frozen live meta-intelligence prompt fetch.
//
// PROBED LIVE 2026-07-18 on Veterinary mastermind (act_735865779578613), 2026-07-10..16 (M-FILL#1 GATE-A PROBE):
//   • GRAINS: served at campaign / ad_set / ad. ACCOUNT LEVEL returns 200 with ZERO rows (served-EMPTY, a silent
//     false-zero trap) → we DO NOT query account for these. campaign/adset/ad ONLY.
//   • POSTURE: WRITE-ONLY, NEVER reconciled. The 7 breakdowns do NOT partition spend uniformly — CTA + link_url
//     tie 1.000×, image+video are complementary SUBSETS (0.26×+0.74×=1.0), body/description are subsets, and
//     title OVER-counts (~1.4×, the Dynamic-Creative combination double-count). Reconciling on spend would
//     false-flag nearly every breakdown every day → no anchor, no flags (same class as video / action_type).
//   ⚠ PROVENANCE (bake this — the reader-facing caveat, surfaced by the query_breakdown tool later): asset spend is
//     COMPONENT ATTRIBUTION, NOT a partition; it is over/under the base by design (title over-counts under Dynamic
//     Creative) and MUST NOT be summed to the ad total, nor summed across asset breakdown_types (that triple-counts).
//   • FIELD SHAPE varies per breakdown (probed): image {id,name,hash,url}; video {id,video_name,video_id,url,
//     thumbnail_url}; title/body {id,text}; call_to_action {id,name}; link_url {id,website_url}; description {id}
//     ONLY (no human label served → value = id, name-lookup DEFERRED). breakdown_value = the human label (real
//     text/name/url, NOT an opaque id — except description); the id + secondary fields ride extra.
//
// STORAGE: breakdown_value + extra JSONB on the EXISTING 7-col key — NO new columns, NO migration (unlike video,
// which needed dedicated numeric columns; assets carry only a label + the existing spend/impressions/clicks).
// spend/impressions/clicks are WRITTEN (the component attribution — which creative drove spend); conversions=0
// (Meta does not break conversions per asset; L58). breakdown_value is CAPPED to protect the 7-col btree unique
// index (a body_asset can be a full paragraph) — full label kept in extra.value_full when capped.
//
// Single-creative (non-Dynamic) ads return EMPTY for these — honest/expected, never an error, never a fabricated row.
// Stateless-range: processes the [startDate,endDate] the drain's rangeLap hands it. REUSE: metaFetchAllPaged.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { metaFetchAllPaged } from './meta-graph-paged'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const VALUE_CAP = 300 // breakdown_value char cap — protects the 7-col btree index (body text can be a paragraph)

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

// campaign / ad_set / ad ONLY — NO account (served-empty for asset breakdowns; probed 2026-07-18).
interface LevelCfg {
  entity_level: 'campaign' | 'ad_set' | 'ad'
  metaLevel: string
  idFields: string
  extract: (ins: any, acctId: string) => { entityId: string; entityName: string; parentId: string }
}
const ASSET_LEVELS: LevelCfg[] = [
  { entity_level: 'campaign', metaLevel: 'campaign', idFields: 'campaign_id,campaign_name',
    extract: (ins, acctId) => ({ entityId: String(ins.campaign_id || ''), entityName: String(ins.campaign_name || ''), parentId: acctId }) },
  { entity_level: 'ad_set', metaLevel: 'adset', idFields: 'adset_id,adset_name,campaign_id',
    extract: (ins) => ({ entityId: String(ins.adset_id || ''), entityName: String(ins.adset_name || ''), parentId: String(ins.campaign_id || '') }) },
  { entity_level: 'ad', metaLevel: 'ad', idFields: 'ad_id,ad_name,adset_id',
    extract: (ins) => ({ entityId: String(ins.ad_id || ''), entityName: String(ins.ad_name || ''), parentId: String(ins.adset_id || '') }) },
]

// Per-breakdown canonical mapping (probed field shapes). valueField = the human label; NULL → value = id.
interface AssetCfg {
  bt: string
  valueField: string | null // null → id-only (description_asset)
  extraFields: string[]      // secondary fields → extra (id is always added)
}
const ASSET_BREAKDOWNS: AssetCfg[] = [
  { bt: 'image_asset', valueField: 'name', extraFields: ['hash', 'url'] },
  { bt: 'video_asset', valueField: 'video_name', extraFields: ['video_id', 'url', 'thumbnail_url'] },
  { bt: 'title_asset', valueField: 'text', extraFields: [] },
  { bt: 'body_asset', valueField: 'text', extraFields: [] },
  { bt: 'call_to_action_asset', valueField: 'name', extraFields: [] },
  { bt: 'description_asset', valueField: null, extraFields: [] }, // id-only; no label served → name-lookup deferred
  { bt: 'link_url_asset', valueField: 'website_url', extraFields: [] },
]

// Canonical breakdown_value + extra for one asset object. value = human label (capped), id + secondaries → extra.
function assetValue(cfg: AssetCfg, obj: any): { value: string; extra: Record<string, unknown> } | null {
  if (obj == null || typeof obj !== 'object') return null
  const id = obj.id != null ? String(obj.id) : ''
  const extra: Record<string, unknown> = { asset_id: id }
  for (const f of cfg.extraFields) if (obj[f] != null) extra[f] = String(obj[f])
  // label = the human field; fall back to id if the label is absent/blank (never opaque-except-when-forced).
  const rawLabel = cfg.valueField ? obj[cfg.valueField] : null
  const label = rawLabel != null && String(rawLabel).trim() !== '' ? String(rawLabel) : id
  if (cfg.valueField === null) extra.name_lookup = 'deferred' // description_asset: id-only by API design
  if (!label) return null // unkeyable (no label AND no id) → skip, never a fabricated key
  const value = label.length > VALUE_CAP ? label.slice(0, VALUE_CAP) : label
  if (value !== label) { extra.value_full = label; extra.value_capped = true }
  return { value, extra }
}

type Agg = { entityId: string; entityName: string; parentId: string; value: string; extra: Record<string, unknown>; spend: number; impressions: number; clicks: number }

export interface AssetBackfillResult { status: number; body: Record<string, any> }

export async function runMetaAssetBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<AssetBackfillResult> {
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

  let written = 0
  const perCell: Record<string, { rows: number; sampleValue?: string; sampleKey?: Record<string, unknown> }> = {}
  const levelsQueried = new Set<string>()

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))

    for (const asset of ASSET_BREAKDOWNS) {
      for (const level of ASSET_LEVELS) {
        levelsQueried.add(level.entity_level)
        const idSel = level.idFields ? level.idFields + ',' : ''
        // breakdown in &breakdowns= (one asset per request); WRITE-ONLY (no reconcile anchor). Full pagination.
        const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&breakdowns=${asset.bt}&fields=${idSel}spend,impressions,clicks&filtering=${filtering}&limit=500`
        const insights = await metaFetchAllPaged(url, token, { guard: 200 })

        // aggregate by (date, entityId, value) — sums spend/impr/clicks; merges a rare label collision idempotently.
        const byDate: Record<string, Map<string, Agg>> = {}
        for (const ins of insights) {
          const date = ins?.date_start
          if (!date) continue
          const obj = ins[asset.bt]
          if (obj == null) continue // no asset this row (single-creative) → skip, never a fabricated row
          const av = assetValue(asset, obj)
          if (!av) continue
          const { entityId, entityName, parentId } = level.extract(ins, metaAccountId)
          if (!entityId) continue
          const key = `${entityId}|${av.value}`
          const m = (byDate[date] ||= new Map<string, Agg>())
          let a = m.get(key)
          if (!a) { a = { entityId, entityName, parentId, value: av.value, extra: av.extra, spend: 0, impressions: 0, clicks: 0 }; m.set(key, a) }
          a.spend += fin(ins.spend); a.impressions += fin(ins.impressions); a.clicks += fin(ins.clicks)
        }

        const cellKey = `${asset.bt}|${level.entity_level}`
        const cell = (perCell[cellKey] ||= { rows: 0 })
        for (const [date, m] of Object.entries(byDate)) {
          const rows: Record<string, unknown>[] = []
          for (const a of m.values()) {
            // WRITE-ONLY: spend/impressions/clicks are COMPONENT ATTRIBUTION (see header PROVENANCE) — not a
            // partition; NEVER reconciled, NEVER summed to the ad total or across asset breakdown_types. conversions=0.
            rows.push({
              client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
              entity_level: level.entity_level, entity_id: a.entityId, entity_name: a.entityName,
              parent_entity_id: a.parentId, date, breakdown_type: asset.bt, breakdown_value: a.value,
              spend: Number(a.spend.toFixed(2)), impressions: a.impressions, clicks: a.clicks,
              conversions: 0, conversion_value: 0, revenue: 0, extra: a.extra,
            })
          }
          if (!rows.length) continue
          cell.rows += rows.length
          if (opts.dryRun && cell.sampleKey == null) {
            const r0 = rows[0]
            cell.sampleValue = String(r0.breakdown_value)
            cell.sampleKey = { entity_level: r0.entity_level, entity_id: r0.entity_id, date: r0.date, breakdown_type: r0.breakdown_type, breakdown_value: r0.breakdown_value, spend: r0.spend, conversions: r0.conversions, extra: r0.extra }
          }
          if (!opts.dryRun) {
            const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(rows), { onConflict: CONFLICT })
            if (upErr) return { status: 500, body: { error: 'upsert failed', breakdown_type: asset.bt, entity_level: level.entity_level, date, detail: upErr.message } }
          }
          written += rows.length
        }
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      written,
      // WRITE-ONLY: asset breakdowns are non-partitioning → never reconciled (uniform reporting shape).
      daysFlagged: 0, flagged: [], reconcile: [],
      accountQueried: levelsQueried.has('account'), // MUST be false — assets are never queried at account level
      levelsQueried: Array.from(levelsQueried),
      breakdownTypes: ASSET_BREAKDOWNS.map((a) => a.bt),
      ...(opts.dryRun ? { perCell } : {}),
    },
  }
}
