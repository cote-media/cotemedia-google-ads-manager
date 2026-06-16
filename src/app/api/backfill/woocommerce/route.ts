// LORAMER_WOO_BACKFILL_2A_V1
// Thin CRON_SECRET-bearer GET wrapper over the WooCommerce historical backfill.
// SEPARATE cursor (sync_state platform='woocommerce_backfill'); the 'woocommerce' forward row is
// untouched. Opt-in, ONE clientId per call; loop invocations until body.complete. No cron schedules it.
// Phase 2a = backend only: NO run-backfill UI branch, NO BackfillControl mount (reviewer-path freeze).

import { NextResponse } from 'next/server'
import { runWooCommerceBackfill } from '@/lib/backfill/woocommerce-backfill'

export const maxDuration = 300 // Pro ceiling — the merchant's WP host is slow (~8s/page); the engine
                               // time-budgets well under this and resumes via the cursor across calls.

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
  // LORAMER_WOO_BACKFILL_SAFE_V1 — deliberate one-shot unblock of the circuit-breaker (after the
  // source store is fixed). No caller-supplied window: resume is always from the persisted frontier.
  const unblock = searchParams.get('unblock') === 'true'

  const { status, body } = await runWooCommerceBackfill(clientId, { days, unblock })
  return NextResponse.json(body, { status })
}
