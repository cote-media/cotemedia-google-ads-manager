// ─── Universal Claude Context Builder ─────────────────────────────────────────
// Converts a ClientIntelligence object into a rich system prompt.
// Every Claude call uses this — InsightChat, AskClaudeButton, chat tab, everything.
//
// Conversation memory:
//   - ALL conversations across ALL panels for the client are merged
//   - Last 20 messages kept (was 6) — directives from earlier sessions survive
//   - Per-message char limit raised to 800 (was 200)
//   - Heuristic scan for "directive-like" statements pulls them into a
//     dedicated DIRECTIVES section at the TOP of the prompt
//   - Directives are also re-stated as hard constraints in the rules section
//     so 50-word insight outputs can't drop them

import type {
  ClientIntelligence,
  IntelligenceGa,
  IntelligenceShopify,
  PlatformIntelligence,
} from './intelligence-types'

const OBJECTIVE_RULES: Record<string, string> = {
  OUTCOME_AWARENESS: 'Brand Awareness — evaluate CPM/reach ONLY. NEVER mention CTR or ROAS.',
  OUTCOME_ENGAGEMENT: 'Engagement — evaluate CPE and engagement rate only.',
  OUTCOME_LEADS: 'Lead Generation — CPL is the ONLY metric that matters.',
  OUTCOME_SALES: 'Sales/Conversions — ROAS and CPA are primary.',
  OUTCOME_TRAFFIC: 'Traffic — CTR and CPC matter. Do NOT expect or evaluate conversions.',
  REACH: 'Reach — maximize reach at lowest CPM. CTR irrelevant.',
  VIDEO_VIEWS: 'Video Views — view rate and ThruPlays ONLY. CTR is irrelevant.',
  SEARCH: 'Search — CTR, Quality Score, CPC. Conversions expected.',
  DISPLAY: 'Display — 0.1-0.35% CTR is completely normal. NEVER call display CTR low.',
  PERFORMANCE_MAX: 'Performance Max — evaluate conversion efficiency and ROAS only.',
  SHOPPING: 'Shopping — ROAS and CPA primary.',
  DISCOVERY: 'Discovery/Demand Gen — upper funnel. Do not expect high conversion volume.',
}

// LORAMER_PROJECT_3_STEP_1_V1 ─────────────────────────────────────────────────
// Focus-aware data slicing. Each surface that calls buildClaudeContext passes
// a focus string. We normalize it to a typed FocusMode and use the mode to
// decide how much of each platform's data to render in the prompt.
//
// Step 1 sets up the scaffolding with current behavior as the default.
// Step 2 will add new data sections (search terms, asset performance, audience
// segments, etc.) that respect these same limits.

export type FocusMode =
  | 'overview'           // main dashboard, broad analysis
  | 'campaigns'          // campaigns tab, full campaign list visible
  | 'adgroups'           // drilled into ad groups under a campaign
  | 'ads'                // drilled into ads under an ad group
  | 'keywords'           // keywords tab (Google)
  | 'shopify'            // shopify tab
  | 'woocommerce'        // woocommerce tab
  | 'asset-attribution'  // PMax / asset-level analysis (Step 2+)
  | 'audience'           // audience-segment analysis (Step 2+)
  | 'search-terms'       // search-term report drill (Step 2+)
  | 'health'             // account-health focus (Step 4+)
  | 'row-context'        // ✦ diamond on a specific row — uses row scope to pick limits

export type DataLimits = {
  campaigns: number          // how many campaigns to render
  adGroups: number           // how many ad groups
  ads: number                // how many ads
  keywords: number           // how many keywords
  conversionActions: number  // how many conversion actions
  topProducts: number        // how many shopify/woo products
  // Step 2+ fields (placeholders for now, default 0)
  searchTerms: number
  audiences: number
  assetGroups: number
  assetsPerGroup: number
  demographics: number
  geographic: number
}

const DEFAULT_LIMITS: DataLimits = {
  campaigns: 15,
  adGroups: 20,
  ads: 20,
  keywords: 20,
  conversionActions: 50,
  topProducts: 5,
  // LORAMER_PROJECT_3_STEP_2A_V1 — search terms enabled
  searchTerms: 10,
  audiences: 10,       // LORAMER_PROJECT_3_STEP_2C_V1
  assetGroups: 8,      // LORAMER_PROJECT_3_STEP_2F_V1
  assetsPerGroup: 25,  // LORAMER_PROJECT_3_STEP_2E_V1
  demographics: 15,    // LORAMER_PROJECT_3_STEP_2D_V1
  geographic: 0,       // Step 3 fills this
}

// Normalize any incoming focus string (which may be a label, a drill key like
// "adgroups:Campaign Name", a platform name like "google", etc.) into a
// typed FocusMode plus the original string for the prompt's "Current view"
// label.
export function normalizeFocus(focus: string | undefined): { mode: FocusMode; label: string } {
  const f = (focus || 'overview').toLowerCase().trim()
  // Drill keys arrive as "adgroups:..." or "ads:..."
  if (f.startsWith('adgroups')) return { mode: 'adgroups', label: focus || 'adgroups' }
  if (f.startsWith('ads')) return { mode: 'ads', label: focus || 'ads' }
  if (f === 'campaigns') return { mode: 'campaigns', label: focus || 'campaigns' }
  if (f === 'keywords') return { mode: 'keywords', label: focus || 'keywords' }
  if (f === 'shopify') return { mode: 'shopify', label: focus || 'shopify' }
  if (f === 'woocommerce') return { mode: 'woocommerce', label: focus || 'woocommerce' }
  if (f === 'asset-attribution' || f.startsWith('asset')) return { mode: 'asset-attribution', label: focus || 'asset-attribution' }
  if (f === 'audience' || f.startsWith('audience')) return { mode: 'audience', label: focus || 'audience' }
  if (f === 'search-terms' || f === 'searchterms') return { mode: 'search-terms', label: focus || 'search-terms' }
  if (f === 'health') return { mode: 'health', label: focus || 'health' }
  // Platform labels: google/meta/combined act like overview
  if (f === 'google' || f === 'meta' || f === 'combined' || f === 'overview') return { mode: 'overview', label: focus || 'overview' }
  // Anything else (e.g. row clicks with custom strings) gets row-context
  return { mode: 'row-context', label: focus || 'row-context' }
}

export function getDataLimitsForFocus(mode: FocusMode): DataLimits {
  switch (mode) {
    case 'overview':
      return { ...DEFAULT_LIMITS, campaigns: 15, adGroups: 20, ads: 20, keywords: 20 }
    case 'campaigns':
      // Campaigns tab — show ALL campaigns, fewer of the others
      return { ...DEFAULT_LIMITS, campaigns: 50, adGroups: 10, ads: 10, keywords: 10, searchTerms: 15, audiences: 20 }
    case 'adgroups':
      // Drilled into ad groups for one campaign — emphasize ad groups + ads
      return { ...DEFAULT_LIMITS, campaigns: 5, adGroups: 30, ads: 20, keywords: 10, searchTerms: 10 }
    case 'ads':
      // Drilled into ads for one ad group — maximize ad detail
      return { ...DEFAULT_LIMITS, campaigns: 3, adGroups: 5, ads: 30, keywords: 5, searchTerms: 5 }
    case 'keywords':
      // Keywords tab — full picture pairs keywords with search terms that triggered
      return { ...DEFAULT_LIMITS, campaigns: 10, adGroups: 10, ads: 5, keywords: 50, searchTerms: 30, audiences: 15 }
    case 'shopify':
    case 'woocommerce':
      return { ...DEFAULT_LIMITS, campaigns: 5, adGroups: 5, ads: 5, keywords: 5, searchTerms: 5, topProducts: 20 }
    case 'asset-attribution':
      // Step 2 will populate assetGroups + assetsPerGroup limits
      return { ...DEFAULT_LIMITS, campaigns: 8, adGroups: 5, ads: 10, keywords: 0, assetGroups: 15, assetsPerGroup: 50 }
    case 'audience':
      return { ...DEFAULT_LIMITS, campaigns: 8, adGroups: 10, ads: 5, keywords: 5, audiences: 30 }
    case 'search-terms':
      // Dedicated search terms focus — the deep dive
      return { ...DEFAULT_LIMITS, campaigns: 5, adGroups: 5, ads: 5, keywords: 30, searchTerms: 50 }
    case 'health':
      return { ...DEFAULT_LIMITS, campaigns: 10, adGroups: 5, ads: 5, keywords: 5 }
    case 'row-context':
      return { ...DEFAULT_LIMITS, campaigns: 10, adGroups: 15, ads: 15, keywords: 15 }
    default:
      return DEFAULT_LIMITS
  }
}
// ── end LORAMER_PROJECT_3_STEP_1_V1 ───────────────────────────────────────────


