// LORAMER_NEXT_CARD_ENGINE_V1 — shared types + catalogs for the PAGE-AGNOSTIC card engine (-next only, dark).
// The engine never hardcodes Overview: it takes a pageKey + a SavedView (cards + grid layout). Portfolio + client
// pages reuse it later by passing a different pageKey + default view — no rebuild (no-do-it-twice).

import type { ComparePreset, Win } from '@/lib/next/card-windows'

// LORAMER_NEXT_MONEY_CARD_V1 — 'money' is an ADDITIVE kind (a full-order money waterfall on captured extra.money).
// Existing kinds/vizes are unchanged; a money card flows through Card.tsx (shared window) + CardViz (a new branch).
// LORAMER_NEXT_ROAS_CARD_V1 — 'roas' is a second ADDITIVE kind (multi-source ROAS: 3 basis-labeled sources, user
// picks which via roasBases). Flows through Card.tsx (shared window) + CardViz (a new branch, its own isolated read).
export type CardKind = 'stat' | 'breakdown' | 'timeseries' | 'money' | 'roas'
export type VizType = 'stat' | 'bar' | 'table' | 'line' | 'money' | 'roas'
export type PageKey = 'overview' | 'portfolio' | 'client'

export interface CardConfig {
  id: string
  title?: string
  subtitle?: string            // LORAMER_NEXT_MER_SUBTITLE_V1 — optional basis/definition line under a stat value (replaces the plain window label; delta still wins)
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
  // roas: LORAMER_NEXT_ROAS_CARD_V1 — which basis-labeled ROAS sources the user has checked ON. Undefined/empty →
  // the card shows every AVAILABLE basis (default = all). Persisted inside the `view` JSONB; no schema change.
  roasBases?: string[]
  // LORAMER_NEXT_STORE_PAGE_V1 — store cards read the STORE-scoped reads instead of the portfolio-combined ones.
  // source==='store' switches useCardData/CardViz to /api/next/store-stats · /store-timeseries · /entities(product).
  // storePlatform = the resolved store platform (shopify|woocommerce), baked into the products/timeseries reads
  // (entities needs an explicit platform). ABSENT on every Overview card → those take the exact existing portfolio
  // path, byte-identical. metric on a store stat card = revenue | orders | aov (mapped to store-stats fields).
  source?: 'store'
  storePlatform?: string
}

// react-grid-layout item (subset we persist).
export interface GridItem { i: string; x: number; y: number; w: number; h: number }

// RESHAPE FIX 2 — the page-level GLOBAL date range + COMPARE selection persist in the view (dashboard_layouts jsonb)
// so they survive a refresh (saved on change, hydrated on load).
// LORAMER_NEXT_MOBILE_LAYOUT_V1 — `layout` is the DESKTOP (lg/md) arrangement, unchanged. `layoutSm` is an ADDITIVE,
// OPTIONAL per-breakpoint MOBILE (sm) arrangement — independent of desktop by design. Absent/empty layoutSm → the
// mobile grid falls back to cards[]-order stacking (a pre-existing row renders identically until reordered on mobile).
export interface SavedView {
  name: string
  cards: CardConfig[]
  layout: GridItem[]
  layoutSm?: GridItem[]
  pinned?: string[]
  globalPeriod?: string
  globalCustom?: Win | null
  compareMode?: ComparePreset
  customCompare?: Win | null
}

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

