// LORAMER_NEXT_GA_OVERVIEW_V1 — the -next Analytics (GA4) page. STATIC route → shadows the dynamic
// /dashboard-next/[platform] 'analytics' slug (Next static wins), replacing PlatformPage(ga)/DrillView's coming-soon
// shell with the REAL property-level GA4 Overview. The [platform] route (google-ads/meta-ads/shopify) is UNTOUCHED,
// so google/meta DrillView is unaffected. Guard-first + membership-aware client resolve (mirrors the store/mer pages).
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Shell from '@/components/redesign/Shell'
import GaOverview from '@/components/redesign/GaOverview'
import { listAccessibleClients } from '@/lib/access/can-access'

export const dynamic = 'force-dynamic'

export default async function DashboardNextAnalyticsPage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()
  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  const ids = await listAccessibleClients(email)
  const { data: clients } = ids.length
    ? await supabaseAdmin.from('clients').select('id, name').in('id', ids).is('deleted_at', null).order('created_at', { ascending: true }) // LORAMER_DELETE_CLIENT_V1
    : { data: [] as { id: string; name: string }[] }
  const list = clients || []
  const resolved = (searchParams?.clientId && list.find((c) => c.id === searchParams.clientId)) || list[0] || null

  if (!resolved) {
    return <Shell active="analytics"><p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p></Shell>
  }
  return (
    <Shell active="analytics" clientName={resolved.name} clientId={resolved.id}>
      <GaOverview clientId={resolved.id} clientName={resolved.name} />
    </Shell>
  )
}
