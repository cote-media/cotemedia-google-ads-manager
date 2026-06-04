// LORAMER_BACKFILL_META_0B_V1
// Account-level daily Meta Ads Insights fetch, used by the historical backfill
// (/api/backfill/meta). Mirrors the proven daily mechanics in /api/meta/daily
// (Graph v18.0, time_increment=1, paginated). See handoff note on the Meta
// conversion seam: spend/impressions/clicks reconcile exactly with forward
// capture; conversion COUNT uses the account-level definition below, which the
// per-campaign forward-capture cron cannot be reproduced from at account level.

// Account-level daily conversion action set (matches /api/meta/daily). NOTE: the
// forward-capture cron uses a per-campaign priority pick that differs - documented
// seam, not a bug.
export const META_CONV_TYPES = ['purchase', 'lead', 'complete_registration', 'offsite_conversion', 'submit_application']

export type MetaDailyRow = {
  date: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
}

export function mapMetaDailyInsightRow(row: any): MetaDailyRow {
  const actions: any[] = row.actions || []
  const actionValues: any[] = row.action_values || []
  const conversions = actions
    .filter(a => META_CONV_TYPES.includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value || '0'), 0)
  const convValue = actionValues
    .filter(a => a.action_type === 'purchase')
    .reduce((s, a) => s + parseFloat(a.value || '0'), 0)
  return {
    date: row.date_start,
    cost: parseFloat(row.spend || '0'),
    clicks: parseInt(row.clicks || '0', 10),
    impressions: parseInt(row.impressions || '0', 10),
    conversions: parseFloat(conversions.toFixed(1)),
    conversionValue: parseFloat(convValue.toFixed(2)),
  }
}

// Fetch ACCOUNT-LEVEL daily metrics over an INCLUSIVE [since, until] window.
// Paginates Graph paging.next. Throws on Graph errors so the backfill fails loudly
// instead of silently returning [] (handoff lessons 8 + 12: time_increment is a
// PARAM, never a fields value).
export async function fetchMetaDailyMetrics(
  accessToken: string,
  accountId: string,
  since: string,
  until: string
): Promise<MetaDailyRow[]> {
  const id = accountId.startsWith('act_') ? accountId : 'act_' + accountId
  const fields = 'spend,clicks,impressions,actions,action_values'
  const timeRange = '{"since":"' + since + '","until":"' + until + '"}'
  let nextUrl: string | null =
    'https://graph.facebook.com/v18.0/' + id + '/insights?fields=' + fields +
    '&time_increment=1&time_range=' + timeRange + '&limit=90&access_token=' + accessToken

  const rows: any[] = []
  let pages = 0
  while (nextUrl && pages < 200) {
    pages += 1
    const res: Response = await fetch(nextUrl)
    const data: any = await res.json()
    if (data.error) {
      throw new Error('Meta Graph error: ' + (data.error.message || JSON.stringify(data.error)))
    }
    if (Array.isArray(data.data)) rows.push(...data.data)
    nextUrl = data.paging?.next || null
  }
  return rows.map(mapMetaDailyInsightRow)
}
