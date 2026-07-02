// LORAMER_META_HOUR_V1 (T1.10)
// Meta hour-BREADTH backfill writer (NEW; backfill-only — does NOT touch forward capture / the frozen live prompt
// fetch). Mirrors meta-geo-backfill.ts EXACTLY (own /act_X/insights call, 4 entity levels, metaFetchAllPaged
// guard 200, monthChunks, account×day spend anchor, reconcileDay FLAG-NOT-BLOCK) with ONE breakdown family:
//   breakdown_type='hour' ← breakdowns=hourly_stats_aggregated_by_advertiser_time_zone
//     Meta returns the range STRING "HH:MM:SS - HH:MM:SS" (advertiser-timezone hour bucket). value = the ZERO-PADDED
//     leading hour "00".."23" (raw int, lexically sortable — NOT an enum, so the UPPER-name casing rule does NOT
//     apply; matches the Google-hour encoding in google-hour.ts so 'hour' is one cross-platform dimension). The raw
//     range string is kept in extra.hourRange (verbatim, never lost). Advertiser-timezone chosen (not the _by_audience
//     variant) — it ties to the account's billing/reporting clock, the same basis the daily rows use.
//
// RECONCILE = SPEND-only FLAG-NOT-BLOCK vs the account×day anchor (entity_level='account', breakdown_type=''),
// .maybeSingle() (one row/day → no silent 1000-row cap). Hour PARTITIONS the day's spend (Σ over the 24 buckets ==
// account×day) exactly on finalized days — same posture as device/age/gender; recent stale-anchor days flag-but-write
// so the drain's monotonic range cursor never permanently skips them. CONVERSIONS are a separate grain (Meta
// account-level dedup, L58) → NEVER reconciled; conversions=value=0.
//
// FLOOR: standard floor36 (hour rides the ~37mo Meta aggregate #3018 wall, like every other Meta breadth). Stateless-
// range — processes the [startDate,endDate] the drain's rangeLap hands it. REUSE: metaFetchAllPaged + reconcileDay.
// NO schema change — rides the existing (breakdown_type, breakdown_value) 7-col key (JSONB/existing-key precedent,
// like device/age/geo). VERIFY-AT-WRITER (Gate A): which of the 4 entity levels serve the hourly breakdown, the exact
// range-string format, per-lap row volume + report count (24× hour fan-out at ad level is the heavy grain → size the
// drain window from the Gate-A measurement, not an assumption).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDay } from './reconcile-day'
import { metaFetchAllPaged } from './meta-graph-paged'

const META_API = 'https://graph.facebook.com/v21.0'
const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const ratio = (a: number, b: number, s = 1): number | null => (b > 0 && Number.isFinite(a / b) ? Number(((a / b) * s).toFixed(4)) : null)
const iso = (d: Date) => d.toISOString().split('T')[0]

// Meta hourly bucket "HH:MM:SS - HH:MM:SS" → zero-padded leading hour "00".."23" (matches google-hour.ts pad2).
// Robust to padded/unpadded ("0:00:00" and "00:00:00" both → "00"); returns '' if not a finite 0-23 hour.
function hourValue(raw: any): string {
  const s = String(raw ?? '').trim()
  const first = s.split(':')[0].trim()
  const n = Number(first)
  return Number.isFinite(n) && n >= 0 && n <= 23 ? String(Math.trunc(n)).padStart(2, '0') : ''
}

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

const HOUR_BREAKDOWN = 'hourly_stats_aggregated_by_advertiser_time_zone'

interface ComboStat {
  entity_level: string
  rows: number; daysWritten: number; daysFlagged: number; anchorSum: number; hourSum: number
}

export interface HourBackfillResult { status: number; body: Record<string, any> }

