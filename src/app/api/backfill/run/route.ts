// LORAMER_BACKFILL_RUN_POST_V1
// Phase 1: session-authed, in-app backfill trigger. ONE platform per lap.
// Verifies the NextAuth session AND enforces client ownership
// (clients.user_email === session email) — the CRON GET wrappers do NOT check
// ownership (CRON_SECRET only), so this browser path must. Delegates the work
// to the shared engine in src/lib/backfill/*.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { runBackfill } from '@/lib/backfill/run-backfill'
import { backfillAdapters } from '@/lib/backfill/adapters'
import { runGoogleDimensionalBackfill } from '@/lib/backfill/google-dimensional-backfill' // LORAMER_SEARCH_TERMS_BACKFILL_V1

export const maxDuration = 60

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const email = session.user.email

  let payload: any
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const clientId = payload?.clientId
  const platform = payload?.platform
  if (!clientId || !platform) {
    return NextResponse.json(
      { error: 'Missing clientId or platform' },
      { status: 400 }
    )
  }

  // LORAMER_SEARCH_TERMS_BACKFILL_V1 — dimensional (search-term/keyword) backfill rides a SEPARATE
  // lib, not the V2 account engine. Ownership-gated like the account path; cursor lives under the
  // synthetic sync_state platform='google_dimensional'.
  if (platform === 'google_dimensional') {
    const { data: owned, error: ownErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('user_email', email)
      .maybeSingle()
    if (ownErr || !owned) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }
    const daysRaw = payload?.days
    const days = typeof daysRaw === 'number' ? Math.max(1, Math.min(400, Math.floor(daysRaw))) : 90
    const { status, body } = await runGoogleDimensionalBackfill(clientId, { days })
    return NextResponse.json(body, { status })
  }

  const adapter = backfillAdapters[platform]
  if (!adapter) {
    return NextResponse.json({
      clientId,
      platform,
      skipped: true,
      note: 'Backfill not available for this platform yet',
    })
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

  const { status, body } = await runBackfill(clientId, adapter)
  return NextResponse.json(body, { status })
}
