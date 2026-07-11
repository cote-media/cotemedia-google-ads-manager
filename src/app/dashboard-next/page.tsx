// LORAMER_REDESIGN_INC1 / LORAMER_NEXT_CLIENT_OVERVIEW_V1
// requirePreviewUser() MUST be the FIRST line: it short-circuits (redirect to /dashboard) BEFORE any content is
// computed or returned, so a non-allowlisted request never has this page's RSC payload streamed in the redirect
// body. The layout gate stays as defense-in-depth. Resolves ?clientId (owner-scoped; resolveAccess swap later) or
// the user's first client, then renders the single-client Overview wired to the captured system-of-record.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Shell from '@/components/redesign/Shell'
import { listAccessibleClients } from '@/lib/access/can-access' // LORAMER_RBAC_ACCESS_ORG_V1 — member-aware client set
// LORAMER_NEXT_CARD_ENGINE_V1 — Overview now renders the page-agnostic card engine (pageKey='overview'); the
// built-in default view = real captured stats + combined-perf timeseries + an age breakdown (query-exposed only).
import CardEngine from '@/components/redesign/cards/CardEngine'
// LORAMER_NEXT_MONEY_CARD_V1 — the money surface is now an in-grid card (kind='money'), owned by the card engine
// (shared date picker + chrome). The former floating <MoneySummary/> mount was removed.

export default async function DashboardNextPage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  // LORAMER_RBAC_ACCESS_ORG_V1 — resolve over ACCESSIBLE clients (owned ∪ org-grant ∪ legacy), not owner-only, so a
  // granted member lands on a client they can see. The CardEngine's per-card reads are resolveAccess-gated (/api/next/*),
  // so access is enforced there too; picking from the accessible set is the page-level gate.
  const ids = await listAccessibleClients(email)
  const { data: clients } = ids.length
    ? await supabaseAdmin.from('clients').select('id, name').in('id', ids).order('created_at', { ascending: true })
    : { data: [] as { id: string; name: string }[] }
  const list = clients || []
  const resolved = (searchParams?.clientId && list.find(c => c.id === searchParams.clientId)) || list[0] || null

  if (!resolved) {
    return (
      <Shell active="overview">
        <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p>
      </Shell>
    )
  }

  return (
    <Shell active="overview" clientName={resolved.name} clientId={resolved.id}>
      <CardEngine pageKey="overview" clientId={resolved.id} />
    </Shell>
  )
}
