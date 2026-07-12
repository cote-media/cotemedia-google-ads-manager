// LORAMER_STRIPE_PHASE3_FIX_WELCOMEGATE_V1 — welcome gate on /dashboard (profile row + Stripe hook for new users).
// LORAMER_NEXT_CUTOVER_V1 — /dashboard is RETIRED as a destination: after the (membership-aware) welcome gate, a real
// authenticated user is redirected to the -next surface (membership-aware, so a MEMBER lands in their org — the real
// fix for RBAC bug B). The LEGACY COHORT (Shopify/Meta review + demo fixtures — isLegacyCohort) is HELD on the current
// screencast UI while the Shopify App Store review is still open. No-session falls through to the page's own auth.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { enforceWelcomeGate } from '@/lib/welcome-gate'
import { isLegacyCohort } from '@/lib/preview-gate'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await enforceWelcomeGate() // new users → /welcome (throws NEXT_REDIRECT before we reach the flip below)
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (email && !isLegacyCohort(email)) redirect('/dashboard-next')
  return <>{children}</>
}
