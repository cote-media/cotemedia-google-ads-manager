// LORAMER_META_VIDEO_CAPTURE_V1 (T1.4)
// Meta VIDEO METRIC-family backfill writer (NEW; backfill-only — the drain runs it forward AND backward; does NOT
// touch the frozen live meta-intelligence prompt fetch). Captures the full video engagement family Meta serves in
// every insights call. Live-probed 2026-06-30 on Foam OH (act_916558565662035, 2024-09 window): ALL 10 fields
// return at ALL FOUR entity levels {account,campaign,ad_set,ad}; each field is an ARRAY [{action_type:'video_view',
// value}]. PARSE IS PER-CLASS: COUNT fields (plays/thruplays/p25–p100/30s) are additive → Σ.value; the two
// NON-ADDITIVE fields (video_avg_time_watched_actions = an average, cost_per_thruplay = a cost-per) are single-value.
//
// COST-CLASS: FIELD-WIDEN — the video_* fields are added to the writer's OWN per-level insights call. NOT a
// &breakdowns= dimension → NO fan-out → ONE report per level → 4 reports/lap (lighter than action_type's row-heavy
// taxonomy, far lighter than device's 8 / age_gender's 12) → a WIDE window is safe. Meta has NO quota wall → the
// drain back-drains the whole cohort to floor36 automatically.
//
// STORAGE (Layer-1 dedicated COLUMNS, Russ-approved storage model — migration 023): one row per entity×day,
// breakdown_type='video', breakdown_value='' (single marker, collision-free with base/other-breakdown rows on the
// 7-col key). The 10 video metrics land in DEDICATED nullable columns (video_plays / video_thruplays /
// video_p25..p100 / video_30s / video_avg_time_sec / cost_per_thruplay). spend/impressions/clicks/conversions = 0
// (the base sentinel row breakdown_type='' owns spend; one ad's spend is NOT per-video-metric).
//
// RECONCILE = WRITE-ONLY (no anchor, no flags): video metrics do NOT partition account spend (engagement counts,
// not a spend split) — per the per-GRAIN reconcile rule a non-partition grain is WRITE-ONLY; reconciling would
// manufacture false flags. (Contrast device/age, which PARTITION spend → FLAG-NOT-BLOCK.) A row is written ONLY
// when ≥1 video field is present (absent video → no row; never a fabricated zero row).
// FLOOR: standard floor36 (video rides the same ~37mo Meta aggregate #3018 wall; Foam OH served to ~33mo).
// Stateless-range: processes the [startDate,endDate] the drain's rangeLap hands it. REUSE: metaFetchAllPaged.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { metaFetchAllPaged } from './meta-graph-paged'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const iso = (d: Date) => d.toISOString().split('T')[0]

// COUNT fields (plays/thruplays/p25–p100/30s) — additive → Σ the array's .value (a single 'video_view' member
// in practice; if Meta ever splits into >1 action_type, counts legitimately add). Absent → null. Scalar = defensive.
const arrVal = (v: any): number | null =>
  Array.isArray(v) ? v.reduce((s, x) => s + fin(parseFloat(x?.value)), 0) : (v == null ? null : fin(parseFloat(v)))
// NON-ADDITIVE fields (video_avg_time_watched_actions = average; cost_per_thruplay = cost-per): summing an
// average/ratio is WRONG. Take .value iff the array has EXACTLY ONE member; if it EVER returns >1, store NULL +
// a loud one-line warning (loud-failure rule) so a wrong number is never silently written.
const singleVal = (v: any, ctx: string): number | null => {
  if (v == null) return null
  if (!Array.isArray(v)) return fin(parseFloat(v)) // scalar fallback (defensive)
  if (v.length === 0) return null
  if (v.length === 1) return fin(parseFloat(v[0]?.value))
  console.warn(`[meta-video] NON-ADDITIVE field returned ${v.length} members — storing NULL (cannot Σ an avg/cost): ${ctx}`)
  return null
}
// The two NON-ADDITIVE (single-value) source fields — parsed by singleVal, NEVER summed.
const SINGLE_VALUE_FIELDS = new Set(['video_avg_time_watched_actions', 'cost_per_thruplay'])

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

// Meta insights field → dedicated metrics_daily column (migration 023). All arrays → arrVal.
const VIDEO_FIELD_TO_COL: Record<string, string> = {
  video_play_actions: 'video_plays',
  video_thruplay_watched_actions: 'video_thruplays',
  video_p25_watched_actions: 'video_p25',
  video_p50_watched_actions: 'video_p50',
  video_p75_watched_actions: 'video_p75',
  video_p95_watched_actions: 'video_p95',
  video_p100_watched_actions: 'video_p100',
  video_30_sec_watched_actions: 'video_30s',
  video_avg_time_watched_actions: 'video_avg_time_sec',
  cost_per_thruplay: 'cost_per_thruplay',
}
const VIDEO_FIELDS = Object.keys(VIDEO_FIELD_TO_COL)

interface LevelStat { entity_level: string; rows: number; daysWritten: number }

export interface VideoBackfillResult { status: number; body: Record<string, any> }

export async function runMetaVideoBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<VideoBackfillResult> {
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

  const VIDEO_SEL = VIDEO_FIELDS.join(',')
  const stats: Record<string, LevelStat> = {}
  const statOf = (l: string): LevelStat => { if (!stats[l]) stats[l] = { entity_level: l, rows: 0, daysWritten: 0 }; return stats[l] }
  const sampleRow: Record<string, unknown> = {}
  let written = 0

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))

    for (const level of LEVELS) {
      const idSel = level.idFields ? level.idFields + ',' : ''
      const stat = statOf(level.entity_level)
      // video_* fields ride &fields= (NOT &breakdowns= — they are response arrays, not a Meta breakdown).
      const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&fields=${idSel}${VIDEO_SEL}&filtering=${filtering}&limit=500`
      const insights = await metaFetchAllPaged(url, token, { guard: 200 })

      const byDate: Record<string, Record<string, unknown>[]> = {}
      for (const ins of insights) {
        const date = ins?.date_start // time_increment=1 → one day per row
        if (!date) continue
        if (!VIDEO_FIELDS.some((f) => ins[f] != null)) continue // no video this entity/day → no row (never a fabricated zero)
        const { entityId, entityName, parentId } = level.extract(ins, metaAccountId, acctName)
        if (!entityId) continue // unkeyable row — skip (never a fabricated key)
        const row: Record<string, unknown> = {
          client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
          entity_level: level.entity_level, entity_id: entityId, entity_name: entityName,
          parent_entity_id: parentId, date, breakdown_type: 'video', breakdown_value: '',
          spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, revenue: 0,
        }
        for (const f of VIDEO_FIELDS) {
          row[VIDEO_FIELD_TO_COL[f]] = SINGLE_VALUE_FIELDS.has(f)
            ? singleVal(ins[f], `client=${clientId} ${level.entity_level} ${entityId} ${date} ${f}`)
            : arrVal(ins[f])
        }
        ;(byDate[date] ||= []).push(row)
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
      // WRITE-ONLY: video is non-partitioning → never reconciled (kept uniform with the drain/route reporting shape).
      daysFlagged: 0, flagged: [], reconcile: [],
      levels: Object.values(stats),
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
