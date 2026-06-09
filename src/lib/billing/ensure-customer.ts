// LORAMER_STRIPE_PHASE2_CUSTOMER_V1
// Idempotently ensure a LoraMer user (user_email) has exactly one Stripe customer, and that
// user_profiles.stripe_customer_id points at it. Called best-effort from the once-per-user
// onboarding event (/api/welcome) and again at checkout (Phase 3) as a backstop.
//
// Hard guarantees:
//  - NEVER throws — any failure logs and returns null so signup/onboarding never breaks.
//  - NEVER creates a duplicate — checks our DB, then Stripe (by metadata, then email) before create.
//  - Skips synthetic non-paying accounts (reviewer / shopify-install).
import { getStripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'

function isSyntheticAccount(email: string): boolean {
  // Reviewer bypass + shopify-install synthetic identities never transact.
  return email.endsWith('@loramer.app')
}

export async function ensureStripeCustomer(email: string | null | undefined): Promise<string | null> {
  if (!email || isSyntheticAccount(email)) return null

  try {
    // 1. Already linked in our DB? Done.
    const { data: prof } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('user_email', email)
      .maybeSingle()
    if (prof?.stripe_customer_id) return prof.stripe_customer_id

    const stripe = getStripe()

    // 2. Customer already exists in Stripe (e.g. DB link lost)? Reuse — never duplicate.
    //    Prefer our own metadata tag, fall back to an exact email match.
    let customerId: string | null = null
    try {
      const byMeta = await stripe.customers.search({
        query: `metadata['user_email']:'${email}'`,
        limit: 1,
      })
      if (byMeta.data[0]) customerId = byMeta.data[0].id
    } catch (e) {
      // search can lag indexing on brand-new customers; fall through to list/create.
      console.error('[billing] customer search failed, falling back:', e)
    }
    if (!customerId) {
      const byEmail = await stripe.customers.list({ email, limit: 1 })
      if (byEmail.data[0]) customerId = byEmail.data[0].id
    }

    // 3. Otherwise create one keyed to user_email.
    if (!customerId) {
      const created = await stripe.customers.create({ email, metadata: { user_email: email } })
      customerId = created.id
    }

    // 4. Write the link back into user_profiles (idempotent).
    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq('user_email', email)
    if (error) console.error('[billing] ensureStripeCustomer write-back failed:', error)

    return customerId
  } catch (e) {
    console.error('[billing] ensureStripeCustomer failed (non-fatal):', e)
    return null
  }
}
