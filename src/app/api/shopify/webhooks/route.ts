// /api/shopify/webhooks
// Single endpoint for all mandatory Shopify GDPR/CCPA compliance webhooks.
// Routed by the X-Shopify-Topic header.
//
// Required by Shopify App Store review.
// Topics handled:
//   customers/data_request — log request, owner has 30 days to fulfill
//   customers/redact       — no-op (LoraMer stores no customer PII)
//   shop/redact            — 48hr after uninstall, delete tokens & connections
//
// HMAC verification: invalid → 401, valid → 200 (per Shopify spec).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

export async function POST(request: Request) {
  // Shopify sends the HMAC in this header, base64-encoded SHA256 of the raw body
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || ''
  const topic = request.headers.get('x-shopify-topic') || ''
  const shopDomain = request.headers.get('x-shopify-shop-domain') || ''

  // CRITICAL: must verify against the RAW request body bytes, not parsed JSON
  const rawBody = await request.text()

  // Verify HMAC
  const secret = process.env.SHOPIFY_CLIENT_SECRET
  if (!secret) {
    console.error('Shopify webhook: SHOPIFY_CLIENT_SECRET not set')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  const computedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64')

  // Constant-time comparison to avoid timing attacks
  const hmacValid =
    hmacHeader.length === computedHmac.length &&
    crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(computedHmac))

  if (!hmacValid) {
    console.warn('Shopify webhook: invalid HMAC', { topic, shopDomain })
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Parse the body now that we've verified it
  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }

  console.log('Shopify webhook received:', { topic, shopDomain })

  try {
    switch (topic) {
      case 'customers/data_request': {
        // Customer asked for their data. We don't store customer PII, but per
        // Shopify spec we must acknowledge and have 30 days to respond.
        // Log it so the merchant/Russ can fulfill manually if needed.
        await supabaseAdmin.from('shopify_compliance_log').insert({
          topic,
          shop_domain: payload.shop_domain || shopDomain,
          shop_id: payload.shop_id?.toString(),
          payload: payload,
          received_at: new Date().toISOString(),
        })
        break
      }

      case 'customers/redact': {
        // Shopify-side: delete this customer's data.
        // LoraMer doesn't store individual customer PII — we only store
        // aggregated metrics tied to a shop, never tied to a customer.
        // Logged for audit trail in case Shopify asks during review.
        await supabaseAdmin.from('shopify_compliance_log').insert({
          topic,
          shop_domain: payload.shop_domain || shopDomain,
          shop_id: payload.shop_id?.toString(),
          payload: payload,
          received_at: new Date().toISOString(),
        })
        break
      }

      case 'shop/redact': {
        // 48 hours after the merchant uninstalls. Wipe everything tied to
        // this shop from Supabase.
        const shop = payload.shop_domain || shopDomain
        if (shop) {
          // Delete tokens
          await supabaseAdmin
            .from('shopify_tokens')
            .delete()
            .eq('shop_domain', shop)

          // Delete platform_connections rows for this shop
          await supabaseAdmin
            .from('platform_connections')
            .delete()
            .eq('platform', 'shopify')
            .eq('account_id', shop)

          // Log the action
          await supabaseAdmin.from('shopify_compliance_log').insert({
            topic,
            shop_domain: shop,
            shop_id: payload.shop_id?.toString(),
            payload: payload,
            received_at: new Date().toISOString(),
            action_taken: 'tokens and connections deleted',
          })
        }
        break
      }

      default:
        console.warn('Shopify webhook: unknown topic', topic)
        // Still return 200 so Shopify doesn't retry
        break
    }

    return new NextResponse('OK', { status: 200 })
  } catch (e: any) {
    console.error('Shopify webhook handler error:', e)
    // Return 200 anyway — Shopify will retry on 5xx, and we've already
    // verified the HMAC. Better to log and move on than get hammered.
    return new NextResponse('OK', { status: 200 })
  }
}
