// LORAMER_CONV_API_V1 + LORAMER_CONV_SOFT_DELETE_V1
// /api/conversations
//
// GET  ?clientId=X&surface=Y&scope=Z&limit=N&includeHidden=true
//   Returns messages oldest first. By default hidden rows (Clear-button rows)
//   are filtered out — UI shouldn't see them. The prompt builder passes
//   includeHidden=true to access them for Claude's memory.
//
// POST { clientId, surface, scope, role, content }
//   Appends a single message.
//
// DELETE ?clientId=X&surface=Y&scope=Z
//   SOFT DELETE — sets hidden_at = NOW() on matching rows. Rows stay in the
//   table; UI stops showing them but Claude still remembers them for the
//   intelligence layer. Matches LoraMer's brand promise that memory accumulates
//   and is never silently lost.
//
// Auth: requires session. All reads/writes scoped to session.user.email.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

// LORAMER_MEMORY_AUTODETECT_V1
// Patterns that suggest a user is stating something durable that belongs
// in memory. Conservative — high-precision phrases only. Phase 2.5 will
// layer a Haiku call for fuzzier detection.
const MEMORY_TRIGGER_PATTERNS: Array<{ pattern: RegExp; suggestedCategory: 'directive' | 'fact' | 'preference' }> = [
  // Explicit "remember this" phrasing → fact
  { pattern: /\bremember\b\s*[:,]?\s*(?:that\s+)?/i, suggestedCategory: 'fact' },
  // "Always X" / "Never X" → directive (binding rule)
  { pattern: /^\s*always\b\s+(?:mention|recommend|suggest|focus|use|include|consider|treat|assume)/i, suggestedCategory: 'directive' },
  { pattern: /^\s*never\b\s+(?:mention|recommend|suggest|focus|use|include|flag|surface|treat|assume)/i, suggestedCategory: 'directive' },
  // "Ignore X" / "Don't focus on X" → directive
  { pattern: /^\s*ignore\s+/i, suggestedCategory: 'directive' },
  { pattern: /^\s*(?:don'?t|do\s+not)\s+(?:focus|worry|mention|recommend|suggest|flag|surface)/i, suggestedCategory: 'directive' },
  // "I prefer X" / "I want X" → preference
  { pattern: /^\s*i\s+(?:prefer|want|like)\s+/i, suggestedCategory: 'preference' },
]

function detectMemoryTrigger(content: string): { suggestedContent: string; suggestedCategory: 'directive' | 'fact' | 'preference'; confidence: number } | null {
  const trimmed = content.trim()
  if (!trimmed || trimmed.length < 6 || trimmed.length > 500) return null

  for (const { pattern, suggestedCategory } of MEMORY_TRIGGER_PATTERNS) {
    if (pattern.test(trimmed)) {
      // Truncate to first sentence if possible
      let snippet = trimmed
      const sentenceEnd = snippet.search(/[.!?](?:\s|$)/)
      if (sentenceEnd > 0 && sentenceEnd < 300) snippet = snippet.slice(0, sentenceEnd + 1)
      else if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...'
      // Strip the "Remember:" prefix if present so the saved fact reads naturally
      let cleaned = snippet.replace(/^\s*remember\b\s*[:,]?\s*(?:that\s+)?/i, '').trim()
      if (!cleaned) cleaned = snippet
      return {
        suggestedContent: cleaned,
        suggestedCategory,
        confidence: 0.8,
      }
    }
  }
  return null
}

async function isAlreadyInMemory(clientId: string, userEmail: string, content: string): Promise<boolean> {
  const key = content.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200)
  const { data } = await supabaseAdmin
    .from('client_memory')
    .select('content')
    .eq('client_id', clientId)
    .eq('user_email', userEmail)
    .is('archived_at', null)
  if (!data) return false
  return data.some(m => {
    const mk = (m.content || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 200)
    return mk === key || mk.includes(key) || key.includes(mk)
  })
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const surface = searchParams.get('surface')
  const scope = searchParams.get('scope')
  const includeHidden = searchParams.get('includeHidden') === 'true'
  const limitParam = searchParams.get('limit')
  // LORAMER_CONV_LIMIT_BUMP_V1 — default raised from 50 to 200
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 500) : 200

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('client_conversations')
    .select('id, surface, scope, role, content, created_at, hidden_at')
    .eq('client_id', clientId)
    .eq('user_email', session.user.email)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (surface) query = query.eq('surface', surface)
  if (scope) query = query.eq('scope', scope)
  if (!includeHidden) query = query.is('hidden_at', null)

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

  // LORAMER_MEMORY_AUTODETECT_V1
  // For user-role messages, check if the content suggests a durable
  // statement that belongs in memory. If yes, return a proposal alongside
  // the saved message so the UI can offer "Save to memory?" inline.
  let proposeMemory: { suggestedContent: string; suggestedCategory: string; confidence: number } | null = null
  if (role === 'user') {
    const detected = detectMemoryTrigger(content)
    if (detected) {
      const dup = await isAlreadyInMemory(clientId, session.user.email, detected.suggestedContent)
      if (!dup) proposeMemory = detected
    }
  }

  return NextResponse.json({ message: data, proposeMemory })
}

export async function DELETE(request: Request) {
  // LORAMER_CONV_SOFT_DELETE_V1
  // SOFT DELETE — sets hidden_at instead of removing rows. Memory is preserved
  // for Claude's intelligence layer; only the UI stops showing it.
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
    .update({ hidden_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('user_email', session.user.email)
    .eq('surface', surface)
    .is('hidden_at', null)

  if (scope) query = query.eq('scope', scope)

  const { error } = await query

  if (error) {
    console.error('[conversations] DELETE (soft) error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
