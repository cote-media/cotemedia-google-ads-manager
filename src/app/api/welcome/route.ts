import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { ensureStripeCustomer } from '@/lib/billing/ensure-customer' // LORAMER_STRIPE_PHASE2_CUSTOMER_V1

export async function POST() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  if (!email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        user_email: email,
        welcome_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email' }
    )

  if (error) {
    console.error('[welcome] failed to set welcome_seen_at:', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  // LORAMER_STRIPE_PHASE2_CUSTOMER_V1: ensure the Stripe customer at this once-per-user
  // onboarding event. ensureStripeCustomer never throws — welcome succeeds even if Stripe is down.
  await ensureStripeCustomer(email)

  return NextResponse.json({ ok: true })
}
