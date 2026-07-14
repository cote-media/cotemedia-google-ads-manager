// LORAMER_LORA_CANONICAL_SETTLE_V1 (Fix #1 Part B1) — THE ONE canonical revenue settle.
// LORAMER_LORA_SPEC §1: ONE canonical computation; no parallel settle()s that can disagree.
//
// Transcribed VERBATIM from the reference implementation in
// src/app/api/next/client-metrics/route.ts:27-44 (the richest of the three copies) — NOT redesigned.
// Behaviour, field set, and rounding are byte-identical to that reference. The three live card routes
// (client-metrics, portfolio-metrics, clients/metrics) consume THIS; the Lora query_metrics tool
// adopts it in B2 so it stops being a 4th, divergent settle.
//
// LAW (do not relitigate — LORAMER_DECISIONS.md):
//   - revenue precedence store(shopify/woo) > ga > none, NEVER summed (store+ga double-counts).
//   - spend = google + meta ONLY; store/ga rows contribute NO spend.
//   - ad-platform conversion_value is NEVER revenue (google/meta rows carry revenue=0); it is a
//     separate figure (conversionValue).
//   - roas = spend>0 && revenue!=null ? revenue/spend : null  ← the CARD's basis (revenue/spend),
//     NOT conversionValue/spend.

// The accumulator shape. A caller sums account-canonical metrics_daily rows into this, per its own
// windowing. Store rows increment storeRev+storeRows; ga rows gaRev+gaRows; ads add spend/conv/etc.
export type RevenueAcc = {
  spend: number
  conversions: number
  conversionValue: number
  impressions: number
  clicks: number
  storeRev: number
  gaRev: number
  storeRows: number
  gaRows: number
}

export const emptyRevenueAcc = (): RevenueAcc => ({
  spend: 0, conversions: 0, conversionValue: 0, impressions: 0, clicks: 0,
  storeRev: 0, gaRev: 0, storeRows: 0, gaRows: 0,
})

export type SettledRevenue = {
  spend: number
  revenue: number | null
  revenueSource: 'store' | 'ga' | 'none'
  conversions: number
  conversionValue: number
  roas: number | null
  impressions: number
  clicks: number
  ctr: number | null
  cpc: number | null
  cpa: number | null
}

// guarded ratio: returns null on /0 or non-finite (never NaN/∞) — verbatim from client-metrics:24-25.
const ratio = (num: number, den: number, scale = 1): number | null =>
  den > 0 && Number.isFinite(num / den) ? Number(((num / den) * scale).toFixed(2)) : null

// settleRevenue — verbatim transcription of client-metrics/route.ts settle(a) (:27-44).
export function settleRevenue(a: RevenueAcc): SettledRevenue {
  const spend = Number(a.spend.toFixed(2))
  let revenue: number | null = null
  let revenueSource: 'store' | 'ga' | 'none' = 'none'
  if (a.storeRows > 0) { revenue = Number(a.storeRev.toFixed(2)); revenueSource = 'store' }
  else if (a.gaRows > 0) { revenue = Number(a.gaRev.toFixed(2)); revenueSource = 'ga' }
  const conversions = Number(a.conversions.toFixed(2))
  const conversionValue = Number(a.conversionValue.toFixed(2))
  const impressions = Math.round(a.impressions)
  const clicks = Math.round(a.clicks)
  const roas = spend > 0 && revenue != null && Number.isFinite(revenue / spend) ? Number((revenue / spend).toFixed(2)) : null
  return {
    spend, revenue, revenueSource, conversions, conversionValue, roas, impressions, clicks,
    ctr: ratio(a.clicks, a.impressions, 100), // percentage
    cpc: ratio(a.spend, a.clicks),
    cpa: ratio(a.spend, a.conversions),
  }
}
