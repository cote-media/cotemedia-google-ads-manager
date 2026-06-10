// LORAMER_STRIPE_PHASE4_PORTAL_V1
// POST /api/billing/portal — create a Stripe Customer Portal session for an active subscriber.
// The portal is where plan switch / downgrade / cancel live (Phase 3 was free->paid only). All
// switch/cancel effects flow back through the existing webhook (customer.subscription.updated/
// deleted) — this route only mints the hosted session. Server-side validated.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getStripe, stripeLivemode } from '@/lib/stripe'
import { isManualTier } from '@/lib/billing/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // The portal config is created out-of-band (scripts/stripe-create-portal-config.mjs) and pinned
  // by env. Fail loudly if it's missing rather than letting Stripe pick an unconfigured default.
  const configId = process.env.STRIPE_PORTAL_CONFIG_ID
  if (!configId) {
    console.error('[billing portal] STRIPE_PORTAL_CONFIG_ID not set')
    return NextResponse.json({ error: 'config_missing' }, { status: 500 })
  }

  // Manual-tier holders (enterprise/beta_unlimited) don't self-serve billing.
  const { data: prof } = await supabaseAdmin
    .from('user_profiles')
    .select('tier, stripe_customer_id')
    .eq('user_email', email)
    .maybeSingle()
  if (isManualTier(prof?.tier)) return NextResponse.json({ error: 'manual_tier' }, { status: 403 })

  // Require a live (this-mode) active/trialing/past_due subscription; also use it as the customer
  // backstop if the profile link is somehow missing.
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_email', email)
    .in('status', ['active', 'trialing', 'past_due'])
    .eq('livemode', stripeLivemode())
    .limit(1)
  if ((subs?.length ?? 0) === 0) {
    return NextResponse.json({ error: 'no_subscription' }, { status: 409 })
  }

  const customerId = prof?.stripe_customer_id ?? subs?.[0]?.stripe_customer_id ?? null
  if (!customerId) return NextResponse.json({ error: 'no_customer' }, { status: 409 })

  const base = process.env.NEXTAUTH_URL || 'https://app.loramer.com'
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      configuration: configId,
      return_url: `${base}/billing`,
    })
    if (!portal.url) return NextResponse.json({ error: 'no_url' }, { status: 502 })
    return NextResponse.json({ url: portal.url })
  } catch (e: any) {
    console.error('[billing portal] session create failed:', e?.message)
    return NextResponse.json({ error: 'stripe_error' }, { status: 502 })
  }
}
