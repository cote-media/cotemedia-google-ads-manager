// LORAMER_NEXT_PLATFORM_PAGE_V1 — the -next per-platform DRILL page (Flight 1, increment 2). Dynamic [platform]
// route that catches the rail channel slugs (google-ads/meta-ads/analytics/shopify); Next static routes
// (clients/client-profile/store) win over this dynamic segment, so no existing route is shadowed. Guard-first
// (requirePreviewUser) → resolve the client (owner-scoped list, EXACTLY mirroring the store page) → map slug→platform
// → mount <PlatformPage> inside Shell. GOOGLE is verified this increment; meta/ga/shopify render the same shell (the
// drill is gated to entity-supported platforms in DrillView). Reviewer path + legacy untouched.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { notFound, redirect } from 'next/navigation'
import Shell from '@/components/redesign/Shell'
import PlatformPage from '@/components/redesign/platform/PlatformPage'

export const dynamic = 'force-dynamic'

// rail slug → the metrics_daily platform value ('ga'/'shopify' are the non-ad-entity channels; DrillView gates them).
const SLUG_TO_PLATFORM: Record<string, string> = { 'google-ads': 'google', 'meta-ads': 'meta', analytics: 'ga', shopify: 'shopify' }
const LABEL: Record<string, string> = { google: 'Google Ads', meta: 'Meta Ads', ga: 'Analytics', shopify: 'Shopify' }
// LORAMER_NEXT_STORE_TAB_REUSE_V1 — store platforms have a full, membership-aware Store surface at /dashboard-next/store
// (CardEngine: revenue/orders/AOV/timeseries/top-products/money). Route those tabs there instead of the DrillView
// shell — no duplicate data layer; the ad platforms (google/meta) keep the DrillView spine untouched.
const STORE_PLATFORMS = new Set(['shopify', 'woocommerce'])

export default async function DashboardNextPlatformPage({ params, searchParams }: { params: { platform: string }; searchParams: { clientId?: string } }) {
  await requirePreviewUser()
  const slug = params.platform
  const platform = SLUG_TO_PLATFORM[slug]
  if (!platform) notFound()

  // LORAMER_NEXT_STORE_TAB_REUSE_V1 — reuse the canonical Store page (membership-aware + connection-aware) for
  // shopify/woo; preserve the client context. The Store page does its own resolveAccess-based resolution + store
  // detection (shopify|woo, honest empty state), so no data layer is duplicated here.
  if (STORE_PLATFORMS.has(platform)) {
    const qs = new URLSearchParams({ platform })
    if (searchParams?.clientId) qs.set('clientId', searchParams.clientId)
    redirect('/dashboard-next/store?' + qs.toString())
  }

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  const { data: clients } = await supabaseAdmin
    .from('clients').select('id, name').eq('user_email', email).is('deleted_at', null).order('created_at', { ascending: true }) // LORAMER_DELETE_CLIENT_V1
  const list = clients || []
  const resolved = (searchParams?.clientId && list.find((c) => c.id === searchParams.clientId)) || list[0] || null

  if (!resolved) {
    return <Shell active={slug}><p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p></Shell>
  }

  return (
    <Shell active={slug} clientName={resolved.name} clientId={resolved.id}>
      <PlatformPage platform={platform} label={LABEL[platform] || slug} clientId={resolved.id} clientName={resolved.name} />
    </Shell>
  )
}
