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

  // Fetch keywords and search terms for full context
  let keywords = []
  let searchTerms = []
  try {
    keywords = await getKeywords(session.refreshToken, accountId, dateRange || 'LAST_30_DAYS')
    searchTerms = await getSearchTerms(session.refreshToken, accountId, dateRange || 'LAST_30_DAYS')
  } catch (e) {
    console.error('Error fetching additional data:', e)
  }

  const systemPrompt = `You are an expert Google Ads analyst and strategist for Cote Media, a digital marketing agency. You have full access to the following account data:

ACCOUNT SUMMARY:
${JSON.stringify(summary, null, 2)}

TOP KEYWORDS (by spend):
${JSON.stringify(keywords.slice(0, 50), null, 2)}

SEARCH TERMS REPORT:
${JSON.stringify(searchTerms.slice(0, 100), null, 2)}

Guidelines:
- Be direct and specific — use actual numbers from the data
- Flag concerns proactively (wasted spend, low quality scores, irrelevant search terms)
- Suggest concrete next steps, not vague advice
- Format responses clearly with headers and bullets where helpful
- You have keyword AND search term data — use both to give deep insights
- If asked about something not in the data, say so`

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
sed -i '' "s/body: JSON.stringify({ message: userMsg, accountId: selectedAccount, summary })/body: JSON.stringify({ message: userMsg, accountId: selectedAccount, summary, dateRange })/" src/app/dashboard/page.tsx
git add .
git commit -m "Add keywords and search terms to chat context"
git push
git add .
git commit -m "Add keywords and search terms to chat context"
git push
