// LORAMER_KNOWLEDGE_INGEST_V1 — secure Knowledge-store ingest API (reference layer). Validates by CONTENT
// (magic bytes), hashes, extracts text-only (never executes), enforces a per-scope word budget, stores into
// uploaded_docs (NEVER user_notes/client_context), and audits every action incl. rejections. Wired to no UI yet.
// Legacy /api/upload + /clients are untouched.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { createHash } from 'crypto'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { CLIENT_WORD_BUDGET, AGENCY_WORD_BUDGET } from '@/lib/knowledge/budgets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const MAX_BYTES = 25 * 1024 * 1024
const EXTRACT_TIMEOUT_MS = 30000

// detected mime → canonical extension we accept (binary, magic-byte validated)
const BINARY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}
const TEXT_CONTENT_TYPE: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv' }

type Sess = { email: string } | null
async function getSess(): Promise<Sess> {
  const s = (await getServerSession(authOptions)) as any
  return s?.user?.email ? { email: s.user.email } : null
}

// Validate scope + ownership. Returns { ok, status, error, clientId }.
async function resolveScope(scope: string | null, clientIdRaw: string | null, email: string) {
  if (scope !== 'client' && scope !== 'agency') return { ok: false as const, status: 400, error: "scope must be 'client' or 'agency'" }
  if (scope === 'agency') return { ok: true as const, scope, clientId: null as string | null }
  if (!clientIdRaw) return { ok: false as const, status: 400, error: 'clientId required for client scope' }
  const { data: owned } = await supabaseAdmin.from('clients').select('id').eq('id', clientIdRaw).eq('user_email', email).maybeSingle()
  if (!owned) return { ok: false as const, status: 404, error: 'Client not found' }
  return { ok: true as const, scope, clientId: clientIdRaw }
}

function scopeFilter(q: any, scope: string, clientId: string | null, email: string) {
  q = q.eq('owner_email', email).eq('scope', scope).is('deleted_at', null)
  return scope === 'client' ? q.eq('client_id', clientId) : q.is('client_id', null)
}

async function audit(row: Record<string, any>) {
  try { await supabaseAdmin.from('upload_audit').insert(row) } catch (e) { console.error('[knowledge] audit failed:', e) }
}

function countWords(s: string): number { const m = s.trim().match(/\S+/g); return m ? m.length : 0 }
function cleanText(s: string): string { return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }
function isUtf8Text(buf: Buffer): boolean {
  if (buf.includes(0)) return false // NUL byte → binary
  return Buffer.from(buf.toString('utf-8'), 'utf-8').equals(buf) // round-trips only if valid UTF-8
}

