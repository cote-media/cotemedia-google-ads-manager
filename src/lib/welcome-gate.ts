// LORAMER_STRIPE_PHASE3_FIX_WELCOMEGATE_V1
// Single welcome/profile-creation gate, shared by ALL authed app surfaces (/dashboard, /clients,
// /billing). A first-time user (no user_profiles row, or welcome_seen_at NULL) is sent to /welcome,
// which is the ONLY thing that creates the profile row and runs the Stripe-customer hook. Before
// this fix the gate lived only in /clients, so a sign-in that landed on /dashboard bypassed it
// entirely (the bug behind the missing profile row).
//
// Edge cases handled:
//  - No loop: /welcome is not under any of the gated surfaces, so it never re-triggers the gate.
//  - API routes: gates live in server layouts; app/api has no layout, so APIs are untouched.
//  - Unauthenticated: with no session email we do nothing (the page's own auth sends them to
//    sign-in) — we never bounce a signed-out visitor to /welcome.
//  - A DB error fails OPEN (logs + lets the page render) so a transient Supabase blip can't lock
//    users out; only a definitive "no row / not seen" redirects.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export async function enforceWelcomeGate(): Promise<void> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return

  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('welcome_seen_at')
      .eq('user_email', email)
      .maybeSingle()
    if (!error && (!data || data.welcome_seen_at === null)) redirect('/welcome')
  } catch (e: any) {
    if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e
    console.error('[welcome gate] check failed, continuing:', e)
  }
}
