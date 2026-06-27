// LORAMER_META_ADSET_AD_BACKFILL_V1
// Ad-set-grain AND ad-grain backfill writer for Meta (NEW, backfill-only — does NOT touch forward capture).
// Mirrors src/lib/backfill/meta-campaign-backfill.ts (parseInsight/metaExtra/fetchAllWithRetry/monthChunks,
// idempotent UPSERT via normalizeMetricsRows, same CONFLICT key) and the two-grains-one-pass shape of
// google-adgroup-ad-backfill.ts. One pass per month-chunk runs TWO Graph insights reports:
//   • level=adset → entity_level='ad_set', entity_id=adset_id, parent=campaign_id
//   • level=ad    → entity_level='ad',     entity_id=ad_id,    parent=adset_id
// Rows are byte-compatible with the forward builder (meta-metrics-row.ts ad_set/ad rows). SAME spend>0
// basis as forward + the campaign/account grains. CRITICAL: we PAGINATE FULLY (limit=500 + paging) — the
// forward fetch uses limit=100 and TRUNCATES the adset/ad tail for high-adset clients (measured: Glass
// Plus/Shelley/BusyBee Σad_set < campaign), so this backfill must capture ALL adsets/ads.
//
// RECONCILE = FLAG-NOT-BLOCK against the ACCOUNT grain per day (the settled Meta-placement/campaign posture):
//   Meta has no PMax-style structural gap — every campaign exposes adsets and ads — so with full pagination
//   Σad_set ≡ Σad ≡ Σcampaign ≡ account. We ALWAYS write the real grain rows and only RECORD a loud delta
//   when Σ(grain spend) diverges from account (stale-anchor restatement OR a residual sliver). The anchor is
//   read via .maybeSingle() (ONE account row/day) — NOT a bulk parent query — so there is NO silent 1000-row
//   cap (the bug google-adgroup-ad V1 hit). Conversions NEVER gate (Meta account-level dedup → account
//   conversions ≠ Σ grain conversions; otherDeltas is informational only).
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

