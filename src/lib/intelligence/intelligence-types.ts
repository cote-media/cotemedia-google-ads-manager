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
  totals: IntelligenceMetrics
}

export interface ClientIntelligence {
  clientId: string
  clientName: string
  fetchedAt: string
  dateRange: string

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

  // Future platforms plug in here:
  // tiktok?: PlatformIntelligence
  // pinterest?: PlatformIntelligence
  // linkedin?: PlatformIntelligence
}
