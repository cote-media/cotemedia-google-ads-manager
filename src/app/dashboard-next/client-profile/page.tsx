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
import { resolveShellClient } from '@/lib/next/shell-client' // LORAMER_SHELL_CLIENT_CONTEXT_V1
import ClientPage from '@/components/redesign/ClientPage'
import { reconcile } from '@/lib/completeness/reconcile' // LORAMER_COMPLETENESS_GATE_V1 F(b) — data-capture verdict (REUSED)
import { computeReadiness, type ReadinessResult } from '@/lib/completeness/readiness'

export default async function DashboardNextClientProfilePage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''

  // LORAMER_SHELL_CLIENT_CONTEXT_V1 — read the URL param, VALIDATE it against the caller's accessible set, fall
  // back deterministically. ONE resolver for every Shell page (Lesson 53 / HANDOFF:847).
  // NOTE: this page previously resolved OWNER-ONLY via .eq('user_email', email) and was never swapped onto the
  // org-aware access layer (LORAMER_RBAC_ACCESS_ORG_V1) — so an org MEMBER with a valid grant saw "No clients
  // yet" here. resolveShellClient uses listAccessibleClients (owner ∪ org-grant ∪ legacy), which fixes that.
  const { client: resolved } = await resolveShellClient(email, searchParams)

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

  // LORAMER_COMPLETENESS_GATE_V1 F(b) — per-client Lora-readiness meter. `resolved.id` is ALREADY owner-verified
  // above (list from clients WHERE user_email = caller), so the access-gated RPC never sees a client the caller
  // can't access. RPC → reconcile (data-capture, REUSED) → composer (brain/context). Non-fatal on error.
  let readiness: ReadinessResult | null = null
  try {
    const { data: sig } = await supabaseAdmin.rpc('get_client_readiness_signals', { p_client_id: resolved.id })
    if (sig) {
      const byPlatform: Record<string, { entity_level: string; breakdown_type: string }[]> = {}
      for (const r of (Array.isArray(sig.realAgg) ? sig.realAgg : [])) (byPlatform[r.platform] ||= []).push({ entity_level: r.entity_level, breakdown_type: r.breakdown_type })
      const [clientResult] = reconcile({
        floors: sig.floors || [], connections: sig.connections || [], cursors: sig.cursors || [],
        realAgg: { [resolved.id]: byPlatform }, nowIso: new Date().toISOString(), clientIds: [resolved.id],
        // LORAMER_RECONCILE_ZERO_DELIVERY_V1 — zero-delivery gate: RPC returns per-ad-platform delivery bool so a
        // connected-but-$0 ad account reads honest-empty instead of a false "needs a fix" defect.
        delivery: { [resolved.id]: sig.delivery || {} },
      })
      if (clientResult) readiness = computeReadiness({
        clientResult,
        connections: (sig.connections || []).map((c: any) => ({ platform: c.platform, health: c.health })),
        brain: sig.brain || {}, docs: sig.docs || {}, memory: sig.memory || {},
      })
    }
  } catch (e) { console.error('[client-profile] readiness failed (non-fatal):', e) }

  return (
    <Shell active="clients" clientName={resolved.name} clientId={resolved.id}>
      <ClientPage clientId={resolved.id} clientName={resolved.name} connections={conns || []} hasGoogleAdsToken={hasGoogleAdsToken} readiness={readiness} />
    </Shell>
  )
}
