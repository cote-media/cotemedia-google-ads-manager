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
import OverviewStatic from '@/components/redesign/OverviewStatic'

export default async function DashboardNextPage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  const { data: clients } = await supabaseAdmin
    .from('clients').select('id, name')
    .eq('user_email', email)
    .order('created_at', { ascending: true })
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
      <OverviewStatic clientId={resolved.id} clientName={resolved.name} />
    </Shell>
  )
}
