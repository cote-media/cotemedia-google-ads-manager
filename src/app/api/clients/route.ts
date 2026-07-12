import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { ensureOrgForOwner } from '@/lib/access/ensure-org' // LORAMER_RBAC_ORG_PROVISION_V1 — every new client gets an org_id

export async function GET() {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('clients')
    .select('*, platform_connections(*)')
    .eq('user_email', session.user.email)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ clients: data })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await request.json()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  // LORAMER_RBAC_ORG_PROVISION_V1 — resolve-or-create the creator's org so the client is born WITH an org_id (the
  // precondition for the NOT-NULL lock). defaultType 'agency' is the Add-client placeholder (two-door homepage overrides).
  let orgId: string
  try {
    orgId = await ensureOrgForOwner(session.user.email, { defaultType: 'agency' })
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
