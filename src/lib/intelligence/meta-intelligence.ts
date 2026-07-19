// ─── Meta Ads Intelligence Adapter ────────────────────────────────────────────
// Fetches ALL available Meta Ads data for a client account.
// Output conforms to PlatformIntelligence schema.

import type { PlatformIntelligence, IntelligenceMetrics, IntelligenceCampaign, IntelligenceAdGroup, IntelligenceAd, IntelligenceConversionAction, IntelligencePlacement, IntelligenceCampaignPlacement } from './intelligence-types'

const META_API = 'https://graph.facebook.com/v21.0'

// LORAMER_DATE_RANGE_CANONICAL_V1
function buildDatePreset(dateRange: string): string {
  const map: Record<string, string> = {
    TODAY: 'today', YESTERDAY: 'yesterday', LAST_7_DAYS: 'last_7d',
    LAST_14_DAYS: 'last_14d', LAST_30_DAYS: 'last_30d',
    THIS_MONTH: 'this_month', LAST_MONTH: 'last_month',
    LAST_90_DAYS: 'last_90d',
  }
  return map[dateRange] || 'last_30_days'
}

function buildMetrics(insight: any): IntelligenceMetrics {
  const spend = parseFloat(insight?.spend || '0')
  const clicks = parseInt(insight?.clicks || '0')
  const impressions = parseInt(insight?.impressions || '0')
  const ctr = parseFloat(insight?.ctr || '0') // Already a percentage from Meta

  const getAction = (actions: any[], type: string) => {
    const a = actions?.find((x: any) => x.action_type === type)
    return a ? parseFloat(a.value) : 0
  }

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
    spend,
    clicks,
    impressions,
    conversions,
    conversionValue: convValue,
    ctr,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    roas: spend > 0 && convValue > 0 ? convValue / spend : null,
    cpa: conversions > 0 ? spend / conversions : null,
    convRate: clicks > 0 ? (conversions / clicks) * 100 : null,
    reach,
    frequency,
    purchases: purchases || undefined,
    addToCart: addToCart || undefined,
    initiateCheckout: initiateCheckout || undefined,
    viewContent: viewContent || undefined,
    costPerPurchase: purchases > 0 ? spend / purchases : undefined,
    costPerAddToCart: addToCart > 0 ? spend / addToCart : undefined,
  }
}

async function fetchAll(url: string, token: string): Promise<any[]> {
  const results: any[] = []
  let nextUrl: string | null = url
  while (nextUrl) {
    const sep = nextUrl.includes('?') ? '&' : '?'
    const fullUrl = nextUrl + sep + 'access_token=' + token
    const res: Response = await fetch(fullUrl)
    const d: any = await res.json()
    if (d.error) throw new Error('Meta Graph error: ' + JSON.stringify(d.error))
    if (d.data) results.push(...d.data)
    nextUrl = d.paging?.next || null
    if (results.length > 500) break
  }
  return results
}

// LORAMER_META_CREATIVE_FAIL_PARTIAL_V1
// SOFT variant of fetchAll for ENRICHMENT-ONLY edges (ad entity rows, creative detail). It NEVER throws:
// a Graph error stops pagination and returns whatever pages already succeeded, plus a degradation record.
// WHY THIS EXISTS: /ads with creative{...} expansion returns HTTP 500 code 1 / subcode 99 (Meta internal)
// on page 2 for large accounts — PROVEN 2026-07-19 on act_584246708329858, which has 179 campaigns,
// 182 ad sets and 100+ ads. The hard throw at fetchAll aborted the ENTIRE client's day, so that account has
// written ZERO metrics_daily rows since 2025-09-02 while its spend, campaign, ad-set and ad PERFORMANCE
// were all returning 200 the whole time. Creative text is enrichment; spend is the system of record. An
// enrichment failure must degrade that field, never discard the day (the fail-partial / never-fail-closed
// law the read path already follows — LORAMER_INTELLIGENCE_HARDENING_V1).
async function fetchAllSoft(url: string, token: string, label: string): Promise<{ rows: any[]; degraded: boolean; detail: string | null }> {
  const results: any[] = []
  let nextUrl: string | null = url
  let page = 0
  while (nextUrl) {
    const sep = nextUrl.includes('?') ? '&' : '?'
    const fullUrl = nextUrl + sep + 'access_token=' + token
    try {
      const res: Response = await fetch(fullUrl)
      const d: any = await res.json()
      if (d.error) throw new Error('Meta Graph error: ' + JSON.stringify(d.error))
      if (d.data) results.push(...d.data)
      nextUrl = d.paging?.next || null
      page += 1
    } catch (e: any) {
      const detail = String(e?.message ?? e)
      console.warn(`[meta-intelligence] ${label}: page ${page + 1} FAILED after ${results.length} row(s) — degrading, NOT aborting: ${detail}`)
      return { rows: results, degraded: true, detail }
    }
    if (results.length > 500) break
  }
  return { rows: results, degraded: false, detail: null }
}

