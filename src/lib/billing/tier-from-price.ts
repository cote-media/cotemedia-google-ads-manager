// LORAMER_STRIPE_PHASE2_LIB_V1
// Resolve a Stripe price id to the LoraMer tier it grants, via plan_entitlements
// (the single source of truth for the price->tier mapping, written by stripe-sync-products.mjs).
// Returns null if the price matches no tier (legacy/unknown price) so callers can decline to act
// rather than write a bogus tier.
import { supabaseAdmin } from '@/lib/supabase'

export async function tierFromPriceId(priceId: string | null | undefined): Promise<string | null> {
  if (!priceId) return null
  const { data, error } = await supabaseAdmin
    .from('plan_entitlements')
    .select('tier, stripe_price_monthly, stripe_price_annual')
    .or(`stripe_price_monthly.eq.${priceId},stripe_price_annual.eq.${priceId}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[billing] tierFromPriceId lookup failed:', error)
    return null
  }
  return data?.tier ?? null
}
