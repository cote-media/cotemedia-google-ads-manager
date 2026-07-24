// LORAMER_BACKFILL_META_0B_V1
// Account-level daily Meta Ads Insights fetch, used by the historical backfill
// (/api/backfill/meta). Mirrors the proven daily mechanics in /api/meta/daily
// (Graph v21.0, time_increment=1, paginated). See handoff note on the Meta
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
  reach: number
  frequency: number
  conversions: number
  conversionValue: number
  // LORAMER_META_ACCOUNT_FIELD_PARITY_V1 — full account-grain parity vs the old buildMetaMetricsRows, fetched
  // account-NATIVE (unique_* de-dup is Meta's own account figure, NOT the summed-campaign upper bound). Absent
  // stays undefined ("not served" ≠ "none").
  outboundClicks?: number
  inlineLinkClicks?: number
  uniqueClicks?: number
  uniqueInlineLinkClicks?: number
  uniqueOutboundClicks?: number
  purchases?: number
  addToCart?: number
  initiateCheckout?: number
  viewContent?: number
  costPerPurchase?: number
  costPerAddToCart?: number
  attributionSetting?: string | null
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
  // LORAMER_META_ACCOUNT_FIELD_PARITY_V1 — mirror meta-intelligence.buildMetrics so the restatement base row matches
  // the old base's coverage. getAction/actionSum: absent stays undefined (never 0) — "not served" ≠ "none".
  const cost = parseFloat(row.spend || '0')
  const getAction = (type: string) => { const a = actions.find((x: any) => x.action_type === type); return a ? parseFloat(a.value || '0') : 0 }
  const actionSum = (arr: any): number | undefined => Array.isArray(arr) ? arr.reduce((t: number, x: any) => t + (parseFloat(x?.value) || 0), 0) : undefined
  const purchases = getAction('offsite_conversion.fb_pixel_purchase')
  const addToCart = getAction('offsite_conversion.fb_pixel_add_to_cart')
  const initiateCheckout = getAction('offsite_conversion.fb_pixel_initiate_checkout')
  const viewContent = getAction('offsite_conversion.fb_pixel_view_content')
  return {
    date: row.date_start,
    cost,
    clicks: parseInt(row.clicks || '0', 10),
    impressions: parseInt(row.impressions || '0', 10),
    reach: parseInt(row.reach || '0', 10),
    frequency: parseFloat(row.frequency || '0'),
    conversions: parseFloat(conversions.toFixed(1)),
    conversionValue: parseFloat(convValue.toFixed(2)),
    outboundClicks: actionSum(row.outbound_clicks),
    inlineLinkClicks: row.inline_link_clicks != null ? parseInt(String(row.inline_link_clicks), 10) : actionSum(row.inline_link_clicks),
    uniqueClicks: row.unique_clicks != null ? parseInt(String(row.unique_clicks), 10) : undefined,
    uniqueInlineLinkClicks: row.unique_inline_link_clicks != null ? parseInt(String(row.unique_inline_link_clicks), 10) : undefined,
    uniqueOutboundClicks: actionSum(row.unique_outbound_clicks),
    purchases: purchases || undefined,
    addToCart: addToCart || undefined,
    initiateCheckout: initiateCheckout || undefined,
    viewContent: viewContent || undefined,
    costPerPurchase: purchases > 0 ? cost / purchases : undefined,
    costPerAddToCart: addToCart > 0 ? cost / addToCart : undefined,
    attributionSetting: row.attribution_setting ?? null,
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
  // LORAMER_META_ACCOUNT_FIELD_PARITY_V1 — full account-native field set (click-variants + attribution_setting);
  // action-based purchases/add_to_cart/initiate_checkout/view_content derive from actions[] in the mapper (no extra call).
  const fields = 'spend,clicks,impressions,reach,frequency,actions,action_values,outbound_clicks,inline_link_clicks,unique_clicks,unique_inline_link_clicks,unique_outbound_clicks,attribution_setting'
  const timeRange = '{"since":"' + since + '","until":"' + until + '"}'
  // LORAMER_META_API_VERSION_BUMP_V1 — v18.0 is EXPIRED (Meta silently auto-upgrades expired-version calls to the
  // oldest available version — undocumented + fragile). Pin to v21.0 to match the rest of the Meta layer (a full
  // codebase→current move is a separate queued flight). action_attribution_windows set explicitly (7d_click,1d_view
  // = Meta's default unified window) so the base conversion number is self-describing + reproducible.
  let nextUrl: string | null =
    'https://graph.facebook.com/v21.0/' + id + '/insights?fields=' + fields +
    '&time_increment=1&action_attribution_windows=7d_click,1d_view&time_range=' + timeRange + '&limit=90&access_token=' + accessToken

  const rows: any[] = []
  let pages = 0
  while (nextUrl && pages < 200) {
    pages += 1
    const res: Response = await fetch(nextUrl)
    const data: any = await res.json()
    if (data.error) {
      // Backfill-only fetcher (sole caller = the backfill adapter): surface code/subcode/http so the backfill
      // boundary can classify per the verified Meta taxonomy (retryable vs query-too-heavy #100/1487534 vs
      // token/disabled). Message is unchanged → any caller reading .message is unaffected.
      const err: any = new Error('Meta Graph error: ' + (data.error.message || JSON.stringify(data.error)))
      err.code = data.error.code
      err.error_subcode = data.error.error_subcode
      err.http = res.status
      throw err
    }
    if (Array.isArray(data.data)) rows.push(...data.data)
    nextUrl = data.paging?.next || null
  }
  return rows.map(mapMetaDailyInsightRow)
}
