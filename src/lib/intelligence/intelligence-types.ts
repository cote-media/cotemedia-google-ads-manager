// ─── Universal Intelligence Types ─────────────────────────────────────────────
// This is the single schema that ALL platforms conform to.
// Every Claude call receives a ClientIntelligence object.
// Adding a new platform = adding one adapter that outputs to this schema.

export interface IntelligenceMetrics {
  spend: number
  clicks: number
  impressions: number
  conversions: number
  conversionValue: number
  ctr: number
  cpc: number
  cpm: number
  roas: number | null
  cpa: number | null
  convRate: number | null
  reach?: number
  frequency?: number
  // Ecommerce
  purchases?: number
  addToCart?: number
  initiateCheckout?: number
  viewContent?: number
  costPerPurchase?: number
  costPerAddToCart?: number
}

export interface IntelligenceCampaign {
  id: string
  name: string
  platform: 'google' | 'meta' | 'shopify'
  status: string
  objective?: string
  channelType?: string        // Google: SEARCH, DISPLAY, PERFORMANCE_MAX, VIDEO, SHOPPING
  bidStrategy?: string        // Target CPA, Target ROAS, Maximize Conversions, etc.
  budgetType?: 'daily' | 'lifetime'
  budget?: number
  metrics: IntelligenceMetrics
}

export interface IntelligenceAdGroup {
  id: string
  name: string
  campaignId: string
  campaignName: string
  platform: 'google' | 'meta'
  status: string
  // Meta specific
  targeting?: {
    ageMin?: number
    ageMax?: number
    genders?: string[]
    interests?: string[]
    lookalikes?: string[]
    customAudiences?: string[]
    retargeting?: boolean
  }
  bidStrategy?: string
  optimizationGoal?: string
  placements?: {
    facebook_feed?: number
    instagram_feed?: number
    facebook_reels?: number
    instagram_reels?: number
    facebook_stories?: number
    instagram_stories?: number
    audience_network?: number
    messenger?: number
  }
  metrics: IntelligenceMetrics
}

export interface IntelligenceAd {
  id: string
  name: string
  adGroupId: string
  adGroupName: string
  campaignId: string
  campaignName: string
  platform: 'google' | 'meta'
  status: string
  // Creative details
  creativeType?: 'image' | 'video' | 'carousel' | 'collection' | 'responsive' | 'text'
  headline?: string
  description?: string
  body?: string
  callToAction?: string
  imageUrl?: string
  metrics: IntelligenceMetrics
}

