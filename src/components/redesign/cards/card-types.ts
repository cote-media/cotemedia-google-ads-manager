// LORAMER_NEXT_CARD_ENGINE_V1 — shared types + catalogs for the PAGE-AGNOSTIC card engine (-next only, dark).
// The engine never hardcodes Overview: it takes a pageKey + a SavedView (cards + grid layout). Portfolio + client
// pages reuse it later by passing a different pageKey + default view — no rebuild (no-do-it-twice).

export type CardKind = 'stat' | 'breakdown' | 'timeseries'
export type VizType = 'stat' | 'bar' | 'table' | 'line'
export type PageKey = 'overview' | 'portfolio' | 'client'

export interface CardConfig {
  id: string
  title?: string
  kind: CardKind
  viz: VizType
  // LORAMER_NEXT_CARD_ENGINE_RESHAPE_V1 — by DEFAULT a card inherits the page-level GLOBAL date range. useCustomRange
  // ON = this card pins to its OWN dateRange and ignores the global (the by-exception override).
  useCustomRange?: boolean
  dateRange: string            // the card's OWN range (a preset key) — used only when useCustomRange is ON
  // stat:
  metric?: string              // spend | revenue | conversions | roas | clicks | impressions
  // breakdown:
  breakdownType?: string       // one of the query-exposed families
  rankBy?: string              // spend | conversions | …
  topN?: number
}

// react-grid-layout item (subset we persist).
export interface GridItem { i: string; x: number; y: number; w: number; h: number }

export interface SavedView { name: string; cards: CardConfig[]; layout: GridItem[]; pinned?: string[] }

// STAT metric catalog (base account cards via /api/next/client-metrics — proven route, honest deltas).
export interface StatMetric { key: string; label: string; money: boolean; suffix?: string }
export const STAT_METRICS: StatMetric[] = [
  { key: 'spend', label: 'Spend', money: true },
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'conversions', label: 'Conversions', money: false },
  { key: 'roas', label: 'ROAS', money: false, suffix: 'x' },
  { key: 'clicks', label: 'Clicks', money: false },
  { key: 'impressions', label: 'Impressions', money: false },
]
export const statMetric = (k?: string): StatMetric => STAT_METRICS.find((m) => m.key === k) || STAT_METRICS[0]

// BREAKDOWN catalog. coming=false → query-EXPOSED today (in the metrics-query allowlist + matching stored rows) →
// a card built on it WORKS on real data. coming=true → CAPTURED but NOT query-exposed yet (surfacing dep #2 =
// the allowlist/(platform,breakdown_type) expansion, freeze-sensitive/post-Meta). The picker lists them but the
// card shows a "coming soon" state — NEVER fabricated data.
export interface BreakdownOption { key: string; label: string; platform: string; coming: boolean }
export const BREAKDOWN_CATALOG: BreakdownOption[] = [
  { key: 'age', label: 'Age (Meta)', platform: 'meta', coming: false },
  { key: 'gender', label: 'Gender (Meta)', platform: 'meta', coming: false },
  { key: 'geo_country', label: 'Country (store)', platform: 'shopify', coming: false },
  { key: 'geo_region', label: 'Region (store)', platform: 'shopify', coming: false },
  { key: 'search_term', label: 'Search terms (Google)', platform: 'google', coming: false },
  { key: 'keyword', label: 'Keywords (Google)', platform: 'google', coming: false },
  // CAPTURED, not yet query-exposed (dep #2):
  { key: 'placement', label: 'Placement (Meta)', platform: 'meta', coming: true },
  { key: 'device', label: 'Device', platform: '', coming: true },
  { key: 'action_type', label: 'Conversion action (Meta)', platform: 'meta', coming: true },
  { key: 'conversion_action', label: 'Conversion action (Google)', platform: 'google', coming: true },
  { key: 'impression_share', label: 'Impression share (Google)', platform: 'google', coming: true },
  { key: 'hour', label: 'Hour', platform: '', coming: true },
  { key: 'geo_city', label: 'Geo — all grains (Google)', platform: 'google', coming: true },
]
export const breakdownOption = (k?: string): BreakdownOption | undefined => BREAKDOWN_CATALOG.find((b) => b.key === k)

export const DATE_RANGES: { key: string; label: string }[] = [
  { key: 'LAST_7_DAYS', label: 'Last 7 days' },
  { key: 'LAST_14_DAYS', label: 'Last 14 days' },
  { key: 'LAST_30_DAYS', label: 'Last 30 days' },
  { key: 'LAST_90_DAYS', label: 'Last 90 days' },
]

let _n = 0
export const newCardId = (): string => `c${Date.now().toString(36)}${(_n++).toString(36)}`

// The built-in DEFAULT Overview view — REAL captured data, query-exposed families ONLY (no fake data). Used when a
// user has no saved view for this page yet. Proves the container→hook→query→viz→grid loop end-to-end.
export function defaultOverviewView(): SavedView {
  const cards: CardConfig[] = [
    { id: 'd-spend', kind: 'stat', viz: 'stat', metric: 'spend', dateRange: 'LAST_30_DAYS' },
    { id: 'd-rev', kind: 'stat', viz: 'stat', metric: 'revenue', dateRange: 'LAST_30_DAYS' },
    { id: 'd-conv', kind: 'stat', viz: 'stat', metric: 'conversions', dateRange: 'LAST_30_DAYS' },
    { id: 'd-roas', kind: 'stat', viz: 'stat', metric: 'roas', dateRange: 'LAST_30_DAYS' },
    { id: 'd-ts', kind: 'timeseries', viz: 'line', dateRange: 'LAST_30_DAYS', title: 'Combined performance' },
    { id: 'd-age', kind: 'breakdown', viz: 'bar', breakdownType: 'age', rankBy: 'spend', topN: 8, dateRange: 'LAST_30_DAYS', title: 'Age (Meta)' },
  ]
  const layout: GridItem[] = [
    { i: 'd-spend', x: 0, y: 0, w: 3, h: 2 },
    { i: 'd-rev', x: 3, y: 0, w: 3, h: 2 },
    { i: 'd-conv', x: 6, y: 0, w: 3, h: 2 },
    { i: 'd-roas', x: 9, y: 0, w: 3, h: 2 },
    { i: 'd-ts', x: 0, y: 2, w: 8, h: 5 },
    { i: 'd-age', x: 8, y: 2, w: 4, h: 5 },
  ]
  return { name: 'Default', cards, layout, pinned: [] }
}
