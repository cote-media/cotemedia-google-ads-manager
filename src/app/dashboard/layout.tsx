// LORAMER_STRIPE_PHASE3_FIX_WELCOMEGATE_V1
// Welcome gate on /dashboard too — a sign-in that lands here (instead of /clients) must still pass
// through /welcome so the profile row + Stripe-customer hook run.
import { enforceWelcomeGate } from '@/lib/welcome-gate'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await enforceWelcomeGate()
  return <>{children}</>
}
