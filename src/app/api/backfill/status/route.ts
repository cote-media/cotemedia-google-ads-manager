// LORAMER_BACKFILL_STATUS_GET_V2
// Phase 1: session-authed read of backfill progress for a client, for the
// /clients Connections UI. Same ownership gate as /api/backfill/run.
// V2 (honest depth): earliestDate now reports the ACTUAL earliest row held in
// metrics_daily for the platform, not the date the backfill cursor swept to.
// Read-only.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { backfillAdapters } from '@/lib/backfill/adapters'

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const email = session.user.email

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }

  // Ownership gate: the client must belong to the signed-in user.
  const { data: owned, error: ownErr } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_email', email)
    .maybeSingle()
  if (ownErr || !owned) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const backfillable = Object.keys(backfillAdapters)

  const { data: rows, error: stateErr } = await supabaseAdmin
    .from('sync_state')
    .select('platform, backfill_earliest_date, backfill_target_date, backfill_complete, updated_at')
    .eq('client_id', clientId)
  if (stateErr) {
    return NextResponse.json(
      { error: 'sync_state read failed', detail: stateErr.message },
      { status: 500 }
    )
  }

  const platforms: Record<string, any> = {}
  for (const r of rows || []) {
    if (!backfillable.includes(r.platform)) continue

    // Honest depth: the actual earliest account-level row we hold for this
    // platform, regardless of how far the cursor swept (empty older chunks
    // don't create rows, so this is the true start of captured history).
    let actualEarliest: string | null = null
    const { data: minRow } = await supabaseAdmin
      .from('metrics_daily')
      .select('date')
      .eq('client_id', clientId)
      .eq('platform', r.platform)
      .eq('entity_level', 'account')
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle()
    actualEarliest = (minRow && minRow.date) || null

    platforms[r.platform] = {
      earliestDate: actualEarliest,
      sweptTo: r.backfill_earliest_date ?? null,
      targetDate: r.backfill_target_date ?? null,
      complete: !!r.backfill_complete,
      updatedAt: r.updated_at ?? null,
    }
  }

  // LORAMER_SHOPIFY_DEEP_BACKFILL_V1 — Shopify deep backfill status. The cursor lives under the synthetic
  // sync_state platform='shopify_deep'; data rows are platform='shopify'. earliestDate = the actual earliest
  // metrics_daily shopify ACCOUNT row (honest depth, same as the adapter platforms above). Emitted only when
  // the client has shopify data or a deep cursor (so non-Shopify clients get no phantom entry).
  const { data: shopState } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_target_date, backfill_complete, updated_at')
    .eq('client_id', clientId)
    .eq('platform', 'shopify_deep')
    .maybeSingle()
  const { data: shopMin } = await supabaseAdmin
    .from('metrics_daily')
    .select('date')
    .eq('client_id', clientId)
    .eq('platform', 'shopify')
    .eq('entity_level', 'account')
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (shopState || shopMin) {
    platforms['shopify'] = {
      earliestDate: (shopMin && shopMin.date) || null,
      sweptTo: shopState?.backfill_earliest_date ?? null,
      targetDate: shopState?.backfill_target_date ?? null,
      complete: !!shopState?.backfill_complete,
      updatedAt: shopState?.updated_at ?? null,
    }
  }

  return NextResponse.json({ clientId, backfillable, platforms })
}
