// LORAMER_NEXT_DATAWIRE_PORTFOLIO_V1 — -next read route (membership-aware client list for the redesign
// portfolio + client switcher). listAccessibleClients = clients owned ∪ clients shared via client_members;
// with client_members empty this is owner-only (zero behavior diff today). NEW /api/next/* namespace — the
// frozen /api/clients route is left byte-identical. Read-only.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { listAccessibleClients } from '@/lib/access/can-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ids = await listAccessibleClients(email)
  if (!ids.length) return NextResponse.json({ clients: [] })

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, created_at')
    .in('id', ids)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ clients: data || [] })
}