// mirror of meta-campaign-backfill.ts parseInsight (which mirrors meta-intelligence buildMetrics)
function parseInsight(insight: any) {
  const spend = parseFloat(insight?.spend || '0')
  const clicks = parseInt(insight?.clicks || '0')
  const impressions = parseInt(insight?.impressions || '0')
  const ctr = parseFloat(insight?.ctr || '0')
  const getAction = (actions: any[], type: string) => { const a = actions?.find((x: any) => x.action_type === type); return a ? parseFloat(a.value) : 0 }
  const actions = insight?.actions || []
  const conversions = getAction(actions, 'lead') || getAction(actions, 'offsite_conversion.fb_pixel_lead') || getAction(actions, 'offsite_conversion.fb_pixel_purchase') || parseFloat(insight?.conversions || '0')
  const purchases = getAction(actions, 'offsite_conversion.fb_pixel_purchase')
  const addToCart = getAction(actions, 'offsite_conversion.fb_pixel_add_to_cart')
  const initiateCheckout = getAction(actions, 'offsite_conversion.fb_pixel_initiate_checkout')
  const viewContent = getAction(actions, 'offsite_conversion.fb_pixel_view_content')
  const convValue = parseFloat(insight?.action_values?.find((x: any) => x.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
  const reach = parseInt(insight?.reach || '0')
  const frequency = parseFloat(insight?.frequency || '0')
  return {
    spend: fin(spend), clicks: fin(clicks), impressions: fin(impressions), conversions: fin(conversions),
    conversionValue: fin(convValue), ctr: fin(ctr), reach: fin(reach), frequency: fin(frequency),
    purchases: fin(purchases), addToCart: fin(addToCart), initiateCheckout: fin(initiateCheckout), viewContent: fin(viewContent),
  }
}

function metaExtra(m: ReturnType<typeof parseInsight>): Record<string, unknown> {
  const e: Record<string, unknown> = {
    ctr: m.ctr, cpc: ratio(m.spend, m.clicks), cpm: ratio(m.spend, m.impressions, 1000),
    roas: ratio(m.conversionValue, m.spend), cpa: ratio(m.spend, m.conversions), convRate: ratio(m.conversions, m.clicks, 100),
  }
  if (m.reach) e.reach = m.reach
  if (m.frequency) e.frequency = m.frequency
  if (m.purchases) e.purchases = m.purchases
  if (m.addToCart) e.addToCart = m.addToCart
  if (m.initiateCheckout) e.initiateCheckout = m.initiateCheckout
  if (m.viewContent) e.viewContent = m.viewContent
  return e
}

interface GrainStat { grainDayRows: number; written: number; daysWritten: number; daysFlagged: number }
const emptyStat = (): GrainStat => ({ grainDayRows: 0, written: 0, daysWritten: 0, daysFlagged: 0 })

export interface AdSetAdBackfillResult { status: number; body: Record<string, any> }

export async function runMetaAdSetAdBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<AdSetAdBackfillResult> {
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

  const insightFields = 'spend,clicks,impressions,ctr,reach,frequency,actions,action_values,conversions'
  const stats: Record<'ad_set' | 'ad', GrainStat> = { ad_set: emptyStat(), ad: emptyStat() }
  const flagged: any[] = []
  const sampleRow: Record<string, unknown> = {} // dryRun diagnostic: first built row per grain

  // PER-DAY account-spend anchor cache (.maybeSingle → one row/day, no bulk query → no silent cap).
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

  for (const chunk of monthChunks(startDate, endDate)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }))
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]))
    const grains: { level: 'ad_set' | 'ad'; metaLevel: string; idFields: string; extract: (ins: any) => { entityId: string; entityName: string; parentId: string } }[] = [
      {
        level: 'ad_set', metaLevel: 'adset', idFields: 'adset_id,adset_name,campaign_id',
        extract: (ins) => ({ entityId: String(ins.adset_id), entityName: String(ins.adset_name || ''), parentId: String(ins.campaign_id || '') }),
      },
      {
        level: 'ad', metaLevel: 'ad', idFields: 'ad_id,ad_name,adset_id',
        extract: (ins) => ({ entityId: String(ins.ad_id), entityName: String(ins.ad_name || ''), parentId: String(ins.adset_id || '') }),
      },
    ]

    for (const grain of grains) {
      const url = `${META_API}/${actId}/insights?level=${grain.metaLevel}&time_range=${timeRange}&time_increment=1&fields=${grain.idFields},${insightFields}&filtering=${filtering}&limit=500`
      const insights = await metaFetchAllPaged(url, token, { guard: 200 })
      const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number }> = {}
      for (const ins of insights) {
        const date = ins?.date_start // time_increment=1 → one day per row
        if (!date) continue
        const { entityId, entityName, parentId } = grain.extract(ins)
        const m = parseInsight(ins)
        if (!byDate[date]) byDate[date] = { rows: [], spend: 0 }
        const b = byDate[date]
        b.spend += m.spend
        b.rows.push({
          client_id: clientId, user_email: userEmail, platform: 'meta', account_id: metaAccountId,
          entity_level: grain.level, entity_id: entityId, entity_name: entityName,
          parent_entity_id: parentId, date, breakdown_type: '', breakdown_value: '',
          spend: Number(m.spend.toFixed(2)), impressions: m.impressions, clicks: m.clicks, conversions: m.conversions,
          conversion_value: Number(m.conversionValue.toFixed(2)), revenue: 0, extra: metaExtra(m),
        })
      }
      const stat = stats[grain.level]
      stat.grainDayRows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
      if (opts.dryRun && !sampleRow[grain.level]) {
        const firstBucket = Object.values(byDate).find((d) => d.rows.length > 0)
        if (firstBucket) sampleRow[grain.level] = firstBucket.rows[0]
      }

      for (const [date, bucket] of Object.entries(byDate)) {
        const acctSpend = await acctDay(date)
        const { within, delta } = reconcileDay(bucket.spend, acctSpend, { posture: 'flag' })
        // FLAG-NOT-BLOCK: ALWAYS write the real grain rows; only record a loud delta when divergent.
        if (!within) {
          stat.daysFlagged++
          flagged.push({
            grain: grain.level, date,
            grain_spend: Number(bucket.spend.toFixed(2)),
            account_spend: Number(acctSpend.toFixed(2)),
            delta: Number(delta.toFixed(2)),
          })
        }
        if (!opts.dryRun) {
          const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
          if (upErr) return { status: 500, body: { error: 'upsert failed', grain: grain.level, date, detail: upErr.message, flagged } }
        }
        stat.written += bucket.rows.length; stat.daysWritten++
      }
    }
  }

  return {
    status: 200,
    body: {
      clientId, metaAccountId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      adSet: stats.ad_set, ad: stats.ad,
      written: stats.ad_set.written + stats.ad.written,
      flagged,
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
