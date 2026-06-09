// LORAMER_STRIPE_PHASE2_WEBHOOK_V1
// Stripe -> Supabase sync. Stripe is the source of truth; subscriptions + user_profiles.tier
// are a fast-read mirror updated here.
//
//  - Signature-authed (stripe-signature + STRIPE_WEBHOOK_SECRET); bad signature => 400.
//  - Idempotent: every event id is recorded in stripe_events; a re-delivery is a no-op (200).
//    On a handler failure the event row is removed and we return 500 so Stripe retries.
//  - Mode-gated: events whose livemode != this deployment's key mode are ignored (keeps TEST and
//    LIVE from cross-writing the shared DB).
//  - Manual tiers (beta_unlimited / enterprise) are sticky — self-serve events never override them.
import { NextResponse } from 'next/server'
import { getStripe, stripeLivemode } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'
import { tierFromPriceId } from '@/lib/billing/tier-from-price'
import type Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Hand-set tiers that self-serve billing must never clobber.
const MANUAL_TIERS = new Set(['beta_unlimited', 'enterprise'])
// Statuses that still grant entitlement (past_due = grace window).
const ENTITLED = new Set(['active', 'trialing', 'past_due'])

export async function POST(request: Request) {
  const sig = request.headers.get('stripe-signature') || ''
  const rawBody = await request.text()

  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET not set')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret)
  } catch (e: any) {
    console.warn('[stripe webhook] signature verification failed:', e?.message)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  // Ignore the other Stripe mode entirely.
  if (event.livemode !== stripeLivemode()) {
    return new NextResponse('Ignored (mode mismatch)', { status: 200 })
  }

  // Idempotency: claim the event id. A duplicate delivery hits the PK and is a no-op.
  const { error: dedupeErr } = await supabaseAdmin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type })
  if (dedupeErr) {
    if (dedupeErr.code === '23505') {
      return new NextResponse('Already processed', { status: 200 })
    }
    // Couldn't even record the event — log and continue; better to process than drop.
    console.error('[stripe webhook] dedupe insert failed:', dedupeErr)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id
        if (subId) {
          const sub = await getStripe().subscriptions.retrieve(subId)
          const email = sessionEmail(session) || (await emailForCustomer(sub.customer))
          await syncSubscription(sub, event.created, email)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const email = await emailForCustomer(sub.customer)
        await syncSubscription(sub, event.created, email)
        break
      }
      default:
        // Acknowledge unhandled event types.
        break
    }
    return new NextResponse('OK', { status: 200 })
  } catch (e: any) {
    console.error('[stripe webhook] handler error:', e?.message)
    // Release the dedupe claim so Stripe's retry can reprocess this event.
    await supabaseAdmin.from('stripe_events').delete().eq('id', event.id)
    return new NextResponse('Handler error', { status: 500 })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sessionEmail(session: Stripe.Checkout.Session): string | null {
  return (
    session.client_reference_id ||
    session.customer_email ||
    session.customer_details?.email ||
    null
  )
}

async function emailForCustomer(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): Promise<string | null> {
  const id = typeof customer === 'string' ? customer : customer?.id
  if (!id) return null

  // Our DB link first (cheap, authoritative for known users).
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('user_email')
    .eq('stripe_customer_id', id)
    .maybeSingle()
  if (data?.user_email) return data.user_email

  // Fall back to the Stripe customer's metadata/email.
  try {
    const c = await getStripe().customers.retrieve(id)
    if (!('deleted' in c) || !c.deleted) {
      const cust = c as Stripe.Customer
      return cust.metadata?.user_email || cust.email || null
    }
  } catch (e: any) {
    console.error('[stripe webhook] customer retrieve failed:', e?.message)
  }
  return null
}

async function syncSubscription(
  sub: Stripe.Subscription,
  eventCreated: number,
  email: string | null
): Promise<void> {
  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id ?? null
  const interval = item?.price?.recurring?.interval ?? null
  // Stripe API (SDK v22) moved the billing period off the Subscription onto each item.
  const periodEnd = item?.current_period_end ?? null
  const tier = await tierFromPriceId(priceId)
  const eventMs = eventCreated * 1000

  // Out-of-order guard: don't let a stale event overwrite a newer state.
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('last_stripe_event_at')
    .eq('id', sub.id)
    .maybeSingle()
  if (existing?.last_stripe_event_at && new Date(existing.last_stripe_event_at).getTime() > eventMs) {
    return
  }

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

  await supabaseAdmin.from('subscriptions').upsert(
    {
      id: sub.id,
      user_email: email ?? 'unknown',
      stripe_customer_id: customerId,
      status: sub.status,
      tier: tier ?? 'unknown',
      price_id: priceId,
      interval,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
      livemode: sub.livemode,
      last_stripe_event_at: new Date(eventMs).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  )

  // Backfill the user->customer link if we resolved the email another way.
  if (email && customerId) {
    await supabaseAdmin
      .from('user_profiles')
      .update({ stripe_customer_id: customerId })
      .eq('user_email', email)
      .is('stripe_customer_id', null)
  }

  // Entitled statuses grant the sub's tier; otherwise drop to free.
  const grantedTier = ENTITLED.has(sub.status) ? tier : 'free'
  await applyTierToProfile(email, grantedTier)
}

async function applyTierToProfile(email: string | null, newTier: string | null): Promise<void> {
  if (!email || !newTier) return
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('tier')
    .eq('user_email', email)
    .maybeSingle()
  if (data && MANUAL_TIERS.has(data.tier)) return // sticky manual tier
  await supabaseAdmin
    .from('user_profiles')
    .update({ tier: newTier, updated_at: new Date().toISOString() })
    .eq('user_email', email)
}