// LORAMER_NEXT_STORE_CATALOG_V1 — the STORE stat catalog (what the store page renders): net revenue · orders · AOV.
// SEPARATE from the ad STAT_METRICS (spend/roas/clicks are meaningless on a store). The source-aware config panel +
// cardTitle use this for source==='store' stat cards. revenue/aov are money, orders is a count (StatBody formats on it).
export const STORE_STAT_METRICS: StatMetric[] = [
  { key: 'revenue', label: 'Net revenue', money: true },
  { key: 'orders', label: 'Orders', money: false },
  { key: 'aov', label: 'AOV', money: true },
]
export const storeStatMetric = (k?: string): StatMetric => STORE_STAT_METRICS.find((m) => m.key === k) || STORE_STAT_METRICS[0]

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
  { key: 'action_type', label: 'Conversion action (Meta)', platform: 'meta', coming: false }, // LORAMER_META_CONV_ACTION_CARD_ENABLE_V1 — query-exposed (allowlist since 07-02) + canonicalized (RESOLVER_V1); freeze retired
  { key: 'conversion_action', label: 'Conversion action (Google)', platform: 'google', coming: true },
  { key: 'impression_share', label: 'Impression share (Google)', platform: 'google', coming: true },
  { key: 'hour', label: 'Hour', platform: '', coming: true },
  { key: 'geo_city', label: 'Geo — all grains (Google)', platform: 'google', coming: true },
  // LORAMER_NEXT_STORE_CATALOG_V1 — STORE families, keyed platform+breakdown_type (shopify|woocommerce). product +
  // variant are query-exposed via /api/next/entities (coming:false, read-probed on real Foam OH rows); customer_mix is
  // the 0-PII customer engine, UNBUILT → coming:true (picker shows it disabled; the card body renders its coming-soon note).
  { key: 'product', label: 'Top products (store)', platform: 'shopify', coming: false },
  { key: 'product', label: 'Top products (store)', platform: 'woocommerce', coming: false },
  { key: 'variant', label: 'Top variants (store)', platform: 'shopify', coming: false },
  { key: 'variant', label: 'Top variants (store)', platform: 'woocommerce', coming: false },
  { key: 'customer_mix', label: 'Customer mix (store)', platform: 'shopify', coming: true },
  { key: 'customer_mix', label: 'Customer mix (store)', platform: 'woocommerce', coming: true },
]
export const breakdownOption = (k?: string): BreakdownOption | undefined => BREAKDOWN_CATALOG.find((b) => b.key === k)
// LORAMER_NEXT_STORE_CATALOG_V1 — the store-scoped breakdown families. The config panel PARTITIONS on this: source==='store'
// shows ONLY these (filtered to the active storePlatform); the ad panel shows ONLY the non-store families. Keeps 'product'
// off the Overview add-card list and the ad families off the store add-card list.
export const STORE_FAMILIES = new Set(['product', 'variant', 'customer_mix'])

// LORAMER_NEXT_ROAS_CARD_V1 — the multi-source ROAS basis catalog (the checkbox set in the config panel). Keys +
// order match the route's bases (src/lib/next/roas-bases.ts). Each basis is basis-LABELED in the card so a value
// can never read as store-verified revenue (the value-column landmine). ALL_ROAS_BASES = the default (all checked).
export interface RoasBaseOption { key: string; label: string }
export const ROAS_BASES: RoasBaseOption[] = [
  { key: 'meta_purchase_roas', label: 'Meta purchase ROAS (window)' },
  { key: 'value_per_meta_spend', label: 'Value ÷ total Meta spend' },
  { key: 'blended_store', label: 'Blended store ÷ Meta spend' },
]
export const ALL_ROAS_BASES: string[] = ROAS_BASES.map((b) => b.key)

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
    { id: 'd-roas', kind: 'stat', viz: 'stat', metric: 'roas', title: 'MER', subtitle: 'Marketing Efficiency Ratio · blended revenue ÷ all ad spend', dateRange: 'LAST_30_DAYS' },
    { id: 'd-ts', kind: 'timeseries', viz: 'line', dateRange: 'LAST_30_DAYS', title: 'Combined performance' },
    { id: 'd-age', kind: 'breakdown', viz: 'bar', breakdownType: 'age', rankBy: 'spend', topN: 8, dateRange: 'LAST_30_DAYS', title: 'Age (Meta)' },
    // LORAMER_NEXT_MONEY_CARD_V1 — the money breakdown = the drill-down behind Revenue (Net sales == the Revenue
    // headline). Placed in a NEW bottom row, left edge under the Revenue stat (x=3); no existing card is moved.
    { id: 'd-money', kind: 'money', viz: 'money', dateRange: 'LAST_30_DAYS', title: 'Revenue — money breakdown' },
    // LORAMER_NEXT_KW_ST_CARD_V1 — P2-B: prebuilt Google keyword + search_term breakdown cards (single-level,
    // already query-exposed). They ALWAYS carry the truncation "subset" note → BreakdownBody now renders it as an
    // advisory caption beneath the top-N rows (not in place of them).
    { id: 'd-kw', kind: 'breakdown', viz: 'table', breakdownType: 'keyword', rankBy: 'spend', topN: 8, dateRange: 'LAST_30_DAYS', title: 'Keywords (Google)' },
    { id: 'd-st', kind: 'breakdown', viz: 'table', breakdownType: 'search_term', rankBy: 'spend', topN: 8, dateRange: 'LAST_30_DAYS', title: 'Search terms (Google)' },
  ]
  const layout: GridItem[] = [
    { i: 'd-spend', x: 0, y: 0, w: 3, h: 2 },
    { i: 'd-rev', x: 3, y: 0, w: 3, h: 2 },
    { i: 'd-conv', x: 6, y: 0, w: 3, h: 2 },
    { i: 'd-roas', x: 9, y: 0, w: 3, h: 2 },
    { i: 'd-ts', x: 0, y: 2, w: 8, h: 5 },
    { i: 'd-age', x: 8, y: 2, w: 4, h: 5 },
    { i: 'd-money', x: 3, y: 7, w: 6, h: 6 }, // new bottom row → existing card positions unchanged
    { i: 'd-kw', x: 0, y: 13, w: 6, h: 6 }, // LORAMER_NEXT_KW_ST_CARD_V1 — new bottom row (nothing above moves)
    { i: 'd-st', x: 6, y: 13, w: 6, h: 6 },
  ]
  return { name: 'Default', cards, layout, pinned: [], globalPeriod: 'LAST_30_DAYS', globalCustom: null, compareMode: 'none', customCompare: null }
}

