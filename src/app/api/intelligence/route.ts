// ─── /api/intelligence ────────────────────────────────────────────────────────
// The master intelligence endpoint.
// Fetches ALL data from ALL connected platforms for a client.
// Returns a complete ClientIntelligence object.
// Every Claude call should use this as its data source.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGoogleIntelligence } from '@/lib/intelligence/google-intelligence'
import { fetchMetaIntelligence } from '@/lib/intelligence/meta-intelligence'
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'

// Cache TTL — how long to use cached intelligence before re-fetching
// Set low (15 min) so data stays fresh but we don't hammer the APIs
const CACHE_TTL_MS = 15 * 60 * 1000

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart') || undefined
  const customEnd = searchParams.get('customEnd') || undefined
  const forceRefresh = searchParams.get('refresh') === 'true'

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // ── Fetch client connections ───────────────────────────────────────────────
  const { data: connections } = await supabaseAdmin
    .from('platform_connections')
    .select('*')
    .eq('client_id', clientId)

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .single()

  // ── Fetch client context (profile + conversations) ─────────────────────────
  const { data: context } = await supabaseAdmin
    .from('client_context')
    .select('*')
    .eq('client_id', clientId)
    .eq('user_email', session.user.email)
    .single()

  // ── Check cache ────────────────────────────────────────────────────────────
  const cacheKey = `intelligence:${clientId}:${dateRange}:${customStart || ''}:${customEnd || ''}`
  if (!forceRefresh && context?.intelligence_cache) {
    try {
      const cached = JSON.parse(context.intelligence_cache)
      if (cached[cacheKey] && Date.now() - new Date(cached[cacheKey].fetchedAt).getTime() < CACHE_TTL_MS) {
        // Return cached with fresh profile/conversations
        cached[cacheKey].profile = {
          businessType: context.business_type,
          primaryKpi: context.primary_kpi,
          funnelNotes: context.funnel_notes,
          userNotes: context.user_notes,
          conversations: context.conversations,
        }
        return NextResponse.json({ intelligence: cached[cacheKey] })
      }
    } catch {}
  }

  // ── Build intelligence object ──────────────────────────────────────────────
  const intelligence: ClientIntelligence = {
    clientId,
    clientName: client?.name || '',
    fetchedAt: new Date().toISOString(),
    dateRange,
    profile: {
      businessType: context?.business_type,
      primaryKpi: context?.primary_kpi,
      funnelNotes: context?.funnel_notes,
      userNotes: context?.user_notes,
      conversations: context?.conversations || {},
    },
  }

  const googleConn = connections?.find(c => c.platform === 'google')
  const metaConn = connections?.find(c => c.platform === 'meta')

  // ── Fetch Google ───────────────────────────────────────────────────────────
  if (googleConn && session.refreshToken) {
    try {
      intelligence.google = await fetchGoogleIntelligence(
        session.refreshToken,
        googleConn.account_id,
        dateRange,
        process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
        process.env.GOOGLE_CLIENT_ID!,
        process.env.GOOGLE_CLIENT_SECRET!,
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        customStart,
        customEnd
      )
    } catch (e: any) {
      console.error('Google intelligence error:', e.message)
      intelligence.google = { connected: false, dateRange, fetchedAt: new Date().toISOString(), campaigns: [], adGroups: [], ads: [], totals: {} as any }
    }
  }

  // ── Fetch Meta ─────────────────────────────────────────────────────────────
  if (metaConn) {
    try {
      const { data: tokenRow } = await supabaseAdmin
        .from('meta_tokens')
        .select('access_token')
        .eq('user_email', session.user.email)
        .single()

      if (tokenRow?.access_token) {
        intelligence.meta = await fetchMetaIntelligence(
          tokenRow.access_token,
          metaConn.account_id,
          dateRange,
          customStart,
          customEnd
        )
      }
    } catch (e: any) {
      console.error('Meta intelligence error:', e.message)
      intelligence.meta = { connected: false, dateRange, fetchedAt: new Date().toISOString(), campaigns: [], adGroups: [], ads: [], totals: {} as any }
    }
  }

  // ── Shopify (ready to add) ─────────────────────────────────────────────────
  // const shopifyConn = connections?.find(c => c.platform === 'shopify')
  // if (shopifyConn) {
  //   intelligence.shopify = await fetchShopifyIntelligence(shopifyConn.access_token, shopifyConn.shop_domain, dateRange)
  // }

  // ── Cache the result ───────────────────────────────────────────────────────
  try {
    const existingCache = context?.intelligence_cache ? JSON.parse(context.intelligence_cache) : {}
    existingCache[cacheKey] = intelligence
    // Keep only last 5 cache entries to avoid bloat
    const keys = Object.keys(existingCache)
    if (keys.length > 5) delete existingCache[keys[0]]
    await supabaseAdmin
      .from('client_context')
      .upsert({ client_id: clientId, user_email: session.user.email, intelligence_cache: JSON.stringify(existingCache), updated_at: new Date().toISOString() }, { onConflict: 'client_id,user_email' })
  } catch {}

  return NextResponse.json({ intelligence })
}
