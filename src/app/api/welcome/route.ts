import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { ensureStripeCustomer } from '@/lib/billing/ensure-customer' // LORAMER_STRIPE_PHASE2_CUSTOMER_V1

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  if (!email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  // LORAMER_ORG_TYPE_PERSIST_V1 — the two-door choice (user-facing 'agency' | 'business') is recorded
  // ATOMICALLY with welcome_seen_at in the SAME upsert, so welcome can never clear without the choice.
  let accountType: unknown
  try {
    accountType = (await request.json())?.account_type
  } catch {
    accountType = undefined
  }
  if (accountType !== 'agency' && accountType !== 'business') {
    return NextResponse.json({ error: 'account_type must be "agency" or "business"' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        user_email: email,
        account_type: accountType,
        welcome_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email' }
    )

  if (error) {
    console.error('[welcome] failed to set welcome_seen_at + account_type:', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  // LORAMER_STRIPE_PHASE2_CUSTOMER_V1: ensure the Stripe customer at this once-per-user
  // onboarding event. ensureStripeCustomer never throws — welcome succeeds even if Stripe is down.
  await ensureStripeCustomer(email)

  return NextResponse.json({ ok: true })
}
