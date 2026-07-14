// LORAMER_PREVIEW_GATE_V1
// The gate seam for the build-dark redesign. SERVER component: an allowlisted user (PREVIEW_ALLOWLIST)
// renders the redesign tree; everyone else — including the Meta reviewer demo@loramer.com and any
// unauthenticated visitor — is redirected to the CURRENT /dashboard. isPreviewUser() fails closed, so
// any error also lands here on /dashboard. This route is isolated: it touches NO existing reviewer-path
// file and no OAuth/consent/domain config.
// LORAMER_SIGNUP_FUNNEL_FIX_V1 (R2) — enforce the new-user WELCOME GATE here. -next is the real post-auth landing
// now, and the 138a820 legacy-surface middleware redirects /dashboard + /clients → -next BEFORE their layouts run,
// bypassing the enforceWelcomeGate that used to fire there. Without this, a fresh user reaches the empty portfolio
// with NO account_type (Add-client 409s). Runs AFTER isPreviewUser so the legacy/reviewer cohort (bounced to
// /dashboard) never reaches it; the gate is membership-aware (existing owners-with-clients + org members pass
// WITHOUT re-onboarding) and fails OPEN on a DB blip. /welcome is NOT under /dashboard-next → no redirect loop.
import { redirect } from 'next/navigation'
import { isPreviewUser } from '@/lib/preview-gate'
import { enforceWelcomeGate } from '@/lib/welcome-gate'

export default async function DashboardNextLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPreviewUser())) redirect('/dashboard')
  await enforceWelcomeGate() // fresh user (no account_type + no accessible clients + no membership) → /welcome
  return <>{children}</>
}
