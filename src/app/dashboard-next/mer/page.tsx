// LORAMER_NEXT_MER_VIEW_V1 — the -next "Mer" (blended MER / Marketing Efficiency Ratio) page. The rail + mobile nav
// already link here (/dashboard-next/mer) but the route was absent (404). Guard-first (requirePreviewUser), then
// resolve the client MEMBERSHIP-AWARE (owned ∪ org-grant ∪ legacy, EXACTLY like the store page) → mount <MerView>,
// which reuses the LOCKED /api/next/client-metrics calc (store-wins revenue ÷ Σ ad spend, guarded). No new data layer.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Shell from '@/components/redesign/Shell'
import MerView from '@/components/redesign/MerView'
import { resolveShellClient } from '@/lib/next/shell-client' // LORAMER_SHELL_CLIENT_CONTEXT_V1 — the ONE client-context resolver

export const dynamic = 'force-dynamic'

export default async function DashboardNextMerPage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()
  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  // LORAMER_SHELL_CLIENT_CONTEXT_V1 — read the URL param, VALIDATE it against the caller's accessible set,
  // fall back deterministically. One resolver for every Shell page (Lesson 53 / HANDOFF:847).
  const { client: resolved } = await resolveShellClient(email, searchParams)

  if (!resolved) {
    return <Shell active="mer"><p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p></Shell>
  }
  return (
    <Shell active="mer" clientName={resolved.name} clientId={resolved.id}>
      <MerView clientId={resolved.id} clientName={resolved.name} />
    </Shell>
  )
}
