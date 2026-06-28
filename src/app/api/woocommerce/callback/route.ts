import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { kickoffBackfill } from '@/lib/backfill/kickoff' // LORAMER_SELFSERVE_SPINE_V1 step 2

// LORAMER_WOO_CALLBACK_V1
// POST /api/woocommerce/callback?clientId=X&shop=https://store.com
//
// WordPress POSTs JSON after the user approves on the wc-auth page:
//   {
//     key_id:          123,
//     user_id:         'user@example.com',  // we passed this in the auth redirect
//     consumer_key:    'ck_...',
//     consumer_secret: 'cs_...',
//     key_permissions: 'read'
//   }
//
// We also passed &shop= and &clientId= through the callback_url so we
// know which client/store these keys belong to.
//
// This endpoint is publicly reachable (WordPress hits it directly, not
// from an authenticated browser). user_id is whatever we sent WordPress
// in the auth redirect, so we trust it as identity.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const shop = searchParams.get('shop')

  if (!clientId || !shop) {
    return NextResponse.json(
      { error: 'missing clientId or shop in query string' },
      { status: 400 }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const consumerKey = body?.consumer_key
  const consumerSecret = body?.consumer_secret
  const userEmail = body?.user_id
  const keyPermissions = body?.key_permissions || 'read'

  if (!consumerKey || !consumerSecret || !userEmail) {
    return NextResponse.json(
      { error: 'missing required credential fields' },
      { status: 400 }
    )
  }

  // Save the credentials. Upsert on (user_email, client_id) because
  // the table has a unique index on that pair; reconnecting overwrites.
  const tokenWrite = await supabaseAdmin
    .from('woocommerce_tokens')
    .upsert(
      {
        user_email: userEmail,
        client_id: clientId,
        store_url: shop,
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
        scope: keyPermissions,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email,client_id' }
    )

  if (tokenWrite.error) {
    console.error('[woo callback] woocommerce_tokens write failed:', tokenWrite.error)
    return NextResponse.json({ error: 'token save failed' }, { status: 500 })
  }

  // Register the platform connection so the clients list / dashboard
  // know this client has WooCommerce. Use the Shopify pattern of
  // delete-then-insert to avoid relying on unique indexes we may not have.
  await supabaseAdmin
    .from('platform_connections')
    .delete()
    .eq('client_id', clientId)
    .eq('platform', 'woocommerce')

  const insert = await supabaseAdmin.from('platform_connections').insert({
    client_id: clientId,
    user_email: userEmail,
    platform: 'woocommerce',
    account_id: shop,
    account_name: shop.replace(/^https?:\/\//, ''),
    backfill_priority: 10,
  })

  if (insert.error) {
    console.error('[woo callback] platform_connections insert failed:', insert.error)
    // Tokens are saved; UI will recover next sign-in. Still 200 so
    // WordPress doesn't keep retrying.
  } else {
    // LORAMER_SELFSERVE_SPINE_V1 step 2 — connect-kickoff.
    kickoffBackfill(new URL(request.url).origin, clientId, 'woocommerce')
  }

  return NextResponse.json({ success: true })
}
