// LORAMER_GOOGLE_ADGROUP_AD_BACKFILL_V1
// Ad-group-grain AND ad-grain backfill writer for Google (NEW, backfill-only — does NOT touch forward
// capture). Mirrors src/lib/backfill/google-campaign-backfill.ts byte-for-pattern (monthChunks,
// queryWithRetry, idempotent UPSERT via normalizeMetricsRows on the standard CONFLICT key, per-day
// reconcile gate, same return shape). One pass per month-chunk runs TWO GAQL reports:
//   • ad_group        → entity_level='ad_group', entity_id=ad_group.id,        parent=campaign.id
//   • ad_group_ad     → entity_level='ad',       entity_id=ad_group_ad.ad.id,  parent=ad_group.id
// Rows are byte-compatible with the forward builder (src/lib/intelligence/google-metrics-row.ts) — same
// columns, same conflict key, same extra-JSON shape (ctr/cpc/cpm/roas/cpa/convRate), breakdown_type/value=''.
// Like the campaign writer we DO NOT filter status (a since-REMOVED ad_group/ad still had real historical
// spend; the no-status-filter capture is what makes the per-day reconcile sum to its parents).
//
// RECONCILE GATE (Lesson 59) — the GRAIN-SPECIFIC anchor:
//   The campaign writer reconciles Σcampaign vs ACCOUNT because every campaign type appears in the
//   `campaign` report (Σcampaign ≡ account). That anchor is WRONG here: PMax campaigns expose no
//   ad_groups, and Shopping/PMax expose no ad_group_ad rows, so Σad_group / Σad sit structurally BELOW
//   account — an account gate would falsely skip days. The correct per-unit-of-work anchor is the
//   ALREADY-BACKFILLED campaign grain: for each day, Σ(grain spend) must equal Σ(campaign-grain
//   metrics_daily.spend for ONLY the campaign-ids present in that grain's result that day). PMax falls
//   out of both sides automatically; a truncated/broken fetch makes the grain sum fall short of its
//   campaigns' total and is caught. Within $0.01 or 0.1% → write; else SKIP that day for that grain + flag
//   (loud). Account spend is reported in dryRun for context (account − Σcampaign-with-children = the
//   structural PMax/Shopping gap), never used as the gate.
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { GoogleAdsApi } from 'google-ads-api'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'
const RECON_ABS = 0.01   // $0.01
const RECON_PCT = 0.001  // 0.1%

const adsClient = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
})

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

async function queryWithRetry(customer: any, gaql: string, tries = 4): Promise<any[]> {
  let lastErr: any
  for (let i = 0; i < tries; i++) {
    try { return await customer.query(gaql) } catch (e: any) {
      lastErr = e
      if (/RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE|429|rate/i.test(String(e?.message || '')) && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); continue
      }
      throw e
    }
  }
  throw lastErr
}

// One built metrics_daily row (byte-compatible with buildGoogleMetricsRows).
function buildRow(
  clientId: string, userEmail: string, customerId: string,
  entityLevel: string, entityId: string, entityName: string, parentEntityId: string,
  date: string, spend: number, impressions: number, clicks: number, conversions: number, convValue: number
): Record<string, unknown> {
  return {
    client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
    entity_level: entityLevel, entity_id: entityId, entity_name: entityName,
    parent_entity_id: parentEntityId, date, breakdown_type: '', breakdown_value: '',
    spend: Number(spend.toFixed(2)), impressions, clicks, conversions, conversion_value: Number(convValue.toFixed(2)), revenue: 0,
    extra: {
      ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
      roas: ratio(convValue, spend), cpa: ratio(spend, conversions), convRate: ratio(conversions, clicks, 100),
    },
  }
}

interface GrainStat {
  grainDayRows: number
  written: number
  skipped: number
  daysWritten: number
  daysSkipped: number
}
const emptyStat = (): GrainStat => ({ grainDayRows: 0, written: 0, skipped: 0, daysWritten: 0, daysSkipped: 0 })

export interface AdGroupAdBackfillResult { status: number; body: Record<string, any> }

export async function runGoogleAdGroupAdBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<AdGroupAdBackfillResult> {
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
  const customer = adsClient.Customer({ customer_id: customerId, refresh_token: tok.refresh_token as string, login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID! })

  const stats: Record<'ad_group' | 'ad', GrainStat> = { ad_group: emptyStat(), ad: emptyStat() }
  const flagged: any[] = []
  const sampleRow: Record<string, unknown> = {} // dryRun diagnostic: first built row per grain

  for (const chunk of monthChunks(startDate, endDate)) {
    // Campaign-grain anchor for this chunk: map[date][campaignId] = campaign spend (already backfilled,
    // residual-0). Read ONCE per chunk (not per-day) — the per-day reconcile sums over only the campaign
    // ids actually present in each grain's result for that day.
    const { data: campRows } = await supabaseAdmin
      .from('metrics_daily').select('entity_id,date,spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'campaign')
      .eq('breakdown_type', '').eq('breakdown_value', '')
      .gte('date', chunk.from).lte('date', chunk.to)
    const campSpendByDate: Record<string, Record<string, number>> = {}
    for (const r of campRows || []) {
      const d = String((r as any).date)
      if (!campSpendByDate[d]) campSpendByDate[d] = {}
      campSpendByDate[d][String((r as any).entity_id)] = fin((r as any).spend)
    }
    // Account-grain spend per day (dryRun context only — exposes the PMax/Shopping structural gap).
    const { data: acctRows } = await supabaseAdmin
      .from('metrics_daily').select('date,spend')
      .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'account')
      .eq('breakdown_type', '').eq('breakdown_value', '')
      .gte('date', chunk.from).lte('date', chunk.to)
    const acctSpendByDate: Record<string, number> = {}
    for (const r of acctRows || []) acctSpendByDate[String((r as any).date)] = fin((r as any).spend)

    // Two grains, identical machinery — query, bucket per (date), reconcile against the parent campaign sum.
    const grains: { level: 'ad_group' | 'ad'; gaql: string; extract: (r: any) => { entityId: string; entityName: string; parentId: string; campaignId: string } }[] = [
      {
        level: 'ad_group',
        gaql: `SELECT ad_group.id, ad_group.name, campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group WHERE segments.date BETWEEN '${chunk.from}' AND '${chunk.to}'`,
        extract: (r) => ({ entityId: String(r.ad_group?.id), entityName: String(r.ad_group?.name || ''), parentId: String(r.campaign?.id), campaignId: String(r.campaign?.id) }),
      },
      {
        level: 'ad',
        gaql: `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group.id, campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group_ad WHERE segments.date BETWEEN '${chunk.from}' AND '${chunk.to}'`,
        extract: (r) => ({ entityId: String(r.ad_group_ad?.ad?.id), entityName: String(r.ad_group_ad?.ad?.name || ''), parentId: String(r.ad_group?.id), campaignId: String(r.campaign?.id) }),
      },
    ]

    for (const grain of grains) {
      const rows = await queryWithRetry(customer, grain.gaql)
      const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number; campaignIds: Set<string> }> = {}
      for (const r of rows) {
        const date = r.segments?.date
        if (!date) continue
        const { entityId, entityName, parentId, campaignId } = grain.extract(r)
        const spend = fin(r.metrics?.cost_micros) / 1e6
        const clicks = fin(r.metrics?.clicks)
        const impressions = fin(r.metrics?.impressions)
        const conversions = fin(r.metrics?.conversions)
        const convValue = fin(r.metrics?.conversions_value)
        if (!byDate[date]) byDate[date] = { rows: [], spend: 0, campaignIds: new Set() }
        const b = byDate[date]
        b.spend += spend
        if (campaignId) b.campaignIds.add(campaignId)
        b.rows.push(buildRow(clientId, userEmail, customerId, grain.level, entityId, entityName, parentId, date, spend, impressions, clicks, conversions, convValue))
      }
      const stat = stats[grain.level]
      stat.grainDayRows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)
      if (opts.dryRun && !sampleRow[grain.level]) {
        const firstBucket = Object.values(byDate).find((d) => d.rows.length > 0)
        if (firstBucket) sampleRow[grain.level] = firstBucket.rows[0]
      }

      for (const [date, bucket] of Object.entries(byDate)) {
        // Anchor = Σ campaign-grain spend over ONLY the campaigns present in THIS grain's result this day.
        const dayCamp = campSpendByDate[date] || {}
        let anchorSpend = 0
        let anchorMissing = 0 // campaign-grain rows absent for a campaign we have grain rows for (can't reconcile)
        for (const cid of bucket.campaignIds) {
          if (cid in dayCamp) anchorSpend += dayCamp[cid]
          else anchorMissing++
        }
        const delta = Math.abs(bucket.spend - anchorSpend)
        const within = anchorMissing === 0 && (delta <= RECON_ABS || (anchorSpend > 0 && delta / anchorSpend <= RECON_PCT))
        if (!within) {
          stat.daysSkipped++; stat.skipped += bucket.rows.length
          flagged.push({
            grain: grain.level, date,
            grain_spend: Number(bucket.spend.toFixed(2)),
            campaign_anchor_spend: Number(anchorSpend.toFixed(2)),
            delta_vs_campaign: Number(delta.toFixed(2)),
            anchor_missing_campaigns: anchorMissing,
            ...(opts.dryRun ? { account_spend: Number(fin(acctSpendByDate[date]).toFixed(2)) } : {}),
          })
          continue
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
      clientId, customerId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      adGroup: stats.ad_group, ad: stats.ad,
      written: stats.ad_group.written + stats.ad.written,
      flagged,
      ...(opts.dryRun ? { sampleRow } : {}),
    },
  }
}
