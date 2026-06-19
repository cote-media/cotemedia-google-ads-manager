// LORAMER_REDESIGN_INCB / LORAMER_NEXT_DATAWIRE_PORTFOLIO_V1 — the Multi-Client Overview (agency portfolio
// landing), where "All clients" lands. Guard-first (requirePreviewUser as the FIRST line, same isolation pattern
// as every /dashboard-next page): a non-allowlisted request redirects to /dashboard BEFORE any content is
// computed. Real client identity wired (membership-aware); per-client metrics + proactive analysis = 1B-2.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { listAccessibleClients } from '@/lib/access/can-access'
import Shell from '@/components/redesign/Shell'
import MultiClientOverview from '@/components/redesign/MultiClientOverview'

export default async function DashboardNextClientsPage() {
  await requirePreviewUser()

  // Real client list, membership-aware (owned ∪ shared). client_members empty → owner-only today.
  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  const ids = await listAccessibleClients(email)
  let clients: { id: string; name: string }[] = []
  if (ids.length) {
    const { data } = await supabaseAdmin
      .from('clients').select('id, name').in('id', ids).order('created_at', { ascending: true })
    clients = data || []
  }

  return (
    <Shell active="clients">
      <MultiClientOverview clients={clients} />
    </Shell>
  )
}