export async function runMetaHourBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<HourBackfillResult> {
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
  const comboOf = (l: string): ComboStat => {
    if (!combos[l]) combos[l] = { entity_level: l, rows: 0, daysWritten: 0, daysFlagged: 0, anchorSum: 0, hourSum: 0 }
    return combos[l]
  }
  const flagged: any[] = []
  const distinctHours = new Set<string>()
  const sampleRow: Record<string, unknown> = {} // dryRun diagnostic: first built row per entity level
  let written = 0
  let unparsedBuckets = 0 // rows whose hourly string didn't yield a 0-23 hour (loud in the result)

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))

    for (const level of LEVELS) {
      const combo = comboOf(level.entity_level)
      const idSel = level.idFields ? level.idFields + ',' : ''
      // breakdown in &breakdowns= (NOT &fields=, L12). Full pagination via metaFetchAllPaged (guard 200).
      const url = `${META_API}/${actId}/insights?level=${level.metaLevel}&time_range=${timeRange}&time_increment=1&breakdowns=${HOUR_BREAKDOWN}&fields=${idSel}spend,clicks,impressions&filtering=${filtering}&limit=500`
      const insights = await metaFetchAllPaged(url, token, { guard: 200 })

      const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number }> = {}
      for (const ins of insights) {
        const date = ins?.date_start // time_increment=1 → one day per row
        if (!date) continue
        const { entityId, entityName, parentId } = level.extract(ins, metaAccountId, acctName)
        if (!entityId) continue // unkeyable row — skip (never a fabricated key)
        const rawBucket = ins[HOUR_BREAKDOWN]
        const hour = hourValue(rawBucket)
        if (hour === '') { unparsedBuckets++; continue } // never fabricate an hour; log the count, don't drop silently-as-if-absent
        distinctHours.add(hour)
        const spend = fin(parseFloat(ins.spend || '0'))
        const clicks = fin(parseInt(ins.clicks || '0'))
        const impressions = fin(parseInt(ins.impressions || '0'))
        if (!byDate[date]) byDate[date] = { rows: [], spend: 0 }
        const b = byDate[date]
        b.spend += spend
        b.rows.push({
          client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
          entity_level: level.entity_level, entity_id: entityId, entity_name: entityName,
          parent_entity_id: parentId, date, breakdown_type: 'hour', breakdown_value: hour,
          spend: Number(spend.toFixed(2)), impressions, clicks, conversions: 0, conversion_value: 0, revenue: 0,
          extra: {
            ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
            hourRange: String(rawBucket || ''),
          },
        })
      }
      combo.rows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
      if (opts.dryRun && !sampleRow[level.entity_level]) {
        const fb = Object.values(byDate).find((d) => d.rows.length > 0)
        if (fb) sampleRow[level.entity_level] = fb.rows[0]
      }

      for (const [date, bucket] of Object.entries(byDate)) {
        // RECONCILE = ACCOUNT level, SPEND only, FLAG-NOT-BLOCK. Σ(hour spend) == account×day anchor (hour
        // partitions the day's spend; recent stale-anchor days flagged-but-written, never dropped).
        const acctSpend = await acctDay(date)
        const { within, delta } = reconcileDay(bucket.spend, acctSpend, { posture: 'flag' })
        combo.anchorSum += acctSpend
        combo.hourSum += bucket.spend
        if (!within) {
          combo.daysFlagged++
          flagged.push({
            entity_level: level.entity_level, date,
            hour_spend: Number(bucket.spend.toFixed(2)), account_spend: Number(acctSpend.toFixed(2)), delta: Number(delta.toFixed(2)),
          })
        }
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', entity_level: level.entity_level, date, detail: upErr.message, flagged } }
        }
        written += bucket.rows.length
        combo.daysWritten++
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      written, unparsedBuckets,
      distinctHours: [...distinctHours].sort(),
      reconcile: Object.values(combos).map((c) => ({
        entity_level: c.entity_level,
        rows: c.rows, daysWritten: c.daysWritten, daysFlagged: c.daysFlagged,
        anchorSum: Number(c.anchorSum.toFixed(2)), hourSum: Number(c.hourSum.toFixed(2)),
        delta: Number((c.hourSum - c.anchorSum).toFixed(2)),
      })),
      daysFlagged: flagged.length, flagged,
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
