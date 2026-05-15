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
  // Meta-specific
  reach?: number
  // Combined
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
  platforms: Platform[]  // which platforms this column applies to
  defaultOn: boolean
  getValue: (c: Campaign) => string | number | null
  align: 'left' | 'right'
}

// ─── Shared column definitions ────────────────────────────────────────────────
export const COLUMN_DEFS: ColumnDef[] = [
  // Shared
  { id: 'spend', label: 'Spend', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.spend, align: 'right' },
  { id: 'clicks', label: 'Clicks', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.clicks, align: 'right' },
  { id: 'impressions', label: 'Impressions', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.impressions, align: 'right' },
  { id: 'ctr', label: 'CTR', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.ctr, align: 'right' },
  { id: 'conversions', label: 'Conv.', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.conversions, align: 'right' },
  { id: 'roas', label: 'ROAS', platforms: ['google', 'meta', 'combined'], defaultOn: true, getValue: c => c.roas, align: 'right' },
  { id: 'costPerConv', label: 'Cost/Conv', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.costPerConv, align: 'right' },
  { id: 'avgCpc', label: 'Avg CPC', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.avgCpc, align: 'right' },
  { id: 'convRate', label: 'Conv Rate', platforms: ['google', 'meta', 'combined'], defaultOn: false, getValue: c => c.convRate, align: 'right' },
  { id: 'budget', label: 'Budget/day', platforms: ['google', 'meta'], defaultOn: false, getValue: c => c.budget, align: 'right' },
  // Google-only
  { id: 'qualityScore', label: 'QS', platforms: ['google'], defaultOn: false, getValue: c => c.qualityScore ?? null, align: 'right' },
  // Meta-only
  { id: 'cpm', label: 'CPM', platforms: ['meta'], defaultOn: false, getValue: c => c.cpm ?? null, align: 'right' },
  { id: 'reach', label: 'Reach', platforms: ['meta'], defaultOn: false, getValue: c => c.reach ?? null, align: 'right' },
  { id: 'frequency', label: 'Frequency', platforms: ['meta'], defaultOn: false, getValue: c => c.frequency ?? null, align: 'right' },
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
