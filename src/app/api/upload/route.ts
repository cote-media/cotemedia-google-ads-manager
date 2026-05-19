import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const clientId = formData.get('clientId') as string

    if (!file || !clientId) return NextResponse.json({ error: 'File and clientId required' }, { status: 400 })

    const fileName = file.name.toLowerCase()
    const fileType = fileName.split('.').pop() || ''
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    let extractedText = ''

    if (fileType === 'txt') {
      extractedText = buffer.toString('utf-8')
    } else if (fileType === 'csv') {
      // Parse CSV — convert to readable text summary
      const text = buffer.toString('utf-8')
      const lines = text.split('\n').filter(l => l.trim())
      const headers = lines[0]
      const rowCount = lines.length - 1
      // Include headers and first 50 rows for context
      const preview = lines.slice(0, 51).join('\n')
      extractedText = `CSV File: ${file.name}\nColumns: ${headers}\nTotal rows: ${rowCount}\n\nData:\n${preview}`
    } else if (fileType === 'pdf') {
      const pdf = await import('pdf-parse')
      const data = await pdf.default(buffer)
      extractedText = data.text
    } else if (fileType === 'docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      extractedText = result.value
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Please upload PDF, DOCX, TXT, or CSV.' }, { status: 400 })
    }

    // Clean up extracted text
    extractedText = extractedText
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!extractedText) {
      return NextResponse.json({ error: 'Could not extract text from this file. It may be empty or image-based.' }, { status: 400 })
    }

    // Limit to ~8000 chars to keep token costs reasonable
    const CHAR_LIMIT = 8000
    const truncated = extractedText.length > CHAR_LIMIT
    const finalText = truncated ? extractedText.slice(0, CHAR_LIMIT) + '\n\n[Document truncated at 8,000 characters]' : extractedText

    // Fetch existing context and append
    const { data: existing } = await supabaseAdmin
      .from('client_context')
      .select('user_notes')
      .eq('client_id', clientId)
      .eq('user_email', session.user.email)
      .single()

    const existingNotes = existing?.user_notes || ''
    const separator = existingNotes ? '\n\n---\n\n' : ''
    const updatedNotes = existingNotes + separator + `[Uploaded: ${file.name}]\n${finalText}`

    await supabaseAdmin
      .from('client_context')
      .upsert({
        client_id: clientId,
        user_email: session.user.email,
        user_notes: updatedNotes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,user_email' })

    return NextResponse.json({
      success: true,
      fileName: file.name,
      charCount: finalText.length,
      truncated,
      preview: finalText.slice(0, 300) + (finalText.length > 300 ? '...' : ''),
    })
  } catch (e: any) {
    console.error('Upload error:', e)
    return NextResponse.json({ error: 'Failed to process file: ' + e.message }, { status: 500 })
  }
}
