import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message, accountId, summary } = await request.json()

  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  const systemPrompt = `You are an expert Google Ads analyst and strategist for Cote Media, a digital marketing agency. 
You have access to the following account data for account ID ${accountId}:

${summary ? JSON.stringify(summary, null, 2) : 'No account data loaded yet.'}

Answer the user's questions about this account clearly and concisely. 
- Provide specific numbers and insights from the data
- Flag any concerning metrics (high CPC, low CTR, poor ROAS, learning phase issues, etc.)
- Suggest actionable optimizations where relevant
- Be direct and professional
- Format numbers clearly (e.g. $1,234.56, 3.2x ROAS, 4.5% CTR)
- If asked about something not in the data, say so clearly`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
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
