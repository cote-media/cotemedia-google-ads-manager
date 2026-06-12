// LORAMER_SHOPIFY_DIM_BACKFILL_V1
// Thin CRON_SECRET-bearer GET wrapper over the Shopify dimensional (geo + product-net) backfill.
// SEPARATE cursor (sync_state platform='shopify_dimensional'); the 'shopify' forward/account row is
// untouched. Opt-in, ONE clientId per call. No cron schedules it.

import { NextResponse } from 'next/server'
import { runShopifyDimensionalBackfill } from '@/lib/backfill/shopify-dimensional-backfill'

export const maxDuration = 60

const DEFAULT_DAYS = 90

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }
  const daysRaw = searchParams.get('days')
  const days = daysRaw ? Math.max(1, Math.min(400, parseInt(daysRaw, 10) || DEFAULT_DAYS)) : DEFAULT_DAYS

  const { status, body } = await runShopifyDimensionalBackfill(clientId, { days })
  return NextResponse.json(body, { status })
}
