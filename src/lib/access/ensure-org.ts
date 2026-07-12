// LORAMER_RBAC_ORG_PROVISION_V1 — resolve-or-CREATE the caller's org so EVERY client-create path can set clients.org_id
// (the precondition for the clients.org_id NOT-NULL lock). Server-only. Idempotent (one org per owner_email), fail-LOUD
// (throws on a real error — never silently returns a bad/absent id, so a create path can't proceed to insert a client
// with no org), and race-TOLERANT (re-select on an insert error; becomes fully race-SAFE once organizations.owner_email
// carries its unique constraint — added alongside the not-null lock migration).
//
// TEMP org_type — the defaultType passed here is a PLACEHOLDER until the two-door homepage (agency vs owner/business
// signup, launch-critical, banked) sets it explicitly at signup; the homepage choice will OVERRIDE this default.
import { supabaseAdmin } from '@/lib/supabase'

const norm = (e: string | null | undefined): string => (e || '').trim().toLowerCase()

async function findOrgId(ownerEmail: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin
    .from('organizations').select('id').eq('owner_email', ownerEmail).limit(1).maybeSingle()
  return (data?.id as string) || undefined
}

export async function ensureOrgForOwner(email: string, opts: { defaultType: 'agency' | 'solo'; name?: string }): Promise<string> {
  const e = norm(email)
  if (!e) throw new Error('[ensure-org] owner email required')

  // 1) Already have an org → reuse it (no duplicate org per owner).
  const existing = await findOrgId(e)
  if (existing) return existing

  // 2) Create the org. deriveName: an explicit name (e.g. a Shopify store name) else the email localpart.
  const name = (opts.name && opts.name.trim()) || e.split('@')[0] || 'My workspace'
  const { data: created, error } = await supabaseAdmin
    .from('organizations')
    .insert({ owner_email: e, name, org_type: opts.defaultType })
    .select('id').single()
  let orgId = (created?.id as string) || undefined
  if (error || !orgId) {
    // Race: a concurrent create may have won → re-select (fully safe once owner_email is unique; best-effort before).
    orgId = await findOrgId(e)
    if (!orgId) throw error || new Error('[ensure-org] failed to create organization')
  }

  // 3) The owner's org membership (idempotent on org_id+member_email). Fail loud — an org without its owner-member row
  //    is a broken state that must not be silently returned.
  const { error: mErr } = await supabaseAdmin
    .from('org_members')
    .upsert({ org_id: orgId, member_email: e, role: 'owner', invited_by: e }, { onConflict: 'org_id,member_email' })
  if (mErr) throw mErr

  return orgId
}