// LORAMER_NEXT_STORE_PAGE_V1 — the built-in STORE view (FLIGHT 2 of the Shopify/Woo store platform page). Cards read
// the store-scoped reads shipped in FLIGHT 1: net revenue · orders · AOV (store-stats) + a revenue/orders timeseries
// (store-timeseries) + top products (entities, product grain) + the money-breakdown waterfall (the existing 'money'
// kind, /api/next/money — folded in from the old standalone store page) + an honest customer-mix "coming soon" (the
// 0-PII customer engine is unbuilt — NEVER fabricated). `platform` = the resolved store platform (shopify|
// woocommerce), baked into the product + timeseries reads. All cards add/remove/rearrangeable (grid-native law).
export function storeDefaultView(platform: string): SavedView {
  const cards: CardConfig[] = [
    { id: 's-rev', kind: 'stat', viz: 'stat', source: 'store', storePlatform: platform, metric: 'revenue', dateRange: 'LAST_30_DAYS', title: 'Net revenue' },
    { id: 's-orders', kind: 'stat', viz: 'stat', source: 'store', storePlatform: platform, metric: 'orders', dateRange: 'LAST_30_DAYS', title: 'Orders' },
    { id: 's-aov', kind: 'stat', viz: 'stat', source: 'store', storePlatform: platform, metric: 'aov', dateRange: 'LAST_30_DAYS', title: 'AOV' },
    { id: 's-ts', kind: 'timeseries', viz: 'line', source: 'store', storePlatform: platform, dateRange: 'LAST_30_DAYS', title: 'Revenue & orders' },
    { id: 's-products', kind: 'breakdown', viz: 'table', source: 'store', storePlatform: platform, breakdownType: 'product', rankBy: 'revenue', topN: 8, dateRange: 'LAST_30_DAYS', title: 'Top products' },
    { id: 's-money', kind: 'money', viz: 'money', dateRange: 'LAST_30_DAYS', title: 'Money breakdown' }, // reuses /api/next/money (auto-detects the store platform)
    { id: 's-customers', kind: 'breakdown', viz: 'table', source: 'store', breakdownType: 'customer_mix', dateRange: 'LAST_30_DAYS', title: 'Customer mix' }, // coming-soon (0-PII engine unbuilt)
  ]
  const layout: GridItem[] = [
    { i: 's-rev', x: 0, y: 0, w: 3, h: 2 },
    { i: 's-orders', x: 3, y: 0, w: 3, h: 2 },
    { i: 's-aov', x: 6, y: 0, w: 3, h: 2 },
    { i: 's-ts', x: 0, y: 2, w: 8, h: 5 },
    { i: 's-products', x: 8, y: 2, w: 4, h: 5 },
    { i: 's-money', x: 0, y: 7, w: 6, h: 6 },
    { i: 's-customers', x: 6, y: 7, w: 6, h: 6 },
  ]
  return { name: 'Default', cards, layout, pinned: [], globalPeriod: 'LAST_30_DAYS', globalCustom: null, compareMode: 'none', customCompare: null }
}
