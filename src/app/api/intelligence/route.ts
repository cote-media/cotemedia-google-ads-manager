// ─── /api/intelligence ────────────────────────────────────────────────────────
// Master intelligence endpoint — fetches ALL data from ALL connected platforms.
// Every Claude call uses this as its data source.
// Design principles:
// - Never returns null — always returns a typed object
// - Failed platform fetches return { connected: false } not null
// - All errors logged explicitly
// - Cache per client+dateRange, invalidated on demand
// - user_email always included in Supabase operations

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGoogleIntelligence } from '@/lib/intelligence/google-intelligence'
import { fetchMetaIntelligence } from '@/lib/intelligence/meta-intelligence'
import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'
import type { ClientIntelligence, PlatformIntelligence } from '@/lib/intelligence/intelligence-types'

const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

const EMPTY_PLATFORM: PlatformIntelligence = {
  connected: false,
  dateRange: '',
  fetchedAt: new Date().toISOString(),
  campaigns: [],
  adGroups: [],
  ads: [],
  totals: {
    spend: 0, clicks: 0, impressions: 0, conversions: 0,
    conversionValue: 0, ctr: 0, cpc: 0, cpm: 0,
    roas: null, cpa: null, convRate: null,
  },
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart') || undefined
  const customEnd = searchParams.get('customEnd') || undefined
  const forceRefresh = searchParams.get('refresh') === 'true'

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // ── Fetch client data from Supabase ────────────────────────────────────────
  const [connectionsResult, clientResult, contextResult] = await Promise.all([
    supabaseAdmin.from('platform_connections').select('*').eq('client_id', clientId),
    supabaseAdmin.from('clients').select('name').eq('id', clientId).single(),
    supabaseAdmin.from('client_context').select('*').eq('client_id', clientId).eq('user_email', session.user.email).single(),
  ])

  const connections = connectionsResult.data || []
  const client = clientResult.data
  const context = contextResult.data

  // ── Check cache ────────────────────────────────────────────────────────────
  const cacheKey = `intelligence:${clientId}:${dateRange}:${customStart || ''}:${customEnd || ''}`

  if (!forceRefresh && context?.intelligence_cache) {
    try {
      const cached = JSON.parse(context.intelligence_cache)
      const entry = cached[cacheKey]
      if (entry && Date.now() - new Date(entry.fetchedAt).getTime() < CACHE_TTL_MS) {
        // Always return fresh profile/conversations with cached platform data
        entry.profile = {
          businessType: context.business_type,
          primaryKpi: context.primary_kpi,
          funnelNotes: context.funnel_notes,
          userNotes: context.user_notes,
          conversations: context.conversations || {},
        }
        return NextResponse.json({ intelligence: entry })
      }
    } catch (e) {
      console.error('Cache parse error:', e)
    }
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

  const googleConn = connections.find(c => c.platform === 'google')
  const metaConn = connections.find(c => c.platform === 'meta')
  const shopifyConn = connections.find(c => c.platform === 'shopify')

  // ── Fetch all platforms in parallel ───────────────────────────────────────
  const [googleResult, metaResult, shopifyResult] = await Promise.allSettled([
    // Google
    googleConn && session.refreshToken
      ? fetchGoogleIntelligence(
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
      : Promise.resolve(null),

    // Meta
    metaConn
      ? supabaseAdmin
          .from('meta_tokens')
          .select('access_token')
          .eq('user_email', session.user.email)
          .single()
          .then(({ data: tokenRow }) => {
            if (!tokenRow?.access_token) throw new Error('No Meta token found')
            return fetchMetaIntelligence(
              tokenRow.access_token,
              metaConn.account_id,
              dateRange,
              customStart,
              customEnd
            )
          })
      : Promise.resolve(null),

    // Shopify
    shopifyConn
      ? supabaseAdmin
          .from('shopify_tokens')
          .select('access_token')
          .eq('user_email', session.user.email)
          .eq('shop_domain', shopifyConn.account_id)
          .single()
          .then(({ data: tokenRow }) => {
            if (!tokenRow?.access_token) throw new Error('No Shopify token found')
            return fetchShopifyIntelligence(
              tokenRow.access_token,
              shopifyConn.account_id,
              dateRange,
              customStart,
              customEnd
            )
          })
      : Promise.resolve(null),
  ])

  // ── Process results — never crash on platform failure ──────────────────────
  if (googleResult.status === 'fulfilled' && googleResult.value) {
    intelligence.google = googleResult.value
  } else if (googleConn) {
    console.error('Google intelligence failed:', googleResult.status === 'rejected' ? googleResult.reason?.message : 'unknown')
    intelligence.google = { ...EMPTY_PLATFORM, dateRange }
  }

  if (metaResult.status === 'fulfilled' && metaResult.value) {
    intelligence.meta = metaResult.value
  } else if (metaConn) {
    console.error('Meta intelligence failed:', metaResult.status === 'rejected' ? metaResult.reason?.message : 'unknown')
    intelligence.meta = { ...EMPTY_PLATFORM, dateRange }
  }

  if (shopifyResult.status === 'fulfilled' && shopifyResult.value) {
    intelligence.shopify = shopifyResult.value
  } else if (shopifyConn) {
    console.error('Shopify intelligence failed:', shopifyResult.status === 'rejected' ? shopifyResult.reason?.message : 'unknown')
    intelligence.shopify = { connected: false }
  }

  // ── Cache the result ───────────────────────────────────────────────────────
  try {
    const existingCache = context?.intelligence_cache ? JSON.parse(context.intelligence_cache) : {}
    existingCache[cacheKey] = intelligence
    // Keep only last 5 cache entries
    const keys = Object.keys(existingCache)
    if (keys.length > 5) delete existingCache[keys[0]]
    await supabaseAdmin
      .from('client_context')
      .upsert({
        client_id: clientId,
        user_email: session.user.email,
        intelligence_cache: JSON.stringify(existingCache),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,user_email' })
  } catch (e) {
    console.error('Cache save error:', e)
  }

  return NextResponse.json({ intelligence })
}
