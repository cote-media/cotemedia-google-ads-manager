// LORAMER_STRIPE_PHASE3_FIX_WELCOMEGATE_V1
// Welcome gate on /billing too — a brand-new user can't land on the upgrade page before the
// profile row exists.
import { enforceWelcomeGate } from '@/lib/welcome-gate'

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  await enforceWelcomeGate()
  return <>{children}</>
}
