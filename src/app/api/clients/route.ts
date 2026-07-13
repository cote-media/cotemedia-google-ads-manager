import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { ensureOrgForOwner } from '@/lib/access/ensure-org' // LORAMER_RBAC_ORG_PROVISION_V1 — every new client gets an org_id
import { resolveAccess } from '@/lib/access/can-access' // LORAMER_DELETE_CLIENT_V1 — owner-only archive gate
import { kickoffBackfill, kickoffGapBackfill } from '@/lib/backfill/kickoff' // LORAMER_DELETE_CLIENT_V1 slice 2 — drain resume (path A) + full-window gap-fill on restore

export async function GET() {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('clients')
    .select('*, platform_connections(*)')
    .eq('user_email', session.user.email)
    .is('deleted_at', null) // LORAMER_DELETE_CLIENT_V1 — hide archived clients (rows persist)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ clients: data })
}

// LORAMER_DELETE_CLIENT_V1 slice 1 — ARCHIVE (soft-delete) one client. OWNER-ONLY. Deletes NO rows: sets
// clients.deleted_at only; all children + metrics_daily/sync_state persist untouched (store-forever). Idempotent.
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // OWNER-ONLY: resolveAccess must return role 'owner' (rejects admin/member/editor/viewer). resolveAccess denies an
  // already-archived client, so the idempotent no-op is handled explicitly below.
  const access = await resolveAccess(id, email)
  if (access?.role === 'owner') {
    // Set the marker ONCE (preserve the original archive time on any repeat). owner-scoped write; deletes nothing.
    const { error } = await supabase
      .from('clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id).eq('user_email', email).is('deleted_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ archived: id })
  }

  // Idempotent: an already-archived client still owned by the caller → no-op success (resolveAccess denied it above).
  const { data: already } = await supabase
    .from('clients').select('id').eq('id', id).eq('user_email', email).not('deleted_at', 'is', null).maybeSingle()
  if (already) return NextResponse.json({ archived: id, alreadyArchived: true })

  return NextResponse.json({ error: 'Client not found or not owner' }, { status: 404 })
}

// LORAMER_DELETE_CLIENT_V1 slice 2 — RESTORE (un-archive). OWNER-ONLY. Clears clients.deleted_at only — creates &
// deletes NOTHING. Idempotent. NOTE: resolveAccess DENIES an archived client by slice-1 design, so restore CANNOT
// use it (it would deny the very client being restored); it gates DIRECTLY on ownership (user_email === caller ⇒
// owner; rejects members/editors/viewers) and intentionally looks up the archived row (no deleted_at filter).
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: owned } = await supabase
    .from('clients').select('id, deleted_at').eq('id', id).eq('user_email', email).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found or not owner' }, { status: 404 })
  const archivedAt = (owned as any).deleted_at as string | null
  if (!archivedAt) return NextResponse.json({ restored: id, alreadyActive: true }) // idempotent no-op

  const { error } = await supabase.from('clients').update({ deleted_at: null }).eq('id', id).eq('user_email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // BACKFILL-THE-GAP over the FULL archived window [archivedAt, today], NOT a 35-day interior slice:
  //  (1) kickoffBackfill (path A → drain) per platform resumes any not-yet-floored deep-history backfill.
  //  (2) kickoffGapBackfill fires the catchup cron in RESTORE mode (?clientId&since=archivedAt) → drives the shared
  //      per-day builders across [archivedAt, today] for every platform, each floor-clamped by known_floors, on the
  //      SAME metered __catchup_ lane + Google quota guard. Within-floor gap days are refetched + persisted; days
  //      below a platform floor are never fetched (documented gap, never a false zero). The 35-day catchup window
  //      does NOT bound restore recovery — the retention floor does.
  const { data: conns } = await supabase.from('platform_connections').select('platform').eq('client_id', id)
  const platforms = Array.from(new Set((conns || []).map((c: any) => c.platform).filter(Boolean))) as string[]
  const origin = new URL(request.url).origin
  for (const p of platforms) kickoffBackfill(origin, id, p)
  kickoffGapBackfill(origin, id, archivedAt.slice(0, 10)) // full [archivedAt, today] gap-fill, all platforms
  return NextResponse.json({ restored: id, kicked: platforms, gapBackfillSince: archivedAt.slice(0, 10) })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await request.json()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  // LORAMER_ORG_TYPE_PERSIST_V1 — resolve the creator's org_type from the recorded two-door choice
  // (user_profiles.account_type). business -> 'solo' is mapped HERE (the ONLY translation point), so the
  // organizations.org_type CHECK ('solo','agency') is never fed 'business'. Forced-choice design: a null
  // account_type is an ERROR state (onboarding incomplete / gate bypassed), NEVER a silent default.
  const { data: prof } = await supabase
    .from('user_profiles')
    .select('account_type')
    .eq('user_email', session.user.email)
    .maybeSingle()
  const acct = prof?.account_type
  if (acct !== 'agency' && acct !== 'business') {
    return NextResponse.json({ error: 'account type not set — complete onboarding (choose Agency or Business) first' }, { status: 409 })
  }
  const defaultType: 'agency' | 'solo' = acct === 'business' ? 'solo' : 'agency'

  // LORAMER_RBAC_ORG_PROVISION_V1 — resolve-or-create the creator's org so the client is born WITH an org_id
  // (the precondition for the NOT-NULL lock). defaultType only sets org_type on a NET-NEW org; a reused org keeps its type.
  let orgId: string
  try {
    orgId = await ensureOrgForOwner(session.user.email, { defaultType })
  } catch (e: any) {
    console.error('[clients POST] org provisioning failed:', e?.message || e)
    return NextResponse.json({ error: 'could not resolve your organization' }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({ name, user_email: session.user.email, org_id: orgId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ client: data })
}
