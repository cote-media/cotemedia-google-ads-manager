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

  // LORAMER_NEXT_ADD_CLIENT_V1 — owner-only Add-client entry. Allow owners (own an org) AND brand-new users
  // (no org yet → their first client makes them the owner); HIDE for a pure member/admin of someone else's org
  // (they view the owner's clients here, they don't create). resolveCallerOrgAdmin conflates member with new,
  // so we compute the precise signal directly.
  const normEmail = email.trim().toLowerCase()
  const { data: ownedOrg } = await supabaseAdmin
    .from('organizations').select('id').eq('owner_email', normEmail).maybeSingle()
  const { data: anyMembership } = await supabaseAdmin
    .from('org_members').select('org_id').eq('member_email', normEmail).limit(1).maybeSingle()
  const canAddClient = !!ownedOrg || !anyMembership

  return (
    <Shell active="clients">
      <MultiClientOverview clients={clients} canAddClient={canAddClient} />
    </Shell>
  )
}
