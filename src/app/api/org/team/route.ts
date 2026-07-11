// LORAMER_RBAC_INVITE_V1 — org team read. Owner/admin only. Returns the caller's org type, its members with each
// member's grant summary (all_clients or the specific client names), and the org's clients (id+name) so the agency
// invite UI can render the per-client checklist without a second call. Scoped to caller.orgId. Fails closed.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveCallerOrgAdmin, normEmail } from '@/lib/access/org-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const caller = await resolveCallerOrgAdmin(email)
  if (!caller) return NextResponse.json({ error: 'You do not administer an organization' }, { status: 403 })

  const [membersRes, grantsRes, clientsRes] = await Promise.all([
    supabaseAdmin.from('org_members').select('member_email, role, invited_by, created_at').eq('org_id', caller.orgId).order('created_at', { ascending: true }),
    supabaseAdmin.from('org_client_grants').select('member_email, client_id, all_clients').eq('org_id', caller.orgId),
    supabaseAdmin.from('clients').select('id, name').eq('org_id', caller.orgId).order('name', { ascending: true }),
  ])

  const clients = (clientsRes.data || []) as { id: string; name: string }[]
  const nameById = new Map(clients.map((c) => [c.id, c.name]))
  const grantsByMember = new Map<string, { all_clients: boolean; client_ids: string[]; client_names: string[] }>()
  for (const g of grantsRes.data || []) {
    const k = (g as any).member_email as string
    const cur = grantsByMember.get(k) || { all_clients: false, client_ids: [], client_names: [] }
    if ((g as any).all_clients === true) cur.all_clients = true
    else if ((g as any).client_id) { cur.client_ids.push((g as any).client_id); cur.client_names.push(nameById.get((g as any).client_id) || (g as any).client_id) }
    grantsByMember.set(k, cur)
  }

  const members = (membersRes.data || []).map((m: any) => {
    const isOwner = normEmail(m.member_email) === normEmail(caller.ownerEmail)
    return {
      member_email: m.member_email,
      role: m.role,
      invited_by: m.invited_by,
      created_at: m.created_at,
      is_owner: isOwner,
      // the owner has no grant rows — they see everything by the resolveAccess owner path.
      access: grantsByMember.get(m.member_email) || { all_clients: isOwner, client_ids: [], client_names: [] },
    }
  })

  return NextResponse.json({ orgType: caller.orgType, ownerEmail: caller.ownerEmail, callerRole: caller.role, clients, members })
}
