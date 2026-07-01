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
// LORAMER_NEXT_CARD_ENGINE_V1 — Overview now renders the page-agnostic card engine (pageKey='overview'); the
// built-in default view = real captured stats + combined-perf timeseries + an age breakdown (query-exposed only).
import CardEngine from '@/components/redesign/cards/CardEngine'
// LORAMER_ECOM_MONEY_SURFACE_DISPLAY_V1 — compact store money summary above the card engine (renders nothing
// for non-store clients; taps through to the store drill page). -next-only.
import MoneySummary from '@/components/redesign/MoneySummary'

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
      <MoneySummary clientId={resolved.id} />
      <CardEngine pageKey="overview" clientId={resolved.id} />
    </Shell>
  )
}
