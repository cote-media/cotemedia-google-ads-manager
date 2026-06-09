// LORAMER_STRIPE_PHASE3_CHECKOUT_API_V1
// GET /api/billing — read the caller's current plan + the self-serve plan list. Powers the
// /billing UI and the post-Checkout success polling (which waits for the webhook to flip the tier).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { stripeLivemode } from '@/lib/stripe'
import { SELF_SERVE_TIERS, DISPLAY_PRICES, isManualTier } from '@/lib/billing/plans'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Current tier (default free if no profile row exists yet).
  const { data: prof } = await supabaseAdmin
    .from('user_profiles')
    .select('tier')
    .eq('user_email', email)
    .maybeSingle()
  const currentTier = prof?.tier ?? 'free'

  // Entitlements for display (current plan card + per-plan "what's included").
  const { data: ents } = await supabaseAdmin
    .from('plan_entitlements')
    .select('tier, display_name, workspace_cap, questions_per_month, history_window_days, feature_flags')
  const entByTier = Object.fromEntries((ents ?? []).map((e) => [e.tier, e]))

  // Does the caller already have a live (this-mode) active/trialing/past_due subscription?
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('user_email', email)
    .in('status', ['active', 'trialing', 'past_due'])
    .eq('livemode', stripeLivemode())
    .limit(1)
  const hasActiveSub = (subs?.length ?? 0) > 0

  const plans = SELF_SERVE_TIERS.map((t) => ({
    tier: t,
    display_name: entByTier[t]?.display_name ?? t,
    entitlements: entByTier[t] ?? null,
    monthly: DISPLAY_PRICES[t].monthly,
    annual: DISPLAY_PRICES[t].annual,
  }))

  return NextResponse.json({
    currentTier,
    currentPlan: entByTier[currentTier] ?? { tier: currentTier, display_name: currentTier },
    hasActiveSub,
    isManual: isManualTier(currentTier),
    plans,
  })
}