export interface IntelligenceKeyword {
  text: string
  matchType: string
  campaignName: string
  adGroupName: string
  status: string
  qualityScore?: number
  metrics: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_2A_V1
// Search Term Report: what actual user queries triggered ads.
// Independent of keywords — these are the queries users typed, not the
// keywords we bid on. Reveals wasted spend at granular level.
export interface IntelligenceSearchTerm {
  text: string                    // the actual user query
  matchType: string               // how it matched (BROAD, EXACT, PHRASE, NEAR_EXACT, NEAR_PHRASE)
  status: string                  // NONE, ADDED, EXCLUDED, ADDED_EXCLUDED — has user already acted on it?
  campaignName: string
  adGroupName: string
  metrics: IntelligenceMetrics
}

export interface IntelligenceConversionAction {
  id: string
  name: string
  category: string        // PURCHASE, LEAD, SIGNUP, PAGE_VIEW, etc.
  platform: 'google' | 'meta'
  includeInConversions: boolean
  count: number
}

// LORAMER_PROJECT_3_STEP_2B_V1
// Per-campaign conversion breakdown. Flat list of (campaign, conversion_action)
// pairs with conversion counts and values. Lets Claude attribute conversions
// to specific campaigns instead of just reporting account-level totals.
export interface IntelligenceConversionByCampaign {
  campaignId: string
  campaignName: string
  conversionActionName: string
  conversionActionCategory: string  // PURCHASE, LEAD, SIGNUP, etc.
  count: number
  value: number
}

// LORAMER_PROJECT_3_STEP_2C_V1
// Audience segment performance — which audience signals (in-market, affinity,
// lookalikes, custom audiences, retargeting lists) are driving traffic and
// conversions for each campaign. Critical for PMax analysis where audience
// signals do a lot of the targeting work.
export interface IntelligenceAudience {
  id: string
  name: string
  description?: string
  campaignId: string
  campaignName: string
  adGroupId?: string
  adGroupName?: string
  metrics: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_2D_V1
// Demographic performance — age buckets and gender splits per campaign.
// Two GAQL views (age_range_view, gender_view) flatten into one type
// distinguished by `dimension`.
export interface IntelligenceDemographic {
  dimension: 'age' | 'gender'
  value: string                    // '25-34', '18-24', 'MALE', 'FEMALE', 'UNDETERMINED', etc.
  campaignId: string
  campaignName: string
  adGroupId?: string
  adGroupName?: string
  metrics: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_3A_V1
// Geographic performance from geographic_view. country_criterion_id and
// location_type are what the API exposes; further resolution to readable
// country/region names is deferred (Google's geo_target_constant lookup).
export interface IntelligenceGeographic {
  campaignId: string
  campaignName: string
  countryCriterionId?: string
  locationType?: string
  metrics: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_3B_V1
// Per-campaign device split: Mobile / Desktop / Tablet / Connected TV / Other.
export interface IntelligenceDeviceSplit {
  campaignId: string
  campaignName: string
  device: string
  metrics: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_3C_V1
// Per-campaign hour-of-day + day-of-week performance. hour is 0-23 in the
// account timezone. dayOfWeek is a short label (Mon/Tue/...).
export interface IntelligenceHourly {
  campaignId: string
  campaignName: string
  hour: number
  dayOfWeek: string
  metrics: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_3D_V1
// Impression share intelligence — the API-accessible auction signal.
// All values are decimals 0.0-1.0 (e.g. 0.62 = 62%). null when API returns
// -1.0 (campaign not eligible for that metric). True Auction Insights with
// competitor domains, overlap rate, outranking share is UI-only in v23.
export interface IntelligenceImpressionShare {
  campaignId: string
  campaignName: string
  channelType: string
  impressionShare: number | null
  topImpressionShare: number | null
  absoluteTopImpressionShare: number | null
  lostToBudget: number | null
  lostToRank: number | null
  lostTopToBudget: number | null
  lostTopToRank: number | null
  hasData: boolean
}

// LORAMER_PROJECT_3_STEP_3E_V1
// Google's own optimization recommendations. Claude evaluates against client
// data rather than rubber-stamping — see operator-bias grounding in prompt.
// Base = current state metrics. Potential = Google's projection if applied.
export interface IntelligenceRecommendation {
  resourceName: string
  type: string  // e.g. "KEYWORD", "CAMPAIGN_BUDGET", "USE_BROAD_MATCH_KEYWORD", "TARGET_CPA_OPT_IN"
  campaignResourceName?: string
  baseImpressions: number
  baseClicks: number
  baseCost: number
  baseConversions: number
  potentialImpressions: number
  potentialClicks: number
  potentialCost: number
  potentialConversions: number
}

// LORAMER_PROJECT_3_STEP_2E_V1
// Asset-level RSA performance. Each Responsive Search Ad has up to 15
// headlines and 4 descriptions. Google reports per-asset performance
// labels (BEST/GOOD/LOW/PENDING/UNRATED) not raw metrics. The label IS
// the signal for asset-level analysis.
export interface IntelligenceAdAsset {
  adId: string
  campaignName: string
  adGroupName: string
  fieldType: 'HEADLINE' | 'DESCRIPTION' | 'OTHER'
  text: string
  performanceLabel: string  // 'BEST' | 'GOOD' | 'LOW' | 'PENDING' | 'UNRATED' | ''
}

// LORAMER_PROJECT_3_STEP_2F_V1
// Performance Max asset groups. Each PMax campaign has 1+ asset groups,
// each a themed collection of creative + audience signals. Asset groups
// have their own metrics (Google exposes these), while individual assets
// within only have performance labels.
export interface IntelligenceAssetGroup {
  id: string
  name: string
  campaignId: string
  campaignName: string
  status: string
  adStrength?: string  // EXCELLENT, GOOD, AVERAGE, POOR, PENDING, NO_ADS
  metrics: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_2F_V1
// Individual assets within PMax asset groups. Field types include
// HEADLINE, LONG_HEADLINE, DESCRIPTION, BUSINESS_NAME, MARKETING_IMAGE,
// SQUARE_MARKETING_IMAGE, LOGO, LANDSCAPE_LOGO, YOUTUBE_VIDEO, etc.
// Image/video assets have no text but carry performance labels.
export interface IntelligenceAssetGroupAsset {
  assetGroupId: string
  assetGroupName: string
  campaignName: string
  fieldType: string  // see comment above
  text?: string  // present for text assets
  isImage: boolean  // marketing image, square marketing image, logo, etc.
  isVideo: boolean  // youtube video
  assetId: string  // LORAMER_PROJECT_3_STEP_2G_V1 — asset resource name, join key for combinations
}

// LORAMER_PROJECT_3_STEP_2G_V1
// A top-performing asset COMBINATION from Google's Combinations report
// (asset_group_top_combination_view). These are the actual sets of assets that
// served together and performed well — the real answer to "which combination
// drove this conversion?". Per-asset BEST/GOOD/LOW labels are UI-only in v23,
// so combinations (not labels) are the asset-level performance signal via API.
export interface IntelligenceAssetCombination {
  assetGroupId: string
  assetGroupName: string
  campaignName: string
  adStrength?: string
  assets: string[]  // readable descriptions of the assets in this combination
}

// LORAMER_GA_INTELLIGENCE_V1
export interface IntelligenceGaTrafficSource {
  source: string
  medium: string
  sessions: number
  conversions: number
  totalRevenue: number
}

export interface IntelligenceGaCampaign {
  campaignName: string
  sessions: number
  conversions: number
  totalRevenue: number
}

export interface IntelligenceGaLandingPage {
  landingPage: string
  sessions: number
  sessionConversionRate: number
}

export interface IntelligenceGaConversionEvent {
  eventName: string
  eventCount: number
  eventValue: number
}

export interface IntelligenceGaCountry {
  country: string
  sessions: number
}

export interface IntelligenceGaDevice {
  deviceCategory: string
  sessions: number
}

export interface IntelligenceGaProduct {
  itemName: string
  itemsPurchased: number
  itemRevenue: number
}

export interface IntelligenceGaTransactionSource {
  source: string
  medium: string
  transactions: number
}

export interface IntelligenceGa {
  connected: boolean
  propertyId?: string
  propertyName?: string
  sessions?: number
  totalUsers?: number
  newUsers?: number
  engagementRate?: number
  conversions?: number
  totalRevenue?: number
  transactions?: number
  topTrafficSources?: IntelligenceGaTrafficSource[]
  topCampaigns?: IntelligenceGaCampaign[]
  topLandingPages?: IntelligenceGaLandingPage[]
  conversionEvents?: IntelligenceGaConversionEvent[]
  topCountries?: IntelligenceGaCountry[]
  deviceSplit?: IntelligenceGaDevice[]
  topProducts?: IntelligenceGaProduct[]
  transactionsBySource?: IntelligenceGaTransactionSource[]
  cartToPurchaseRate?: number
  purchaserConversionRate?: number
  refundAmount?: number
}

// Shopify — ready to plug in
export interface IntelligenceShopify {
  connected: boolean
  // Orders
  totalOrders?: number
  totalRevenue?: number
  avgOrderValue?: number
  // Products
  topProducts?: { id: string; name: string; revenue: number; units: number }[]
  // Customers
  newCustomers?: number
  returningCustomers?: number
  // LORAMER_SHOPIFY_DEEPER_SIGNALS_V1 — derived metrics
  refundedOrderCount?: number
  refundRate?: number              // percentage (0-100)
  returningRate?: number           // percentage of orders from returning customers (0-100)
  newCustomerAov?: number          // average order value among first-time customer orders
  returningCustomerAov?: number    // average order value among returning customer orders
  revenueConcentration?: number    // % of revenue contributed by top 10% of orders by value (0-100)
  // LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 — count only (no PII).
  // undefined when the merchant hasn't granted manage_abandoned_checkouts
  // permission, or when the query fails. Different from 0, which means
  // "zero abandoned in this window". Claude is instructed to honor the
  // distinction in build-claude-context.ts.
  abandonedCheckoutCount?: number
  // Attribution (when connected to ad platforms)
  adAttributedRevenue?: number
  adAttributedOrders?: number
}

export interface PlatformIntelligence {
  connected: boolean
  accountId?: string
  accountName?: string
  dateRange: string
  fetchedAt: string
  campaigns: IntelligenceCampaign[]
  adGroups: IntelligenceAdGroup[]
  ads: IntelligenceAd[]
  keywords?: IntelligenceKeyword[]           // Google only
  // LORAMER_PROJECT_3_STEP_2A_V1
  searchTerms?: IntelligenceSearchTerm[]     // Google only — search term report
  conversionActions?: IntelligenceConversionAction[]
  // LORAMER_PROJECT_3_STEP_2B_V1
  conversionsByCampaign?: IntelligenceConversionByCampaign[]
  // LORAMER_PROJECT_3_STEP_2C_V1
  audiences?: IntelligenceAudience[]
  // LORAMER_PROJECT_3_STEP_2D_V1
  demographics?: IntelligenceDemographic[]
  // LORAMER_PROJECT_3_STEP_2E_V1
  adAssets?: IntelligenceAdAsset[]
  // LORAMER_PROJECT_3_STEP_2F_V1 - PMax asset groups + assets
  assetGroups?: IntelligenceAssetGroup[]
  assetGroupAssets?: IntelligenceAssetGroupAsset[]
  // LORAMER_PROJECT_3_STEP_2G_V1 - PMax top asset combinations
  assetCombinations?: IntelligenceAssetCombination[]
  // LORAMER_PROJECT_3_STEP_3A_V1 / 3B_V1 / 3C_V1 — Tier 2 Claude-context-only
  geographics?: IntelligenceGeographic[]
  devices?: IntelligenceDeviceSplit[]
  hourly?: IntelligenceHourly[]
  // LORAMER_PROJECT_3_STEP_3D_V1
  impressionShares?: IntelligenceImpressionShare[]
  // LORAMER_PROJECT_3_STEP_3E_V1 — Google's own optimization suggestions
  recommendations?: IntelligenceRecommendation[]
  // LORAMER_PROJECT_3_STEP_4A_V1 — Meta-only: placement breakdown
  placements?: IntelligencePlacement[]
  totals: IntelligenceMetrics
}

// LORAMER_PROJECT_3_STEP_4A_V1
// Meta placement breakdown: (publisher_platform × platform_position) aggregated.
// publisherPlatform: facebook, instagram, audience_network, messenger, etc.
// platformPosition: feed, reels, stories, marketplace, etc.
export interface IntelligencePlacement {
  publisherPlatform: string
  platformPosition: string
  spend: number
  clicks: number
  impressions: number
}

export interface ClientIntelligence {
  clientId: string
  clientName: string
  fetchedAt: string
  dateRange: string
  // LORAMER_DATE_RANGE_PROMPT_CLARITY_V1 - actual start/end when custom range used
  customStart?: string
  customEnd?: string

  // Client profile
  profile: {
    businessType?: string
    primaryKpi?: string
    funnelNotes?: string
    userNotes?: string
    conversations?: Record<string, any[]>
    // LORAMER_MEMORY_V1 - structured facts from client_memory table
    memory?: Array<{
      id: number
      content: string
      category: 'directive' | 'fact' | 'observation' | 'preference' | 'context'
      confidence: number
      pinned: boolean
      source: string
    }>
  }

  // Platform data
  google?: PlatformIntelligence
  meta?: PlatformIntelligence
  shopify?: IntelligenceShopify
  woocommerce?: IntelligenceShopify  // LORAMER_WOO_INTEL_V1 - same shape as Shopify
  // LORAMER_GA_INTELLIGENCE_V1
  ga?: IntelligenceGa

  // Future platforms plug in here:
  // tiktok?: PlatformIntelligence
  // pinterest?: PlatformIntelligence
  // linkedin?: PlatformIntelligence
}
