// LORAMER_WOO_BACKFILL_SAFE_V1 — TEMPORARY controlled always-500 endpoint for the live-store-safety
// e2e (stands in for a store that PHP-fatals on every request). Catch-all so {base}/wp-json/wc/v3/orders
// resolves here and returns 500. NOT part of the product — REMOVE after the verification.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return new NextResponse(
    '{"code":"mock_internal_error","message":"<p>There has been a critical error on this website.</p>"}',
    { status: 500, headers: { 'content-type': 'application/json' } }
  )
}
