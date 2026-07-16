// LORAMER_NEXT_STORE_PAGE_V1 — the -next STORE platform page (FLIGHT 2). Guard-first (requirePreviewUser as the FIRST
// line): a non-allowlisted request redirects to /dashboard BEFORE any data is computed. Resolves ?clientId (owner-
// scoped; resolveAccess swap later, same as Overview) or the first client, then CONNECTION-AWARE via
// resolveStorePlatform (shopify|woo per captured data): a store with data → the full CardEngine store view (net
// revenue · orders · AOV · revenue/orders timeseries · top products · money-breakdown waterfall + a customer-mix
// coming-soon); NEITHER connected/captured → an honest empty/connect state (hasDataEver law, NEVER a false $0).
// The old MoneyWaterfall-only store page is RETIRED — the money surface is now the in-grid 'money' card here.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Shell from '@/components/redesign/Shell'
import CardEngine from '@/components/redesign/cards/CardEngine'
import { storeDefaultView } from '@/components/redesign/cards/card-types'
import { resolveStorePlatform } from '@/lib/next/store-detect'
import { resolveShellClient } from '@/lib/next/shell-client' // LORAMER_SHELL_CLIENT_CONTEXT_V1 — the ONE client-context resolver // LORAMER_RBAC_ACCESS_ORG_V1 — member-aware client set

// Auth-gated (requirePreviewUser reads headers/session) → always server-rendered on demand; skip static prerender.
export const dynamic = 'force-dynamic'

export default async function DashboardNextStorePage({ searchParams }: { searchParams: { clientId?: string; platform?: string } }) {
  await requirePreviewUser()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''

  // LORAMER_RBAC_ACCESS_ORG_V1 — resolve over ACCESSIBLE clients (owned ∪ org-grant ∪ legacy), not owner-only. The
  // store reads (/api/next/store-*) are resolveAccess-gated; resolveStorePlatform reads metrics_daily by client_id
  // (owner-agnostic), so a granted member sees the store they can access.
  // LORAMER_SHELL_CLIENT_CONTEXT_V1 — read the URL param, VALIDATE it against the caller's accessible set,
  // fall back deterministically. One resolver for every Shell page (Lesson 53 / HANDOFF:847).
  const { client: resolved } = await resolveShellClient(email, searchParams)

  if (!resolved) {
    return (
      <Shell active="store">
        <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p>
      </Shell>
    )
  }

  // Connection/data-aware: an explicit ?platform (if it has data) else the store with the most-recent captured data;
  // chosen=null → this client has NO captured store data on either platform → the honest empty/connect state below.
  const requested = searchParams?.platform && ['woocommerce', 'shopify'].includes(searchParams.platform) ? searchParams.platform : undefined
  const { chosen } = await resolveStorePlatform(resolved.id, requested)

  return (
    <Shell active="store" clientName={resolved.name} clientId={resolved.id}>
      {chosen
        // LORAMER_NEXT_STORE_PAGE_V1 (S-PL#1 fix) — key by the resolved client id so a SOFT client switch MOUNTS a
        // fresh CardEngine seeded from the correct storeDefaultView(chosen). Without this, the client switcher's
        // router.push(?clientId=…) REUSES the CardEngine instance → it keeps the prior client's cards + baked
        // storePlatform (+ reused RGL/recharts subtree) through the async re-apply window → the client-side crash.
        // Remounting per client kills the whole stale-transition class at the source (no band-aid boundaries).
        ? <CardEngine key={`store-${resolved.id}`} pageKey={`store:${resolved.id}`} clientId={resolved.id} defaultView={storeDefaultView(chosen)} source="store" storePlatform={chosen} />
        : <StoreEmpty />}
    </Shell>
  )
}

// Honest empty/connect state — the client has no captured Shopify/WooCommerce data (hasDataEver law: absence renders
// as "connect a store", NEVER a fabricated $0). Links to /clients where a store gets connected.
function StoreEmpty() {
  return (
    <div style={{ maxWidth: 460, margin: '48px auto', textAlign: 'center', color: '#334155', fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🛍</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No store connected</div>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: '#64748b', marginBottom: 16 }}>
        Connect Shopify or WooCommerce to see net revenue, orders, AOV, top products, and the money breakdown here.
        (No store sales have been captured for this client yet.)
      </p>
      <a href="/clients" style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 8, background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
        Connect a source →
      </a>
    </div>
  )
}
