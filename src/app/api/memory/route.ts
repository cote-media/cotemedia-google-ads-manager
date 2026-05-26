// LORAMER_MEMORY_V1
// /api/memory
//
// Structured facts Claude knows about a client. Read by /api/intelligence
// and injected into the system prompt by build-claude-context.ts.
//
// GET    ?clientId=X&includeArchived=true&category=fact
//   Lists facts. Defaults: active only (archived_at IS NULL), all categories,
//   ordered pinned DESC, confidence DESC, created_at DESC.
//
// POST   { clientId, content, category, confidence?, source?, pinned?,
//          sourceConversationId? }
//   Creates a fact. Defaults: confidence=1.0, source='user_explicit',
//   pinned=false. Category must be one of:
//   'directive' | 'fact' | 'observation' | 'preference' | 'context'.
//
// PATCH  { id, content?, category?, confidence?, pinned?, archived? }
//   Edits a fact. Setting archived=true sets archived_at=NOW() (soft delete);
//   archived=false restores it (clears archived_at).
//
// DELETE ?id=X
//   SOFT DELETE — sets archived_at=NOW(). Memory rows are never hard-deleted,
//   matching the brand promise: "deep knowledge accumulates."
//
// Auth: requires session. All operations scoped to session.user.email.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const VALID_CATEGORIES = new Set([
  'directive',
  'fact',
  'observation',
  'preference',
  'context',
])

const VALID_SOURCES = new Set([
  'user_explicit',
  'user_conversation',
  'claude_extracted',
  'claude_observed',
  'bootstrap_legacy',
])

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const category = searchParams.get('category')
  const includeArchived = searchParams.get('includeArchived') === 'true'

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('client_memory')
    .select('id, content, category, confidence, source, source_conversation_id, pinned, created_at, updated_at, archived_at, last_referenced_at')
    .eq('client_id', clientId)
    .eq('user_email', session.user.email)
    .order('pinned', { ascending: false })
    .order('confidence', { ascending: false })
    .order('created_at', { ascending: false })

  if (category) query = query.eq('category', category)
  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query

  if (error) {
    console.error('[memory] GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ memory: data || [] })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const {
    clientId,
    content,
    category,
    confidence,
    source,
    pinned,
    sourceConversationId,
  } = body

  if (!clientId || !content || !category) {
    return NextResponse.json(
      { error: 'clientId, content, category required' },
      { status: 400 }
    )
  }

  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${Array.from(VALID_CATEGORIES).join(', ')}` },
      { status: 400 }
    )
  }

  const finalSource = source || 'user_explicit'
  if (!VALID_SOURCES.has(finalSource)) {
    return NextResponse.json(
      { error: `source must be one of: ${Array.from(VALID_SOURCES).join(', ')}` },
      { status: 400 }
    )
  }

  const finalConfidence = typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : 1.0

  const { data, error } = await supabaseAdmin
    .from('client_memory')
    .insert({
      client_id: clientId,
      user_email: session.user.email,
      content: String(content).trim(),
      category,
      confidence: finalConfidence,
      source: finalSource,
      source_conversation_id: sourceConversationId || null,
      pinned: !!pinned,
    })
    .select('id, content, category, confidence, source, source_conversation_id, pinned, created_at, updated_at, archived_at')
    .single()

  if (error) {
    console.error('[memory] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ memory: data })
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { id, content, category, confidence, pinned, archived } = body

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const update: Record<string, any> = {}
  if (typeof content === 'string') update.content = content.trim()
  if (typeof category === 'string') {
    if (!VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ error: 'invalid category' }, { status: 400 })
    }
    update.category = category
  }
  if (typeof confidence === 'number') {
    update.confidence = Math.max(0, Math.min(1, confidence))
  }
  if (typeof pinned === 'boolean') update.pinned = pinned
  if (typeof archived === 'boolean') {
    update.archived_at = archived ? new Date().toISOString() : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('client_memory')
    .update(update)
    .eq('id', id)
    .eq('user_email', session.user.email)
    .select('id, content, category, confidence, source, source_conversation_id, pinned, created_at, updated_at, archived_at')
    .single()

  if (error) {
    console.error('[memory] PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ memory: data })
}

export async function DELETE(request: Request) {
  // LORAMER_MEMORY_V1 - SOFT DELETE
  // Sets archived_at = NOW(). Rows stay in the table; UI hides archived facts
  // by default but the intelligence layer / audit views can still see them.
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('client_memory')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_email', session.user.email)
    .is('archived_at', null)

  if (error) {
    console.error('[memory] DELETE (soft) error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