// LORAMER_META_CREATIVE_FAIL_PARTIAL_V1 — creative detail fetched BY EXPLICIT ID BATCH, not by cursor page.
// Cursor pagination is the trap: when page 2 fails there is no cursor for page 3, so ONE bad page blocks
// every ad after it. Batching by id makes each batch INDEPENDENT — a batch Meta cannot serve costs only the
// ads in that batch, and every later batch still runs. Small batches (25) keep the expansion light, which is
// what triggers the 500 in the first place. Preserves EXACTLY the creative fields we already captured
// (title, body, call_to_action_type, image_url, video_id) — this is the asset-attribution flagship's input
// and must not be thinned.
const CREATIVE_BATCH_SIZE = 25
async function fetchCreativesBatched(
  adIds: string[],
  token: string
): Promise<{ byAdId: Record<string, any>; batchesTotal: number; batchesFailed: number; adsMissing: number; firstError: string | null }> {
  const byAdId: Record<string, any> = {}
  let batchesFailed = 0
  let firstError: string | null = null
  const batches: string[][] = []
  for (let i = 0; i < adIds.length; i += CREATIVE_BATCH_SIZE) batches.push(adIds.slice(i, i + CREATIVE_BATCH_SIZE))

  const fetchIds = async (ids: string[]): Promise<void> => {
    const url = `${META_API}/?ids=${ids.join(',')}&fields=creative{title,body,call_to_action_type,image_url,video_id}&access_token=${token}`
    const res = await fetch(url)
    const d: any = await res.json()
    if (d.error) throw new Error('Meta Graph error: ' + JSON.stringify(d.error))
    for (const id of ids) if (d[id]) byAdId[id] = d[id]
  }

  for (const batch of batches) {
    try {
      await fetchIds(batch)
    } catch (e: any) {
      batchesFailed += 1
      if (!firstError) firstError = String(e?.message ?? e)
      // SPLIT-ON-FAILURE. Meta's code-1/subcode-99 is raised for the WHOLE batch when (apparently) a single
      // ad's creative cannot be expanded, so accepting the batch failure costs 24 healthy creatives to
      // quarantine 1 bad one — measured on act_584246708329858, where the ONE delivering ad of the day sat in
      // the poisoned batch and lost its creative for no reason. Re-fetch the batch ONE ID AT A TIME so the
      // blast radius collapses to exactly the ad(s) Meta genuinely cannot serve. Only runs on failure, so the
      // healthy path costs nothing extra.
      console.warn(`[meta-intelligence] creative batch (${batch.length} ads) failed — splitting to isolate the bad ad(s): ${String(e?.message ?? e)}`)
      for (const id of batch) {
        try {
          await fetchIds([id])
        } catch {
          // this specific ad is the unservable one — it alone loses creative detail
        }
      }
    }
  }
  const adsMissing = adIds.filter((id) => !byAdId[id]).length
  return { byAdId, batchesTotal: batches.length, batchesFailed, adsMissing, firstError }
}

