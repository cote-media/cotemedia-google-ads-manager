// LORAMER_SHOPIFY_ORDER_GRAIN_WRITER_V1 — the order-grain cron leg.
//
// TWO JOBS, both bounded to the store_* tables. metrics_daily is never touched from this route.
//   DRAIN (default, and what the cron fires) — every bulk op still in flight, or COMPLETED but never ingested,
//     is polled and ingested. This is the FALLBACK for a bulk_operations/finish webhook that never arrived; a
//     webhook is a delivery, not a guarantee, and a capture layer that depends on one has a silent hole in it.
//   SUBMIT (explicit, operator-driven) — start a bulk op for ONE client over ONE bounded window. Deliberately
//     NOT automatic: the backfill that decides which windows to walk is its own flight.
//
// Kept OUT of /api/cron/sync on purpose. That route is the money path; a defect here must not be able to reach
// it, and a separate route means the blast radius is the route boundary rather than a try/catch.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { drainInFlightBulkOps, submitOrdersBulkOp } from '@/lib/order-grain/shopify-bulk'

export const maxDuration = 800

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || gotToken !== envSecret) {
    console.error(`[cron/order-grain] auth failed — envSecretSet: ${Boolean(process.env.CRON_SECRET)}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const mode = params.get('mode') ?? 'drain'

  try {
    if (mode === 'submit') {
      const clientId = params.get('client') ?? ''
      const startDate = params.get('start') ?? ''
      const endDate = params.get('end') ?? ''
      if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return NextResponse.json({ error: 'submit needs client=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD' }, { status: 400 })
      }
      const { data: conns, error } = await supabaseAdmin
        .from('platform_connections')
        .select('account_id, user_email, client_id')
        .eq('platform', 'shopify').eq('client_id', clientId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!conns?.length) return NextResponse.json({ error: 'no shopify connection for that client' }, { status: 404 })

      const results = []
      for (const c of conns) {
        results.push({
          accountId: c.account_id,
          ...(await submitOrdersBulkOp({
            clientId, accountId: c.account_id, userEmail: c.user_email, startDate, endDate,
          })),
        })
      }
      return NextResponse.json({ mode, clientId, window: `${startDate} → ${endDate}`, results })
    }

    const drained = await drainInFlightBulkOps(Number(params.get('limit') ?? 10))
    return NextResponse.json({ mode: 'drain', count: drained.length, drained })
  } catch (e: any) {
    console.error('[cron/order-grain] failed:', e?.message ?? e)
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
