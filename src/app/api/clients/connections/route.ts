import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { client_id, platform, account_id, account_name } = await request.json()

  const { data, error } = await supabase
    .from('platform_connections')
    .insert({ client_id, platform, account_id, account_name, user_email: session.user.email })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ connection: data })
}

export async function DELETE(request: Request) {
  // LORAMER_DISCONNECT_FIX_V1
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  let id = url.searchParams.get('id')

  if (!id) {
    try {
      const body = await request.json()
      id = body?.id
    } catch {}
  }

  if (!id) {
    return NextResponse.json({ error: 'connection id required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('platform_connections')
    .delete()
    .eq('id', id)
    .eq('user_email', session.user.email)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, deleted: data.length })
}
