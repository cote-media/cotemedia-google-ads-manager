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
import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'  // LORAMER_WOO_INTEL_V1
import { getValidShopifyToken } from '@/lib/shopify-token'
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
  // LORAMER_CONV_API_V1_INTELLIGENCE
  // Conversations now live in client_conversations table (was client_context.conversations).
  // We fetch ALL rows including hidden_at != null - hidden rows are still part of
  // Claude's memory; only the UI hides them.
  // LORAMER_MEMORY_V1
  // client_memory holds structured facts Claude knows about each client.
  // Read active (non-archived) facts only; pinned first, then highest
  // confidence, then most recent. The prompt builder uses these to inject
  // a "WHAT YOU KNOW ABOUT [CLIENT]" block in Claude's system prompt.
  const [connectionsResult, clientResult, contextResult, conversationsResult, memoryResult] = await Promise.all([
    supabaseAdmin.from('platform_connections').select('*').eq('client_id', clientId),
    supabaseAdmin.from('clients').select('name').eq('id', clientId).single(),
    supabaseAdmin.from('client_context').select('*').eq('client_id', clientId).eq('user_email', session.user.email).single(),
    supabaseAdmin
      .from('client_conversations')
      .select('surface, scope, role, content, created_at')
      .eq('client_id', clientId)
      .eq('user_email', session.user.email)
      .order('created_at', { ascending: true })
      .limit(500),
    supabaseAdmin
      .from('client_memory')
      .select('id, content, category, confidence, pinned, source')
      .eq('client_id', clientId)
      .eq('user_email', session.user.email)
      .is('archived_at', null)
      .order('pinned', { ascending: false })
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  const memory = memoryResult.data || []

  const connections = connectionsResult.data || []
  const client = clientResult.data
  const context = contextResult.data
  // Build conversations object keyed by "surface:scope" to match the
  // JSONB shape that build-claude-context.ts expects.
  // Falls back to legacy context.conversations blob if the new table is empty.
  const conversationRows = conversationsResult.data || []
  let conversations: Record<string, Array<{ role: string; content: string; timestamp: string }>> = {}
  if (conversationRows.length > 0) {
    for (const row of conversationRows) {
      const key = row.scope ? `${row.surface}:${row.scope}` : row.surface
      if (!conversations[key]) conversations[key] = []
      conversations[key].push({
        role: row.role,
        content: row.content,
        timestamp: row.created_at,
      })
    }
  } else if (context?.conversations && typeof context.conversations === 'object') {
    conversations = context.conversations as any
  }

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
          conversations, // LORAMER_CONV_API_V1_INTELLIGENCE
          memory, // LORAMER_MEMORY_V1
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
      conversations, // LORAMER_CONV_API_V1_INTELLIGENCE
      memory, // LORAMER_MEMORY_V1
    },
  }

  const googleConn = connections.find(c => c.platform === 'google')
  const metaConn = connections.find(c => c.platform === 'meta')
  const shopifyConn = connections.find(c => c.platform === 'shopify')
  const wooConn = connections.find(c => c.platform === 'woocommerce')  // LORAMER_WOO_INTEL_V1

  // ── Fetch all platforms in parallel ───────────────────────────────────────
  const [googleResult, metaResult, shopifyResult, wooResult] = await Promise.allSettled([
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

    // Shopify — uses getValidShopifyToken which auto-refreshes expired tokens
    shopifyConn
      ? getValidShopifyToken(session.user.email, shopifyConn.account_id).then(tokenResult => {
          if (!tokenResult.ok) {
            throw new Error(`Shopify token unavailable: ${tokenResult.reason}${tokenResult.detail ? ' - ' + tokenResult.detail : ''}`)
          }
          return fetchShopifyIntelligence(
            tokenResult.accessToken,
            shopifyConn.account_id,
            dateRange,
            customStart,
            customEnd
          )
        })
      : Promise.resolve(null),
    // LORAMER_WOO_INTEL_V1 - WooCommerce
    wooConn
      ? supabaseAdmin
          .from('woocommerce_tokens')
          .select('store_url, consumer_key, consumer_secret')
          .eq('user_email', session.user.email)
          .eq('client_id', wooConn.client_id)
          .single()
          .then(({ data: tok }) => {
            if (!tok?.consumer_key || !tok?.consumer_secret || !tok?.store_url) {
              throw new Error('No WooCommerce credentials found')
            }
            return fetchWooCommerceIntelligence(
              tok.store_url,
              tok.consumer_key,
              tok.consumer_secret,
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
  // LORAMER_WOO_INTEL_V1
  if (wooResult.status === 'fulfilled' && wooResult.value) {
    intelligence.woocommerce = wooResult.value
  } else if (wooConn) {
    console.error('WooCommerce intelligence failed:', wooResult.status === 'rejected' ? wooResult.reason?.message : 'unknown')
    intelligence.woocommerce = { connected: false }
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
