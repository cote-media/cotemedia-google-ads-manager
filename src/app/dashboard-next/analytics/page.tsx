// LORAMER_NEXT_GA_OVERVIEW_V1 — the -next Analytics (GA4) page. STATIC route → shadows the dynamic
// /dashboard-next/[platform] 'analytics' slug (Next static wins), replacing PlatformPage(ga)/DrillView's coming-soon
// shell with the REAL property-level GA4 Overview. The [platform] route (google-ads/meta-ads/shopify) is UNTOUCHED,
// so google/meta DrillView is unaffected. Guard-first + membership-aware client resolve (mirrors the store/mer pages).
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Shell from '@/components/redesign/Shell'
import GaOverview from '@/components/redesign/GaOverview'
import { resolveShellClient } from '@/lib/next/shell-client' // LORAMER_SHELL_CLIENT_CONTEXT_V1 — the ONE client-context resolver

export const dynamic = 'force-dynamic'

export default async function DashboardNextAnalyticsPage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()
  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  // LORAMER_SHELL_CLIENT_CONTEXT_V1 — read the URL param, VALIDATE it against the caller's accessible set,
  // fall back deterministically. One resolver for every Shell page (Lesson 53 / HANDOFF:847).
  const { client: resolved } = await resolveShellClient(email, searchParams)

  if (!resolved) {
    return <Shell active="analytics"><p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p></Shell>
  }
  return (
    <Shell active="analytics" clientName={resolved.name} clientId={resolved.id}>
      <GaOverview clientId={resolved.id} clientName={resolved.name} />
    </Shell>
  )
}