const DIRECTIVE_PATTERNS: RegExp[] = [
  /\bignore\b/i,
  /\bdon'?t\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include|flag|highlight|surface)/i,
  /\bdo\s+not\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include|flag|highlight|surface)/i,
  /\bstop\s+(?:mentioning|recommending|suggesting|focusing|talking|flagging|highlighting|surfacing)/i,
  /\bfocus\s+on\b/i,
  /\bprioriti[sz]e\b/i,
  /\b(?:we|i)\s+(?:only|just)\s+care\s+about/i,
  /\bnot\s+important\b/i,
  /\binstead\s+of\b/i,
  /\bremember\s+that\b/i,
  /\bkeep\s+in\s+mind\b/i,
  /\bnever\s+(?:mention|recommend|suggest|focus|use|include|flag|surface)/i,
  /\balways\s+(?:mention|recommend|suggest|focus|use|include|consider)/i,
  /\btarget\s+(?:is|for)\b.*\$/i,
  /\bfor\s+now\b/i,
  /\bdeprioriti[sz]e\b/i,
  /\bdisregard\b/i,
  /\bset\s+aside\b/i,
  /\bnot\s+(?:focus|worry|track|measure)/i,
]

// Try to extract a normalized "rule" from a directive snippet. E.g.,
// "ignore ROAS for now" → "Do not mention ROAS"
// "focus on lead volume instead" → "Focus on lead volume"
// If we can't normalize cleanly, return the raw snippet.
function normalizeDirective(snippet: string): string {
  const s = snippet.trim()
  // Trim leading conversation cruft
  const cleaned = s
    .replace(/^(yeah|yes|ok|okay|hey|so|but|and|also|please|just|hi)\s*[,:]?\s*/i, '')
    .replace(/^haven'?t\s+i\s+told\s+you\s+(not\s+to\s+|to\s+not\s+|to\s+)?/i, '')
    .replace(/^i\s+told\s+you\s+(not\s+to\s+|to\s+not\s+|to\s+)?/i, '')
    .trim()
  return cleaned || s
}

function formatMetrics(m: any, indent = ''): string {
  const lines = []
  if (m.spend != null) lines.push(`Spend: $${m.spend.toFixed(2)}`)
  if (m.clicks != null) lines.push(`Clicks: ${m.clicks.toLocaleString()}`)
  if (m.impressions != null) lines.push(`Impressions: ${m.impressions.toLocaleString()}`)
  if (m.ctr != null) lines.push(`CTR: ${m.ctr.toFixed(2)}%`)
  if (m.cpc != null && m.cpc > 0) lines.push(`CPC: $${m.cpc.toFixed(2)}`)
  if (m.cpm != null && m.cpm > 0) lines.push(`CPM: $${m.cpm.toFixed(2)}`)
  if (m.reach != null && m.reach > 0) lines.push(`Reach: ${m.reach.toLocaleString()}`)
  if (m.frequency != null && m.frequency > 0) lines.push(`Frequency: ${m.frequency.toFixed(2)}`)
  if (m.conversions != null) lines.push(`Conversions: ${m.conversions.toFixed(1)}`)
  if (m.roas != null) lines.push(`ROAS: ${m.roas.toFixed(2)}x`)
  if (m.cpa != null) lines.push(`CPA: $${m.cpa.toFixed(2)}`)
  if (m.convRate != null) lines.push(`Conv Rate: ${m.convRate.toFixed(2)}%`)
  if (m.purchases != null && m.purchases > 0) lines.push(`Purchases: ${m.purchases}`)
  if (m.addToCart != null && m.addToCart > 0) lines.push(`Add to Cart: ${m.addToCart}`)
  if (m.costPerPurchase != null) lines.push(`Cost/Purchase: $${m.costPerPurchase.toFixed(2)}`)
  return lines.map(l => indent + l).join(', ')
}

// LORAMER_GA_CLAUDE_CONTEXT_V1
function formatGaRate(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a'
  const pct = value <= 1 ? value * 100 : value
  return `${pct.toFixed(2)}%`
}

function buildGaSection(ga: IntelligenceGa | undefined, limits: DataLimits): string {
  if (!ga?.connected) return ''
  const lines: string[] = []
  const listLimit = 10

  lines.push('\n=== GOOGLE ANALYTICS ===')
  if (ga.propertyName || ga.propertyId) {
    const idPart = ga.propertyId ? ` (${ga.propertyId})` : ''
    lines.push(`Property: ${ga.propertyName || ga.propertyId || 'Unknown'}${idPart}`)
  }

  const hasData = (ga.sessions ?? 0) > 0
  if (!hasData) {
    lines.push(
      'Google Analytics is connected, but no session data is available for this date range. Do not infer or invent GA metrics from prior turns — say so honestly if asked.'
    )
    return lines.join('\n')
  }

  const totalUsers = ga.totalUsers ?? 0
  const newUsers = ga.newUsers ?? 0
  const returningUsers = Math.max(0, totalUsers - newUsers)

  lines.push('Account totals:')
  lines.push(`  Sessions: ${(ga.sessions ?? 0).toLocaleString()}`)
  lines.push(`  Total users: ${totalUsers.toLocaleString()}`)
  lines.push(`  New users: ${newUsers.toLocaleString()}`)
  lines.push(`  Returning users (total − new): ${returningUsers.toLocaleString()}`)
  lines.push(`  Engagement rate: ${formatGaRate(ga.engagementRate)}`)
  lines.push(`  Conversions: ${(ga.conversions ?? 0).toFixed(1)}`)
  lines.push(`  Revenue: $${(ga.totalRevenue ?? 0).toFixed(2)}`)
  lines.push(`  Transactions: ${(ga.transactions ?? 0).toLocaleString()}`)

  if (ga.topTrafficSources?.length) {
    lines.push(`\nTop traffic sources (top ${Math.min(ga.topTrafficSources.length, listLimit)} by sessions):`)
    ga.topTrafficSources.slice(0, listLimit).forEach((row) => {
      lines.push(
        `  • ${row.source} / ${row.medium}: ${row.sessions.toLocaleString()} sessions, ${row.conversions.toFixed(1)} conv, $${row.totalRevenue.toFixed(2)} revenue`
      )
    })
  }

  if (ga.topCampaigns?.length) {
    lines.push(`\nTop campaigns (top ${Math.min(ga.topCampaigns.length, listLimit)} by sessions):`)
    ga.topCampaigns.slice(0, listLimit).forEach((row) => {
      lines.push(
        `  • ${row.campaignName}: ${row.sessions.toLocaleString()} sessions, ${row.conversions.toFixed(1)} conv, $${row.totalRevenue.toFixed(2)} revenue`
      )
    })
  }

  if (ga.topLandingPages?.length) {
    lines.push(`\nTop landing pages (top ${Math.min(ga.topLandingPages.length, listLimit)} by sessions):`)
    ga.topLandingPages.slice(0, listLimit).forEach((row) => {
      lines.push(
        `  • ${row.landingPage}: ${row.sessions.toLocaleString()} sessions, session conv rate ${formatGaRate(row.sessionConversionRate)}`
      )
    })
  }

  if (ga.conversionEvents?.length) {
    lines.push(`\nTop conversion events (top ${Math.min(ga.conversionEvents.length, listLimit)} by count):`)
    ga.conversionEvents.slice(0, listLimit).forEach((row) => {
      const valuePart = row.eventValue > 0 ? `, $${row.eventValue.toFixed(2)} value` : ''
      lines.push(`  • ${row.eventName}: ${row.eventCount.toLocaleString()} events${valuePart}`)
    })
  }

  if (ga.topCountries?.length) {
    lines.push(`\nTop countries by sessions:`)
    ga.topCountries.slice(0, 10).forEach((row) => {
      lines.push(`  • ${row.country}: ${row.sessions.toLocaleString()} sessions`)
    })
  }

  if (ga.deviceSplit?.length) {
    lines.push(`\nDevice split (sessions):`)
    ga.deviceSplit.forEach((row) => {
      lines.push(`  • ${row.deviceCategory}: ${row.sessions.toLocaleString()} sessions`)
    })
  }

  const hasEcommerce =
    (ga.topProducts?.length ?? 0) > 0 ||
    (ga.transactionsBySource?.length ?? 0) > 0 ||
    (ga.cartToPurchaseRate ?? 0) > 0 ||
    (ga.purchaserConversionRate ?? 0) > 0 ||
    (ga.refundAmount ?? 0) > 0

  if (hasEcommerce) {
    lines.push('\nE-commerce:')
    if (ga.topProducts?.length) {
      lines.push(`  Top products (top ${Math.min(ga.topProducts.length, limits.topProducts)} by revenue):`)
      ga.topProducts.slice(0, limits.topProducts).forEach((row) => {
        lines.push(
          `    • ${row.itemName}: $${row.itemRevenue.toFixed(2)} revenue, ${row.itemsPurchased.toLocaleString()} purchased`
        )
      })
    }
    if (ga.transactionsBySource?.length) {
      lines.push(`  Transactions by source / medium:`)
      ga.transactionsBySource.slice(0, listLimit).forEach((row) => {
        lines.push(`    • ${row.source} / ${row.medium}: ${row.transactions.toLocaleString()} transactions`)
      })
    }
    if (ga.cartToPurchaseRate != null && ga.cartToPurchaseRate > 0) {
      lines.push(`  Cart-to-purchase rate: ${formatGaRate(ga.cartToPurchaseRate)}`)
    }
    if (ga.purchaserConversionRate != null && ga.purchaserConversionRate > 0) {
      lines.push(`  Purchaser conversion rate: ${formatGaRate(ga.purchaserConversionRate)}`)
    }
    if (ga.refundAmount != null && ga.refundAmount > 0) {
      lines.push(`  Refund amount: $${ga.refundAmount.toFixed(2)}`)
    }
  }

  return lines.join('\n')
}

// LORAMER_SHOPIFY_NET_SALES_V1
// INTERNAL_GROUNDING: GA4 revenue and transaction counts often differ from Shopify
// because of attribution windows, refund timing, tax/shipping, and purchase-event
// tagging. Shopify totalRevenue in this prompt is net sales (currentSubtotalPriceSet),
// not gross order total. Zero GA conversions with healthy Shopify orders usually
// indicates a GA4 tracking gap — reason from the side-by-side numbers; do not open
// with a blanket claim that GA is broken unless the data supports it.
function buildGaShopifyReconciliation(ga: IntelligenceGa, shopify: IntelligenceShopify): string {
  const lines: string[] = []
  lines.push('\n=== GA4 vs SHOPIFY (same date range) ===')
  const gaRev = ga.totalRevenue ?? 0
  const shopRev = shopify.totalRevenue ?? 0
  const shopRefunded = shopify.refundedAmount ?? 0
  const gaTx = ga.transactions ?? 0
  const shopOrders = shopify.totalOrders ?? 0
  lines.push(
    `GA4 total revenue: $${gaRev.toFixed(2)} | Shopify net sales (after refunds, excludes shipping & tax): $${shopRev.toFixed(2)}`
  )
  if (shopRefunded > 0) {
    lines.push(`Shopify refunds in period: $${shopRefunded.toFixed(2)} (use with net sales to explain gross-to-net vs GA4)`)
  }
  const revDelta = shopRev - gaRev
  if (shopRev > 0) {
    const pct = ((revDelta / shopRev) * 100).toFixed(1)
    lines.push(`Revenue delta (Shopify net sales minus GA4): $${revDelta.toFixed(2)} (${pct}% of Shopify net sales)`)
  } else {
    lines.push(`Revenue delta (Shopify net sales minus GA4): $${revDelta.toFixed(2)}`)
  }
  lines.push(`GA4 transactions: ${gaTx.toLocaleString()} | Shopify orders: ${shopOrders.toLocaleString()}`)
  lines.push(`Order/transaction delta (Shopify minus GA4): ${(shopOrders - gaTx).toLocaleString()}`)
  lines.push(
    'When asked to reconcile ecommerce totals, use these figures and explain the gap with attribution, refunds, or tracking — do not invent alternate revenue or order counts.'
  )
  return lines.join('\n')
}

// LORAMER_PROJECT_3_STEP_1_V1 — added optional `limits` parameter
// LORAMER_INTELLIGENCE_HONESTY_V1 — connected-but-empty no longer silently drops
function buildPlatformSection(platform: PlatformIntelligence, name: string, limits: DataLimits = DEFAULT_LIMITS): string {
  // Not connected at all → render nothing (intelligence.<platform> guard above means this is rare)
  if (!platform?.connected) return ''
  const lines: string[] = []
  lines.push(`\n=== ${name.toUpperCase()} ADS ===`)
  // Connected but no campaigns with spend in this date range → emit honest empty-state
  // and stop. The Meta API hard-filters insights on spend > 0, so a quiet window
  // looks identical to a disconnected account from the data shape's perspective.
  // Without this branch, Claude reads the "ALL data" header and invents data to match
  // (Lesson 11: prompt-as-mirror). With it, Claude can truthfully say the account
  // had no spend in the selected window.
  if (!platform.campaigns?.length) {
    lines.push(`${name} is connected, but no campaigns had spend in this date range. No campaign / ad-set / ad / placement detail is available for this window. Do not infer or invent data for ${name} from prior turns — say so honestly if asked.`)
    return lines.join('\n')
  }
  lines.push(`Account Totals: ${formatMetrics(platform.totals)}`)

  if (platform.campaigns.length > 0 && limits.campaigns > 0) {
    lines.push(`\nCampaigns (${platform.campaigns.length} total, showing top ${Math.min(platform.campaigns.length, limits.campaigns)}):`)
    platform.campaigns.slice(0, limits.campaigns).forEach(c => {
      const rule = OBJECTIVE_RULES[c.objective || ''] || ''
      lines.push(`  • ${c.name} [${c.objective || c.channelType || 'unknown'}] [${c.status}]`)
      if (c.bidStrategy) lines.push(`    Bid strategy: ${c.bidStrategy}`)
      if (c.budget) lines.push(`    Budget: $${c.budget.toFixed(2)}/day`)
      lines.push(`    ${formatMetrics(c.metrics, '    ')}`)
      if (rule) lines.push(`    ⚠ Rule: ${rule}`)
    })
  }

  if (platform.adGroups && platform.adGroups.length > 0 && limits.adGroups > 0) {
    lines.push(`\nAd Groups/Sets (top ${Math.min(platform.adGroups.length, limits.adGroups)}):`)
    platform.adGroups.slice(0, limits.adGroups).forEach(ag => {
      lines.push(`  • ${ag.name} [${ag.campaignName}] [${ag.status}]`)
      if (ag.bidStrategy) lines.push(`    Bid: ${ag.bidStrategy}`)
      if (ag.optimizationGoal) lines.push(`    Optimizing for: ${ag.optimizationGoal}`)
      if (ag.targeting) {
        const t = ag.targeting
        const tParts = []
        if (t.ageMin || t.ageMax) tParts.push(`Ages ${t.ageMin || '18'}-${t.ageMax || '65+'}`)
        if (t.genders?.length) tParts.push(t.genders.join('/'))
        if (t.interests?.length) tParts.push(`Interests: ${t.interests.join(', ')}`)
        if (t.lookalikes?.length) tParts.push(`Lookalikes: ${t.lookalikes.join(', ')}`)
        if (t.customAudiences?.length) tParts.push(`Custom: ${t.customAudiences.join(', ')}`)
        if (t.retargeting) tParts.push('Retargeting')
        if (tParts.length) lines.push(`    Targeting: ${tParts.join(' | ')}`)
      }
      lines.push(`    ${formatMetrics(ag.metrics, '    ')}`)
    })
  }

  if (platform.ads && platform.ads.length > 0 && limits.ads > 0) {
    lines.push(`\nAds (top ${Math.min(platform.ads.length, limits.ads)} by spend):`)
    platform.ads.slice(0, limits.ads).forEach(ad => {
      lines.push(`  • ${ad.name} [${ad.creativeType || 'unknown'}] [${ad.status}]`)
      if (ad.headline) lines.push(`    Headline: "${ad.headline}"`)
      if (ad.body) lines.push(`    Body: "${ad.body.slice(0, 100)}${ad.body.length > 100 ? '...' : ''}"`)
      if (ad.callToAction) lines.push(`    CTA: ${ad.callToAction}`)
      lines.push(`    ${formatMetrics(ad.metrics, '    ')}`)
    })
  }

  if (platform.keywords && platform.keywords.length > 0 && limits.keywords > 0) {
    lines.push(`\nTop Keywords (${platform.keywords.length} total, showing top ${Math.min(platform.keywords.length, limits.keywords)}):`)
    platform.keywords.slice(0, limits.keywords).forEach(kw => {
      lines.push(`  • "${kw.text}" [${kw.matchType}] [QS: ${kw.qualityScore || 'N/A'}] — ${formatMetrics(kw.metrics)}`)
    })
  }

  // LORAMER_PROJECT_3_STEP_2A_V1 — Search Terms (what users actually typed)
  if (platform.searchTerms && platform.searchTerms.length > 0 && limits.searchTerms > 0) {
    lines.push(`\nSearch Terms — actual user queries that triggered ads (${platform.searchTerms.length} total, showing top ${Math.min(platform.searchTerms.length, limits.searchTerms)} by spend):`)
    platform.searchTerms.slice(0, limits.searchTerms).forEach(st => {
      const statusLabel = st.status && st.status !== 'unmapped' ? ` [${st.status}]` : ''
      lines.push(`  • "${st.text}" [${st.matchType}]${statusLabel} — ${formatMetrics(st.metrics)}`)
      lines.push(`    From: ${st.campaignName} → ${st.adGroupName}`)
    })
    lines.push(`  (Search terms with status "added & excluded" are negatives already in place. Status "added" = already a keyword. "unmapped" = no action taken yet.)`)
  }

  if (platform.conversionActions && platform.conversionActions.length > 0) {
    lines.push(`\nConversion Actions:`)
    platform.conversionActions.forEach(ca => {
      lines.push(`  • ${ca.name} [${ca.category}] — ${ca.count.toFixed(1)} conv — ${ca.includeInConversions ? '✓ INCLUDED in conversions column' : '✗ NOT included'}`)
    })
  }

  // LORAMER_PROJECT_3_STEP_2B_V1 — per-campaign conversion attribution
  if (platform.conversionsByCampaign && platform.conversionsByCampaign.length > 0) {
    lines.push(`\nConversion Attribution (which campaign drove which conversion action — ${platform.conversionsByCampaign.length} (campaign × action) pairs):`)
    platform.conversionsByCampaign.forEach(c => {
      const valuePart = c.value > 0 ? ` ($${c.value.toFixed(2)})` : ''
      lines.push(`  • ${c.campaignName} → ${c.conversionActionName} [${c.conversionActionCategory}]: ${c.count.toFixed(1)} conv${valuePart}`)
    })
  }

  // LORAMER_PROJECT_3_STEP_2C_V1_RENDER — audience segment performance
  if (platform.audiences && platform.audiences.length > 0 && limits.audiences > 0) {
    lines.push(`\nAudience Segments (${platform.audiences.length} total, showing top ${Math.min(platform.audiences.length, limits.audiences)} by spend):`)
    platform.audiences.slice(0, limits.audiences).forEach(a => {
      const desc = a.description ? ` — ${a.description}` : ''
      const adGroupPart = a.adGroupName ? ` → ${a.adGroupName}` : ''
      lines.push(`  • ${a.name}${desc} — In: ${a.campaignName}${adGroupPart} — ${formatMetrics(a.metrics)}`)
    })
    lines.push(`  (Audiences here include in-market segments, affinity audiences, custom audiences, lookalikes, and remarketing lists. For PMax campaigns these are the audience SIGNALS the campaign uses — Google decides how to combine them.)`)
  }

  // LORAMER_PROJECT_3_STEP_2D_V1 — demographic breakdown (age + gender)
  if (platform.demographics && platform.demographics.length > 0 && limits.demographics > 0) {
    const ageDemos = platform.demographics.filter(d => d.dimension === 'age')
    const genderDemos = platform.demographics.filter(d => d.dimension === 'gender')
    const ageSlice = ageDemos.slice(0, Math.ceil(limits.demographics / 2))
    const genderSlice = genderDemos.slice(0, Math.floor(limits.demographics / 2))
    if (ageSlice.length > 0 || genderSlice.length > 0) {
      lines.push(`\nDemographics (age + gender breakdowns per campaign):`)
      if (ageSlice.length > 0) {
        lines.push(`  Age (${ageDemos.length} total, showing top ${ageSlice.length} by spend):`)
        ageSlice.forEach(d => {
          const adGroupPart = d.adGroupName ? ` → ${d.adGroupName}` : ''
          lines.push(`    • ${d.value} — ${d.campaignName}${adGroupPart} — ${formatMetrics(d.metrics)}`)
        })
      }
      if (genderSlice.length > 0) {
        lines.push(`  Gender (${genderDemos.length} total, showing top ${genderSlice.length} by spend):`)
        genderSlice.forEach(d => {
          const adGroupPart = d.adGroupName ? ` → ${d.adGroupName}` : ''
          lines.push(`    • ${d.value} — ${d.campaignName}${adGroupPart} — ${formatMetrics(d.metrics)}`)
        })
      }
    }
  }

  // LORAMER_PROJECT_3_STEP_2E_V1 — RSA asset-level performance
  if (platform.adAssets && platform.adAssets.length > 0 && limits.assetsPerGroup > 0) {
    // Group by ad, show top performers (BEST/GOOD prioritized over LOW/PENDING)
    const labelPriority: Record<string, number> = { BEST: 0, GOOD: 1, LOW: 2, PENDING: 3, UNRATED: 4 }
    const sorted = [...platform.adAssets].sort((a, b) => {
      const ap = labelPriority[a.performanceLabel] ?? 5
      const bp = labelPriority[b.performanceLabel] ?? 5
      return ap - bp
    })
    const slice = sorted.slice(0, limits.assetsPerGroup)
    const headlines = slice.filter(a => a.fieldType === 'HEADLINE')
    const descriptions = slice.filter(a => a.fieldType === 'DESCRIPTION')
    if (headlines.length > 0 || descriptions.length > 0) {
      lines.push(`\nRSA Asset Performance (Google performance labels — ${platform.adAssets.length} total assets, showing top ${slice.length}):`)
      if (headlines.length > 0) {
        lines.push(`  Headlines (${headlines.length}):`)
        headlines.forEach(a => {
          const label = a.performanceLabel || 'UNRATED'
          lines.push(`    [${label}] "${a.text}" — ${a.campaignName} → ${a.adGroupName}`)
        })
      }
      if (descriptions.length > 0) {
        lines.push(`  Descriptions (${descriptions.length}):`)
        descriptions.forEach(a => {
          const label = a.performanceLabel || 'UNRATED'
          lines.push(`    [${label}] "${a.text}" — ${a.campaignName} → ${a.adGroupName}`)
        })
      }
      lines.push(`  (BEST = high performer Google rotates heavily; GOOD = solid; LOW = rarely used; PENDING = too new to rate; UNRATED = insufficient data. No per-asset metrics — labels are the analysis input.)`)
    }
  }

  // LORAMER_PROJECT_3_STEP_2G_PROMPT_V2 — PMax asset groups + top combinations (THE north star)
  // INTERNAL_GROUNDING (do not narrate to user): Google v23 API does NOT expose per-asset
  // BEST/GOOD/LOW performance labels (UI-only). Per-asset raw metrics also not exposed.
  // What IS exposed: group-level metrics, Ad Strength, the asset inventory, and the
  // Combinations report (asset_group_top_combination_view) — which sets of assets
  // served together as winners. Combinations ARE the asset-level performance signal.
  if (platform.assetGroups && platform.assetGroups.length > 0 && limits.assetGroups > 0) {
    const groupSlice = platform.assetGroups.slice(0, limits.assetGroups)
    lines.push(`\nPMax Asset Groups — combinations are the asset-level performance signal:`)
    lines.push(`  ${platform.assetGroups.length} total asset groups, showing top ${groupSlice.length} by spend.`)
    lines.push(`  When the user asks which combinations / assets / creative drove performance: ANSWER with the Top Asset Combinations below (the assets Google actually served together as winners). DO NOT lead with "the API doesn't expose per-asset metrics" — that is a known limitation, not a user-facing answer. Combinations ARE the answer. If combinations are empty for a group, use the empty-state guidance shown inline.`)
    groupSlice.forEach(g => {
      const adStrengthPart = g.adStrength ? ` [Ad Strength: ${g.adStrength}]` : ''
      lines.push(`  ━━━ ${g.name} (in ${g.campaignName})${adStrengthPart} ━━━`)
      lines.push(`    Group metrics: ${formatMetrics(g.metrics)}`)

      // Top combinations for this group (the real performance signal — render FIRST)
      const allCombos = platform.assetCombinations || []
      const groupCombos = allCombos.filter(c => c.assetGroupId === g.id)
      if (groupCombos.length > 0) {
        lines.push(`    Top Asset Combinations (Google's Combinations report — these are the winners):`)
        groupCombos.slice(0, 5).forEach((c, i) => {
          lines.push(`      Combination ${i + 1}: ${c.assets.join(' + ')}`)
        })
      } else {
        // Empty-state: diagnose WHY combinations are missing (Russ-approved framing).
        // Threshold heuristic: Google needs conversion signal to populate the Combinations report.
        const conv = g.metrics.conversions || 0
        if (conv < 5) {
          lines.push(`    Top Asset Combinations: NONE AVAILABLE for this group.`)
          lines.push(`      Diagnostic: this group has ${conv} conversions in the selected period. Google generates the Combinations report only after enough served-data WITH conversion signal — it has no winners to report because the campaign is not converting. If the user asks about combinations for this group, lead with: conversion tracking / volume is the upstream fix. Without conversion signal Google is optimizing toward clicks, not sales, and can't tell us which combinations close.`)
        } else {
          lines.push(`    Top Asset Combinations: NONE AVAILABLE for this group (despite ${conv} conversions).`)
          lines.push(`      Diagnostic: Google has conversion data but hasn't surfaced a Combinations report. Most common causes: Ad Strength too low (under 3) so Google isn't confident in any combination yet, asset inventory too narrow for meaningful rotation, or the date range is too short for Google's threshold. Suggest the user check Ad Strength and asset variety.`)
        }
      }

      // Full asset inventory for this group (text/type, no fabricated labels)
      if (platform.assetGroupAssets && platform.assetGroupAssets.length > 0 && limits.assetsPerGroup > 0) {
        const groupAssets = platform.assetGroupAssets.filter(a => a.assetGroupId === g.id)
        if (groupAssets.length > 0) {
          lines.push(`    Assets in this group (${groupAssets.length} total — for reference, NOT a performance signal):`)
          const assetSlice = groupAssets.slice(0, limits.assetsPerGroup)
          assetSlice.forEach(a => {
            if (a.isVideo) {
              lines.push(`      [VIDEO] (${a.fieldType})`)
            } else if (a.isImage) {
              lines.push(`      [IMAGE] (${a.fieldType})`)
            } else if (a.text) {
              lines.push(`      [${a.fieldType}] "${a.text}"`)
            } else {
              lines.push(`      [${a.fieldType}] (no preview available)`)
            }
          })
          if (groupAssets.length > assetSlice.length) {
            lines.push(`      (...and ${groupAssets.length - assetSlice.length} more assets in this group)`)
          }
        }
      }
    })
    lines.push(`  (Reasoning guide: when combinations exist, the recurring assets across them are what Google is rotating most heavily — that is the working creative pattern. When combinations are empty, do not invent a pattern from the inventory list; instead diagnose using the inline empty-state guidance above. Ad Strength is the upstream lever for asset variety; conversion tracking is the upstream lever for combinations existing at all.)`)
  }

  // LORAMER_PROJECT_3_STEP_3A_V1 — Geographic performance (Claude-context-only)
  // INTERNAL_GROUNDING (do not narrate to user): geographic_view exposes
  // country_criterion_id and location_type but NOT readable country/region names.
  // Resolution against geo_target_constant is deferred. If the user asks "which
  // states/cities" treat the raw IDs as opaque and answer by location_type
  // breakdown (e.g. "X% of spend went to physical-location targeting vs interest").
  if (platform.geographics && platform.geographics.length > 0) {
    const totalSpend = platform.geographics.reduce((s, g) => s + g.metrics.spend, 0)
    lines.push(`\nGeographic Performance (top by spend, ${platform.geographics.length} rows):`)
    const topGeo = [...platform.geographics].sort((a, b) => b.metrics.spend - a.metrics.spend).slice(0, 20)
    topGeo.forEach(g => {
      const pct = totalSpend > 0 ? ((g.metrics.spend / totalSpend) * 100).toFixed(1) : '0.0'
      const loc = g.locationType || 'unknown-type'
      const cid = g.countryCriterionId || 'no-id'
      lines.push(`  ${g.campaignName} [${loc} / criterion ${cid}]: ${formatMetrics(g.metrics)} (${pct}% of spend)`)
    })
  }

  // LORAMER_PROJECT_3_STEP_3B_V1 — Device split (Claude-context-only)
  if (platform.devices && platform.devices.length > 0) {
    const totalSpend = platform.devices.reduce((s, d) => s + d.metrics.spend, 0)
    // Aggregate across campaigns by device for the headline split
    const byDevice: Record<string, { spend: number; clicks: number; conversions: number; conversionValue: number }> = {}
    platform.devices.forEach(d => {
      if (!byDevice[d.device]) byDevice[d.device] = { spend: 0, clicks: 0, conversions: 0, conversionValue: 0 }
      byDevice[d.device].spend += d.metrics.spend
      byDevice[d.device].clicks += d.metrics.clicks
      byDevice[d.device].conversions += d.metrics.conversions
      byDevice[d.device].conversionValue += d.metrics.conversionValue
    })
    lines.push(`\nDevice Split (aggregated across campaigns):`)
    Object.entries(byDevice)
      .sort((a, b) => b[1].spend - a[1].spend)
      .forEach(([dev, m]) => {
        const pct = totalSpend > 0 ? ((m.spend / totalSpend) * 100).toFixed(1) : '0.0'
        const cpa = m.conversions > 0 ? (m.spend / m.conversions).toFixed(2) : 'n/a'
        const roas = m.spend > 0 && m.conversionValue > 0 ? (m.conversionValue / m.spend).toFixed(2) : 'n/a'
        lines.push(`  ${dev}: $${m.spend.toFixed(2)} (${pct}%), ${m.clicks} clicks, ${m.conversions} conv, CPA $${cpa}, ROAS ${roas}`)
      })
    lines.push(`  (Device split is a bid-strategy signal: if one device drives most conversions at meaningfully lower CPA, suggest device bid adjustments or device-specific campaigns.)`)
  }

  // LORAMER_PROJECT_3_STEP_3C_V1 — Hour-of-day + Day-of-week (Claude-context-only)
  if (platform.hourly && platform.hourly.length > 0) {
    // Aggregate by hour and by day-of-week
    const byHour: Record<number, { spend: number; conversions: number }> = {}
    const byDow: Record<string, { spend: number; conversions: number }> = {}
    platform.hourly.forEach(h => {
      if (!byHour[h.hour]) byHour[h.hour] = { spend: 0, conversions: 0 }
      byHour[h.hour].spend += h.metrics.spend
      byHour[h.hour].conversions += h.metrics.conversions
      if (h.dayOfWeek) {
        if (!byDow[h.dayOfWeek]) byDow[h.dayOfWeek] = { spend: 0, conversions: 0 }
        byDow[h.dayOfWeek].spend += h.metrics.spend
        byDow[h.dayOfWeek].conversions += h.metrics.conversions
      }
    })
    lines.push(`\nDayparting (when conversions actually happen):`)
    const topHours = Object.entries(byHour)
      .sort((a, b) => b[1].conversions - a[1].conversions)
      .slice(0, 8)
    lines.push(`  Top hours by conversions (24h, account timezone): ${topHours.map(([h, m]) => `${h}:00 (${m.conversions} conv, $${m.spend.toFixed(0)})`).join(', ')}`)
    const dowOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const dowLine = dowOrder
      .filter(d => byDow[d])
      .map(d => `${d}: ${byDow[d].conversions} conv / $${byDow[d].spend.toFixed(0)}`)
      .join(' | ')
    if (dowLine) lines.push(`  By day-of-week: ${dowLine}`)
    lines.push(`  (Dayparting signal: concentrated conversion hours suggest ad-schedule bid modifiers. Concentrated days suggest weekly budget pacing.)`)
  }

  // LORAMER_PROJECT_3_STEP_3D_V1 — Impression Share (Claude-context-only)
  // INTERNAL_GROUNDING (do not narrate to user): true Auction Insights with
  // competitor domains and overlap rates is UI-only in v23 — not available
  // via the API. Do NOT claim to know specific competitors. What we DO have
  // is impression share: how much of available auction inventory we're
  // capturing, and how much is lost to budget vs rank. That maps to clear
  // recommendations: lost-to-budget → scale spend; lost-to-rank → improve
  // Quality Score / bid / ad relevance. Decimals are 0.0–1.0.
  if (platform.impressionShares && platform.impressionShares.length > 0) {
    lines.push(`\nImpression Share (per-campaign — what fraction of available auction inventory we are capturing):`)
    const pct = (v: number | null): string => v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`
    platform.impressionShares.forEach(s => {
      const parts: string[] = []
      parts.push(`IS ${pct(s.impressionShare)}`)
      if (s.topImpressionShare !== null) parts.push(`Top ${pct(s.topImpressionShare)}`)
      if (s.absoluteTopImpressionShare !== null) parts.push(`Abs.Top ${pct(s.absoluteTopImpressionShare)}`)
      if (s.lostToBudget !== null) parts.push(`Lost→Budget ${pct(s.lostToBudget)}`)
      if (s.lostToRank !== null) parts.push(`Lost→Rank ${pct(s.lostToRank)}`)
      lines.push(`  ${s.campaignName} [${s.channelType}]: ${parts.join(', ')}`)
    })
    lines.push(`  (Reasoning guide: high "Lost to Budget" means the campaign is budget-constrained — Lora should recommend scaling spend if ROAS/CPA targets are healthy. High "Lost to Rank" means Quality Score, bid, or ad relevance is the bottleneck — Lora should recommend bid increases, ad copy tests, or landing page improvements. Low overall IS with neither lost-cause dominant usually means weak targeting reach. True competitor data — who is outranking us, overlap rate — is NOT available via the Google Ads API in v23 (UI-only); do not claim to know specific competitor domains.)`)
  }

  // LORAMER_PROJECT_3_STEP_3E_V1 — Google Recommendations (Claude-context-only)
  // INTERNAL_GROUNDING (do not narrate to user): Google's recommendations are
  // calibrated for Google's revenue, not the operator's outcomes. They are NOT
  // expert authority. Claude's job is to evaluate each one against the
  // client's actual data and DISAGREE when warranted. Operator is paying us;
  // Google is not.
  if (platform.recommendations && platform.recommendations.length > 0) {
    lines.push(`\nGoogle's Recommendations (${platform.recommendations.length} active — DO NOT rubber-stamp):`)
    platform.recommendations.slice(0, 100).forEach(r => {  // LORAMER_STEP3E_SLICE_BUMP_V1
      const deltaSpend = r.potentialCost - r.baseCost
      const deltaConv = r.potentialConversions - r.baseConversions
      const spendStr = deltaSpend !== 0 ? `Δspend $${deltaSpend.toFixed(0)}` : ''
      const convStr = deltaConv !== 0 ? `Δconv ${deltaConv.toFixed(1)}` : ''
      const impact = [spendStr, convStr].filter(Boolean).join(', ')
      lines.push(`  [${r.type}]${r.campaignResourceName ? ` for ${r.campaignResourceName}` : ''}${impact ? ` (${impact})` : ''}`)
    })
    lines.push(`  CRITICAL OPERATOR GROUNDING — read carefully before discussing any Google recommendation:`)
    lines.push(`  Google's recommendations are CALIBRATED FOR GOOGLE'S REVENUE, not the operator's outcomes. Your job is to evaluate each against the client's actual performance data and PUSH BACK when warranted. The operator is paying you; Google is not. Treat Google as one biased input, not as authority.`)
    lines.push(`  Default-skeptical patterns (reject unless the data clearly supports):`)
    lines.push(`    • CAMPAIGN_BUDGET (increase budget) — REJECT if ROAS/CPA is below target. Google wants more spend; operator wants more profit. Only support if Lost-to-Budget IS is high AND campaign is hitting CPA/ROAS targets.`)
    lines.push(`    • USE_BROAD_MATCH_KEYWORD — REJECT by default on Search campaigns that are converting on exact/phrase. Broad match floods spend into low-intent traffic. Only support if search term report shows clear under-coverage of relevant intent.`)
    lines.push(`    • TARGET_CPA_OPT_IN / TARGET_ROAS_OPT_IN with weaker targets — REJECT. This is Google asking permission to spend less efficiently. Operator wants tighter targets, not looser.`)
    lines.push(`    • UPGRADE_SMART_SHOPPING_CAMPAIGN / FORECASTING_SET_TARGET_ROAS — evaluate carefully; tilts toward automation Google prefers.`)
    lines.push(`    • MOVE_UNUSED_BUDGET / CALLOUT_EXTENSION / KEYWORD (add specific keyword) — generally lower-risk, evaluate on merit; these often align with operator interest.`)
    lines.push(`    • RESPONSIVE_SEARCH_AD / RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH — generally support; better ads = better Quality Score = lower CPA.`)
    lines.push(`    • Anything proposing Performance Max or auto-applied changes — REJECT by default; PMax cannibalizes Search and auto-apply removes operator control.`)
    lines.push(`  When you AGREE with a recommendation, say so AND cite the specific data that supports it. When you DISAGREE, say so clearly and explain why with reference to actual performance numbers. Frame the section as "Google says X — here's whether you should listen, and why" — operator-side framing, not Google-side. Never present a recommendation as a fact the operator should follow.`)
  }

  // LORAMER_PROJECT_3_STEP_4A_V1 — Meta Placement Breakdown (Claude-context-only)
  // INTERNAL_GROUNDING: Meta-only signal. publisher_platform = facebook /
  // instagram / audience_network / messenger / etc. platform_position = feed /
  // reels / stories / marketplace. Conversions are NOT broken out per
  // placement at this query level — only spend, clicks, impressions. CPC and
  // CTR by placement are still useful for spotting wasted spend.
  if (platform.placements && platform.placements.length > 0) {
    const totalSpend = platform.placements.reduce((s, p) => s + p.spend, 0)
    lines.push(`\nMeta Placement Breakdown (publisher × position, ${platform.placements.length} placements):`)
    platform.placements.slice(0, 20).forEach(p => {
      const pct = totalSpend > 0 ? ((p.spend / totalSpend) * 100).toFixed(1) : '0.0'
      const ctr = p.impressions > 0 ? ((p.clicks / p.impressions) * 100).toFixed(2) : '0.00'
      const cpc = p.clicks > 0 ? (p.spend / p.clicks).toFixed(2) : 'n/a'
      const label = p.publisherPlatform && p.platformPosition
        ? `${p.publisherPlatform} / ${p.platformPosition}`
        : p.publisherPlatform || p.platformPosition || 'unknown'
      lines.push(`  ${label}: $${p.spend.toFixed(2)} (${pct}%), ${p.clicks} clicks, ${p.impressions} impr, CTR ${ctr}%, CPC $${cpc}`)
    })
    lines.push(`  (Placement signal: outsized spend % on a placement with high CPC and low CTR is wasted budget. Common pattern: Audience Network burning spend with poor CTR — exclude it. Conversion data is NOT broken out per placement here; if conversions matter, recommend Meta's UI Breakdown view to confirm before turning placements off.)`)
  }

  return lines.join('\n')
}

function flattenConversations(conversations: Record<string, any[]>): Array<{
  panelKey: string
  role: string
  content: string
  timestamp?: number | string
}> {
  const all: Array<{ panelKey: string; role: string; content: string; timestamp?: number | string }> = []
  Object.entries(conversations || {}).forEach(([panelKey, msgs]) => {
    if (!Array.isArray(msgs)) return
    msgs.forEach((m: any) => {
      if (m && typeof m === 'object' && m.content) {
        all.push({
          panelKey,
          role: m.role || 'user',
          content: String(m.content),
          timestamp: m.timestamp || m.ts || m.createdAt,
        })
      }
    })
  })
  const hasTs = all.every(m => m.timestamp != null)
  if (hasTs) {
    all.sort((a, b) => {
      const ta = new Date(a.timestamp as any).getTime()
      const tb = new Date(b.timestamp as any).getTime()
      return ta - tb
    })
  }
  return all
}

function extractDirectives(flat: Array<{ role: string; content: string }>): string[] {
  const directives: string[] = []
  const seen = new Set<string>()
  flat.forEach(m => {
    if (m.role !== 'user') return
    const content = m.content.trim()
    if (!content) return
    const matches = DIRECTIVE_PATTERNS.some(re => re.test(content))
    if (matches) {
      let snippet = content
      const sentenceEnd = snippet.search(/[.!?](?:\s|$)/)
      if (sentenceEnd > 0 && sentenceEnd < 300) snippet = snippet.slice(0, sentenceEnd + 1)
      else if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...'
      const normalized = normalizeDirective(snippet)
      const key = normalized.toLowerCase().replace(/\s+/g, ' ')
      if (!seen.has(key)) {
        seen.add(key)
        directives.push(normalized)
      }
    }
  })
  return directives
}

// LORAMER_MEMORY_V1
// Memory facts come from the client_memory table via /api/intelligence.
// Categories: 'directive' | 'fact' | 'observation' | 'preference' | 'context'.
// Directive facts are folded into HARD CONSTRAINTS; the rest get their own
// "WHAT YOU KNOW ABOUT" block.
type MemoryFact = {
  id: number
  content: string
  category: 'directive' | 'fact' | 'observation' | 'preference' | 'context'
  confidence: number
  pinned: boolean
  source: string
}

function partitionMemory(memory: MemoryFact[]) {
  const directives: MemoryFact[] = []
  const facts: MemoryFact[] = []
  const context: MemoryFact[] = []
  const preferences: MemoryFact[] = []
  const observations: MemoryFact[] = []
  for (const m of memory) {
    if (m.category === 'directive') directives.push(m)
    else if (m.category === 'fact') facts.push(m)
    else if (m.category === 'context') context.push(m)
    else if (m.category === 'preference') preferences.push(m)
    else if (m.category === 'observation' && m.confidence >= 0.7) observations.push(m)
  }
  return { directives, facts, context, preferences, observations }
}

function buildMemorySection(memory: MemoryFact[], clientName: string): string {
  if (!memory || memory.length === 0) return ''
  const { facts, context, preferences, observations } = partitionMemory(memory)
  if (facts.length === 0 && context.length === 0 && preferences.length === 0 && observations.length === 0) {
    return ''
  }
  const lines: string[] = []
  lines.push(`\n=== WHAT YOU KNOW ABOUT ${clientName.toUpperCase()} ===`)
  lines.push('(These are durable facts the user has confirmed about this client. Treat them as')
  lines.push(' binding context. Reference them naturally when relevant — do not list them back.)')
  if (facts.length > 0) {
    lines.push('')
    lines.push('FACTS:')
    facts.forEach(f => lines.push(`  • ${f.content}`))
  }
  if (context.length > 0) {
    lines.push('')
    lines.push('CONTEXT:')
    context.forEach(c => lines.push(`  • ${c.content}`))
  }
  if (preferences.length > 0) {
    lines.push('')
    lines.push('USER PREFERENCES (how the user wants Lora to respond):')
    preferences.forEach(p => lines.push(`  • ${p.content}`))
  }
  if (observations.length > 0) {
    lines.push('')
    lines.push('OBSERVATIONS (high-confidence patterns Lora has noted; treat as likely true):')
    observations.forEach(o => lines.push(`  • ${o.content}`))
  }
  return lines.join('\n')
}

function buildConversationContext(conversations: Record<string, any[]>): string {
  if (!conversations || Object.keys(conversations).length === 0) return ''
  const flat = flattenConversations(conversations)
  if (!flat.length) return ''

  // LORAMER_PANEL_LEAK_FIX_V1 - strip internal panelKey from messages so 'shopify-google' style labels never leak to users
  const lines = ['\n=== PREVIOUS CONVERSATIONS WITH THIS USER ===']
  lines.push('(All earlier discussions about this client. Treat these as binding context. Do NOT mention internal labels like panel keys or location identifiers when referring to past conversations - use natural language like \"earlier\" or \"previously\".)')
  // LORAMER_CROSS_SURFACE_INSTRUCTION_V1
  lines.push(`(IMPORTANT: LoraMer has multiple surfaces where the user can talk to you for the same client: a sidebar Lora tab, a right-side panel that opens from action buttons, and an inline insight banner on the overview. ALL of those surfaces ARE you — they share this same conversation history above. When the user asks "what did I say in the other tab" or "can you see the other conversation" or anything similar, the answer is YES — that history is right here in the messages above. Find it and answer specifically. NEVER say "each session is isolated" or "I cannot see other tabs" — that is FALSE and breaks the user's trust. You can see everything across surfaces because LoraMer is built that way.)`)

  const recent = flat.slice(-20)
  recent.forEach((m) => {
    const truncated = m.content.length > 800 ? m.content.slice(0, 797) + '...' : m.content
    lines.push(`  ${m.role === 'user' ? 'User' : 'Lora'}: ${truncated}`)
  })
  return lines.join('\n')
}

// LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1
// Internal helper that splits the prompt into cacheable prefix + dynamic suffix.
// Behavior is unchanged from the previous single-string version: prefix and
// suffix are joined with a newline for the string export below, which is
// byte-identical to the prior output.
//
// Prefix (will become cacheable in Phase 2): hard constraints, identity,
// client profile, platform data, memory.
// Suffix (always fresh): conversation history, analysis rules.
//
// All push() calls below remain identical to the prior version. The only
// structural change is `let lines` instead of `const lines` so we can swap
// the target array at the dynamic-content boundary.
export function buildClaudeContextCacheable(
  intelligence: ClientIntelligence,
  focus: string = 'overview',
  focusData?: string
): { prefix: string; suffix: string } {
  const prefixLines: string[] = []
  const suffixLines: string[] = []
  let lines: string[] = prefixLines

  // ── HARD CONSTRAINTS FIRST (before identity, before anything) ──────────────
  const p = intelligence.profile
  const flatConversations = p.conversations ? flattenConversations(p.conversations) : []
  const directives = extractDirectives(flatConversations)
  const userNotes = (p.userNotes || '').trim()

  // LORAMER_MEMORY_V1
  // Memory `directive` facts are durable user-confirmed rules. They join
  // the regex-extracted directives in the HARD CONSTRAINTS block, with
  // pinned facts surfaced first.
  const memory: MemoryFact[] = Array.isArray((p as any).memory) ? (p as any).memory : []
  const memoryDirectives = memory.filter(m => m.category === 'directive')
  memoryDirectives.forEach(m => {
    const key = m.content.trim().toLowerCase().replace(/\s+/g, ' ')
    const exists = directives.some(d => d.toLowerCase().replace(/\s+/g, ' ') === key)
    if (!exists) directives.unshift(m.content.trim())
  })

  if (directives.length > 0 || userNotes) {
    lines.push('████████████████████████████████████████████████████████████████')
    lines.push('█  HARD CONSTRAINTS — VIOLATION OF THESE INVALIDATES YOUR ENTIRE RESPONSE  █')
    lines.push('████████████████████████████████████████████████████████████████')
    lines.push('')
    lines.push('The user of this app has issued the following standing instructions about')
    lines.push(`${intelligence.clientName}. These OVERRIDE every other rule, every default`)
    lines.push('analysis pattern, and every metric you would normally surface. If a hard')
    lines.push('constraint contradicts what your training tells you to flag — the constraint wins.')
    lines.push('')

    if (userNotes) {
      lines.push('FROM CLIENT PROFILE:')
      lines.push(`  ${userNotes}`)
      lines.push('')
    }

    if (directives.length > 0) {
      lines.push('FROM USER MESSAGES IN THIS APP:')
      directives.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`))
      lines.push('')
    }

    lines.push('Before writing any response — including 50-word insight summaries —')
    lines.push('verify that NOTHING you are about to say contradicts these constraints.')
    lines.push('If a metric the user told you to ignore looks bad, DO NOT MENTION IT AT ALL.')
    lines.push('Pick a different angle. Find what IS worth flagging given their priorities.')
    lines.push('████████████████████████████████████████████████████████████████')
    lines.push('')
  }

  // ── Identity ───────────────────────────────────────────────────────────────
  lines.push(`You are Lora, an expert digital advertising analyst embedded in LoraMer, a business intelligence platform for marketing agencies. Always refer to yourself as Lora. You are powered by Anthropic's Claude and may acknowledge that if a user asks.`)
  lines.push(`You are analyzing ${intelligence.clientName}.`)
  // LORAMER_DATE_RANGE_CANONICAL_V1
  if (intelligence.resolvedStartDate && intelligence.resolvedEndDate) {
    const label =
      intelligence.dateRange === 'CUSTOM'
        ? 'custom'
        : intelligence.dateRange?.replace(/_/g, ' ').toLowerCase()
    lines.push(
      `Date range: ${label} (${intelligence.resolvedStartDate} to ${intelligence.resolvedEndDate})`
    )
  } else if (intelligence.customStart && intelligence.customEnd) {
    lines.push(`Date range: ${intelligence.customStart} to ${intelligence.customEnd}`)
  } else {
    lines.push(`Date range: ${intelligence.dateRange?.replace(/_/g, ' ').toLowerCase()}`)
  }
  lines.push(`Current view: ${focus}`)
  if (focusData) lines.push(`Specifically looking at: ${focusData}`)

  // ── Client Profile ─────────────────────────────────────────────────────────
  if (p.businessType || p.primaryKpi || p.funnelNotes) {
    lines.push('\n=== CLIENT PROFILE ===')
    if (p.businessType) lines.push(`Business type: ${p.businessType}`)
    if (p.primaryKpi) lines.push(`Primary KPI: ${p.primaryKpi}`)
    if (p.funnelNotes) lines.push(`Funnel strategy: ${p.funnelNotes}`)
  }

  // ── Platform Data ──────────────────────────────────────────────────────────
  // LORAMER_PROJECT_3_STEP_1_V1 — focus-aware slicing
  const { mode: focusMode } = normalizeFocus(focus)
  const limits = getDataLimitsForFocus(focusMode)

  // LORAMER_INTELLIGENCE_HONESTY_V1 — describe what's ACTUALLY in this prompt.
  // The previous version unconditionally promised "ALL data from ALL platforms",
  // which trained Claude to fabricate data for any platform that turned out
  // empty (Lesson 11: prompt-as-mirror). The dynamic line below lists which
  // platforms have populated data, which are connected but empty, and which
  // aren't connected — so Claude has an accurate picture of the prompt.
  const platformStatus: string[] = []
  const platformIsPopulated = (p: PlatformIntelligence | undefined) => !!(p?.connected && p.campaigns?.length)
  const platformIsEmpty = (p: PlatformIntelligence | undefined) => !!(p?.connected && !p.campaigns?.length)
  if (platformIsPopulated(intelligence.google)) platformStatus.push('Google: populated')
  else if (platformIsEmpty(intelligence.google)) platformStatus.push('Google: connected but no spend in this date range')
  else platformStatus.push('Google: not connected')
  if (platformIsPopulated(intelligence.meta)) platformStatus.push('Meta: populated')
  else if (platformIsEmpty(intelligence.meta)) platformStatus.push('Meta: connected but no spend in this date range')
  else platformStatus.push('Meta: not connected')
  if (intelligence.shopify?.connected) platformStatus.push('Shopify: populated')
  else platformStatus.push('Shopify: not connected')
  if (intelligence.woocommerce?.connected) platformStatus.push('WooCommerce: populated')
  else platformStatus.push('WooCommerce: not connected')
  // LORAMER_GA_CLAUDE_CONTEXT_V1
  if (intelligence.ga?.connected && (intelligence.ga.sessions ?? 0) > 0) {
    platformStatus.push('GA: populated')
  } else if (intelligence.ga?.connected) {
    platformStatus.push('GA: connected but no data')
  } else {
    platformStatus.push('GA: not connected')
  }

  lines.push('\n=== ACCOUNT DATA IN THIS PROMPT ===')
  lines.push(`Platforms: ${platformStatus.join(' | ')}`)
  lines.push(
    'Use the data that IS in this prompt. If a platform shows "connected but no spend in this date range", "connected but no data", or "not connected", do NOT invent data for it — say so directly if the user asks about that platform.'
  )

  if (intelligence.google) lines.push(buildPlatformSection(intelligence.google, 'Google', limits))
  if (intelligence.meta) lines.push(buildPlatformSection(intelligence.meta, 'Meta', limits))

  if (intelligence.shopify?.connected) {
    const s = intelligence.shopify
    lines.push('\n=== SHOPIFY ===')
    // LORAMER_SHOPIFY_NET_SALES_V1
    if (s.totalRevenue != null) {
      lines.push(`Net sales (after refunds, excludes shipping & tax): $${s.totalRevenue.toFixed(2)}`)
    }
    if (s.refundedAmount != null && s.refundedAmount > 0) {
      lines.push(`Refunds in period: $${s.refundedAmount.toFixed(2)}`)
    }
    if (s.totalOrders) lines.push(`Total Orders: ${s.totalOrders}`)
    if (s.avgOrderValue) lines.push(`Avg Order Value: $${s.avgOrderValue.toFixed(2)}`)
    if (s.newCustomers) lines.push(`New Customers: ${s.newCustomers}`)
    if (s.returningCustomers) lines.push(`Returning Customers: ${s.returningCustomers}`)
    // LORAMER_SHOPIFY_DEEPER_SIGNALS_V1 — derived signals for Claude reasoning
    if (s.returningRate != null && s.totalOrders) lines.push(`Returning-customer rate: ${s.returningRate.toFixed(1)}% of orders`)
    if (s.newCustomerAov != null && s.newCustomerAov > 0) lines.push(`New customer AOV: $${s.newCustomerAov.toFixed(2)}`)
    if (s.returningCustomerAov != null && s.returningCustomerAov > 0) lines.push(`Returning customer AOV: $${s.returningCustomerAov.toFixed(2)}`)
    if (s.refundedOrderCount != null && s.totalOrders) lines.push(`Refunded orders: ${s.refundedOrderCount} (${s.refundRate?.toFixed(1)}% refund rate)`)
    if (s.revenueConcentration != null && s.totalOrders && s.totalOrders >= 10) lines.push(`Revenue concentration: top 10% of orders drove ${s.revenueConcentration.toFixed(1)}% of revenue`)
    // LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 — only render when we have a count.
    // undefined means the merchant didn't grant manage_abandoned_checkouts permission,
    // or the query failed. Distinct from 0 (no abandoned in this window).
    if (s.abandonedCheckoutCount != null) {
      lines.push(`Abandoned checkouts: ${s.abandonedCheckoutCount} in this date range (compared to ${s.totalOrders ?? 0} completed orders). The "abandonment rate" depends on which denominator you use — full checkout funnel data isn't available via API, so reason about the count directly rather than asserting a precise rate.`)
    }
    if (s.topProducts?.length) {
      lines.push(`Top Products (showing top ${Math.min(s.topProducts.length, limits.topProducts)}):`)
      s.topProducts.slice(0, limits.topProducts).forEach(prod => {
        lines.push(`  • ${prod.name}: $${prod.revenue.toFixed(2)} revenue, ${prod.units} units`)
      })
    }
  }


  // LORAMER_WOO_INTEL_V1
  if (intelligence.woocommerce?.connected) {
    const w = intelligence.woocommerce
    lines.push('\n=== WOOCOMMERCE ===')
    if (w.totalRevenue) lines.push(`Total Revenue: $${w.totalRevenue.toFixed(2)}`)
    if (w.totalOrders) lines.push(`Total Orders: ${w.totalOrders}`)
    if (w.avgOrderValue) lines.push(`Avg Order Value: $${w.avgOrderValue.toFixed(2)}`)
    if (w.newCustomers) lines.push(`New Customers: ${w.newCustomers}`)
    if (w.returningCustomers) lines.push(`Returning Customers: ${w.returningCustomers}`)
    if (w.topProducts?.length) {
      lines.push(`Top Products (showing top ${Math.min(w.topProducts.length, limits.topProducts)}):`)
      w.topProducts.slice(0, limits.topProducts).forEach(prod => {
        lines.push(`  • ${prod.name}: $${prod.revenue.toFixed(2)} revenue, ${prod.units} units`)
      })
    }
  }

  // LORAMER_GA_CLAUDE_CONTEXT_V1
  const gaSection = buildGaSection(intelligence.ga, limits)
  if (gaSection) lines.push(gaSection)
  if (intelligence.ga?.connected && intelligence.shopify?.connected) {
    lines.push(buildGaShopifyReconciliation(intelligence.ga, intelligence.shopify))
  }

  // LORAMER_MEMORY_V1 — durable facts above conversation history
  const memorySection = buildMemorySection(memory, intelligence.clientName)
  if (memorySection) lines.push(memorySection)

  // LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1
  // Everything below this point varies per call: conversation history grows
  // by 2 messages each turn, analysis rules are static but conventionally
  // placed at the end. Switch the lines reference so they land in the
  // suffix (dynamic) block. The eventual cache breakpoint in Phase 2 will
  // sit right here — before this line.
  lines = suffixLines
  // ── Previous Conversations (full flat history) ─────────────────────────────
  if (p.conversations) lines.push(buildConversationContext(p.conversations))

  // ── Rules ──────────────────────────────────────────────────────────────────
  lines.push('\n=== ANALYSIS RULES ===')
  if (directives.length > 0 || userNotes) {
    lines.push('REMINDER: The HARD CONSTRAINTS at the top of this prompt override everything below.')
    lines.push('If you are tempted to flag a metric the user told you to ignore — STOP and find a different angle.')
  }
  lines.push('Always respect campaign objectives. Never criticize a metric irrelevant to the objective.')
  lines.push('Be specific — use actual campaign names, ad names, and numbers.')
  lines.push('You are talking to an experienced agency professional. Skip basics.')
  lines.push('If you can see the data needed to answer a question, answer it directly without asking for more info.')

  return {
    prefix: prefixLines.join('\n'),
    suffix: suffixLines.join('\n'),
  }
}

// LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1
// Backwards-compatible string wrapper. /api/chat and /api/insight still call
// this and receive a single string, byte-identical to the previous behavior.
// Phase 2 will switch the routes to call buildClaudeContextCacheable() and
// pass the prefix and suffix as a typed system array with cache_control on
// the prefix block.
export function buildClaudeContext(
  intelligence: ClientIntelligence,
  focus: string = 'overview',
  focusData?: string
): string {
  const { prefix, suffix } = buildClaudeContextCacheable(intelligence, focus, focusData)
  return suffix ? prefix + '\n' + suffix : prefix
}
