// LORAMER_BACKFILL_STATUS_GET_V1
// Phase 1: session-authed read of backfill progress (sync_state) for a client,
// for the /clients Connections UI. Same ownership gate as /api/backfill/run.
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
    platforms[r.platform] = {
      earliestDate: r.backfill_earliest_date ?? null,
      targetDate: r.backfill_target_date ?? null,
      complete: !!r.backfill_complete,
      updatedAt: r.updated_at ?? null,
    }
  }

  return NextResponse.json({ clientId, backfillable, platforms })
}
