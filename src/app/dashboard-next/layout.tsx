// LORAMER_PREVIEW_GATE_V1
// The gate seam for the build-dark redesign. SERVER component: an allowlisted user (PREVIEW_ALLOWLIST)
// renders the redesign tree; everyone else — including the Meta reviewer demo@loramer.com and any
// unauthenticated visitor — is redirected to the CURRENT /dashboard. isPreviewUser() fails closed, so
// any error also lands here on /dashboard. This route is isolated: it touches NO existing reviewer-path
// file and no OAuth/consent/domain config.
import { redirect } from 'next/navigation'
import { isPreviewUser } from '@/lib/preview-gate'

export default async function DashboardNextLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPreviewUser())) redirect('/dashboard')
  return <>{children}</>
}
