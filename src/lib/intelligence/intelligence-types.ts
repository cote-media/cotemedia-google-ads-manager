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

// LORAMER_PROJECT_3_STEP_3A_V1 / LORAMER_GEO_RESOLVE_V1
// Geographic performance from geographic_view. country_criterion_id + location_type are what the API exposes;
// criterion ids RESOLVE to readable place names via the geo_target_constant reference — the query_breakdown tool
// returns geoName + geoCanonicalName. Metro/DMA ids do NOT resolve (not in Google's geotargets CSV) — reported as
// unresolved codes, never fabricated.
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
  // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant/SKU grain (capture-only, NOT UI). Shopify: id = bare variant
  // gid (globally unique). Woo: id = composite `${productId}:${variationId}` (variationId=0 = simple product,
  // folded to `${productId}:0` — a bare variationId is UNSAFE: every simple product shares 0 → 7-col-key collision).
  // parentProductId = the product entity_id (written as parent_entity_id). sku/variantTitle ride extra. revenue =
  // NET (Shopify: per-line refundLineItems netting; Woo: pro-rata of order net by line share) so Σ variant ≡ product ≡ account.
  variantsCapture?: { id: string; parentProductId: string; name: string; sku?: string; variantTitle?: string; units: number; revenue?: number; netRevenue?: number; grossRevenue?: number }[]
  geoCountries?: { country: string; netRevenue: number; orders: number; refunded: number }[]
  geoRegions?: { region: string; netRevenue: number; orders: number }[]
  // LORAMER_SHOPIFY_BATCH_A1_V1 — three families off the SAME widened OrdersInRange response.
  // geoCities: third rung of the geo ladder, composite '<country>-<province>-<city>'. PARTITIONS net.
  // salesChannelCapture: PARTITIONS net (one channel per order); channel = channelDefinition.handle.
  // discountTypeCapture: the TYPE axis of discounting (code/manual/automatic/script). WRITE-ONLY and
  //   NON-ADDITIVE — a subset of discounting whose allocations overlap; never summed into net sales.
  // LORAMER_SHOPIFY_BATCH_A2_V1 — product GROUPING attributes, accumulated off the same per-line net as
  // productsCapture. type/vendor PARTITION the day net (one of each per product). tag does NOT: a product
  // carries many tags, so the same net lands in every tag it holds — over-counting BY DESIGN, which is why
  // the family is additive:false and must never be summed as a share of the day.
  productTypeCapture?: { productType: string; netRevenue: number }[]
  productVendorCapture?: { vendor: string; netRevenue: number }[]
  productTagCapture?: { tag: string; netRevenue: number; units: number }[]
  // LORAMER_SHOPIFY_BATCH_A3_V1 — ORDER STATUS, CAPTURE-TIME SNAPSHOT (not order-date-historical).
  // Both PARTITION the day net at query time. Status is MUTABLE, so these record what was true WHEN WE
  // ASKED: a re-walk of the same day can legitimately return different values, and backfilled history is
  // systematically more settled than recent days. Never read a status distribution as a trend.
  financialStatusCapture?: { status: string; netRevenue: number; orders: number }[]
  fulfillmentStatusCapture?: { status: string; netRevenue: number; orders: number }[]
  // LORAMER_SHOPIFY_BATCH_C_V1 — customer cohort (PARTITIONS the day net via each order's customer) plus
  // avgLifetimeSpent, a LABELED LIFETIME attribute that must never be summed across days: a customer who
  // orders on ten days would have their whole lifetime value counted ten times. Non-PII: buckets, counts
  // and money only, never a per-customer row.
  // LORAMER_SHOPIFY_BATCH_B_V1 — collection membership from a SEPARATE batched call (never the orders query;
  // Shopify rejects that widen at 1,036 pts). NON-ADDITIVE: a product belongs to many collections, so the same
  // net is counted under each. Membership is a CAPTURE-TIME SNAPSHOT — it is mutable and not reconstructable
  // historically, so a re-walk records today's membership against old orders.
  productCollectionCapture?: { collection: string; netRevenue: number; products: number }[]
  customerCohortCapture?: { bucket: string; netRevenue: number; orders: number; customers: number; avgLifetimeSpent: number | null }[]
  geoCities?: { city: string; netRevenue: number; orders: number }[]
  salesChannelCapture?: { channel: string; netRevenue: number; orders: number; channelName: string | null }[]
  discountTypeCapture?: { type: string; discountedAmount: number; orders: number; label: string | null }[]
  // LORAMER_SHOPIFY_DISCOUNT_CODE_V1 (S-FILL#3) — per discount-code performance, WRITE-ONLY. discountedAmount = exact
  // applied money from line-item allocations; a SUBSET of total discounting (excludes manual/automatic non-code
  // discounts) that must NEVER sum into or reconcile against the order discount total (currentTotalDiscountsSet) or net sales.
  discountCodeCapture?: { code: string; discountedAmount: number; orders: number }[]
  // LORAMER_SHOPIFY_ORDER_TIME_V1 (S-FILL#7) — RAW order placement timestamps, one entry per live order.
  // createdAt is the verbatim Shopify UTC ISO-8601 string (to the second); it is NEVER bucketed to an hour at
  // write time so a later client-timezone model can re-bucket the full history with zero recapture.
  orderTimesCapture?: { orderId: string; createdAt: string; netRevenue: number }[]
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
  // LORAMER_SHOPIFY_ABANDONED_VALUE_V1 (S-FILL#2) — Σ totalPriceSet of the abandoned checkouts
  // in-window. POTENTIAL/LOST revenue, NEVER actual; persisted write-only, never summed into net
  // sales. undefined ⟺ abandonedCheckoutCount undefined (same fail-soft, same id+money PII lock).
  abandonedCheckoutValue?: number
  // Attribution (when connected to ad platforms)
  adAttributedRevenue?: number
  adAttributedOrders?: number
  // LORAMER_ECOM_MONEY_SURFACE_V1 (T1.5/T1.6) — full order money split beyond NET, captured onto the account
  // row's extra (extra.money). SHARED by Shopify (T1.5) + Woo (T1.6); per-platform basis carried by moneyBasis.
  // Per-field null-vs-zero: a component is null (not 0) when it could not be honestly summed (a present "0.00"
  // is a TRUE zero). residual = the per-day composed-identity gap (transparency; null if any input is null).
  money?: {
    netSales: number | null      // == account revenue (unchanged, load-bearing)
    grossSales: number | null    // pre-discount line total (Σ line subtotal), excl tax
    discounts: number | null     // Shopify: currentTotalDiscounts; Woo: discount_total (coupon/cart)
    taxes: number | null         // Shopify: currentTotalTax; Woo: total_tax (sum of ALL taxes)
    shipping: number | null      // Shopify: currentShipping; Woo: shipping_total (excl tax)
    totalSales: number | null    // grand total incl tax/shipping (Shopify: currentTotalPrice; Woo: total)
    refunds: number | null       // returns axis (Shopify: totalRefunded; Woo: Σ refunds.total, negative)
    residual: number | null      // totalSales − composed parts (on-sale-markdown / edit gap; transparency)
    moneyBasis: string
    // platform-specific (optional)
    tips?: number | null         // Shopify native tip (totalTipReceived)
    fees?: number | null         // Woo fee_lines total — tip-BEARING proxy (Woo has NO native tip field)
    shippingTax?: number | null  // Woo shipping_tax (informational; already inside taxes)
    discountTax?: number | null  // Woo discount_tax
    cartTax?: number | null      // Woo cart_tax (line-item taxes only)
  }
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
  // LORAMER_WS1C_WIDE_SWALLOW_HARDEN_V1 — per-sub-query fetch failures (resolve=[] is a true zero; reject is
  // recorded here). Present + non-empty ⇒ a DEGRADED fetch (a sub-query threw and returned [] instead of throwing).
  // The base account/campaign rows are NOT affected (the campaigns query is un-swallowed → it throws on failure).
  fetchErrors?: { label: string; message: string }[]
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
    valueModel?: string[]        // LORAMER_CLIENT_VALUE_MODEL_V1 — declared conversion/value model (online-purchase / offline-sales / lead); Lora reads it to interpret conversions + ROAS
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
