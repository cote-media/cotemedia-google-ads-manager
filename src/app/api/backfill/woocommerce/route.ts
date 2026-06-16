// LORAMER_WOO_BACKFILL_2A_V1
// Thin CRON_SECRET-bearer GET wrapper over the WooCommerce historical backfill.
// SEPARATE cursor (sync_state platform='woocommerce_backfill'); the 'woocommerce' forward row is
// untouched. Opt-in, ONE clientId per call; loop invocations until body.complete. No cron schedules it.
// Phase 2a = backend only: NO run-backfill UI branch, NO BackfillControl mount (reviewer-path freeze).

import { NextResponse } from 'next/server'
import { runWooCommerceBackfill } from '@/lib/backfill/woocommerce-backfill'

export const maxDuration = 60

const DEFAULT_DAYS = 4000

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }
  const daysRaw = searchParams.get('days')
  const days = daysRaw ? Math.max(1, Math.min(5000, parseInt(daysRaw, 10) || DEFAULT_DAYS)) : DEFAULT_DAYS

  const { status, body } = await runWooCommerceBackfill(clientId, { days })
  return NextResponse.json(body, { status })
}
