// LORAMER_NEXT_RBAC_FOUNDATION_V1 / LORAMER_RBAC_ACCESS_ORG_V1 — server-only access resolution for the -next
// membership-aware read layer. OWNER is implicit = clients.user_email. NON-owner access resolves in precedence:
//   1. OWNER (clients.user_email === viewer)
//   2. ORG-MEMBER via GRANT (Path B): viewer ∈ org_members for the client's org (clients.org_id) AND has an
//      org_client_grants row for that org that is all_clients=true OR client_id=this client → role = the org role.
//   3. LEGACY per-client client_members (kept as fallback so nothing regresses) → editor|viewer.
//   4. else fail closed (null).
//
// KEYSTONE (unchanged): resolveAccess ALWAYS returns the client's REAL owner as `ownerEmail`. A share runs on the
// OWNER's identity — downstream token fetches (meta/ga/shopify/google, all owner-keyed) and owner-keyed row reads
// (client_context/memory/conversations/uploaded_docs) MUST key off ownerEmail, never the viewer's email. The
// viewer's email is used ONLY for authz + audit. Fails closed (null) on any error. Cross-org isolation: a viewer
// with no owner/grant/legacy path resolves to null — a fixture-org member can NEVER resolve a Cote Media client.
import { supabaseAdmin } from '@/lib/supabase'

export type AccessRole = 'owner' | 'admin' | 'member' | 'editor' | 'viewer'
export type AccessResult = { ok: true; ownerEmail: string; role: AccessRole } | null

function norm(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase()
}

// Resolve a viewer's access to a single client. Returns the client's real owner email + the viewer's role, or null
// if the client does not exist or the viewer has no access. NEVER returns the viewer as ownerEmail.
export async function resolveAccess(clientId: string, viewerEmail: string): Promise<AccessResult> {
  try {
    const viewer = norm(viewerEmail)
    if (!clientId || !viewer) return null

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('user_email, org_id, deleted_at') // LORAMER_RBAC_ACCESS_ORG_V1 org_id; LORAMER_DELETE_CLIENT_V1 deleted_at
      .eq('id', clientId)
      .maybeSingle()
    // LORAMER_DELETE_CLIENT_V1 — an ARCHIVED (soft-deleted) client is denied to EVERY viewer incl. its owner, so no
    // surface (chat/intelligence/context/etc.) can load it. Its rows persist untouched; only access is withdrawn.
    if (error || !client?.user_email || (client as any).deleted_at) return null
    const ownerEmail = client.user_email as string
    const orgId = (client as any).org_id as string | null

    // 1. Implicit owner.
    if (norm(ownerEmail) === viewer) return { ok: true, ownerEmail, role: 'owner' }

    // 2. ORG-MEMBER via grant (Path B). Membership AND a matching grant are BOTH required.
    if (orgId) {
      const { data: mem } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('member_email', viewer)
        .maybeSingle()
      const memRole = mem?.role as AccessRole | undefined
      if (memRole === 'admin' || memRole === 'member' || memRole === 'owner') {
        // A grant for this client: all_clients=true (standing, incl. future) OR a specific client_id row.
        const { data: grants } = await supabaseAdmin
          .from('org_client_grants')
          .select('client_id, all_clients')
          .eq('org_id', orgId)
          .eq('member_email', viewer)
        const granted = (grants || []).some((g: any) => g.all_clients === true || g.client_id === clientId)
        if (granted) return { ok: true, ownerEmail, role: memRole } // ownerEmail STAYS the real owner
      }
    }

    // 3. Legacy per-client grant (client_members) — kept so nothing regresses.
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

// Deduped set of client ids the viewer can access = owned ∪ org-grant (all_clients or specific) ∪ legacy
// client_members. Fails to []. Used by the -next clients list + the page resolvers.
export async function listAccessibleClients(viewerEmail: string): Promise<string[]> {
  try {
    const viewer = norm(viewerEmail)
    if (!viewer) return []
    const ids = new Set<string>()

    const [ownedRes, legacyRes, orgRes] = await Promise.all([
      supabaseAdmin.from('clients').select('id').eq('user_email', viewer),
      supabaseAdmin.from('client_members').select('client_id').eq('member_email', viewer),
      supabaseAdmin.from('org_members').select('org_id').eq('member_email', viewer),
    ])
    for (const r of ownedRes.data || []) if (r?.id) ids.add(r.id as string)
    for (const r of legacyRes.data || []) if (r?.client_id) ids.add(r.client_id as string)

    // ORG grants: for the orgs the viewer belongs to, add specific-granted clients + all_clients-org clients.
    const orgIds = (orgRes.data || []).map((r: any) => r.org_id).filter(Boolean) as string[]
    if (orgIds.length) {
      const { data: grants } = await supabaseAdmin
        .from('org_client_grants')
        .select('org_id, client_id, all_clients')
        .in('org_id', orgIds)
        .eq('member_email', viewer)
      const allClientsOrgs = new Set<string>()
      for (const g of grants || []) {
        if ((g as any).all_clients === true) allClientsOrgs.add((g as any).org_id as string)
        else if ((g as any).client_id) ids.add((g as any).client_id as string)
      }
      if (allClientsOrgs.size) {
        const { data: orgClients } = await supabaseAdmin
          .from('clients')
          .select('id')
          .in('org_id', Array.from(allClientsOrgs))
        for (const c of orgClients || []) if ((c as any)?.id) ids.add((c as any).id as string)
      }
    }
    // LORAMER_DELETE_CLIENT_V1 — final archived sweep: whatever the source (owned / legacy / grant / all_clients),
    // drop any id that is soft-deleted so an archived client vanishes from EVERY list. Rows persist; only listing stops.
    const idArr = Array.from(ids)
    if (idArr.length) {
      const { data: archived } = await supabaseAdmin
        .from('clients').select('id').in('id', idArr).not('deleted_at', 'is', null)
      for (const a of archived || []) ids.delete((a as any).id as string)
    }
    return Array.from(ids)
  } catch (e) {
    console.error('[can-access] listAccessibleClients failed:', e)
    return []
  }
}

// LORAMER_AGENCY_SCOPE_LORA_V1 — the accessible roster WITH names (id + name), for the agency-scope Lora prompt so
// she can resolve a client the user names to its id. Reuses listAccessibleClients (SAME RBAC precedence + archived
// drop), then looks up names for exactly those ids — so it can NEVER widen the set. Fails closed to [].
export async function listAccessibleClientsWithNames(viewerEmail: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const ids = await listAccessibleClients(viewerEmail)
    if (!ids.length) return []
    const { data } = await supabaseAdmin.from('clients').select('id, name').in('id', ids)
    return (data || []).map((c: any) => ({ id: c.id as string, name: (c.name as string) || 'Unnamed client' }))
  } catch (e) {
    console.error('[can-access] listAccessibleClientsWithNames failed:', e)
    return []
  }
}
