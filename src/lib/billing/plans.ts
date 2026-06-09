// LORAMER_STRIPE_PHASE3_CHECKOUT_API_V1
// Self-serve plan metadata shared by the billing API + UI. The REAL charge is always the Stripe
// price id stored in plan_entitlements; the dollar amounts here are DISPLAY-ONLY (they mirror the
// Stripe TEST/LIVE prices created by scripts/stripe-sync-products.mjs).
export const SELF_SERVE_TIERS = ['business', 'agency', 'scale'] as const
export type SelfServeTier = (typeof SELF_SERVE_TIERS)[number]

// Upgrade ordering (free < business < agency < scale); manual tiers sit outside self-serve.
export const TIER_ORDER = ['free', 'business', 'agency', 'scale', 'enterprise', 'beta_unlimited']

// Display-only dollar amounts. Annual = 20% off monthly, marketing-rounded (matches Stripe prices).
export const DISPLAY_PRICES: Record<SelfServeTier, { monthly: number; annual: number }> = {
  business: { monthly: 79, annual: 750 },
  agency: { monthly: 199, annual: 1900 },
  scale: { monthly: 999, annual: 9500 },
}

// LORAMER_STRIPE_PHASE3_FLAGLABELS_V1
// Human-readable labels for plan_entitlements.feature_flags (never show raw keys to users).
export const FLAG_LABELS: Record<string, string> = {
  wyws: 'While You Were Sleeping digest',
  priority_support: 'Priority support',
  automations: 'Automations',
  white_label: 'White-label',
  bulk_export: 'Bulk export',
  sla: 'SLA',
}
export function flagLabel(f: string): string {
  return FLAG_LABELS[f] ?? f
}

export function isSelfServeTier(t: unknown): t is SelfServeTier {
  return typeof t === 'string' && (SELF_SERVE_TIERS as readonly string[]).includes(t)
}

export function isManualTier(t: string | null | undefined): boolean {
  return t === 'enterprise' || t === 'beta_unlimited'
}
