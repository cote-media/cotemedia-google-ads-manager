// LORAMER_RBAC_INVITE_V1 — resolve the CALLER's org + whether they may ADMINISTER it (owner or org 'admin'). Server-only.
// Fail-closed (null on any error / no org). Every /api/org/* writer route derives the org from HERE and scopes ALL
// writes to caller.orgId — a caller can only ever invite into / grant clients of their OWN org (no cross-org write).
import { supabaseAdmin } from '@/lib/supabase'

export type CallerOrg = { orgId: string; orgType: 'solo' | 'agency'; ownerEmail: string; role: 'owner' | 'admin' } | null
const norm = (e?: string | null): string => (e || '').trim().toLowerCase()

export async function resolveCallerOrgAdmin(email: string): Promise<CallerOrg> {
  try {
    const e = norm(email)
    if (!e) return null
    // 1) Owner of an org (authoritative — organizations.owner_email).
    const { data: owned } = await supabaseAdmin
      .from('organizations').select('id, org_type, owner_email').eq('owner_email', e).maybeSingle()
    if (owned?.id) {
      return { orgId: owned.id as string, orgType: owned.org_type === 'agency' ? 'agency' : 'solo', ownerEmail: owned.owner_email as string, role: 'owner' }
    }
    // 2) Admin (or owner-role) member of an org.
    const { data: mem } = await supabaseAdmin
      .from('org_members').select('org_id, role').eq('member_email', e).in('role', ['owner', 'admin']).maybeSingle()
    if (mem?.org_id) {
      const { data: org } = await supabaseAdmin
        .from('organizations').select('id, org_type, owner_email').eq('id', mem.org_id).maybeSingle()
      if (org?.id) {
        return { orgId: org.id as string, orgType: org.org_type === 'agency' ? 'agency' : 'solo', ownerEmail: org.owner_email as string, role: mem.role === 'owner' ? 'owner' : 'admin' }
      }
    }
    return null
  } catch (e) {
    console.error('[org-admin] resolveCallerOrgAdmin failed, denying:', e)
    return null
  }
}

export const normEmail = norm
