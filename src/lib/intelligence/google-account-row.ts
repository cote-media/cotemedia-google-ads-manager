// LORAMER_GOOGLE_FORWARD_RESTATE_V1 — THE ONE PRODUCER OF GOOGLE `entity_level='account'` ROWS.
//
// ⛔ WHY THIS FILE EXISTS, AND WHY IT IS NOT A SUM OF CAMPAIGNS.
// Until now the account row was `data.totals` from fetchGoogleIntelligence — a reduce over the campaign
// query, filtered `campaign.status != 'REMOVED'`, stamped with ONE date. Two defects fell out of that:
//   (1) it could never be range-widened (a wider range writes a MULTI-DAY SUM onto one day), so Google
//       forward capture could never restate — measured 2026-08-24, spend/clicks/conversions all move
//       AFTER capture and nothing ever re-asked the day;
//   (2) the `!= 'REMOVED'` filter drops spend that genuinely occurred. Russ's ruling, 2026-08-24: an
//       account total INCLUDES campaigns that were later deleted, because the money was really spent.
//
// ⛔ AND WHY NOT "just sum all campaigns", which expresses the ruling directly and costs no request:
// google-campaign-backfill reconciles each day's campaign sum against the ACCOUNT row with
// `posture: 'block'` — a day whose campaign rows disagree with the account anchor is NOT WRITTEN. That
// check only means something while the account row comes from an INDEPENDENT fetch. Derive the account
// row from the campaign rows and the reconciler compares its own output to itself: delta 0 by
// construction, the block gate can never fire, and the only detector for a truncated or partial campaign
// fetch is gone — silently. google-adgroup-ad-backfill anchors on the same row and loses the same thing.
//
// SO: the source is `FROM customer` — Google's own account-grain report. It is per-day by construction
// (segments.date), ranged in ONE request, has no campaign filter to apply (so it satisfies the ruling by
// construction rather than by approximation), and is INDEPENDENT of the campaign query, which keeps both
// reconcilers honest.
//
// MEASURED EQUIVALENCE (client ids below are registry ids — verify against src/lib/clients/canonical.ts,
// never against a name), live, 2026-08-24, window 2026-07-25..2026-08-23 (30 days), three clients —
// `FROM customer` vs the sum of ALL campaigns, on all five metrics:
//   60e6dd99 Bath Fitter  $76,877.82 / 3,986 clicks / 52,842 impr / 703.99 conv   DELTA 0 on all five
//   c39ee088 Escential     $4,000.44 / 9,012 / 349,742 / 790.99                   DELTA 0 on all five
//   366afedc Champion     $13,272.95 / 717 / 13,018 / 46.00                       DELTA 0 on all five
// Each returned exactly 30 rows over 30 days. The fleet census on the same window found ZERO removed
// campaigns across all 18 connections, so the ruling ships at a measured $0.00 delta today — and the
// first client to delete a campaign is the first day the two derivations would have diverged.
import { googleAdsCustomerFor } from '@/lib/google-ads-client'

export interface GoogleAccountDay {
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
}

const fin = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const ratio = (num: number, den: number, mult = 1): number => (den > 0 ? (num / den) * mult : 0)

/** ONE ranged query against Google's own account report. Per-day rows, no campaign filter, no status
 *  filter — there is none to apply at this grain, which is exactly why this is the right source. */
export async function fetchGoogleAccountWindow(
  refreshToken: string, customerId: string, startDate: string, endDate: string
): Promise<GoogleAccountDay[]> {
  const customer = googleAdsCustomerFor({ refreshToken, customerId })
  const rows = await customer.query(`
    SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM customer WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `)
  const out: GoogleAccountDay[] = []
  for (const r of rows as any[]) {
    const date = String(r.segments?.date || '')
    if (!date) continue
    out.push({
      date,
      spend: fin(r.metrics?.cost_micros) / 1e6,
      impressions: fin(r.metrics?.impressions),
      clicks: fin(r.metrics?.clicks),
      conversions: fin(r.metrics?.conversions),
      conversionValue: fin(r.metrics?.conversions_value),
    })
  }
  return out
}

/** metrics_daily rows, one per day. Shape is byte-compatible with the account row buildGoogleMetricsRows
 *  used to emit (same conflict key, same extra{} keys), so a re-pull REPLACES rather than duplicates. */
export function buildGoogleAccountRows(
  clientId: string, userEmail: string, customerId: string, accountName: string | null | undefined, days: GoogleAccountDay[]
): Record<string, unknown>[] {
  return days.map((d) => {
    const spend = Number(d.spend.toFixed(2))
    const convValue = Number(d.conversionValue.toFixed(2))
    return {
      client_id: clientId,
      user_email: userEmail,
      platform: 'google',
      account_id: customerId,
      entity_level: 'account',
      entity_id: customerId,
      entity_name: accountName || customerId,
      date: d.date,
      breakdown_type: '',
      breakdown_value: '',
      spend,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
      conversion_value: convValue,
      revenue: 0,
      extra: {
        ctr: ratio(d.clicks, d.impressions, 100),
        cpc: ratio(spend, d.clicks),
        cpm: ratio(spend, d.impressions, 1000),
        roas: spend > 0 && convValue > 0 ? convValue / spend : null,
        cpa: d.conversions > 0 ? spend / d.conversions : null,
        convRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : null,
      },
    }
  })
}
