import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getKeywords, getSearchTerms } from '@/lib/google-ads'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message, accountId, summary, dateRange } = await request.json()
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  let keywords = []
  let searchTerms = []
  try {
    keywords = await getKeywords(session.refreshToken, accountId, dateRange || 'LAST_30_DAYS')
    searchTerms = await getSearchTerms(session.refreshToken, accountId, dateRange || 'LAST_30_DAYS')
  } catch (e) {
    console.error('Error fetching additional data:', e)
  }

  const systemPrompt = `You are an expert Google Ads analyst for Cote Media agency.

ACCOUNT SUMMARY:
${JSON.stringify(summary, null, 2)}

TOP KEYWORDS (by spend):
${JSON.stringify(keywords.slice(0, 50), null, 2)}

SEARCH TERMS REPORT:
${JSON.stringify(searchTerms.slice(0, 100), null, 2)}

Be direct and specific. Use actual numbers. Flag concerns proactively. Suggest concrete next steps. Format with headers and bullets where helpful.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    })
    const data = await response.json()
    const responseText = data.content?.[0]?.text || 'No response generated.'
    return NextResponse.json({ response: responseText })
  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
