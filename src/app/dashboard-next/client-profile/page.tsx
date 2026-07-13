// LORAMER_REDESIGN_CLIENTPAGE_A — the sectioned client page (build a-core), wired to real data.
// Guard-first (requirePreviewUser as the FIRST line): a non-allowlisted request redirects to /dashboard
// BEFORE any session lookup or DB fetch, so no client data is ever computed for them. Resolves ?clientId
// (verified to belong to the signed-in user) or defaults to the user's FIRST client, fetches that client's
// connections server-side (read-only display), and renders the sectioned page inside the existing Shell.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Shell from '@/components/redesign/Shell'
import ClientPage from '@/components/redesign/ClientPage'

export default async function DashboardNextClientProfilePage({ searchParams }: { searchParams: { clientId?: string } }) {
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
      <Shell active="clients">
        <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p>
      </Shell>
    )
  }

  // LORAMER_NEXT_CONNECT_V1 — include `id` so the -next Connections section can DISCONNECT via the existing
  // DELETE /api/clients/connections?id=<id> (ownership-gated; removes the connection row only, history kept).
  const { data: conns } = await supabaseAdmin
    .from('platform_connections').select('id, platform, account_name, account_id, health')
    .eq('client_id', resolved.id)
    .eq('user_email', email)
    .order('platform', { ascending: true })

  // LORAMER_NEXT_CONNECT_V1 F3 — owner-level Google Ads authorization (google_tokens keyed by user_email). Google Ads
  // is a two-level connection: (1) this owner token, captured by the decoupler; (2) per-client customer_id mapping
  // (the legacy account picker — F3b). The -next Google row keys its Connect/Reconnect on this token.
  const { data: gadsTok } = await supabaseAdmin
    .from('google_tokens').select('user_email').eq('user_email', email).maybeSingle()
  const hasGoogleAdsToken = !!gadsTok

  return (
    <Shell active="clients" clientName={resolved.name} clientId={resolved.id}>
      <ClientPage clientId={resolved.id} clientName={resolved.name} connections={conns || []} hasGoogleAdsToken={hasGoogleAdsToken} />
    </Shell>
  )
}
