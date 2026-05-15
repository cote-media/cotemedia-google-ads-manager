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
  qualityScore?: number
  searchImpressionShare?: number
  // Meta-specific
  cpm?: number | null
  reach?: number
  frequency?: number | null
  objective?: string
  // Meta e-commerce actions
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
  { id: 'impressions', label: 'Impressions', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.impressions, align: 'right', category: 'core' },
  { id: 'ctr', label: 'CTR', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.ctr, align: 'right', category: 'core' },
  { id: 'conversions', label: 'Conv.', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.conversions, align: 'right', category: 'core' },
  { id: 'roas', label: 'ROAS', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.roas, align: 'right', category: 'core' },
  { id: 'costPerConv', label: 'Cost/Conv', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.costPerConv, align: 'right', category: 'core' },
  { id: 'avgCpc', label: 'Avg CPC', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.avgCpc, align: 'right', category: 'core' },
  { id: 'convRate', label: 'Conv Rate', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.convRate, align: 'right', category: 'core' },
  { id: 'budget', label: 'Budget/day', platforms: ['google', 'meta'], defaultOn: false, getValue: c => c.budget, align: 'right', category: 'core' },
  // ── Google-only ──
  { id: 'qualityScore', label: 'QS', platforms: ['google'], defaultOn: false, getValue: c => c.qualityScore ?? null, align: 'right', category: 'google' },
  // ── Meta-only core ──
  { id: 'cpm', label: 'CPM', platforms: ['meta'], defaultOn: false, getValue: c => c.cpm ?? null, align: 'right', category: 'meta' },
  { id: 'reach', label: 'Reach', platforms: ['meta'], defaultOn: false, getValue: c => c.reach ?? null, align: 'right', category: 'meta' },
  { id: 'frequency', label: 'Frequency', platforms: ['meta'], defaultOn: false, getValue: c => c.frequency ?? null, align: 'right', category: 'meta' },
  // ── Meta e-commerce ──
  { id: 'viewContent', label: 'View Content', platforms: ['meta'], defaultOn: false, getValue: c => c.viewContent ?? null, align: 'right', category: 'ecommerce' },
  { id: 'addToCart', label: 'Add to Cart', platforms: ['meta'], defaultOn: false, getValue: c => c.addToCart ?? null, align: 'right', category: 'ecommerce' },
  { id: 'initiateCheckout', label: 'Initiate Checkout', platforms: ['meta'], defaultOn: false, getValue: c => c.initiateCheckout ?? null, align: 'right', category: 'ecommerce' },
  { id: 'purchases', label: 'Purchases', platforms: ['meta'], defaultOn: false, getValue: c => c.purchases ?? null, align: 'right', category: 'ecommerce' },
  { id: 'addToWishlist', label: 'Add to Wishlist', platforms: ['meta'], defaultOn: false, getValue: c => c.addToWishlist ?? null, align: 'right', category: 'ecommerce' },
  { id: 'costPerAddToCart', label: 'Cost/ATC', platforms: ['meta'], defaultOn: false, getValue: c => c.costPerAddToCart ?? null, align: 'right', category: 'ecommerce' },
  { id: 'costPerInitiateCheckout', label: 'Cost/Checkout', platforms: ['meta'], defaultOn: false, getValue: c => c.costPerInitiateCheckout ?? null, align: 'right', category: 'ecommerce' },
  { id: 'costPerPurchase', label: 'Cost/Purchase', platforms: ['meta'], defaultOn: false, getValue: c => c.costPerPurchase ?? null, align: 'right', category: 'ecommerce' },
]

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
