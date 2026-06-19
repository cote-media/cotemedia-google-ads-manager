// LORAMER_NEXT_RBAC_FOUNDATION_V1 — server-only access resolution for the -next membership-aware read layer.
// OWNER is implicit = clients.user_email; non-owner grants live in client_members (additive migration 018).
//
// KEYSTONE: resolveAccess ALWAYS returns the client's REAL owner as `ownerEmail`. A share runs on the OWNER's
// identity — downstream token fetches (meta/ga/shopify/google, all owner-keyed) and owner-keyed row reads
// (client_context/memory/conversations/uploaded_docs) MUST key off ownerEmail, never the viewer's email. The
// viewer's email is used ONLY for authz + audit. Fails closed (null) on any error.
//
// Wired NOWHERE yet (Increment 1 slice 1a). Must only be imported by server components / route handlers.
import { supabaseAdmin } from '@/lib/supabase'

export type AccessRole = 'owner' | 'editor' | 'viewer'
export type AccessResult = { ok: true; ownerEmail: string; role: AccessRole } | null

function norm(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase()
}

// Resolve a viewer's access to a single client. Returns the client's real owner email + the viewer's role,
// or null if the client does not exist or the viewer has no access. Owner match is implicit (clients.user_email);
// otherwise a client_members row (editor|viewer) grants access. NEVER returns the viewer as ownerEmail.
export async function resolveAccess(clientId: string, viewerEmail: string): Promise<AccessResult> {
  try {
    const viewer = norm(viewerEmail)
    if (!clientId || !viewer) return null

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('user_email')
      .eq('id', clientId)
      .maybeSingle()
    if (error || !client?.user_email) return null
    const ownerEmail = client.user_email as string

    // Implicit owner.
    if (norm(ownerEmail) === viewer) return { ok: true, ownerEmail, role: 'owner' }

    // Non-owner grant.
    const { data: member, error: mErr } = await supabaseAdmin
      .from('client_members')
      .select('role')
      .eq('client_id', clientId)
      .eq('member_email', viewer)
      .maybeSingle()
    if (mErr || !member) return null
    const role = member.role as AccessRole
    if (role !== 'editor' && role !== 'viewer') return null
    return { ok: true, ownerEmail, role }
  } catch (e) {
    console.error('[can-access] resolveAccess failed, denying:', e)
    return null
  }
}

// Deduped set of client ids the viewer can access = clients they own ∪ clients shared with them. Fails to [].
export async function listAccessibleClients(viewerEmail: string): Promise<string[]> {
  try {
    const viewer = norm(viewerEmail)
    if (!viewer) return []
    const [ownedRes, memberRes] = await Promise.all([
      supabaseAdmin.from('clients').select('id').eq('user_email', viewer),
      supabaseAdmin.from('client_members').select('client_id').eq('member_email', viewer),
    ])
    const ids = new Set<string>()
    for (const r of ownedRes.data || []) if (r?.id) ids.add(r.id as string)
    for (const r of memberRes.data || []) if (r?.client_id) ids.add(r.client_id as string)
    return Array.from(ids)
  } catch (e) {
    console.error('[can-access] listAccessibleClients failed:', e)
    return []
  }
}
