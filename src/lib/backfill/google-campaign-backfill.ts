// LORAMER_CAMPAIGN_BACKFILL_PILOT_V1
// Campaign-grain backfill writer for Google (NEW, backfill-only — does NOT touch forward capture).
// Source: Google GAQL `campaign` report with segments.date over a bounded range, per client×customer.
// Writes per campaign×day rows into metrics_daily (entity_level='campaign', breakdown_type=''/value=''),
// byte-compatible with the forward builder (src/lib/intelligence/google-metrics-row.ts) — same columns,
// same conflict key, same extra-JSON shape (ctr/cpc/cpm/roas/cpa/convRate).
//
// SAFETY (mirrors the account/dimensional backfills):
//  • idempotent UPSERT on (client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value) — re-runnable, no dupes.
//  • every row through normalizeMetricsRows (Number.isFinite; never NaN / false zero).
//  • PER-DAY RECONCILE GATE (Lesson 59): before writing a day, Σ campaign spend that day vs the EXISTING
//    account-grain spend for that client×platform×day. Within $0.01 or 0.1% → write; else SKIP that day + flag (loud).
//  • month chunks, resumable by range, transient (429/RESOURCE_EXHAUSTED) backoff, loud failures (no fabrication).
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { reconcileDayAgainstAnchorRow } from './reconcile-day'
import { gaqlWithRetry } from './gaql-with-retry'
import { GoogleAdsApi } from 'google-ads-api'

const CONFLICT = 'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

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

export interface CampaignBackfillResult { status: number; body: Record<string, any> }

