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
