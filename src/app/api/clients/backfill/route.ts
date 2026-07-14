// LORAMER_NEXT_FULL_BACKFILL_AFFORDANCE_V1 — owner-gated manual "Backfill history" trigger for -next.
// THIN WRAPPER over the existing self-serve spine — ZERO new backfill logic:
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

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // OWNER-ONLY gate (mirror restore + status): the client must be OWNED by the caller (user_email === caller).
  // Rejects members/editors/viewers. Active clients only (an archived client uses restore, not this).
  const { data: owned } = await supabaseAdmin
    .from('clients').select('id').eq('id', id).eq('user_email', email).is('deleted_at', null).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found or not owner' }, { status: 404 })

  // Connected platforms for this client (NO connection created/changed).
  const { data: conns } = await supabaseAdmin
    .from('platform_connections').select('platform').eq('client_id', id)
  const platforms = Array.from(new Set((conns || []).map((c: any) => c.platform).filter(Boolean))) as string[]
  if (platforms.length === 0) return NextResponse.json({ kicked: [], note: 'no connected platforms' })

  const origin = new URL(request.url).origin
  const since = addDaysIso(resolveDateWindow('YESTERDAY').startDate, -(GAP_REPAIR_DAYS - 1))

  // (1) deep-history drain to floor, per platform. (2) interior-gap repair over [since, today].
  for (const p of platforms) kickoffBackfill(origin, id, p)
  kickoffGapBackfill(origin, id, since)

  return NextResponse.json({ kicked: platforms, gapRepairSince: since })
}
