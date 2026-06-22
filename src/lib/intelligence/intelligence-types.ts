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
  primaryStatus?: string           // LORAMER_GOOGLE_CAMPAIGN_STATUS_FIX_V2 — Google CampaignPrimaryStatus (ELIGIBLE/ENDED/PAUSED/LIMITED/…); authoritative serving signal behind the toggle
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
  // LORAMER_SHOPIFY_NET_SALES_V1 — totalRevenue is net sales (after refunds, excludes shipping/tax)
  totalRevenue?: number
  refundedAmount?: number
  avgOrderValue?: number
  // Products
  topProducts?: { id: string; name: string; revenue: number; units: number }[]
  // LORAMER_SHOPIFY_DEPTH_2A_V1 — capture-only (NOT UI): full product net + ship-to geo.
  // Cancelled orders excluded from these. currencyCode = the store's shopMoney currency.
  // LORAMER_WOO_ALLPRODUCTS_FIX1A_V1 — revenue fields optional so this serves BOTH Shopify
  // (netRevenue/grossRevenue) AND Woo (revenue). id/name/units required (both set them).
  productsCapture?: { id: string; name: string; units: number; revenue?: number; netRevenue?: number; grossRevenue?: number }[]
  geoCountries?: { country: string; netRevenue: number; orders: number; refunded: number }[]
  geoRegions?: { region: string; netRevenue: number; orders: number }[]
  currencyCode?: string
  currencyMixed?: boolean // LORAMER_SHOPIFY_DIM_BACKFILL_V1 — window spans >1 base currency (rare)
  unknownGeoOrders?: number
  // Customers
  newCustomers?: number
  returningCustomers?: number
  // LORAMER_CUSTOMER_MIX_FIX_V1 — new/returning are now COUNTS of distinct customers classified by
  // their TRUE first-order date; unknownCustomers can't be determined; customerMixUnavailable=true
  // when none could be classified (render "unavailable", never a fabricated split).
  unknownCustomers?: number
  customerMixUnavailable?: boolean
  // LORAMER_WOO_CAPTURED_E1_V1 — Woo dashboard reads captured aggregates; first-ever new/returning is the
  // E2 0-PII engine. When true, the tiles render an honest "coming soon" (never a fabricated 0/split).
  customerMixComingSoon?: boolean
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
  fetchFailed?: boolean   // LORAMER_GOOGLE_CAMPAIGN_STATUS_FIX_V2 — connected, but the live fetch threw this turn (distinct from no-spend / not-connected)
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
  // LORAMER_PROJECT_3_STEP_4A_V1 — Meta-only: placement breakdown (account-level, Lora-prompt only)
  placements?: IntelligencePlacement[]
  // LORAMER_META_PLACEMENT_PERSIST_SLICE1_V1 — Meta-only: campaign × placement breakdown (for metrics_daily persistence)
  campaignPlacements?: IntelligenceCampaignPlacement[]
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

// LORAMER_META_PLACEMENT_PERSIST_SLICE1_V1
// Meta campaign × placement breakdown: same (publisher × position) split, but KEYED PER CAMPAIGN
// (campaign_id added to the placement fetch). Persisted to metrics_daily as entity_level='campaign',
// breakdown_type='placement'. spend/clicks/impressions only — Meta does not break conversions out per placement.
export interface IntelligenceCampaignPlacement {
  campaignId: string
  campaignName: string
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
  // LORAMER_DATE_RANGE_CANONICAL_V1 - resolved window for all platforms
  resolvedStartDate?: string
  resolvedEndDate?: string

  // Client profile
  profile: {
    businessType?: string
    businessDescriptor?: string  // LORAMER_CLIENT_DESCRIPTOR_V1 — free-text "what this business does" (primary signal; falls back to businessType)
    serviceArea?: string         // LORAMER_CLIENT_DESCRIPTOR_V1
    naicsCodes?: { code: string; title: string }[]  // LORAMER_NAICS_V1 — official definitions resolved server-side at prompt time
    knowledgeDocs?: { scope: 'client' | 'agency'; filename: string; text: string; wordCount: number }[]  // LORAMER_KNOWLEDGE_INGEST_V1 — uploaded reference docs (delimited untrusted data)
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

  // LORAMER_CONNECTION_HEALTH_V1 — reconnect-needed connections (only populated when the
  // NEXT_PUBLIC_SHOW_CONNECTION_HEALTH_UI flag is on; absent → no honesty block in the prompt).
  connectionHealth?: Array<{ platform: string; accountName: string }>

  // Future platforms plug in here:
  // tiktok?: PlatformIntelligence
  // pinterest?: PlatformIntelligence
  // linkedin?: PlatformIntelligence
}
