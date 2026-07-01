// LORAMER_ECOM_MONEY_SURFACE_DISPLAY_V1 — -NEXT-ONLY per-platform STORE drill page (the store tab that didn't
// exist yet). Guard-first (requirePreviewUser as the FIRST line): a non-allowlisted request redirects to
// /dashboard BEFORE any data is computed. Resolves ?clientId (verified to belong to the user) or the first
// client; ?platform selects the store (auto-detected by the money route when absent). Hosts the full
// MoneyWaterfall now and is structured so more store cards drop in later. Reviewer path untouched.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Shell from '@/components/redesign/Shell'
import MoneyWaterfall from '@/components/redesign/MoneyWaterfall'

// Auth-gated (requirePreviewUser reads headers/session) → always server-rendered on demand; skip static prerender.
export const dynamic = 'force-dynamic'

export default async function DashboardNextStorePage({ searchParams }: { searchParams: { clientId?: string; platform?: string; period?: string } }) {
  await requirePreviewUser()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''

  const { data: clients } = await supabaseAdmin
    .from('clients').select('id, name')
    .eq('user_email', email)
    .order('created_at', { ascending: true })
  const list = clients || []
  const resolved = (searchParams?.clientId && list.find((c) => c.id === searchParams.clientId)) || list[0] || null

  if (!resolved) {
    return (
      <Shell active="store">
        <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p>
      </Shell>
    )
  }

  const platform = searchParams?.platform && ['woocommerce', 'shopify'].includes(searchParams.platform) ? searchParams.platform : undefined
  const period = searchParams?.period || 'LAST_30_DAYS'

  return (
    <Shell active="store" clientName={resolved.name} clientId={resolved.id}>
      {/* Store drill container — a simple stack so additional store cards (orders, products, customers, …) drop in
          later without restructuring. Money surface is the first card. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
        <MoneyWaterfall clientId={resolved.id} platform={platform} period={period} />
      </div>
    </Shell>
  )
}
