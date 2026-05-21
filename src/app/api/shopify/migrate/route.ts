// /api/shopify/migrate — one-time migration of legacy non-expiring offline tokens
// to expiring offline tokens via Shopify token exchange.
//
// Usage: hit /api/shopify/migrate while signed in. It finds all your shopify_tokens
// rows that have no refresh_token (i.e. legacy) and exchanges them.
//
// Per Shopify docs: this is IRREVERSIBLE. The old non-expiring token is revoked
// upon successful exchange.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find all legacy tokens for this user (no refresh_token = non-expiring)
  const { data: legacyTokens, error } = await supabaseAdmin
    .from('shopify_tokens')
    .select('shop_domain, access_token')
    .eq('user_email', session.user.email)
    .is('refresh_token', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!legacyTokens || legacyTokens.length === 0) {
    return NextResponse.json({
      message: 'No legacy tokens to migrate.',
      migrated: 0,
    })
  }

  const results: any[] = []

  for (const row of legacyTokens) {
    try {
      const exchangeRes = await fetch(
        `https://${row.shop_domain}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: new URLSearchParams({
            client_id: process.env.SHOPIFY_CLIENT_ID!,
            client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: row.access_token,
            subject_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
            requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
            expiring: '1',
          }).toString(),
        }
      )

      const exchanged = await exchangeRes.json()

      if (!exchanged.access_token) {
        results.push({
          shop: row.shop_domain,
          status: 'failed',
          detail: exchanged,
        })
        continue
      }

      const now = Date.now()
      const expiresAt = new Date(now + (exchanged.expires_in || 3600) * 1000).toISOString()
      const refreshTokenExpiresAt = new Date(
        now + (exchanged.refresh_token_expires_in || 7776000) * 1000
      ).toISOString()

      await supabaseAdmin
        .from('shopify_tokens')
        .update({
          access_token: exchanged.access_token,
          refresh_token: exchanged.refresh_token,
          expires_at: expiresAt,
          refresh_token_expires_at: refreshTokenExpiresAt,
          scope: exchanged.scope,
          updated_at: new Date().toISOString(),
        })
        .eq('user_email', session.user.email)
        .eq('shop_domain', row.shop_domain)

      results.push({ shop: row.shop_domain, status: 'migrated' })
    } catch (e: any) {
      results.push({ shop: row.shop_domain, status: 'error', detail: e.message })
    }
  }

  return NextResponse.json({
    message: `Processed ${results.length} shop(s)`,
    migrated: results.filter(r => r.status === 'migrated').length,
    results,
  })
}
