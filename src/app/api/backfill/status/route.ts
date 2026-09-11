// LORAMER_BACKFILL_STATUS_GET_V2
// Phase 1: session-authed read of backfill progress for a client, for the
// /clients Connections UI. Same ownership gate as /api/backfill/run.
// V2 (honest depth): earliestDate now reports the ACTUAL earliest row held in
// metrics_daily for the platform, not the date the backfill cursor swept to.
// Read-only.
//
// LORAMER_ONE_CLICK_WALK_V1 (1/2) — GOOGLE ANSWERS FROM THE WALK'S FLOOR, NEVER FROM A JUNE-ENGINE CURSOR.
// Measured 2026-09-10 (round 14): Escential read "Complete back to 2026-02-23" from a sync_state cursor swept to 2015 —
// a completion claim over ground nobody walked (the ★check-completion-claims class). For google the line is now the
// walk's own three answers (googleWalkStatus below): inception UNKNOWN → 'not-started' · every catalogue surface
// floor-sealed → 'complete' back to the account floor · otherwise 'partial' back to the walk's earliest window.
// Other platforms are unchanged (sync_state cursor + earliest account row).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { backfillAdapters } from '@/lib/backfill/adapters'
import { readWalkStopAccountFacts } from '@/lib/backfill/google-ads-universe-writer'

export type GoogleWalkState = 'not-started' | 'complete' | 'partial'

/**
 * THE WALK'S ANSWER FOR ONE CLIENT. Reads the same facts the resumer composes its stop from (readWalkStopAccountFacts,
 * discover: null — this route never fetches), the same seals the resumer excludes on (universe_attempt_log
 * attempt_finished/floor_stop on lane 'descend', newest per surface), and the catalogue size the latest completed fire
 * recorded (universe_fire_log.catalog_size — no artifact read on this route, so no tracing entry is needed).
 *   not-started — no universe_account_inception row (UNKNOWN never defaults; the worker's first message discovers it)
 *   complete    — sealed surfaces ≥ the catalogue size the last fire saw; earliestDate = the account floor
 *                 (min(inception, earliest held day) — the stop the seals were written at)
 *   partial     — anything else; earliestDate = the walk's earliest descend window start (real surfaces only)
 */
async function googleWalkStatus(clientId: string): Promise<{ state: GoogleWalkState; earliestDate: string | null; complete: boolean; sealed: number; catalogSize: number | null; inception: string | null }> {
  const facts = await readWalkStopAccountFacts({ clientId, vendor: 'google', discover: null })
  if (!facts.inceptionDate) return { state: 'not-started', earliestDate: null, complete: false, sealed: 0, catalogSize: null, inception: null }

  const { data: sealRows } = await supabaseAdmin.from('universe_attempt_log')
    .select('resource, segment')
    .eq('client_id', clientId).eq('vendor', 'google')
    .eq('phase', 'attempt_finished').eq('outcome', 'floor_stop').eq('lane', 'descend')
    .limit(5000)
  const sealed = new Set((sealRows ?? []).map((r: any) => `${r.resource}|${r.segment ?? ''}`)).size

  const { data: fire } = await supabaseAdmin.from('universe_fire_log')
    .select('catalog_size')
    .eq('client_id', clientId).eq('fire_outcome', 'completed')
    .order('fired_at', { ascending: false }).limit(1).maybeSingle()
  const catalogSize = fire?.catalog_size != null ? Number(fire.catalog_size) : null

  if (catalogSize !== null && catalogSize > 0 && sealed >= catalogSize) {
    const floor = facts.earliestHeldDate && facts.earliestHeldDate < facts.inceptionDate ? facts.earliestHeldDate : facts.inceptionDate
    return { state: 'complete', earliestDate: floor, complete: true, sealed, catalogSize, inception: facts.inceptionDate }
  }

  const { data: earliest } = await supabaseAdmin.from('universe_attempt_log')
    .select('window_start')
    .eq('client_id', clientId).eq('vendor', 'google').eq('lane', 'descend')
    .neq('resource', '__account_inception').gt('window_start', '2000-01-01')
    .order('window_start', { ascending: true }).limit(1).maybeSingle()
  return { state: 'partial', earliestDate: earliest?.window_start ? String(earliest.window_start) : null, complete: false, sealed, catalogSize, inception: facts.inceptionDate }
}

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
    if (r.platform === 'google') continue // LORAMER_ONE_CLICK_WALK_V1 — google is the walk's answer (below), never the cursor's

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

  // LORAMER_ONE_CLICK_WALK_V1 — google: present whenever the client holds a google connection.
  const { data: gconn } = await supabaseAdmin
    .from('platform_connections').select('id').eq('client_id', clientId).eq('platform', 'google').limit(1).maybeSingle()
  if (gconn) platforms['google'] = await googleWalkStatus(clientId)

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
