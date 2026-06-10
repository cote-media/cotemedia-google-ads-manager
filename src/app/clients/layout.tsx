// LORAMER_STRIPE_PHASE3_FIX_WELCOMEGATE_V1 — gate logic now shared via enforceWelcomeGate().
import { enforceWelcomeGate } from '@/lib/welcome-gate'

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  await enforceWelcomeGate()
  return <>{children}</>
}
