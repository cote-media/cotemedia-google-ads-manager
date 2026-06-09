// LORAMER_STRIPE_PHASE3_CHECKOUT_API_V1
// POST /api/billing/checkout — create a Stripe Checkout session for a free->paid upgrade.
// Phase 3 is initial subscribe ONLY; plan switches/cancel are Phase 4 (Customer Portal), so this
// route refuses when the caller already has an active subscription. All validation is server-side.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getStripe, stripeLivemode } from '@/lib/stripe'
import { ensureStripeCustomer } from '@/lib/billing/ensure-customer'
import { isSelfServeTier, isManualTier } from '@/lib/billing/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { tier?: unknown; interval?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const { tier, interval } = body
  if (!isSelfServeTier(tier)) return NextResponse.json({ error: 'invalid_tier' }, { status: 400 })
  if (interval !== 'monthly' && interval !== 'annual') {
    return NextResponse.json({ error: 'invalid_interval' }, { status: 400 })
  }

  // Manual-tier holders (enterprise/beta_unlimited) don't self-serve.
  const { data: prof } = await supabaseAdmin
    .from('user_profiles')
    .select('tier')
    .eq('user_email', email)
    .maybeSingle()
  if (isManualTier(prof?.tier)) return NextResponse.json({ error: 'manual_tier' }, { status: 403 })

  // Block a second Checkout when a live subscription already exists (switches -> Phase 4 Portal).
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('user_email', email)
    .in('status', ['active', 'trialing', 'past_due'])
    .eq('livemode', stripeLivemode())
    .limit(1)
  if ((subs?.length ?? 0) > 0) {
    return NextResponse.json({ error: 'already_subscribed' }, { status: 409 })
  }

  // Resolve the Stripe price id for the requested tier+interval.
  const { data: ent } = await supabaseAdmin
    .from('plan_entitlements')
    .select('stripe_price_monthly, stripe_price_annual')
    .eq('tier', tier)
    .maybeSingle()
  const priceId = interval === 'monthly' ? ent?.stripe_price_monthly : ent?.stripe_price_annual
  if (!priceId) return NextResponse.json({ error: 'price_unavailable' }, { status: 503 })

  // Ensure the Stripe customer (backstop in case /api/welcome never ran).
  const customerId = await ensureStripeCustomer(email)
  if (!customerId) return NextResponse.json({ error: 'customer_unavailable' }, { status: 503 })

  const base = process.env.NEXTAUTH_URL || 'https://app.loramer.com'
  try {
    const checkout = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: email, // webhook resolves the user from this
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { user_email: email } },
      success_url: `${base}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?status=cancel`,
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
    })
    if (!checkout.url) return NextResponse.json({ error: 'no_url' }, { status: 502 })
    return NextResponse.json({ url: checkout.url })
  } catch (e: any) {
    console.error('[billing checkout] session create failed:', e?.message)
    return NextResponse.json({ error: 'stripe_error' }, { status: 502 })
  }
}