async function extractText(type: string, buf: Buffer): Promise<string> {
  const run = (async () => {
    if (type === 'pdf') {
      const { getDocumentProxy, extractText: pdfExtractText } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      const { text } = await pdfExtractText(pdf, { mergePages: true })
      return text || ''
    }
    if (type === 'docx') {
      const mammoth = require('mammoth')
      return (await mammoth.extractRawText({ buffer: buf })).value || '' // macros never run
    }
    if (type === 'xlsx') {
      const XLSX = require('xlsx')
      const wb = XLSX.read(buf, { type: 'buffer' })
      return wb.SheetNames.map((n: string) => `# ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n')
    }
    // txt / md / csv → plain UTF-8
    return buf.toString('utf-8')
  })()
  // zip-bomb / malformed-DoS guard
  return Promise.race([
    run,
    new Promise<string>((_, rej) => setTimeout(() => rej(new Error('extraction timed out')), EXTRACT_TIMEOUT_MS)),
  ])
}

// ── POST: ingest one file ──────────────────────────────────────────────────────
export async function POST(request: Request) {
  const sess = await getSess()
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const email = sess.email

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  const scopeRaw = form.get('scope') ? String(form.get('scope')) : null
  const clientIdRaw = form.get('clientId') ? String(form.get('clientId')) : null
  const file = form.get('file') as File | null

  const sc = await resolveScope(scopeRaw, clientIdRaw, email)
  if (!sc.ok) return NextResponse.json({ error: sc.error }, { status: sc.status })
  const { scope, clientId } = sc
  const filename = file?.name || 'upload'

  const reject = async (status: number, msg: string) => {
    await audit({ owner_email: email, client_id: clientId, scope, action: 'rejected', filename, detail: msg })
    return NextResponse.json({ error: msg }, { status })
  }

  // 1) presence + size
  if (!file) return reject(400, 'File is required')
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length > MAX_BYTES) return reject(400, 'File exceeds 25 MB')

  // 2) magic-byte validation (by CONTENT, not extension)
  const ext = filename.toLowerCase().split('.').pop() || ''
  const { fileTypeFromBuffer } = await import('file-type')
  const ft = await fileTypeFromBuffer(buf)
  let type: string
  let contentType: string
  if (ft && BINARY_MIME[ft.mime]) {
    type = BINARY_MIME[ft.mime]
    contentType = ft.mime
  } else if (ft) {
    return reject(400, "file content doesn't match its type")
  } else {
    // no magic bytes → must be allowlisted text + valid UTF-8
    if (!TEXT_CONTENT_TYPE[ext]) return reject(400, 'Unsupported file type. Allowed: PDF, DOCX, XLSX, TXT, MD, CSV.')
    if (!isUtf8Text(buf)) return reject(400, "file content doesn't match its type")
    type = ext
    contentType = TEXT_CONTENT_TYPE[ext]
  }

  // 3) hash + dedup
  const contentHash = createHash('sha256').update(buf).digest('hex')
  const { data: dupe } = await scopeFilter(supabaseAdmin.from('uploaded_docs').select('id'), scope, clientId, email)
    .eq('content_hash', contentHash).maybeSingle()
  if (dupe) return reject(409, 'This file was already uploaded')

  // 4) extract (text-only, timeout-guarded)
  let text: string
  try { text = cleanText(await extractText(type, buf)) } catch (e: any) { return reject(400, 'Could not read this file: ' + (e?.message || 'extraction failed')) }
  if (!text) return reject(400, 'No text could be extracted (the file may be empty or image-only)')

  // 5) word budget (never silently truncate)
  const wordCount = countWords(text)
  const budget = scope === 'client' ? CLIENT_WORD_BUDGET : AGENCY_WORD_BUDGET
  const { data: existing } = await scopeFilter(supabaseAdmin.from('uploaded_docs').select('word_count'), scope, clientId, email)
  const used = (existing || []).reduce((s: number, r: any) => s + (r.word_count || 0), 0)
  if (used + wordCount > budget) {
    return reject(413, `Would exceed the ~${budget.toLocaleString()}-word knowledge budget: ${used.toLocaleString()} used, this doc ${wordCount.toLocaleString()}.`)
  }

  // 6) store (NEVER user_notes/client_context)
  const { data: doc, error } = await supabaseAdmin.from('uploaded_docs').insert({
    owner_email: email, scope, client_id: clientId, filename, content_type: contentType,
    byte_size: buf.length, content_hash: contentHash, extracted_text: text,
    word_count: wordCount, char_count: text.length, status: 'ready', scan_status: 'deferred',
  }).select('id, filename, word_count, status, created_at').single()
  if (error) { console.error('[knowledge] insert failed:', error); await audit({ owner_email: email, client_id: clientId, scope, action: 'error', filename, detail: error.message }); return NextResponse.json({ error: 'Failed to store the document' }, { status: 500 }) }

  await audit({ owner_email: email, doc_id: doc.id, client_id: clientId, scope, action: 'upload', filename, detail: `${wordCount} words` })
  return NextResponse.json({ doc, usage: { used: used + wordCount, budget } })
}

// ── GET: list docs + usage ─────────────────────────────────────────────────────
export async function GET(request: Request) {
  const sess = await getSess()
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const sc = await resolveScope(searchParams.get('scope'), searchParams.get('clientId'), sess.email)
  if (!sc.ok) return NextResponse.json({ error: sc.error }, { status: sc.status })

  const { data, error } = await scopeFilter(
    supabaseAdmin.from('uploaded_docs').select('id, filename, word_count, char_count, status, scan_status, created_at'),
    sc.scope, sc.clientId, sess.email,
  ).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const docs = data || []
  const budget = sc.scope === 'client' ? CLIENT_WORD_BUDGET : AGENCY_WORD_BUDGET
  const used = docs.reduce((s: number, r: any) => s + (r.word_count || 0), 0)
  return NextResponse.json({ docs, usage: { used, budget } })
}

// ── DELETE: soft-delete one doc ────────────────────────────────────────────────
export async function DELETE(request: Request) {
  const sess = await getSess()
  if (!sess) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: doc } = await supabaseAdmin.from('uploaded_docs')
    .select('id, owner_email, scope, client_id, filename, deleted_at').eq('id', id).maybeSingle()
  if (!doc || doc.owner_email !== sess.email || doc.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.scope === 'client') {
    const { data: owned } = await supabaseAdmin.from('clients').select('id').eq('id', doc.client_id).eq('user_email', sess.email).maybeSingle()
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await supabaseAdmin.from('uploaded_docs').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('owner_email', sess.email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await audit({ owner_email: sess.email, doc_id: id, client_id: doc.client_id, scope: doc.scope, action: 'delete', filename: doc.filename })
  return NextResponse.json({ ok: true })
}
