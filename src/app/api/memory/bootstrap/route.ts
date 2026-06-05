// LORAMER_MEMORY_BOOTSTRAP_V1
// /api/memory/bootstrap
//
// One-time-per-client bootstrap of memory facts from existing data:
//   - client_context.user_notes (free-text profile field)
//   - client_conversations (regex-extracted directives from user messages)
//
// GET ?clientId=X
//   Scans existing data, returns array of candidate facts (NOT inserted).
//   Each candidate has: text, guessed category, source description, confidence.
//   Does NOT return candidates that already match active memory rows
//   (so re-running after partial import doesn't show duplicates).
//
// POST { clientId, candidates: [{ content, category }] }
//   Inserts the user's confirmed selections with source='bootstrap_legacy'.
//   user_notes is NOT modified (kept-in-both-places, by design — see roadmap).
//
// Auth: session-scoped to user_email.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

// Mirror of DIRECTIVE_PATTERNS in build-claude-context.ts. Kept in sync
// manually for now; if patterns drift the regex extractor in the prompt
// builder is the source of truth.
const DIRECTIVE_PATTERNS: RegExp[] = [
  /\bignore\b/i,
  /\bdon'?t\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include|flag|highlight|surface)/i,
  /\bdo\s+not\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include|flag|highlight|surface)/i,
  /\bstop\s+(?:mentioning|recommending|suggesting|focusing|talking|flagging|highlighting|surfacing)/i,
  /\bfocus\s+on\b/i,
  /\bprioriti[sz]e\b/i,
  /\b(?:we|i)\s+(?:only|just)\s+care\s+about/i,
  /\bnot\s+important\b/i,
  /\binstead\s+of\b/i,
  /\bremember\s+that\b/i,
  /\bkeep\s+in\s+mind\b/i,
  /\bnever\s+(?:mention|recommend|suggest|focus|use|include|flag|surface)/i,
  /\balways\s+(?:mention|recommend|suggest|focus|use|include|consider)/i,
  /\btarget\s+(?:is|for)\b.*\$/i,
  /\bfor\s+now\b/i,
  /\bdeprioriti[sz]e\b/i,
  /\bdisregard\b/i,
  /\bset\s+aside\b/i,
  /\bnot\s+(?:focus|worry|track|measure)/i,
]

type Candidate = {
  content: string
  category: 'directive' | 'fact' | 'context' | 'preference'
  source_description: string
  confidence: number
}

function isDirectiveLike(text: string): boolean {
  return DIRECTIVE_PATTERNS.some(re => re.test(text))
}

function dedupeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
}

// Split user_notes into discrete candidate facts.
// user_notes is free-text and can contain multiple things in one blob.
// We split on blank lines and on uploaded-doc separators ("[Uploaded: ...]"
// followed by content gets skipped — those are doc dumps, not facts).
function splitUserNotes(notes: string): string[] {
  if (!notes) return []
  // Strip uploaded-doc blocks: anything between [Uploaded: ...] markers
  // gets removed because that's document content, not a directive
  const stripped = notes.replace(/\[Uploaded:[^\]]*\][\s\S]*?(?=(\n\s*---\s*\n|\[Uploaded:|$))/g, '')
  // Split into paragraphs on blank lines or single newlines
  const parts = stripped
    .split(/\n{2,}|\n[-*]\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length <= 500)
  return parts
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  // Fetch user_notes, conversations, AND existing memory in parallel
  const [contextResult, conversationsResult, memoryResult] = await Promise.all([
    supabaseAdmin
      .from('client_context')
      .select('user_notes')
      .eq('client_id', clientId)
      .eq('user_email', session.user.email)
      .single(),
    supabaseAdmin
      .from('client_conversations')
      .select('content, created_at, surface, scope')
      .eq('client_id', clientId)
      .eq('user_email', session.user.email)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('client_memory')
      .select('content')
      .eq('client_id', clientId)
      .eq('user_email', session.user.email)
      .is('archived_at', null),
  ])

  const userNotes = (contextResult.data?.user_notes || '') as string
  const conversations = conversationsResult.data || []
  const existingMemory = memoryResult.data || []

  // Build dedupe set of things already in memory
  const existingKeys = new Set<string>()
  existingMemory.forEach(m => existingKeys.add(dedupeKey(m.content)))

  const candidates: Candidate[] = []
  const seen = new Set<string>(existingKeys)

  // Source 1: user_notes paragraphs
  const notesParts = splitUserNotes(userNotes)
  for (const part of notesParts) {
    const key = dedupeKey(part)
    if (seen.has(key)) continue
    seen.add(key)

    // Guess category: directive-like text → directive, otherwise → context
    const guessedCategory: Candidate['category'] = isDirectiveLike(part) ? 'directive' : 'context'

    candidates.push({
      content: part,
      category: guessedCategory,
      source_description: 'From "Additional Context for Lora" field',
      confidence: 1.0, // user typed it themselves into the form
    })
  }

  // Source 2: regex-detected directives from conversation history
  for (const msg of conversations) {
    const text = (msg.content || '').trim()
    if (!text || text.length > 500) continue
    if (!isDirectiveLike(text)) continue

    // Truncate to first sentence if possible
    let snippet = text
    const sentenceEnd = snippet.search(/[.!?](?:\s|$)/)
    if (sentenceEnd > 0 && sentenceEnd < 300) snippet = snippet.slice(0, sentenceEnd + 1)
    else if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...'

    const key = dedupeKey(snippet)
    if (seen.has(key)) continue
    seen.add(key)

    const dateStr = new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    candidates.push({
      content: snippet,
      category: 'directive',
      source_description: `From your chat with Lora on ${dateStr}`,
      confidence: 0.7, // detected by regex, less certain than direct profile input
    })
  }

  return NextResponse.json({
    candidates,
    notesPresent: !!userNotes,
    conversationsCount: conversations.length,
  })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { clientId, candidates } = body

  if (!clientId || !Array.isArray(candidates) || candidates.length === 0) {
    return NextResponse.json({ error: 'clientId and non-empty candidates required' }, { status: 400 })
  }

  const VALID_CATEGORIES = new Set(['directive', 'fact', 'observation', 'preference', 'context'])

  const rows = candidates
    .filter((c: any) => c && typeof c.content === 'string' && VALID_CATEGORIES.has(c.category))
    .map((c: any) => ({
      client_id: clientId,
      user_email: session.user.email,
      content: String(c.content).trim(),
      category: c.category,
      confidence: typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 1.0,
      source: 'bootstrap_legacy',
      pinned: false,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ error: 'no valid candidates after filter' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('client_memory')
    .insert(rows)
    .select('id, content, category, source')

  if (error) {
    console.error('[memory/bootstrap] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ inserted: data?.length || 0, memory: data || [] })
}