export async function fetchMetaIntelligence(
  accessToken: string,
  accountId: string,
  dateRange: string,
  customStart?: string,
  customEnd?: string
): Promise<PlatformIntelligence> {
  const actId = accountId.startsWith('act_') ? accountId : 'act_' + accountId
  const dateParam = customStart && customEnd
    ? `time_range={"since":"${customStart}","until":"${customEnd}"}`
    : `date_preset=${buildDatePreset(dateRange)}`

  const insightFields = 'spend,clicks,impressions,ctr,reach,frequency,actions,action_values,conversions'
  // LORAMER_META_PLACEMENT_FIELDS_FIX_V1 — breakdowns go in &breakdowns=, NOT &fields=.
  // LORAMER_META_PLACEMENT_PERSIST_SLICE1_V1 — campaign_id,campaign_name added (additive response columns)
  // so the SAME response feeds BOTH the unchanged account-level `placements` sum AND the new per-campaign map.
  const placementFields = 'campaign_id,campaign_name,spend,clicks,impressions'

  // ── Campaigns ──────────────────────────────────────────────────────────────
  const campaignInsights = await fetchAll(
    `${META_API}/${actId}/insights?level=campaign&${dateParam}&fields=campaign_id,campaign_name,${insightFields}&filtering=[{"field":"spend","operator":"GREATER_THAN","value":"0"}]&limit=100`,
    accessToken
  )

  const campaignDetails = await fetchAll(
    `${META_API}/${actId}/campaigns?fields=id,name,status,effective_status,objective,bid_strategy,daily_budget,lifetime_budget&limit=100`,
    accessToken
  )

  const campaignDetailMap: Record<string, any> = {}
  campaignDetails.forEach((c: any) => { campaignDetailMap[c.id] = c })

  const campaigns: IntelligenceCampaign[] = campaignInsights.map((insight: any) => {
    const detail = campaignDetailMap[insight.campaign_id] || {}
    const status = detail.effective_status || detail.status || 'UNKNOWN'
    const budget = detail.daily_budget ? parseFloat(detail.daily_budget) / 100 : detail.lifetime_budget ? parseFloat(detail.lifetime_budget) / 100 : undefined
    return {
      id: insight.campaign_id,
      name: insight.campaign_name,
      platform: 'meta' as const,
      status: status.toLowerCase(),
      objective: detail.objective || '',
      bidStrategy: detail.bid_strategy || '',
      budgetType: detail.daily_budget ? 'daily' : 'lifetime',
      budget,
      metrics: buildMetrics(insight),
    }
  })

  // ── Ad Sets ────────────────────────────────────────────────────────────────
  const adSetInsights = await fetchAll(
    `${META_API}/${actId}/insights?level=adset&${dateParam}&fields=adset_id,adset_name,campaign_id,campaign_name,${insightFields}&filtering=[{"field":"spend","operator":"GREATER_THAN","value":"0"}]&limit=100`,
    accessToken
  )

  const adSetDetails = await fetchAll(
    `${META_API}/${actId}/adsets?fields=id,name,status,effective_status,campaign_id,targeting,bid_strategy,optimization_goal,billing_event,daily_budget,lifetime_budget&limit=100`,
    accessToken
  )

  const adSetDetailMap: Record<string, any> = {}
  adSetDetails.forEach((a: any) => { adSetDetailMap[a.id] = a })

  const adGroups: IntelligenceAdGroup[] = adSetInsights.map((insight: any) => {
    const detail = adSetDetailMap[insight.adset_id] || {}
    const targeting = detail.targeting || {}

    // Parse targeting for Claude context
    const parsedTargeting = {
      ageMin: targeting.age_min,
      ageMax: targeting.age_max,
      genders: targeting.genders?.map((g: number) => g === 1 ? 'male' : 'female'),
      interests: targeting.flexible_spec?.[0]?.interests?.map((i: any) => i.name).slice(0, 5),
      lookalikes: targeting.lookalike_audience?.map((l: any) => l.name).slice(0, 3),
      customAudiences: targeting.custom_audiences?.map((a: any) => a.name).slice(0, 3),
      retargeting: !!(targeting.custom_audiences?.length > 0),
    }

    return {
      id: insight.adset_id,
      name: insight.adset_name,
      campaignId: insight.campaign_id,
      campaignName: insight.campaign_name,
      platform: 'meta' as const,
      status: (detail.effective_status || detail.status || 'unknown').toLowerCase(),
      targeting: parsedTargeting,
      bidStrategy: detail.bid_strategy || '',
      optimizationGoal: detail.optimization_goal || '',
      metrics: buildMetrics(insight),
    }
  })

  // ── Ads ────────────────────────────────────────────────────────────────────
  const adInsights = await fetchAll(
    `${META_API}/${actId}/insights?level=ad&${dateParam}&fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,${insightFields}&filtering=[{"field":"spend","operator":"GREATER_THAN","value":"0"}]&limit=100`,
    accessToken
  )

  // LORAMER_META_CREATIVE_FAIL_PARTIAL_V1 — SPLIT into (1) a light ad-ENTITY page walk with NO creative
  // expansion, and (2) creative detail by independent id batch. The old single call combined both and was
  // fatal: one 500 on the creative expansion threw away the whole client's day (act_584246708329858, zero
  // rows since 2025-09-02). Both halves are now SOFT — enrichment can degrade, performance cannot be lost.
  const adEntityResult = await fetchAllSoft(
    `${META_API}/${actId}/ads?fields=id,name,status,effective_status,adset_id,campaign_id&limit=100`,
    accessToken,
    'ad entities'
  )
  const adDetails = adEntityResult.rows

  const adDetailMap: Record<string, any> = {}
  adDetails.forEach((a: any) => { adDetailMap[a.id] = a })

  // Creative detail for the ads that actually DELIVERED (the insight set) plus any entity rows we hold —
  // never the whole account. Fewer ids = fewer batches = less of the expansion that triggers Meta's 500.
  // DELIVERING ADS FIRST. Ads that actually spent are the asset-attribution flagship's real input, so they
  // go in the earliest batches — they get their creative before any budget/limit is reached, and they are
  // never queued behind a poisoned batch of dormant ads.
  const creativeAdIds = Array.from(new Set<string>([
    ...adInsights.map((i: any) => String(i.ad_id)).filter(Boolean),
    ...adDetails.map((a: any) => String(a.id)).filter(Boolean),
  ]))
  const creativeResult = await fetchCreativesBatched(creativeAdIds, accessToken)
  for (const [adId, node] of Object.entries(creativeResult.byAdId)) {
    adDetailMap[adId] = { ...(adDetailMap[adId] || { id: adId }), creative: (node as any).creative }
  }
  if (adEntityResult.degraded || creativeResult.batchesFailed > 0) {
    console.warn(
      `[meta-intelligence] ${actId} DEGRADED-NOT-DROPPED: adEntities=${adDetails.length}${adEntityResult.degraded ? ' (page walk cut short)' : ''} · ` +
      `creative batches ${creativeResult.batchesTotal - creativeResult.batchesFailed}/${creativeResult.batchesTotal} ok · ` +
      `${creativeResult.adsMissing} ad(s) without creative detail · performance rows UNAFFECTED`
    )
  }

  const ads: IntelligenceAd[] = adInsights.map((insight: any) => {
    const detail = adDetailMap[insight.ad_id] || {}
    const creative = detail.creative || {}
    const hasVideo = !!creative.video_id
    const hasImage = !!creative.image_url

    return {
      id: insight.ad_id,
      name: insight.ad_name,
      adGroupId: insight.adset_id,
      adGroupName: insight.adset_name,
      campaignId: insight.campaign_id,
      campaignName: insight.campaign_name,
      platform: 'meta' as const,
      status: (detail.effective_status || detail.status || 'unknown').toLowerCase(),
      creativeType: hasVideo ? 'video' : hasImage ? 'image' : 'text',
      headline: creative.title || '',
      body: creative.body || '',
      callToAction: creative.call_to_action_type || '',
      metrics: buildMetrics(insight),
    }
  })

  // ── Placement Breakdown ────────────────────────────────────────────────────
  // LORAMER_INTELLIGENCE_HONESTY_V1 — removed RAW_DEBUG_V1 instrumentation.
  // Underlying bug (breakdowns in fields param) was fixed in
  // LORAMER_META_PLACEMENT_FIELDS_FIX_V1; the raw response capture was
  // diagnostic only and per Lesson 15 should never linger in the prompt path.
  // This call now matches the same fetchAll pattern used for campaigns/ad sets/ads.
  const placementInsights = await fetchAll(
    `${META_API}/${actId}/insights?level=campaign&${dateParam}&breakdowns=publisher_platform,platform_position&fields=${placementFields}&limit=200`,
    accessToken
  )

  // LORAMER_PROJECT_3_STEP_4A_V1 — aggregate Meta placement data into a typed
  // array with full metrics, not just a spend record. Each row is a
  // (publisher_platform × platform_position) combination — e.g. Facebook Feed,
  // Instagram Reels, Audience Network Native.
  const placementMap: Record<string, IntelligencePlacement> = {}
  placementInsights.forEach((p: any) => {
    const publisher = String(p.publisher_platform || '').toLowerCase()
    const position = String(p.platform_position || '').toLowerCase()
    const key = `${publisher}|${position}`
    if (!placementMap[key]) {
      placementMap[key] = {
        publisherPlatform: publisher,
        platformPosition: position,
        spend: 0,
        clicks: 0,
        impressions: 0,
      }
    }
    placementMap[key].spend += parseFloat(p.spend || '0')
    placementMap[key].clicks += parseFloat(p.clicks || '0')
    placementMap[key].impressions += parseFloat(p.impressions || '0')
  })
  const placements: IntelligencePlacement[] = Object.values(placementMap)
    .sort((a, b) => b.spend - a.spend)

  // LORAMER_META_PLACEMENT_PERSIST_SLICE1_V1 — SECOND aggregation from the SAME response, keyed by
  // campaign × placement, for metrics_daily persistence. The account-level `placements` array above is
  // UNTOUCHED (Lora prompt byte-identical). Rows missing campaign_id are skipped (never pollute the grain).
  const campaignPlacementMap: Record<string, IntelligenceCampaignPlacement> = {}
  placementInsights.forEach((p: any) => {
    const campaignId = String(p.campaign_id || '')
    if (!campaignId) return
    const publisher = String(p.publisher_platform || '').toLowerCase()
    const position = String(p.platform_position || '').toLowerCase()
    const key = `${campaignId}|${publisher}|${position}`
    if (!campaignPlacementMap[key]) {
      campaignPlacementMap[key] = {
        campaignId,
        campaignName: String(p.campaign_name || ''),
        publisherPlatform: publisher,
        platformPosition: position,
        spend: 0,
        clicks: 0,
        impressions: 0,
      }
    }
    campaignPlacementMap[key].spend += parseFloat(p.spend || '0')
    campaignPlacementMap[key].clicks += parseFloat(p.clicks || '0')
    campaignPlacementMap[key].impressions += parseFloat(p.impressions || '0')
  })
  const campaignPlacements: IntelligenceCampaignPlacement[] = Object.values(campaignPlacementMap)
    .sort((a, b) => b.spend - a.spend)

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalSpend = campaigns.reduce((s, c) => s + c.metrics.spend, 0)
  const totalClicks = campaigns.reduce((s, c) => s + c.metrics.clicks, 0)
  const totalImpressions = campaigns.reduce((s, c) => s + c.metrics.impressions, 0)
  const totalConversions = campaigns.reduce((s, c) => s + c.metrics.conversions, 0)
  const totalConvValue = campaigns.reduce((s, c) => s + c.metrics.conversionValue, 0)
  const totalReach = campaigns.reduce((s, c) => s + (c.metrics.reach || 0), 0)

  const totals: IntelligenceMetrics = {
    spend: totalSpend,
    clicks: totalClicks,
    impressions: totalImpressions,
    conversions: totalConversions,
    conversionValue: totalConvValue,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    roas: totalSpend > 0 && totalConvValue > 0 ? totalConvValue / totalSpend : null,
    cpa: totalConversions > 0 ? totalSpend / totalConversions : null,
    convRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : null,
    reach: totalReach,
  }

  return {
    connected: true,
    accountId,
    dateRange,
    fetchedAt: new Date().toISOString(),
    campaigns,
    adGroups,
    ads,
    conversionActions: [],
    placements,  // LORAMER_PROJECT_3_STEP_4A_V1 (account-level; Lora prompt — UNCHANGED)
    campaignPlacements,  // LORAMER_META_PLACEMENT_PERSIST_SLICE1_V1 (campaign × placement; metrics_daily)
    totals,
  }
}
