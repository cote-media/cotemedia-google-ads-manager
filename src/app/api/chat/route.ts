import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getKeywords, getSearchTerms } from '@/lib/google-ads'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message, accountId, summary, dateRange, history, accountName } = await request.json()
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  let keywords: any[] = []
  let searchTerms: any[] = []
  try {
    keywords = await getKeywords(session.refreshToken, accountId, dateRange || 'LAST_30_DAYS')
    searchTerms = await getSearchTerms(session.refreshToken, accountId, dateRange || 'LAST_30_DAYS')
  } catch (e) {
    console.error('Error fetching additional data:', e)
  }


  // Clean status codes before sending to Claude
  const cleanedSummary = summary ? {
    ...summary,
    campaigns: (summary.campaigns || []).map((c: any) => ({
      ...c,
      status: c.status === '2' ? 'Active' : c.status === '3' ? 'Paused' : c.status === '4' ? 'Removed' : c.status,
      type: c.type === '2' ? 'Search' : c.type === '9' ? 'Smart' : c.type === '10' ? 'Performance Max' : c.type === '3' ? 'Display' : c.type === '4' ? 'Shopping' : c.type === '6' ? 'Video' : c.type
    }))
  } : summary;

  const cleanedKeywords = keywords.map((k: any) => ({
    ...k,
    matchType: k.matchType === '4' ? 'Broad' : k.matchType === '3' ? 'Phrase' : k.matchType === '2' ? 'Exact' : k.matchType,
    status: k.status === '2' ? 'Active' : k.status === '3' ? 'Paused' : k.status === '4' ? 'Removed' : k.status,
  }));

  const systemPrompt = `You are a senior PPC strategist at Cote Media agency, analyzing Google Ads data for your client: ${accountName || accountId}. Always refer to this account by name (${accountName || accountId}) when discussing their data. Never say 'Cote Media' when referring to the advertiser — Cote Media is the agency, ${accountName || accountId} is the client.

ACCOUNT SUMMARY:
${JSON.stringify(cleanedSummary, null, 2)}

TOP KEYWORDS (by spend):
${JSON.stringify(cleanedKeywords.slice(0, 50), null, 2)}

SEARCH TERMS REPORT:
${JSON.stringify(searchTerms.slice(0, 100), null, 2)}

VOICE AND TONE: You are a senior PPC strategist with strong opinions. Be direct, opinionated, and confident. Never hedge. Use actual numbers always. Lead with the most important finding, not a summary. Use emojis sparingly but effectively to flag critical issues (🚩 for problems, ⭐ for top performers, ❌ for things to kill immediately). Write like you are briefing a client in person, not writing a report. Short punchy sentences. Call out waste and missed opportunities aggressively. Always end with a clear priority order for next actions.`

  // Build messages array with history
  const messages = [
    ...(history || []),
    { role: 'user', content: message }
  ]

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
        max_tokens: 8000,
        system: systemPrompt,
        messages,
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
