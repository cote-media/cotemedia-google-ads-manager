// LORAMER_STRIPE_PHASE2_LIB_V1
// Lazy Stripe client singleton. Construction is deferred (not at import) so that routes
// importing this — notably /api/welcome via ensureStripeCustomer — never crash at module
// load if STRIPE_SECRET_KEY is missing in some environment. Callers in the signup path wrap
// getStripe() in try/catch and degrade gracefully; the webhook treats a missing key as a 500.
import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  if (!_stripe) _stripe = new Stripe(key)
  return _stripe
}

// Mode is inferred from the secret key prefix. Used to gate webhook events by livemode so
// TEST and LIVE never cross-write the shared Supabase DB.
export function stripeLivemode(): boolean {
  return (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_')
}
