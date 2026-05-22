import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ profiledClientIds: [] })

  const { data, error } = await supabaseAdmin
    .from('client_context')
    .select('client_id, business_type, primary_kpi, funnel_notes, user_notes')
    .eq('user_email', email)

  if (error) {
    console.error('[profiles] query failed:', error)
    return NextResponse.json({ profiledClientIds: [] })
  }

  // A client "has a profile" if ANY field is non-empty
  const ids = (data || [])
    .filter(r =>
      (r.business_type && r.business_type.trim()) ||
      (r.primary_kpi && r.primary_kpi.trim()) ||
      (r.funnel_notes && r.funnel_notes.trim()) ||
      (r.user_notes && r.user_notes.trim())
    )
    .map(r => r.client_id)

  return NextResponse.json({ profiledClientIds: ids })
}
