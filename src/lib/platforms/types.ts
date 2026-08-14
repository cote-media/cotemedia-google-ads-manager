// ─── Shared Platform Types ────────────────────────────────────────────────────

export type Platform = 'google' | 'meta' | 'combined'

export type CampaignStatus = 'active' | 'paused' | 'completed' | 'archived' | 'deleted' | 'unknown'

export type Campaign = {
  id: string
  name: string
  status: CampaignStatus
  platform: 'google' | 'meta'
  // Shared metrics
  spend: number
  clicks: number
  impressions: number
  ctr: number
  conversions: number
  conversionValue: number
  roas: number | null
  costPerConv: number | null
  convRate: number | null
  avgCpc: number | null
  budget: number | null
  // Google-specific
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.10/R.20 require all_conversions as a DEFAULT column. OPTIONAL on the
  // shared type on purpose: Meta has no equivalent metric, and the Meta/combined builders must not be forced to
  // invent one. A blended google+meta "all conversions" would violate MULTI-SOURCE METRIC PROVENANCE, so the
  // column is scoped to platform 'google' in COLUMN_DEFS and simply does not exist elsewhere.
  allConversions?: number | null
  qualityScore?: number
  searchImpressionShare?: number
  // Meta-specific
  cpm?: number | null
  reach?: number
  frequency?: number | null
  objective?: string
  // E-commerce actions (Meta; Google shows — for most)
  addToCart?: number | null
  initiateCheckout?: number | null
  purchases?: number | null
  viewContent?: number | null
  addToWishlist?: number | null
  costPerAddToCart?: number | null
  costPerInitiateCheckout?: number | null
  costPerPurchase?: number | null
}

export type PlatformTotals = {
  spend: number
  clicks: number
  impressions: number
  ctr: number
  conversions: number
  conversionValue: number
  roas: number | null
  avgCtr: number
  activeCampaigns: number
  reach?: number
  googleSpend?: number
  metaSpend?: number
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.10 (Account). Set ONLY on the google path; left undefined on
  // meta/combined for the provenance reason on Campaign.allConversions above. The Overview tile renders when it
  // is defined, so an undefined never becomes a displayed zero.
  allConversions?: number
}

export type PlatformData = {
  platform: Platform
  campaigns: Campaign[]
  totals: PlatformTotals
  dateRange: string
  accountId: string
  accountName?: string
}

export type ColumnDef = {
  id: string
  label: string
  platforms: Platform[]
  defaultOn: boolean
  getValue: (c: Campaign) => string | number | null | undefined
  align: 'left' | 'right'
  category?: 'core' | 'ecommerce' | 'meta' | 'google'
}

export const COLUMN_DEFS: ColumnDef[] = [
  // ── Core shared ──
  { id: 'spend', label: 'Spend', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.spend, align: 'right', category: 'core' },
  { id: 'clicks', label: 'Clicks', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.clicks, align: 'right', category: 'core' },
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — impressions is DEFAULT-ON. RMF R.20 (Campaign) and R.40 (Ad) both require
  // it by default, and this one ColumnDef feeds the campaign, ad-group AND ad tables. Was `false`.
  { id: 'impressions', label: 'Impressions', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.impressions, align: 'right', category: 'core' },
  { id: 'ctr', label: 'CTR', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.ctr, align: 'right', category: 'core' },
  { id: 'conversions', label: 'Conv.', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.conversions, align: 'right', category: 'core' },
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — RMF R.20. GOOGLE ONLY, deliberately: Meta serves no all_conversions, so
  // listing it for meta/combined would ship a column that is structurally empty forever — the exact defect the
  // Quality Score column had before this flight.
  { id: 'allConversions', label: 'All conv.', platforms: ['google'], defaultOn: true, getValue: c => c.allConversions ?? null, align: 'right', category: 'google' },
  { id: 'roas', label: 'ROAS', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.roas, align: 'right', category: 'core' },
  { id: 'costPerConv', label: 'Cost/Conv', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.costPerConv, align: 'right', category: 'core' },
  { id: 'avgCpc', label: 'Avg CPC', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.avgCpc, align: 'right', category: 'core' },
  { id: 'convRate', label: 'Conv Rate', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.convRate, align: 'right', category: 'core' },
  { id: 'budget', label: 'Budget/day', platforms: ['google', 'meta'], defaultOn: false, getValue: c => c.budget, align: 'right', category: 'core' },
  // ── Google-only ──
  { id: 'qualityScore', label: 'QS', platforms: ['google'], defaultOn: false, getValue: c => c.qualityScore ?? null, align: 'right', category: 'google' },
  // ── Meta-only core ──
  { id: 'cpm', label: 'CPM', platforms: ['meta'], defaultOn: false, getValue: c => c.cpm ?? null, align: 'right', category: 'meta' },
  { id: 'reach', label: 'Reach', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.reach ?? null, align: 'right', category: 'meta' },
  { id: 'frequency', label: 'Frequency', platforms: ['meta'], defaultOn: false, getValue: c => c.frequency ?? null, align: 'right', category: 'meta' },
  // ── E-commerce (Meta + Combined) ──
  { id: 'viewContent', label: 'View Content', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.viewContent ?? null, align: 'right', category: 'ecommerce' },
  { id: 'addToCart', label: 'Add to Cart', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.addToCart ?? null, align: 'right', category: 'ecommerce' },
  { id: 'initiateCheckout', label: 'Initiate Checkout', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.initiateCheckout ?? null, align: 'right', category: 'ecommerce' },
  { id: 'purchases', label: 'Purchases', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.purchases ?? null, align: 'right', category: 'ecommerce' },
  { id: 'addToWishlist', label: 'Add to Wishlist', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.addToWishlist ?? null, align: 'right', category: 'ecommerce' },
  { id: 'costPerAddToCart', label: 'Cost/ATC', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.costPerAddToCart ?? null, align: 'right', category: 'ecommerce' },
  { id: 'costPerInitiateCheckout', label: 'Cost/Checkout', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.costPerInitiateCheckout ?? null, align: 'right', category: 'ecommerce' },
  { id: 'costPerPurchase', label: 'Cost/Purchase', platforms: ['meta', 'combined'], defaultOn: false, getValue: c => c.costPerPurchase ?? null, align: 'right', category: 'ecommerce' },
]

