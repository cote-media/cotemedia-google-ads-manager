// LORAMER_NEXT_FULL_BACKFILL_AFFORDANCE_V1 — owner-gated manual "Backfill history" trigger for -next.
// ⛔ LORAMER_ONE_CLICK_RUN_V1 (flight 2, 2026-09-18): ONE BUTTON PER PLATFORM (`?platform=`, MAP §7). google → the continuous run,
// started ONCE (client-run-start.ts: a live run is returned unchanged, floor-done + complete is the meter, an ended run
// restarts by a conditional update) after a preflight on the CONNECTION's email; the one-turn resumer kick (kickoffWalk)
// is retired. Every other platform → exactly the kicks below, byte-identical (their drains are live; Google's is allocation-0).
// THIN WRAPPER over the existing self-serve spine — ZERO new backfill logic (+ LORAMER_ONE_CLICK_WALK_V1 (2/2 A): the
// walk's first touch for google rides the same click, step (3) below — a kick, like (1) and (2)):
//   (1) kickoffBackfill per connected platform → the deep-history DRAIN (all registry grains, deepest-first, to the
//       retention floor). Rides the SAME /api/cron/drain the cron rides, so every guard is inherited intact:
//       readGoogleQuotaPause (global Google dev-token pause), the __drain_<platform> 360s claim/lease (= server-side
//       debounce; repeat kicks no-op against an active claim), GA per-property cap, runPool memory cap.
//   (2) kickoffGapBackfill once → the catchup in RESTORE mode over a recent window, to repair interior holes the
//       forward/catchup crons may have left (floor-clamped per platform, same Google quota guard).
// CRON_SECRET NEVER leaves the server (the kickoff* helpers hold it). NO restore/connect side-effects: does NOT touch
// clients.deleted_at and creates NO platform_connections rows. Mirrors the restore kickoff block minus the un-archive.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { kickoffBackfill, kickoffGapBackfill } from '@/lib/backfill/kickoff'
// LORAMER_ONE_CLICK_RUN_V1 — the google press starts the CONTINUOUS RUN once (DB-conditional), never a one-turn kick.
import { startClientRun, preflightGoogle } from '@/lib/backfill/client-run-start'
import { googleWalkStatus, RUN_VENDOR } from '@/lib/backfill/google-walk-status'
import { resolveDateWindow, addDaysIso } from '@/lib/date-range'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Interior-gap repair window: re-drive the last ~90 days day-by-day (floor-clamped per platform in the catchup) to
// fill holes in already-swept recent history. Deep history older than this is covered by the drain (1). One
// kickoffGapBackfill fire covers this in full (well under the catchup RESTORE_DAY_CAP of 400).
const GAP_REPAIR_DAYS = 90

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // LORAMER_ONE_CLICK_RUN_V1 — one button per platform: the press names its platform.
  const platform = url.searchParams.get('platform')
  if (!platform) return NextResponse.json({ error: 'platform required' }, { status: 400 })

  // OWNER-ONLY gate (mirror restore + status): the client must be OWNED by the caller (user_email === caller).
  // Rejects members/editors/viewers. Active clients only (an archived client uses restore, not this).
  // (Widening to org admins is a product fork for Russ — DECISIONS LORAMER_ONE_CLICK_RUN_V1.)
  const { data: owned } = await supabaseAdmin
    .from('clients').select('id, user_email').eq('id', id).eq('user_email', email).is('deleted_at', null).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found or not owner' }, { status: 404 })

  // The pressed platform must be connected (NO connection created/changed).
  const { data: conns } = await supabaseAdmin
    .from('platform_connections').select('platform').eq('client_id', id).eq('platform', platform)
  if (!conns || conns.length === 0) return NextResponse.json({ error: `${platform} is not connected on this client` }, { status: 409 })

  const origin = url.origin
  const since = addDaysIso(resolveDateWindow('YESTERDAY').startDate, -(GAP_REPAIR_DAYS - 1))

  // (1) deep-history drain for THIS platform (Google's lane is allocation-0 by decision — LORAMER_WALK_TAKES_THE_LANE_V1 —
  //     and declines cleanly; the four other platforms' drains are live). (2) interior-gap repair over [since, today].
  //     ⛔ Kept byte-for-byte for every platform — ruling (n): the legacy family remains the one writer of the 52 legacy
  //     keys; the walk owns the catalogue spelling; disjoint surfaces, no row written twice.
  kickoffBackfill(origin, id, platform)
  kickoffGapBackfill(origin, id, since)

  if (platform !== 'google') {
    return NextResponse.json({ platform, kicked: [platform], gapRepairSince: since })
  }

  // (3) GOOGLE → THE CONTINUOUS RUN, ONCE. Preflight on the CONNECTION's email (the fire runs on
  //     `conn.user_email || client.user_email`, never the presser's session), then the DB-conditional start.
  const pre = await preflightGoogle({ clientId: id, ownerEmail: owned.user_email as string })
  if (!pre.ok) return NextResponse.json({ platform, error: pre.reason, kicked: [platform], gapRepairSince: since }, { status: 409 })
  const readout = await googleWalkStatus(id)
  const started = await startClientRun({ clientId: id, vendor: RUN_VENDOR, readout: readout.state })
  return NextResponse.json({
    platform, kicked: [platform], gapRepairSince: since,
    action: started.action, run: started.run, note: started.note, readout: readout.state,
    pumpedBy: started.action === 'insert' || started.action === 'restart' ? '/api/cron/universe-run-pump (next minute)' : null,
  })
}
