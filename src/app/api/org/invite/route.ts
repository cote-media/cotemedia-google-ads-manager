// LORAMER_RBAC_INVITE_V1 — org invite writer. Caller must be owner/admin of THEIR org (resolveCallerOrgAdmin). Writes
// org_members (upsert on org_id+member_email) + org_client_grants (ONE all_clients row OR one row per client_id).
// Idempotent (re-invite replaces the member's grants). CROSS-ORG WRITE BLOCKED: every client_id must belong to the
// caller's org or the whole request is rejected with NO write. Scopes every write to caller.orgId. Fails closed.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveCallerOrgAdmin, normEmail } from '@/lib/access/org-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const caller = await resolveCallerOrgAdmin(email)
  if (!caller) return NextResponse.json({ error: 'You do not administer an organization' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const memberEmail = normEmail(body?.member_email)
  const role = body?.role
  const grants = body?.grants || {}
  const allClients = grants.all_clients === true
  const clientIds: string[] = Array.isArray(grants.client_ids) ? grants.client_ids.filter((x: any) => typeof x === 'string') : []

  // Validate.
  if (!memberEmail || !EMAIL_RE.test(memberEmail)) return NextResponse.json({ error: 'valid member_email required' }, { status: 400 })
  if (role !== 'admin' && role !== 'member') return NextResponse.json({ error: 'role must be admin|member' }, { status: 400 })
  if (memberEmail === normEmail(caller.ownerEmail)) return NextResponse.json({ error: 'the owner already has full access' }, { status: 400 })
  if (!allClients && clientIds.length === 0) return NextResponse.json({ error: 'grant all_clients or at least one client_id' }, { status: 400 })

  // CROSS-ORG GUARD — every specified client_id MUST belong to the caller's org, else reject with NO write.
  if (!allClients && clientIds.length) {
    const { data: orgClients } = await supabaseAdmin.from('clients').select('id').eq('org_id', caller.orgId).in('id', clientIds)
    const valid = new Set((orgClients || []).map((c: any) => c.id as string))
    const invalid = clientIds.filter((id) => !valid.has(id))
    if (invalid.length) return NextResponse.json({ error: 'one or more client_ids are not in your organization', invalid }, { status: 400 })
  }

  // WRITE — membership (upsert) then grants (delete-then-insert = idempotent replace). Scoped to caller.orgId.
  const { error: mErr } = await supabaseAdmin
    .from('org_members')
    .upsert({ org_id: caller.orgId, member_email: memberEmail, role, invited_by: email }, { onConflict: 'org_id,member_email' })
  if (mErr) return NextResponse.json({ error: 'failed to write membership', detail: mErr.message }, { status: 500 })

  // LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — auto-allowlist the invited email so they can sign up via EITHER door
  // (Google or email/password). ON CONFLICT DO NOTHING (ignoreDuplicates) — never clobber an existing seed source.
  await supabaseAdmin
    .from('signup_allowlist')
    .upsert({ email: memberEmail, source: 'rbac_invite' }, { onConflict: 'email', ignoreDuplicates: true })

  await supabaseAdmin.from('org_client_grants').delete().eq('org_id', caller.orgId).eq('member_email', memberEmail)
  const grantRows = allClients
    ? [{ org_id: caller.orgId, member_email: memberEmail, all_clients: true }]
    : clientIds.map((id) => ({ org_id: caller.orgId, member_email: memberEmail, client_id: id, all_clients: false }))
  const { error: gErr } = await supabaseAdmin.from('org_client_grants').insert(grantRows)
  if (gErr) return NextResponse.json({ error: 'failed to write grants', detail: gErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    member: { member_email: memberEmail, role },
    grants: allClients ? { all_clients: true } : { client_ids: clientIds },
  })
}