export async function runGoogleCampaignBackfill(
  clientId: string, startDate: string, endDate: string, opts: { dryRun?: boolean } = {}
): Promise<CampaignBackfillResult> {
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

  const flagged: any[] = []
  let written = 0, skipped = 0, daysWritten = 0, daysSkipped = 0, campaignDayRows = 0
  const otherDeltas = { clicks: 0, impressions: 0, conversions: 0 } // Σ(campaign − account) over written days

  for (const chunk of monthChunks(startDate, endDate)) {
    // LORAMER_CAMPAIGN_TYPE_MATRIX_V1 — CHANNEL TYPE IS A CAMPAIGN ATTRIBUTE, so it comes back with the historical
    // metrics at ZERO ADDITIONAL REQUESTS: one more field on a SELECT already being issued, not a new call.
    // ⛔ ZERO REQUESTS, NOT ZERO OPERATIONS. Google bills operations and the operations-per-request ratio is not
    // published — that unknown belongs to ★GAQL-OP-METER and must not be claimed away here.
    // WHY IT IS WORTH CAPTURING: without it every completeness check judges a CRITERIA-DEPENDENT family
    // (age/gender, keyword, ad_group) against ACCOUNT SPEND. Measured 2026-08-01: Foam OH spent $5,956.94 across
    // 90 days on a Performance Max campaign, PMax cannot produce age/gender rows, and the completion-claim gate
    // recorded 90 days of "missing demographics" that could never have existed. Google states the ad_group half
    // outright — "Querying resources such as ad_group or ad_group_ad won't return any data for your Performance Max
    // campaigns" (developers.google.com/google-ads/api/performance-max/reporting, last updated 2026-07-22).
    const gaql = `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, segments.date FROM campaign WHERE segments.date BETWEEN '${chunk.from}' AND '${chunk.to}'`
    const rows = await gaqlWithRetry(customer, gaql)
    const byDate: Record<string, { rows: Record<string, unknown>[]; spend: number; clicks: number; impressions: number; conversions: number }> = {}
    for (const r of rows) {
      const date = r.segments?.date
      if (!date) continue
      const spend = fin(r.metrics?.cost_micros) / 1e6
      const clicks = fin(r.metrics?.clicks)
      const impressions = fin(r.metrics?.impressions)
      const conversions = fin(r.metrics?.conversions)
      const convValue = fin(r.metrics?.conversions_value)
      if (!byDate[date]) byDate[date] = { rows: [], spend: 0, clicks: 0, impressions: 0, conversions: 0 }
      const b = byDate[date]
      b.spend += spend; b.clicks += clicks; b.impressions += impressions; b.conversions += conversions
      b.rows.push({
        client_id: clientId, user_email: userEmail, platform: 'google', account_id: customerId,
        entity_level: 'campaign', entity_id: String(r.campaign?.id), entity_name: String(r.campaign?.name || ''),
        parent_entity_id: customerId, date, breakdown_type: '', breakdown_value: '',
        spend: Number(spend.toFixed(2)), impressions, clicks, conversions, conversion_value: Number(convValue.toFixed(2)), revenue: 0,
        extra: {
          ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
          roas: ratio(convValue, spend), cpa: ratio(spend, conversions), convRate: ratio(conversions, clicks, 100),
          // ⛔ PRECEDENCE, WRITTEN WHERE IT EXECUTES — `entity_state_history` WINS OVER THIS FIELD when both exist
          // and disagree. This stamps the campaign's CURRENT channel type onto every historical row it writes, so a
          // campaign converted from Search to Performance Max would be mislabelled for its entire history. The state
          // table carries the value as TIME-VARYING (SCD2, valid_from/valid_to) and is therefore the authority on
          // "what was this campaign on THAT day"; this field is the authority on "what is it now", and it exists
          // because the state table only began observing on 2026-07-30 and only sees campaigns still returned by the
          // API. READ ORDER FOR ANY CONSUMER: entity_state_history for the row's date → this field → unknown.
          // ⚠ MEASURED 2026-08-01, so the precedence is INSURANCE rather than load-bearing today: ZERO of the 86
          // campaigns in entity_state_history carry more than one advertising_channel_type value. Nothing has been
          // observed changing type yet. That is a reason to write the rule down now, not a reason to skip it.
          // ⚠ THE VALUE IS THE VENDOR'S RAW ENUM ORDINAL, NOT A NAME — the live payload returns 2 / 3 / 10, not
          // SEARCH / DISPLAY / PERFORMANCE_MAX. Stored raw on purpose: normalisation belongs at READ time, and
          // `normalizeChannelType` (google-intelligence.ts:61) currently maps STRING names only and passes numbers
          // straight through. See ★CHANNEL-TYPE-ENUM-UNMAPPED.
          channelType: String(r.campaign?.advertising_channel_type || ''),
          channelSubType: String(r.campaign?.advertising_channel_sub_type || ''),
        },
      })
    }
    campaignDayRows += Object.values(byDate).reduce((s, d) => s + d.rows.length, 0)

    for (const [date, bucket] of Object.entries(byDate)) {
      const { data: acctRow } = await supabaseAdmin
        .from('metrics_daily').select('spend,clicks,impressions,conversions')
        .eq('client_id', clientId).eq('platform', 'google').eq('entity_level', 'account')
        .eq('breakdown_type', '').eq('breakdown_value', '').eq('date', date).maybeSingle()
      // LORAMER_GOOGLE_CAMPAIGN_ANCHOR_MISSING_V1 — the ROW goes in, not fin(acctRow?.spend): that collapse
      // read a MISSING anchor as $0.00 and let this block gate pass 0-vs-0 on exactly the days it could not
      // see (9 of 18 connections on 2026-08-25). Absent anchor → anchorMissing=1 → skip + flagged, same as
      // the guarded four one anchor-grain up. Posture and tolerance unchanged.
      const { within, delta, anchorMissing, anchorMetric: acctSpend } = reconcileDayAgainstAnchorRow(bucket.spend, acctRow, { posture: 'block' })
      if (!within) {
        daysSkipped++; skipped += bucket.rows.length
        flagged.push({ date, campaign_spend: Number(bucket.spend.toFixed(2)), account_spend: Number(acctSpend.toFixed(2)), delta: Number(delta.toFixed(2)), anchor_missing_account: anchorMissing })
        continue
      }
      otherDeltas.clicks += bucket.clicks - fin(acctRow?.clicks)
      otherDeltas.impressions += bucket.impressions - fin(acctRow?.impressions)
      otherDeltas.conversions += bucket.conversions - fin(acctRow?.conversions)
      if (!opts.dryRun) {
        const { error: upErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(bucket.rows), { onConflict: CONFLICT })
        if (upErr) return { status: 500, body: { error: 'upsert failed', date, detail: upErr.message, flagged } }
      }
      written += bucket.rows.length; daysWritten++
    }
  }

  return {
    status: 200,
    body: {
      clientId, customerId, range: `${startDate}→${endDate}`, dryRun: !!opts.dryRun,
      campaignDayRows, written, skipped, daysWritten, daysSkipped,
      otherDeltas: { clicks: Math.round(otherDeltas.clicks), impressions: Math.round(otherDeltas.impressions), conversions: Number(otherDeltas.conversions.toFixed(2)) },
      flagged,
    },
  }
}