// ─── RMF required default columns ─────────────────────────────────────────────
// LORAMER_RMF_REPORTING_DEFAULTS_V1
//
// ⛔ WHY THIS EXISTS AND WHY `defaultOn` ALONE WAS NOT ENOUGH. Both legacy column pickers seed their state from
// localStorage — `lsJson('advar-cols-' + platform, defaultCols)` and `lsJson('advar-kw-cols', …)`. For ANY browser
// that has ever opened those screens the SAVED array wins and the new defaults are never consulted. Flipping
// `defaultOn` therefore changes what a FRESH browser shows and nothing else, which is precisely the shape of a
// green check that answers a narrower question than the reader assumes: the constant would read "impressions is
// default-on" while the reviewer's screen, on a browser Russ had used once, still had it hidden.
//
// So the required set is ALSO unioned into the active set on load (rmfEnsure below). A user may still hide a
// column deliberately for the rest of that session — "by default" is a statement about the default state, not a
// prohibition on user choice — but a STALE PREFERENCE can no longer silently drop an RMF-required column.
export const RMF_REQUIRED_COLUMNS: Record<string, string[]> = {
  // R.20 Campaign / R.40 Ad — the campaign table's ColumnDefs also drive the ad-group and ad drill levels.
  google: ['clicks', 'spend', 'impressions', 'conversions', 'allConversions'],
  // Meta is not under Google's RMF; it keeps only what the shared table already defaulted to.
  meta: [],
  combined: [],
}
// R.50 Keyword — a SEPARATE id-space (the Keywords tab owns its own column list, not COLUMN_DEFS).
export const RMF_REQUIRED_KEYWORD_COLUMNS: string[] = [
  'spend', 'clicks', 'impressions', 'conversions', 'firstPageCpc', 'firstPositionCpc',
]

// Union the required ids into a (possibly stale, possibly localStorage-sourced) active set, preserving the
// user's own ordering and never dropping anything they added.
export function rmfEnsure(active: string[], required: string[]): string[] {
  const missing = required.filter((id) => !active.includes(id))
  return missing.length === 0 ? active : [...active, ...missing]
}

// ─── Status normalization ─────────────────────────────────────────────────────
export function normalizeGoogleStatus(status: string): CampaignStatus {
  const s = String(status).toUpperCase()
  if (s === 'ENABLED' || s === '2') return 'active'
  if (s === 'PAUSED' || s === '3') return 'paused'
  if (s === 'REMOVED' || s === '4') return 'deleted'
  return 'unknown'
}

export function normalizeMetaStatus(status: string): CampaignStatus {
  const s = String(status).toUpperCase()
  if (s === 'ACTIVE') return 'active'
  if (s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED') return 'paused'
  if (s === 'COMPLETED') return 'completed'
  if (s === 'ARCHIVED') return 'archived'
  if (s === 'DELETED') return 'deleted'
  return 'unknown'
}

export function statusLabel(status: CampaignStatus): string {
  const labels: Record<CampaignStatus, string> = {
    active: 'Active', paused: 'Paused', completed: 'Completed',
    archived: 'Archived', deleted: 'Deleted', unknown: 'Unknown',
  }
  return labels[status] || status
}

export function statusBadgeClass(status: CampaignStatus): string {
  if (status === 'active') return 'badge-good'
  if (status === 'paused') return 'badge-warn'
  return 'badge-bad'
}
