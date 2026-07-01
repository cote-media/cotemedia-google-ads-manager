// LORAMER_ECOM_MONEY_SURFACE_DISPLAY_V1 — pure logic for the -next money-surface display.
// -NEXT-ONLY: imported by /api/next/money (aggregation) + MoneyWaterfall (chain + formatting) + the Gate-A
// harness. The FROZEN reviewer path (src/app/dashboard, reviewer-login) never imports this. Reads the persisted
// metrics_daily.extra.money shape (LORAMER_ECOM_MONEY_SURFACE_V1, T1.5/T1.6). No side effects, no I/O.

export type MoneyKey =
  | 'grossSales' | 'discounts' | 'discountTax' | 'taxes' | 'cartTax'
  | 'shipping' | 'shippingTax' | 'fees' | 'totalSales' | 'refunds' | 'netSales' | 'residual'

export const MONEY_KEYS: MoneyKey[] = [
  'grossSales', 'discounts', 'discountTax', 'taxes', 'cartTax',
  'shipping', 'shippingTax', 'fees', 'totalSales', 'refunds', 'netSales', 'residual',
]

// One aggregated component. value=null means "absent on >=1 day in the window -> not honestly summable"
// (NEVER a false 0). present=true with value 0 = a genuine zero (e.g. no tax nexus). absentDays = # of days
// the component was missing/null (surfaced so the UI can explain the gap instead of implying $0).
export interface AggComponent { value: number | null; present: boolean; absentDays: number }

const round2 = (n: number) => Math.round(n * 100) / 100

// Sum every component across the window's money objects with PER-FIELD null-vs-zero honesty. A present number
// (incl 0) accumulates; a null/absent/non-number on ANY day makes the whole component null (+absentDays).
export function aggregateMoney(moneyObjs: Array<Record<string, any>>): Record<MoneyKey, AggComponent> {
  const out = {} as Record<MoneyKey, AggComponent>
  for (const k of MONEY_KEYS) {
    let sum = 0
    let absent = 0
    for (const m of moneyObjs) {
      const v = m && k in m ? m[k] : null
      if (v === null || v === undefined || typeof v !== 'number' || Number.isNaN(v)) { absent++; continue }
      sum += v
    }
    out[k] = absent > 0 ? { value: null, present: false, absentDays: absent } : { value: round2(sum), present: true, absentDays: 0 }
  }
  return out
}

// A step in the waterfall. op = arithmetic direction for reading (the VALUE carries its own sign; fees/refunds
// can be negative). '=' rows are stored totals (totalSales/netSales) — self-consistent checkpoints, not deltas.
export interface ChainStep { key: MoneyKey; label: string; op: '+' | '-' | '=' | 'start'; total?: boolean; tooltip?: string }

// Per-BASIS chain (read moneyBasis from the row — NEVER hardcode; Woo net includes shipping/tax, Shopify excludes).
export const MONEY_CHAINS: Record<string, ChainStep[]> = {
  // Woo (T1.6): net = grand total incl shipping+tax, after refunds.
  woo_total_incl_shipping_tax_refundNetted: [
    { key: 'grossSales', label: 'Gross sales', op: 'start', tooltip: 'Product subtotal before discounts, excluding tax.' },
    { key: 'discounts', label: 'Discounts', op: '-', tooltip: 'Coupon / cart discounts (WooCommerce discount_total).' },
    { key: 'shipping', label: 'Shipping', op: '+', tooltip: 'Shipping charged, excluding shipping tax.' },
    { key: 'taxes', label: 'Taxes', op: '+', tooltip: 'All taxes collected — already includes shipping tax.' },
    { key: 'fees', label: 'Fees / tips', op: '+', tooltip: 'WooCommerce fee lines. Woo has NO native tip field — tips, when collected, appear here. Can be negative (store credits / adjustments).' },
    { key: 'totalSales', label: 'Total sales', op: '=', total: true, tooltip: 'Grand total charged, including tax and shipping.' },
    { key: 'refunds', label: 'Refunds', op: '+', tooltip: 'Refund totals (negative), including tax.' },
    { key: 'netSales', label: 'Net sales', op: '=', total: true, tooltip: 'Booked revenue = total after refunds. WooCommerce basis: INCLUDES shipping and tax.' },
  ],
  // Shopify (T1.5, when built): net = subtotal, EXCLUDES shipping/tax, after refunds. (Untested until T1.5 data lands.)
  shopify_current_refundAdjusted: [
    { key: 'grossSales', label: 'Gross sales', op: 'start', tooltip: 'Line-item total before discounts, excluding tax.' },
    { key: 'discounts', label: 'Discounts', op: '-', tooltip: 'Order/line discounts.' },
    { key: 'netSales', label: 'Net sales', op: '=', total: true, tooltip: 'Booked revenue = subtotal after discounts and refunds. Shopify basis: EXCLUDES shipping and tax.' },
    { key: 'taxes', label: 'Taxes', op: '+', tooltip: 'Total tax collected.' },
    { key: 'shipping', label: 'Shipping', op: '+', tooltip: 'Shipping charged (refund-adjusted).' },
    { key: 'tips', label: 'Tips', op: '+', tooltip: 'Tips collected (Shopify native tip field).' } as any, // 'tips' key exists on Shopify money objs (T1.5)
    { key: 'totalSales', label: 'Total sales', op: '=', total: true, tooltip: 'Grand total charged, including tax and shipping.' },
  ],
}

// Residual is a SEPARATE reconciliation note (never a chain step). Shown only when present && != 0.
export const RESIDUAL_STEP = {
  key: 'residual' as MoneyKey,
  label: 'On-sale markdowns (not counted as coupon discounts)',
  tooltip: "Gross minus coupons doesn't fully match the order total — typically product sale-price markdowns WooCommerce doesn't record as a discount, and/or order edits. Shown for transparency; it does NOT affect net sales.",
}

export function chainForBasis(basis: string | null | undefined): ChainStep[] {
  return (basis && MONEY_CHAINS[basis]) || genericChain()
}

// Fallback when the basis is unknown: list the always-present anchors so nothing is silently dropped.
function genericChain(): ChainStep[] {
  return [
    { key: 'grossSales', label: 'Gross sales', op: 'start' },
    { key: 'discounts', label: 'Discounts', op: '-' },
    { key: 'totalSales', label: 'Total sales', op: '=', total: true },
    { key: 'netSales', label: 'Net sales', op: '=', total: true },
  ]
}

// Format a component value for display. null -> the honest "not captured"; a true 0 -> "$0.00".
export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '— not captured'
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// The signed value to DISPLAY for a step: '-' shows -(|value|) (a discount reads as a subtraction); every other
// op shows the value with its own sign (fees/refunds may already be negative). null passes through as null.
export function stepDisplayValue(step: ChainStep, value: number | null): number | null {
  if (value === null || value === undefined) return null
  return step.op === '-' ? -Math.abs(value) : value
}
