// LORAMER_RBAC_INVITE_V1 — org revoke writer. Caller must be owner/admin of their org. Deletes a member's
// org_client_grants + org_members within the CALLER's org only. The org OWNER can never be revoked. Fails closed.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveCallerOrgAdmin, normEmail } from '@/lib/access/org-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const caller = await resolveCallerOrgAdmin(email)
  if (!caller) return NextResponse.json({ error: 'You do not administer an organization' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const memberEmail = normEmail(body?.member_email)
  if (!memberEmail) return NextResponse.json({ error: 'member_email required' }, { status: 400 })

  // The org owner can never be revoked (by owner_email OR an org 'owner'-role row).
  if (memberEmail === normEmail(caller.ownerEmail)) return NextResponse.json({ error: 'the org owner cannot be revoked' }, { status: 400 })
  const { data: target } = await supabaseAdmin
    .from('org_members').select('role').eq('org_id', caller.orgId).eq('member_email', memberEmail).maybeSingle()
  if (target?.role === 'owner') return NextResponse.json({ error: 'the org owner cannot be revoked' }, { status: 400 })

  // Scoped to caller.orgId — a caller can only revoke within their own org.
  await supabaseAdmin.from('org_client_grants').delete().eq('org_id', caller.orgId).eq('member_email', memberEmail)
  const { error } = await supabaseAdmin.from('org_members').delete().eq('org_id', caller.orgId).eq('member_email', memberEmail)
  if (error) return NextResponse.json({ error: 'failed to revoke', detail: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, revoked: memberEmail })
}
