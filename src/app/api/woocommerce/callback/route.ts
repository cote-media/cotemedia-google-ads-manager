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

  // LORAMER_WOO_CALLBACK_NONCE_V1 (C2) — VERIFY the state nonce BEFORE any write. This POST is unauthenticated
  // (WordPress → server, no session/cookie); the nonce (minted in /api/woocommerce/auth under an authenticated
  // session, carried on the callback_url) is what binds it to the real initiator. The body.user_id === minted
  // user_email check is the core: it rejects a forged POST claiming a victim's identity. Any failure → LOG + NO
  // WRITE, and return 200 to suppress a WordPress retry storm (a bad/expired/forged nonce never becomes valid).
  const nonce = searchParams.get('nonce')
  const { data: nrow } = nonce
    ? await supabaseAdmin
        .from('woo_connect_nonce')
        .select('client_id, user_email, shop, expires_at, consumed_at')
        .eq('nonce', nonce)
        .maybeSingle()
    : { data: null as any }
  const notExpired = !!nrow && new Date(nrow.expires_at).getTime() > Date.now()
  const nonceOk =
    !!nrow &&
    nrow.consumed_at == null &&
    notExpired &&
    nrow.client_id === clientId &&
    nrow.shop === shop &&
    nrow.user_email === userEmail
  if (!nonceOk) {
    const reason = !nonce ? 'missing' : !nrow ? 'not-found' : nrow.consumed_at != null ? 'consumed'
      : !notExpired ? 'expired' : nrow.client_id !== clientId ? 'client-mismatch'
      : nrow.shop !== shop ? 'shop-mismatch' : 'identity-mismatch'
    console.error(`[woo callback] REJECTED — nonce ${reason} (clientId=${clientId} shop=${shop} bodyUser=${userEmail})`)
    return NextResponse.json({ ok: false, error: 'invalid or expired authorization' }, { status: 200 })
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
    // Nonce UNCONSUMED on purpose: a WordPress retry within the TTL re-attempts the (idempotent) upsert.
    return NextResponse.json({ error: 'token save failed' }, { status: 500 })
  }

  // LORAMER_WOO_CALLBACK_NONCE_V1 (C2) — CONSUME the nonce only NOW, after the credential write SUCCEEDED. A
  // transient failure above left it unconsumed (retry-safe); the idempotent upsert makes a post-success retry a
  // no-op. One-time consume also blocks replay of a captured callback_url.
  await supabaseAdmin.from('woo_connect_nonce').update({ consumed_at: new Date().toISOString() }).eq('nonce', nonce)

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
