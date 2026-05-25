// LORAMER_CONV_API_V1
// /api/conversations
//
// GET  ?clientId=X&surface=Y&scope=Z&limit=N
//   Returns messages for a specific surface+scope, oldest first.
//   Defaults: limit=50, no scope filter unless provided.
//
// POST { clientId, surface, scope, role, content }
//   Appends a single message. Server stamps user_email from session and created_at.
//
// DELETE ?clientId=X&surface=Y&scope=Z
//   Deletes all messages for that client+surface+scope. Used by Clear button.
//   surface required. scope optional (if omitted, clears all scopes for the surface).
//
// Auth: requires session. All reads/writes scoped to session.user.email.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const surface = searchParams.get('surface')
  const scope = searchParams.get('scope')
  const limitParam = searchParams.get('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 500) : 50

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('client_conversations')
    .select('id, surface, scope, role, content, created_at')
    .eq('client_id', clientId)
    .eq('user_email', session.user.email)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (surface) query = query.eq('surface', surface)
  if (scope) query = query.eq('scope', scope)

  const { data, error } = await query

  if (error) {
    console.error('[conversations] GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ messages: data || [] })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { clientId, surface, scope, role, content } = body

  if (!clientId || !surface || !role || !content) {
    return NextResponse.json(
      { error: 'clientId, surface, role, content required' },
      { status: 400 }
    )
  }

  if (role !== 'user' && role !== 'assistant') {
    return NextResponse.json({ error: "role must be 'user' or 'assistant'" }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('client_conversations')
    .insert({
      client_id: clientId,
      user_email: session.user.email,
      surface,
      scope: scope || null,
      role,
      content,
    })
    .select('id, surface, scope, role, content, created_at')
    .single()

  if (error) {
    console.error('[conversations] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message: data })
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const surface = searchParams.get('surface')
  const scope = searchParams.get('scope')

  if (!clientId || !surface) {
    return NextResponse.json({ error: 'clientId and surface required' }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('client_conversations')
    .delete()
    .eq('client_id', clientId)
    .eq('user_email', session.user.email)
    .eq('surface', surface)

  if (scope) query = query.eq('scope', scope)

  const { error } = await query

  if (error) {
    console.error('[conversations] DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
