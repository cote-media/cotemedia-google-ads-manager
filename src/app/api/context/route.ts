import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

// GET — fetch client context
export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('client_context')
    .select('*')
    .eq('client_id', clientId)
    .eq('user_email', session.user.email)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // LORAMER_NAICS_V1 (additive): coalesce naics_codes null → [] so the client page reads a stable array.
  if (data) (data as any).naics_codes = (data as any).naics_codes || []
  return NextResponse.json({ context: data || null })
}

// POST — save client context (upsert)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { clientId, updates } = body
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // LORAMER_OWNERSHIP_GATE_20260616 (#20) — same proven gate as /api/insight, /api/intelligence, /api/backfill/run.
  const { data: owned } = await supabaseAdmin
    .from('clients').select('id')
    .eq('id', clientId).eq('user_email', session.user.email).is('deleted_at', null) // LORAMER_DELETE_CLIENT_V1 — archived → 404
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // LORAMER_CLIENT_DESCRIPTOR_V1 (additive): business_descriptor / service_area / website ride through the
  // generic `...updates` spread below — no per-field handling needed; GET's select('*') already returns them.
  // Existing fields (business_type / primary_kpi / funnel_notes / user_notes) are unchanged and keep working
  // for the legacy /clients form.
  // LORAMER_NAICS_V1 (additive): persist naics_codes ONLY when the key is present (absent → column untouched,
  // so a partial save never wipes it). Validate shape: array of {code:string,title:string}; drop malformed
  // entries. Never throws when absent.
  const cleanUpdates: Record<string, any> = { ...updates }
  if (updates && Object.prototype.hasOwnProperty.call(updates, 'naics_codes')) {
    const arr = Array.isArray(updates.naics_codes) ? updates.naics_codes : []
    cleanUpdates.naics_codes = arr
      .filter((x: any) => x && typeof x.code === 'string' && typeof x.title === 'string')
      .map((x: any) => ({ code: x.code, title: x.title }))
  }

  const { data, error } = await supabaseAdmin
    .from('client_context')
    .upsert({
      client_id: clientId,
      user_email: session.user.email,
      ...cleanUpdates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,user_email' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ context: data })
}
