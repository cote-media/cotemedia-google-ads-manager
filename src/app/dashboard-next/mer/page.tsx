// LORAMER_NEXT_MER_VIEW_V1 — the -next "Mer" (blended MER / Marketing Efficiency Ratio) page. The rail + mobile nav
// already link here (/dashboard-next/mer) but the route was absent (404). Guard-first (requirePreviewUser), then
// resolve the client MEMBERSHIP-AWARE (owned ∪ org-grant ∪ legacy, EXACTLY like the store page) → mount <MerView>,
// which reuses the LOCKED /api/next/client-metrics calc (store-wins revenue ÷ Σ ad spend, guarded). No new data layer.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Shell from '@/components/redesign/Shell'
import MerView from '@/components/redesign/MerView'
import { listAccessibleClients } from '@/lib/access/can-access'

export const dynamic = 'force-dynamic'

export default async function DashboardNextMerPage({ searchParams }: { searchParams: { clientId?: string } }) {
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
    return <Shell active="mer"><p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p></Shell>
  }
  return (
    <Shell active="mer" clientName={resolved.name} clientId={resolved.id}>
      <MerView clientId={resolved.id} clientName={resolved.name} />
    </Shell>
  )
}
